import { PC_KEY_MAP, SPECTRUM_KEYS } from '@zx-vibes/emulator/src/spectrum/ula.js';
import type { Machine } from './machine.js';

export interface KeyEvent {
  /** Frame offset relative to the start of the run (0 = before first frame). */
  frame: number;
  key: string;
  action: 'down' | 'up';
}

/**
 * Parses the agent-facing key spec: "60:O*30, 120:SPACE*5"
 * → press O at frame 60 for 30 frames, SPACE at 120 for 5 frames.
 */
export function parseKeysSpec(spec: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+):([A-Za-z0-9_]+)(?:\*(\d+))?$/);
    if (!match) {
      throw new Error(
        `Invalid key spec '${trimmed}' (expected frame:KEY*holdFrames, e.g. "60:O*30")`
      );
    }
    const frame = parseInt(match[1]!, 10);
    const key = match[2]!.toUpperCase();
    const hold = match[3] !== undefined ? parseInt(match[3], 10) : 3;
    if (hold < 1) {
      throw new Error(`Invalid key spec '${trimmed}' (holdFrames must be at least 1)`);
    }
    if (!SPECTRUM_KEYS[key]) {
      throw new Error(
        `Unknown Spectrum key '${key}'. Valid: A-Z, 0-9, ENTER, SPACE, CAPS_SHIFT, SYMBOL_SHIFT`
      );
    }
    events.push({ frame, key, action: 'down' });
    events.push({ frame: frame + hold, key, action: 'up' });
  }
  return sortEvents(events);
}

/**
 * Compiles text into a key plan using the Spectrum key matrix.
 * Letters map to their key (the Spectrum has one key per letter); digits,
 * SPACE and ENTER are direct; punctuation uses SYMBOL/CAPS SHIFT combos
 * from PC_KEY_MAP. Unmappable characters throw.
 */
export function compileTypeText(text: string, opts: { framesPerKey?: number } = {}): KeyEvent[] {
  const hold = opts.framesPerKey ?? 3;
  const gap = 2; // released frames between keystrokes so the ROM sees distinct presses
  const events: KeyEvent[] = [];
  let frame = 0;

  for (const ch of text) {
    const keys = resolveChar(ch);
    for (const key of keys) events.push({ frame, key, action: 'down' });
    for (const key of keys) events.push({ frame: frame + hold, key, action: 'up' });
    frame += hold + gap;
  }
  return sortEvents(events);
}

function resolveChar(ch: string): string[] {
  if (ch === '\n') return ['ENTER'];
  const upper = ch.toUpperCase();
  if (/^[A-Z0-9 ]$/.test(upper)) {
    return [upper === ' ' ? 'SPACE' : upper];
  }
  const mapped = PC_KEY_MAP[ch];
  if (typeof mapped === 'string') return [mapped];
  if (mapped && 'keys' in mapped) return mapped.keys;
  throw new Error(`Cannot type character '${ch}' on a Spectrum keyboard`);
}

function sortEvents(events: KeyEvent[]): KeyEvent[] {
  // Stable order: by frame, ups before downs at the same frame so a re-press
  // of the same key within one frame boundary still registers an edge.
  return events.sort(
    (a, b) => a.frame - b.frame || (a.action === b.action ? 0 : a.action === 'up' ? -1 : 1)
  );
}

/** Applies KeyEvents at frame boundaries; wire `onFrame` into RunOptions. */
export class KeyPlanRunner {
  private idx = 0;
  constructor(
    private readonly events: KeyEvent[],
    private readonly machine: Machine
  ) {}

  /** Total frames needed for every event to fire (plus one settling frame). */
  get planFrames(): number {
    return this.events.length === 0 ? 0 : this.events[this.events.length - 1]!.frame + 1;
  }

  /** Apply all events due at this frame offset (call with 0 before running). */
  applyDue(frameOffset: number): void {
    while (this.idx < this.events.length && this.events[this.idx]!.frame <= frameOffset) {
      const ev = this.events[this.idx++]!;
      this.machine.setKey(ev.key, ev.action === 'down');
    }
  }
}
