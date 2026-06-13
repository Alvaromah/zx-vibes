import type { Z80 } from '@zx-vibes/emulator/src/core/cpu.js';
import type { Machine } from './machine.js';

export type HangKind = 'di-halt' | 'rom-error' | 'tight-loop' | 'sp-corrupt' | 'pc-in-rom';

export interface HangVerdict {
  kind: HangKind;
  /** PC where the problem was detected. */
  pc: number;
  detail: string;
  confidence: 'definite' | 'probable';
  likelyCause?: string;
}

const SCREEN_START = 0x4000;
const SCREEN_END = 0x5aff; // bitmap + attributes
const ROM_END = 0x3fff;
const RING_SIZE = 64;
/** Frames without any screen write before a tight loop counts as hung. */
const STATIC_FRAMES_THRESHOLD = 25;
/**
 * Frames of uninterrupted ROM execution (after the program ran from RAM)
 * before concluding it crashed into the ROM. Generous (~1s) because long
 * legitimate ROM calls exist (BEEP holds the CPU for the note's duration).
 */
const ROM_RESIDENCE_FRAMES_THRESHOLD = 50;

/**
 * Run-time hang/crash classifier. Attach before a run (patches memory.write
 * on the instance to count screen writes), pass to RunOptions.watchdog, and
 * detach afterwards. Definite verdicts (di-halt, rom-error) stop the run
 * immediately; probable ones (tight-loop, sp-corrupt, pc-in-rom) are
 * evaluated when the frame budget is exhausted.
 */
export class Watchdog {
  private ring = new Uint16Array(RING_SIZE);
  private ringIdx = 0;
  private ringFilled = false;
  private framesSeen = 0;
  private lastScreenWriteFrame = 0;
  private lastRamExecFrame = 0;
  private sawRamExec = false;
  private haltFrames = 0;
  private sawHaltThisFrame = false;
  private machine: Machine | undefined;

  attach(m: Machine): void {
    this.machine = m;
  }

  onMemoryWrite(addr: number, _value: number): void {
    const a = addr & 0xffff;
    if (a >= SCREEN_START && a <= SCREEN_END) {
      this.lastScreenWriteFrame = this.framesSeen;
    }
  }

  detach(): void {
    this.machine = undefined;
  }

  /** Called before each instruction. A verdict stops the run. */
  beforeInstruction(pc: number, m: Machine): HangVerdict | null {
    this.ring[this.ringIdx] = pc;
    this.ringIdx = (this.ringIdx + 1) % RING_SIZE;
    if (this.ringIdx === 0) this.ringFilled = true;

    if (pc > ROM_END) {
      this.lastRamExecFrame = this.framesSeen;
      this.sawRamExec = true;
    }

    if (pc === 0x0008) {
      // RST 8 — the ROM error restart. Only a crash when invoked from RAM:
      // the BASIC interpreter itself reports through here from ROM addresses.
      const sp = m.cpu.registers.get16('SP');
      const caller = m.memory.read(sp) | (m.memory.read((sp + 1) & 0xffff) << 8);
      if (caller >= 0x4000) {
        const errCode = m.memory.read(caller);
        return {
          kind: 'rom-error',
          pc,
          confidence: 'definite',
          detail: `RST 8 (ROM error restart) invoked from ${hex(caller - 1)} with error code ${hex(errCode, 2)}`,
          likelyCause:
            'Your code called RST 8 or crashed into it — check for a wild jump or a ROM routine reporting an error.',
        };
      }
      return null;
    }

    if (pc === 0x0000 && this.framesSeen + this.ringFilledCount() > 0) {
      return {
        kind: 'rom-error',
        pc,
        confidence: 'definite',
        detail: 'PC reached 0x0000 (reset entry) during execution',
        likelyCause:
          'Wild jump or corrupted stack: a RET popped a bad address, or a JP/JR went to zeroed memory.',
      };
    }

    return null;
  }

