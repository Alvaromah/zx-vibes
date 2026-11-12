// Run hang watchdog — errors.md ERR-PROD-HANG-SHAPE-001 / -KINDS-001 / -HEUR-001,
// toolkit-runtime.md RT-PROD-RUN-003, cli.md CLI-PROD-OUT-RUN-002.
//
// The verdict SHAPE and the HangKind set are contract; the detection thresholds are
// Incidental heuristics (ERR-PROD-HANG-HEUR-001). The two `definite` kinds
// (`di-halt`, `rom-error`) are tested per-instruction and stop the run immediately;
// the three `probable` kinds (`pc-in-rom`, `sp-corrupt`, `tight-loop`) are decided at
// frame-budget exhaustion from per-frame progress statistics. The ROM idling with the
// frame interrupt serviced (BASIC waiting for a key) and the ROM's own power-on boot are
// not hangs; a program that resets the machine is (ERR-PROD-HANG-IDLE-001).

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
/**
 * The reset vector. The 48K ROM's START (`DI`, then the RAM test that fills and clears
 * all RAM, then the copyright and the BASIC editor) runs from here: a power-on boot, or —
 * when a program jumps here — a reset that wipes the program.
 */
export const RESET_VECTOR = 0x0000;

// Incidental heuristic thresholds (ERR-PROD-HANG-HEUR-001).
const STATIC_FRAMES = 50; // ≈ 1 emulated second of zero progress before a probable verdict
const PC_SPAN_TIGHT = 8; // frame-boundary PC confined to ≤ this many bytes ⇒ a tight loop

/** Per-frame progress statistics the probable verdicts are decided from. */
export interface HangStats {
  fingerprint: number; // running RAM+register+I/O checksum of the last frame
  staticFrames: number; // consecutive frames with an unchanged fingerprint
  pcMin: number; // min frame-boundary PC over the static window
  pcMax: number; // max frame-boundary PC over the static window
  romFrames: number; // consecutive frames RESIDENT in ROM (no RAM PC all frame)
  started: boolean;
  /**
   * The machine is in the ROM's reset sequence and has run no RAM code since: `boot` when
   * the run itself entered at the reset vector (a power-on boot — there is no program to
   * have left), `reset` when the program jumped to {@link RESET_VECTOR} during the run (it
   * reset the 48K, whose RAM test wipes the program). Cleared when RAM code runs.
   */
  sinceReset?: 'boot' | 'reset' | undefined;
  /** 1-based frame in which the program reset the machine (`sinceReset === 'reset'`). */
  resetFrame?: number | undefined;
}

/**
 * The observable-I/O progress signals folded into the liveness fingerprint. The RAM
 * stride can miss a program whose only per-frame work lands between sampled bytes
 * (e.g. a title loop bumping one counter), but such a program almost always also
 * TOUCHES the ULA — cycling the border, clicking the beeper — and those signals are
 * exact, not sampled: any border change or new port-`0xFE` write/edge in a frame
 * perturbs the fingerprint and counts as progress. A genuinely frozen machine emits
 * none of them. Structurally satisfied by `HostIo` (io-device.ts).
 */
export interface IoProgress {
  borderColor(): number;
  beeperEdges: number;
  portFEWrites: number;
}

/** A fresh progress-statistics accumulator. */
export function newHangStats(): HangStats {
  return { fingerprint: 0, staticFrames: 0, pcMin: 0xffff, pcMax: 0, romFrames: 0, started: false };
}

// A cheap rolling checksum over RAM (0x4000–0xFFFF) + the core registers + the
// observable I/O counters. Any change — an animating screen, an ISR bumping a
// counter, score updates, a cycling border, a beeper click — counts as progress,
// so the static-fingerprint heuristic only fires when the machine is genuinely
// frozen (no interrupts mutating state, no work being done, no ULA output).
function fingerprint(machine: Machine, io?: IoProgress): number {
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
  // The I/O signals are exact (not strided): border colour + the cumulative beeper-edge
  // and port-0xFE write counts. A program alive only through the ULA still fingerprints
  // as progress; a frozen one leaves all three constant.
  if (io) {
    for (const value of [io.borderColor(), io.beeperEdges, io.portFEWrites]) {
      sum ^= value >>> 0;
      sum = Math.imul(sum, 0x01000193);
    }
  }
  return sum >>> 0;
}

