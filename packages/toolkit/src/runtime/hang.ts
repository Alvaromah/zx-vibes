// Run hang watchdog — errors.md ERR-PROD-HANG-SHAPE-001 / -KINDS-001 / -HEUR-001,
// toolkit-runtime.md RT-PROD-RUN-003, cli.md CLI-PROD-OUT-RUN-002.
//
// The verdict SHAPE and the HangKind set are contract; the detection thresholds are
// Incidental heuristics (ERR-PROD-HANG-HEUR-001). The two `definite` kinds
// (`di-halt`, `rom-error`) are tested per-instruction and stop the run immediately;
// the three `probable` kinds (`pc-in-rom`, `sp-corrupt`, `tight-loop`) are decided at
// frame-budget exhaustion from per-frame progress statistics.

import type { Machine } from '@zx-vibes/machine';

/** The stable HangKind enum (ERR-PROD-HANG-KINDS-001). */
export type HangKind = 'di-halt' | 'rom-error' | 'tight-loop' | 'sp-corrupt' | 'pc-in-rom';

/** A hang verdict — the contract shape (ERR-PROD-HANG-SHAPE-001). */
export interface HangVerdict {
  kind: HangKind;
  pc: number;
  detail: string;
  confidence: 'definite' | 'probable';
  likelyCause?: string;
}

/** Top of ROM / bottom of RAM. A 48K program runs in RAM (org ≥ this). */
export const RAM_BASE = 0x4000;
/** The ROM error restart (RST $08, ERROR-1) — reaching it means the program faulted into the ROM. */
export const ROM_ERROR_VECTOR = 0x0008;

// Incidental heuristic thresholds (ERR-PROD-HANG-HEUR-001).
const STATIC_FRAMES = 50; // ≈ 1 emulated second of zero progress before a probable verdict
const PC_SPAN_TIGHT = 8; // frame-boundary PC confined to ≤ this many bytes ⇒ a tight loop

/** Per-frame progress statistics the probable verdicts are decided from. */
export interface HangStats {
  fingerprint: number; // running RAM+register checksum of the last frame
  staticFrames: number; // consecutive frames with an unchanged fingerprint
  pcMin: number; // min frame-boundary PC over the static window
  pcMax: number; // max frame-boundary PC over the static window
  romFrames: number; // consecutive frames ending with PC in ROM
  started: boolean;
}

/** A fresh progress-statistics accumulator. */
export function newHangStats(): HangStats {
  return { fingerprint: 0, staticFrames: 0, pcMin: 0xffff, pcMax: 0, romFrames: 0, started: false };
}

// A cheap rolling checksum over RAM (0x4000–0xFFFF) + the core registers. Any change
// — an animating screen, an ISR bumping a counter, score updates — counts as
// progress, so the static-fingerprint heuristic only fires when the machine is
// genuinely frozen (no interrupts mutating state, no work being done).
function fingerprint(machine: Machine): number {
  const mem = machine.memory;
  let sum = 0x811c9dc5;
  // Stride the 49152-byte RAM so the per-frame cost stays small but any localized
  // change is still very likely to perturb the sum.
  for (let addr = RAM_BASE; addr < 0x10000; addr += 7) {
    sum ^= mem[addr]!;
    sum = Math.imul(sum, 0x01000193);
  }
  const reg = machine.registers as Record<string, number>;
  for (const name of ['pc', 'sp', 'a', 'f', 'b', 'c', 'd', 'e', 'h', 'l']) {
    sum ^= reg[name] ?? 0;
    sum = Math.imul(sum, 0x01000193);
  }
  return sum >>> 0;
}

/**
 * Fold one frame-boundary observation into the progress statistics.
 *
 * `haltResumed` = this frame's once-per-frame interrupt resumed the CPU from a
 * HALT wait. That is the healthy HALT-synced game-loop cadence (an idle loop
 * waiting on input, the ISR still bumping FRAMES/KSTATE), so it counts as
 * progress even when the strided fingerprint misses the sysvar writes. Without
 * this, a boundary-pinned frame loop samples an idle `EI / HALT / JR` loop in
 * the identical waiting state every frame and the static-fingerprint heuristic
 * would misread the healthiest program shape as a tight-loop hang. A genuine
 * busy loop (`DI` or never halting) never resumes from HALT, so tight-loop
 * detection for it is unaffected (thresholds stay Incidental,
 * ERR-PROD-HANG-HEUR-001).
 */