  /** Called after each instruction. A verdict stops the run. */
  afterInstruction(cpu: Z80): HangVerdict | null {
    if (cpu.halted) {
      this.sawHaltThisFrame = true;
      if (!cpu.iff1) {
        return {
          kind: 'di-halt',
          pc: cpu.registers.getPC(),
          confidence: 'definite',
          detail: `HALT executed with interrupts disabled (PC now ${hex(cpu.registers.getPC())}) — nothing can ever wake the CPU`,
          likelyCause:
            'A DI without a matching EI before HALT. If you use HALT for frame sync, execute EI first.',
        };
      }
    }
    return null;
  }

  /** Called at each frame boundary. */
  onFrame(): void {
    this.framesSeen++;
    if (this.sawHaltThisFrame) this.haltFrames++;
    this.sawHaltThisFrame = false;
  }

  /** Called when the budget is exhausted without a definite verdict. */
  finalize(m: Machine, framesRun: number): HangVerdict | null {
    const sp = m.cpu.registers.get16('SP');
    if (sp !== 0 && sp < 0x4000) {
      return {
        kind: 'sp-corrupt',
        pc: m.cpu.registers.getPC(),
        confidence: 'probable',
        detail: `SP=${hex(sp)} points into ROM — the stack has drifted out of RAM`,
        likelyCause: 'Unbalanced PUSH/POP or CALL/RET in a loop; the crash is only a matter of time.',
      };
    }

    // Checked before haltSynced: the ROM editor's key wait IS halt-synced,
    // which is exactly how crashes into the BASIC editor used to hide.
    if (this.sawRamExec) {
      const romFrames = this.framesSeen - this.lastRamExecFrame;
      if (romFrames > ROM_RESIDENCE_FRAMES_THRESHOLD) {
        return {
          kind: 'pc-in-rom',
          pc: m.cpu.registers.getPC(),
          confidence: 'probable',
          detail:
            `PC has stayed inside ROM (0x0000-0x3FFF) for ${romFrames} frames ` +
            `since the program last executed from RAM`,
          likelyCause:
            'A wild jump or bad RET handed control back to the ROM — typically the BASIC ' +
            'editor (check the screen for the © prompt or a report line). If you called a ' +
            'long ROM routine on purpose (e.g. BEEP), raise the frame budget.',
        };
      }
    }

    if (this.haltSynced(framesRun)) return null; // healthy HALT-synced loop

    if (this.ringFilled && framesRun > 0) {
      const unique = new Set(this.ring);
      const span = Math.max(...unique) - Math.min(...unique);
      const staticFrames = this.framesSeen - this.lastScreenWriteFrame;
      if (unique.size <= 8 && span <= 32 && staticFrames > STATIC_FRAMES_THRESHOLD) {
        const lo = Math.min(...unique);
        const hi = Math.max(...unique);
        return {
          kind: 'tight-loop',
          pc: m.cpu.registers.getPC(),
          confidence: 'probable',
          detail:
            `PC confined to ${hex(lo)}-${hex(hi)} (${unique.size} distinct addresses) ` +
            `with no screen writes for ${staticFrames} frames`,
          likelyCause:
            'Infinite loop — or a keyboard-poll wait. If it is waiting for input, rerun with --keys.',
        };
      }
    }
    return null;
  }

  /** True when the program HALT-synced on most frames (healthy game loop). */
  haltSynced(framesRun: number): boolean {
    return framesRun > 0 && this.haltFrames >= framesRun * 0.5;
  }

  get metrics(): { haltFrames: number; framesSeen: number; lastScreenWriteFrame: number } {
    return {
      haltFrames: this.haltFrames,
      framesSeen: this.framesSeen,
      lastScreenWriteFrame: this.lastScreenWriteFrame,
    };
  }

  private ringFilledCount(): number {
    return this.ringFilled ? RING_SIZE : this.ringIdx;
  }
}

function hex(n: number, width = 4): string {
  return `0x${n.toString(16).toUpperCase().padStart(width, '0')}`;
}