/** Optional per-frame observations beyond the machine itself. */
export interface HangFrameObservation {
  /**
   * This frame's once-per-frame interrupt resumed the CPU from a HALT wait. That is
   * the healthy HALT-synced game-loop cadence (an idle loop waiting on input, the ISR
   * still bumping FRAMES/KSTATE), so it counts as progress even when the strided
   * fingerprint misses the sysvar writes. Without this, a boundary-pinned frame loop
   * samples an idle `EI / HALT / JR` loop in the identical waiting state every frame
   * and the static-fingerprint heuristic would misread the healthiest program shape
   * as a tight-loop hang. A genuine busy loop (`DI` or never halting) never resumes
   * from HALT, so tight-loop detection for it is unaffected (thresholds stay
   * Incidental, ERR-PROD-HANG-HEUR-001).
   */
  haltResumed?: boolean;
  /** The run's observable-I/O device, folded into the liveness fingerprint. */
  io?: IoProgress;
  /**
   * Whether any instruction boundary this frame had PC in RAM (≥ 0x4000). Feeds the
   * ROM-RESIDENCE statistic: `pc-in-rom` must mean "execution left the program into
   * ROM and never came back", not "the frame-edge sample happened to land inside the
   * ROM's IM 1 keyboard scan". A busy IM 1 game spends the frame edge wherever its
   * work loop is, but its ISR frames still EXECUTE RAM instructions — so a frame that
   * touched RAM resets the count. A program genuinely stuck in ROM (`JP` into a ROM
   * loop) never touches RAM again and still accumulates. When not observed (older
   * callers), the frame-edge PC alone decides, as before.
   */
  sawRamPc?: boolean;
  /**
   * Whether this frame's maskable interrupt was accepted. A ROM-resident frame that took
   * it is the ROM IDLING, not stuck (ERR-PROD-HANG-IDLE-001): interrupts are enabled and
   * the IM 1 handler scans the keyboard every frame, which is the BASIC editor, `INPUT`,
   * `PAUSE` or `INKEY$` waiting for a key, or a BASIC program running. That loop busy-polls
   * with a frozen fingerprint, so without this it read as both `pc-in-rom` and
   * `tight-loop`. It exempts ROM-resident frames only: an `EI` busy loop in RAM keeps its
   * verdict, and a `DI` machine never takes the interrupt.
   */
  interruptAccepted?: boolean;
}

/** Fold one frame-boundary observation into the progress statistics. */
export function updateHangStats(
  stats: HangStats,
  machine: Machine,
  observation: HangFrameObservation | boolean = {},
): void {
  // Back-compat: the pre-observation signature was (stats, machine, haltResumed).
  const obs: HangFrameObservation =
    typeof observation === 'boolean' ? { haltResumed: observation } : observation;
  const pc = (machine.registers.pc as number) & 0xffff;
  const fp = fingerprint(machine, obs.io);
  // ROM residence: the frame ended in ROM AND (when observed) never executed a RAM
  // instruction — see HangFrameObservation.sawRamPc. A resident frame that accepted the
  // frame interrupt is the ROM idling on its keyboard loop: progress, not a hang.
  const romResident = pc < RAM_BASE && obs.sawRamPc !== true;
  const romIdle = romResident && obs.interruptAccepted === true;
  if (!obs.haltResumed && !romIdle && stats.started && fp === stats.fingerprint) {
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
  // While the ROM's reset sequence runs (a boot, or after the program reset the machine)
  // residence is the reset's business, decided by `sinceReset`, not frame counting.
  stats.romFrames =
    romResident && !romIdle && stats.sinceReset === undefined ? stats.romFrames + 1 : 0;
}

/**
 * Per-instruction reset tracking (see {@link HangStats.sinceReset}), called with the PC
 * after each executed instruction. Reaching {@link RESET_VECTOR} marks a reset (unless the
 * run is still the ROM's own boot); any RAM PC means a program runs again and clears it.
 */
export function noteInstructionPc(stats: HangStats, pc: number, frame: number): void {
  if (pc === RESET_VECTOR) {
    if (stats.sinceReset === undefined) {
      stats.sinceReset = 'reset';
      stats.resetFrame = frame;
    }
  } else if (pc >= RAM_BASE && stats.sinceReset !== undefined) {
    stats.sinceReset = undefined;
    stats.resetFrame = undefined;
  }
}

/** Whether the opcode at `op` (then `next`) returns: RET, RET cc, or ED RETN/RETI. */
export function isReturnOpcode(op: number, next: number): boolean {
  return op === 0xc9 || (op & 0xc7) === 0xc0 || (op === 0xed && (next & 0xc7) === 0x45);
}

/**
 * Mark a run that ENTERS at the reset vector as the ROM's power-on boot: no program is
 * loaded yet, so its ROM residence (the `DI` RAM test, then the editor) is not a program
 * that left into ROM. Cleared by the first RAM instruction, like a reset.
 */
export function noteBootEntry(stats: HangStats, entryPc: number): void {
  if ((entryPc & 0xffff) === RESET_VECTOR) stats.sinceReset = 'boot';
}

/**
 * A `definite` hang at the current instruction boundary, or `undefined`. Checked
 * after every instruction; a hit stops the run immediately (ERR-PROD-HANG-KINDS-001).
 *
 * `fromProgram` says whether reaching the ROM error restart now is the PROGRAM's doing:
 * the step ran RAM code, or ROM code the program called or jumped into and has not
 * returned from. When BASIC itself reports an error (`2 Variable not found` typed in the
 * editor, a BASIC `STOP`), that is ordinary BASIC, not a crash (ERR-PROD-HANG-IDLE-001).
 */
export function definiteHang(
  machine: Machine,
  org: number,
  fromProgram = true,
): HangVerdict | undefined {
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
  if (org >= RAM_BASE && pc === ROM_ERROR_VECTOR && fromProgram) {
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

  // The program reset the machine and never ran again. Once the ROM's RAM test has
  // wiped it, the 48K sits idle in BASIC (which on its own is not a hang,
  // ERR-PROD-HANG-IDLE-001), so this is the only trace of the crash.
  if (org >= RAM_BASE && stats.sinceReset === 'reset') {
    return {
      kind: 'pc-in-rom',
      pc,
      detail: `The program jumped to 0x0000 in frame ${stats.resetFrame ?? 0}, resetting the machine, and never ran RAM code again`,
      confidence: 'probable',
      likelyCause:
        'A jump or return to 0x0000 (a corrupt stack, or running off the end of the code) reset the 48K; the ROM cleared RAM and is in BASIC',
    };
  }

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