export function updateHangStats(stats: HangStats, machine: Machine, haltResumed = false): void {
  const pc = (machine.registers.pc as number) & 0xffff;
  const fp = fingerprint(machine);
  if (!haltResumed && stats.started && fp === stats.fingerprint) {
    stats.staticFrames += 1;
    stats.pcMin = Math.min(stats.pcMin, pc);
    stats.pcMax = Math.max(stats.pcMax, pc);
  } else {
    stats.staticFrames = 0;
    stats.pcMin = pc;
    stats.pcMax = pc;
  }
  stats.fingerprint = fp;
  stats.started = true;
  stats.romFrames = pc < RAM_BASE ? stats.romFrames + 1 : 0;
}

/**
 * A `definite` hang at the current instruction boundary, or `undefined`. Checked
 * after every instruction; a hit stops the run immediately (ERR-PROD-HANG-KINDS-001).
 */
export function definiteHang(machine: Machine, org: number): HangVerdict | undefined {
  const pc = (machine.registers.pc as number) & 0xffff;
  if (machine.halted && !machine.registers.iff1) {
    return {
      kind: 'di-halt',
      pc,
      detail: 'HALT executed with interrupts disabled (IFF1 = 0)',
      confidence: 'definite',
      likelyCause: 'The CPU halted with interrupts disabled; no interrupt can ever resume it',
    };
  }
  if (org >= RAM_BASE && pc === ROM_ERROR_VECTOR) {
    return {
      kind: 'rom-error',
      pc,
      detail: 'PC reached the ROM error restart (RST $08)',
      confidence: 'definite',
      likelyCause: 'Execution fell into the ROM error handler — likely a bad CALL/RET or stack imbalance',
    };
  }
  return undefined;
}

/**
 * A `probable` hang decided at frame-budget exhaustion, or `undefined` (a healthy run
 * that simply ran out its budget, RT-PROD-EDGE-001). Evaluated most-specific first.
 */
export function probableHang(machine: Machine, org: number, stats: HangStats): HangVerdict | undefined {
  const pc = (machine.registers.pc as number) & 0xffff;
  const sp = (machine.registers.sp as number) & 0xffff;

  // Execution left the program and is stuck in ROM (only meaningful for a RAM program).
  if (org >= RAM_BASE && stats.romFrames >= STATIC_FRAMES) {
    return {
      kind: 'pc-in-rom',
      pc,
      detail: `PC has been resident in ROM (< 0x4000) for ${stats.romFrames} frames`,
      confidence: 'probable',
      likelyCause: 'Execution left the program into ROM and never returned',
    };
  }

  // Frozen with no progress: a tight loop, with the stack intact vs corrupt distinguished.
  if (stats.staticFrames >= STATIC_FRAMES) {
    if (org >= RAM_BASE && sp < RAM_BASE) {
      return {
        kind: 'sp-corrupt',
        pc,
        detail: `No progress for ${stats.staticFrames} frames with SP in ROM/low memory (0x${sp.toString(16)})`,
        confidence: 'probable',
        likelyCause: 'The stack pointer points into ROM/low memory — a stack underflow/overflow likely crashed the program',
      };
    }
    const span = stats.pcMax - stats.pcMin;
    return {
      kind: 'tight-loop',
      pc,
      detail:
        span <= PC_SPAN_TIGHT
          ? `No progress for ${stats.staticFrames} frames in a ${span + 1}-byte PC span`
          : `No progress for ${stats.staticFrames} frames (machine state frozen)`,
      confidence: 'probable',
      likelyCause: 'Execution is stuck in a loop that makes no observable progress',
    };
  }

  // Stack corrupt but still making some change elsewhere — flag it on its own.
  if (org >= RAM_BASE && sp < RAM_BASE) {
    return {
      kind: 'sp-corrupt',
      pc,
      detail: `SP points into ROM/low memory (0x${sp.toString(16)})`,
      confidence: 'probable',
      likelyCause: 'The stack pointer points into ROM/low memory — likely stack corruption',
    };
  }

  return undefined;
}
