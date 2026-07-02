// Declarative assertion engine — recipes-and-assertions.md (REC-PROD-AC-VOCAB-001:
// exactly the 16 assertion types) + toolkit-runtime.md RT-PROD-TEST-002/003.
//
// Each assertion reads observable machine state from a captured {@link Snapshot} and
// returns a human-readable failure string (or `null` on pass, REC-PROD-REPORT-001).
// The data sources mirror the agent observation primitives (screen / mem / regs /
// audio, REC-PROD-SCOPE-002): registers (`observe/registers`), screen image + OCR +
// framebuffer renderer (`observe/screen`), the beeper/port-FE counters (`HostIo`), and
// the ULA border. The four v2 additions — `at` (temporal/checkpoint), `memInRange`,
// `memDelta` (signed start→end), `screenDiff` (PNG visual regression) — read the same
// snapshots plus the per-run start/checkpoint captures (REC-PROD-RUN-005, ADR-0027).

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { userError } from '../output/envelope.js';
import type { RegisterSnapshot } from '../observe/registers.js';
import {
  attrNonBlankCount,
  diffPixelCount,
  framePixelOn,
  nonBlankCellsImage,
  renderRgbaImage,
  screenIncludesText,
} from '../observe/screen.js';
// The one PNG decoder (CLI-PROD-RULE-SCREENSHOT-001) — shared with `screen --diff`.
import { decodePng } from '../observe/screenshot.js';
import { parseAddress } from '../util/address.js';

/** A raw assertion object from a spec's `assert[]` — `{ type, ...params }`. */
export type RawAssertion = { type: string } & Record<string, unknown>;

/** The final run outcome an assertion reads (REC-PROD-RUN-004; test never sets stop conditions). */
export type AssertStatus = 'ok' | 'hang';

/**
 * A point-in-time machine capture an assertion evaluates against (REC-PROD-RUN-005).
 * Captured at start-of-run, at each `at`-frame checkpoint, and post-run; carrying
 * everything the vocabulary reads so a checkpoint evaluates without a live machine.
 */
export interface Snapshot {
  /** Run-relative frame this was captured at (`0` = start-of-run, else frames elapsed). */
  frame: number;
  /** Full 64 KB address space copy (memEquals / memInRange / memDelta read any address). */
  memory: Uint8Array;
  /** The 6912-byte screen image view (display file + attribute file). */
  screen: Uint8Array;
  /** FNV-1a hash of `screen` (screenChanged). */
  screenHash: string;
  /** ULA border colour 0..7 in effect at capture (borderColor). */
  border: number;
  /** Decoded CPU register view (regEquals). */
  registers: RegisterSnapshot;
  /** Cumulative beeper (port-0xFE bit-4) edge count up to this point (beeperEdges). */
  beeperEdges: number;
  /** Cumulative ULA port-0xFE write count up to this point (portFEWrites). */
  portFEWrites: number;
}

/** Whole-run facts + the start/checkpoint captures an assertion needs (REC-PROD-RUN-005). */
export interface RunContext {
  /** Start-of-run snapshot (the baseline for memDelta / screenChanged). */
  start: Snapshot;
  /** Final run status (`status`). */
  status: AssertStatus;
  /** HALT/interrupt-cadence alignment (`haltSynced`). */
  haltSynced: boolean;
  /** Frames actually run (for the "at-frame past run length" failure). */
  framesRun: number;
  /** Per-checkpoint snapshots keyed by `at`-frame (1..framesRun). */
  checkpoints: Map<number, Snapshot>;
  /** Build symbol table (name → address) for label-form `addr` (e.g. "player_lives"). */
  symbols: Map<string, number>;
  /** Directory of the spec file — `screenDiff` baselines resolve relative to it. */
  specDir: string;
}

// --- field readers (a malformed assertion is a USER_ERROR → one spec failure) -------

/** Narrow an untyped spec entry to a {@link RawAssertion} (USER_ERROR if malformed). */
export function asAssertion(raw: unknown): RawAssertion {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw userError('each entry of "assert" must be an object', 'test');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type !== 'string') {
    throw userError('each assertion needs a string "type"', 'test');
  }
  return obj as RawAssertion;
}

function numField(a: RawAssertion, key: string): number | undefined {
  const v = a[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw userError(`${a.type}.${key} must be a number`, 'test');
  }
  return v;
}

function requireNum(a: RawAssertion, key: string): number {
  const v = numField(a, key);
  if (v === undefined) throw userError(`${a.type} requires "${key}"`, 'test');
  return v;
}

function strField(a: RawAssertion, key: string): string {
  const v = a[key];
  if (typeof v !== 'string') throw userError(`${a.type}.${key} must be a string`, 'test');
  return v;
}

function boolField(a: RawAssertion, key: string): boolean {
  const v = a[key];
  if (typeof v !== 'boolean') throw userError(`${a.type}.${key} must be a boolean`, 'test');
  return v;
}

/** Resolve an `addr` field: a number, an address string (`0x`/`$`/`h`/decimal), or a build label. */
function resolveAddr(raw: unknown, symbols: Map<string, number>): number {
  if (typeof raw === 'number') return raw & 0xffff;
  if (typeof raw === 'string') {
    if (symbols.has(raw)) return symbols.get(raw)! & 0xffff;
    return parseAddress(raw, 'test') & 0xffff;
  }
  throw userError('assertion "addr" must be a number, an address string, or a build label', 'test');
}

/** Resolve a numeric/address-form `value` field (regEquals). */
function resolveValue(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return parseAddress(raw, 'test');
  throw userError('assertion "value" must be a number or an address string', 'test');
}

/** Read a 1-byte (default) or 2-byte little-endian unsigned value from memory. */
function readMemValue(mem: Uint8Array, addr: number, size: number): number {
  if (size === 2) return (mem[addr]! | (mem[(addr + 1) & 0xffff]! << 8)) & 0xffff;
  if (size === 1) return mem[addr]! & 0xff;
  throw userError(`memory assertion "size" must be 1 or 2 (got ${size})`, 'test');
}

/** Parse a whitespace-tolerant hex byte string (memEquals `hex`). */
function parseHexBytes(hex: string): number[] {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw userError(`memEquals.hex is not a valid hex byte string: "${hex}"`, 'test');
  }
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  return bytes;
}

/** `[min,max]` bound check (an omitted bound is unbounded) → failure string or null. */
function rangeFail(label: string, value: number, min?: number, max?: number): string | null {
  if (min !== undefined && value < min) return `${label}: ${value} is below min ${min}`;
  if (max !== undefined && value > max) return `${label}: ${value} is above max ${max}`;
  return null;
}

/** Read one CPU register by name (regEquals vocabulary), with its bit width. */
function readReg(regs: RegisterSnapshot, name: string): { value: number; width: 8 | 16 } {
  switch (name) {
    case 'a': return { value: (regs.af >> 8) & 0xff, width: 8 };
    case 'f': return { value: regs.af & 0xff, width: 8 };
    case 'b': return { value: (regs.bc >> 8) & 0xff, width: 8 };
    case 'c': return { value: regs.bc & 0xff, width: 8 };
    case 'd': return { value: (regs.de >> 8) & 0xff, width: 8 };
    case 'e': return { value: regs.de & 0xff, width: 8 };
    case 'h': return { value: (regs.hl >> 8) & 0xff, width: 8 };
    case 'l': return { value: regs.hl & 0xff, width: 8 };
    case 'af': return { value: regs.af, width: 16 };
    case 'bc': return { value: regs.bc, width: 16 };
    case 'de': return { value: regs.de, width: 16 };
    case 'hl': return { value: regs.hl, width: 16 };
    case 'sp': return { value: regs.sp, width: 16 };
    case 'pc': return { value: regs.pc, width: 16 };
    case 'ix': return { value: regs.ix, width: 16 };
    case 'iy': return { value: regs.iy, width: 16 };
    case 'i': return { value: regs.i, width: 8 };
    case 'r': return { value: regs.r, width: 8 };
    case 'im': return { value: regs.im, width: 8 };
    default: throw userError(`regEquals: unknown register "${name}"`, 'test');
  }
}

function hex(value: number, pad = 2): string {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(pad, '0')}`;
}

/**
 * Evaluate one assertion against a target snapshot (the post-run snapshot for a
 * top-level assertion, or a checkpoint snapshot inside `at`). Returns a failure string
 * or `null` on pass. A malformed assertion throws a USER_ERROR the caller renders as a
 * spec failure (no silent skip, ERR-PROD-NOSILENT-001).
 */
export function evaluateAssertion(a: RawAssertion, target: Snapshot, ctx: RunContext): string | null {
  switch (a.type) {
    case 'status': {
      const equals = strField(a, 'equals');
      return ctx.status === equals ? null : `status: expected "${equals}", got "${ctx.status}"`;
    }
    case 'haltSynced': {
      const equals = boolField(a, 'equals');
      return ctx.haltSynced === equals ? null : `haltSynced: expected ${equals}, got ${ctx.haltSynced}`;
    }
    case 'screenIncludes': {
      const text = strField(a, 'text');
      return screenIncludesText(target.screen, text)
        ? null
        : `screenIncludes: "${text}" not found on any screen row`;
    }
    case 'cellsNonBlank':
      return rangeFail('cellsNonBlank', nonBlankCellsImage(target.screen), numField(a, 'min'), numField(a, 'max'));
    case 'attrNonBlank':
      return rangeFail('attrNonBlank', attrNonBlankCount(target.screen), numField(a, 'min'), numField(a, 'max'));
    case 'screenChanged': {
      const equals = boolField(a, 'equals');
      const changed = ctx.start.screenHash !== target.screenHash;
      return changed === equals ? null : `screenChanged: expected ${equals}, got ${changed}`;
    }
    case 'memEquals': {
      const addr = resolveAddr(a.addr, ctx.symbols);
      const want = parseHexBytes(strField(a, 'hex'));
      for (let i = 0; i < want.length; i += 1) {
        const got = target.memory[(addr + i) & 0xffff]!;
        if (got !== want[i]) {
          return `memEquals @${hex(addr, 4)}: byte ${i} expected ${hex(want[i]!)}, got ${hex(got)}`;
        }
      }
      return null;
    }
    case 'regEquals': {
      const name = strField(a, 'reg').toLowerCase();
      const { value, width } = readReg(target.registers, name);
      const want = resolveValue(a.value) & (width === 16 ? 0xffff : 0xff);
      return value === want ? null : `regEquals ${name}: expected ${hex(want, 4)}, got ${hex(value, 4)}`;
    }
    case 'pixelAt': {
      const x = requireNum(a, 'x');
      const y = requireNum(a, 'y');
      const set = boolField(a, 'set');
      if (x < 0 || x > 255 || y < 0 || y > 191) {
        throw userError('pixelAt: x must be 0..255 and y 0..191', 'test');
      }
      const on = framePixelOn(target.screen, x, y);
      return on === set ? null : `pixelAt (${x},${y}): expected ${set ? 'set' : 'clear'}, got ${on ? 'set' : 'clear'}`;
    }
    case 'borderColor': {
      const equals = requireNum(a, 'equals');
      return target.border === equals ? null : `borderColor: expected ${equals}, got ${target.border}`;
    }
    case 'beeperEdges':
      return rangeFail('beeperEdges', target.beeperEdges, numField(a, 'min'), numField(a, 'max'));
    case 'portFEWrites':
      return rangeFail('portFEWrites', target.portFEWrites, numField(a, 'min'), numField(a, 'max'));
    case 'memInRange': {
      const addr = resolveAddr(a.addr, ctx.symbols);
      const size = numField(a, 'size') ?? 1;
      const value = readMemValue(target.memory, addr, size);
      return rangeFail(`memInRange @${hex(addr, 4)}`, value, numField(a, 'min'), numField(a, 'max'));
    }
    case 'memDelta': {
      const addr = resolveAddr(a.addr, ctx.symbols);
      const size = numField(a, 'size') ?? 1;
      const startVal = readMemValue(ctx.start.memory, addr, size);
      const endVal = readMemValue(target.memory, addr, size);
      // The SIGNED change start→end (memDelta semantics; e.g. "score increased" → min 1).
      return rangeFail(`memDelta @${hex(addr, 4)}`, endVal - startVal, numField(a, 'min'), numField(a, 'max'));
    }
    case 'screenDiff': {
      const baseline = strField(a, 'baseline');
      const maxDiff = numField(a, 'maxDiff') ?? 0;
      const file = resolve(ctx.specDir, baseline);
      if (!existsSync(file)) {
        return `screenDiff: baseline not found: ${baseline} (regenerate with \`screen --diff --update-baseline\`)`;
      }
      const base = decodePng(file);
      if (!base) return `screenDiff: cannot decode baseline PNG: ${baseline}`;
      const diff = diffPixelCount(renderRgbaImage(target.screen, 0), base);
      if (diff > maxDiff) {
        const detail = Number.isFinite(diff)
          ? `${diff} differing pixel(s)`
          : `dimension mismatch (baseline is ${base.width}×${base.height}, expected 256×192)`;
        return `screenDiff: ${detail} exceeds maxDiff ${maxDiff} (baseline ${baseline})`;
      }
      return null;
    }
    case 'at': {
      const frame = requireNum(a, 'frame');
      const nested = a.assert;
      if (!Array.isArray(nested)) throw userError('at: "assert" must be an array', 'test');
      const snap = frame === 0 ? ctx.start : ctx.checkpoints.get(frame);
      if (!snap) {
        return `at frame ${frame}: no checkpoint captured (the run reached only ${ctx.framesRun} frame(s))`;
      }
      const failures: string[] = [];
      for (const sub of nested) {
        const subAssertion = asAssertion(sub);
        if (subAssertion.type === 'at') {
          failures.push(`at frame ${frame}: nested "at" is not allowed (one level only)`);
          continue;
        }
        const failure = evaluateAssertion(subAssertion, snap, ctx);
        if (failure) failures.push(`at frame ${frame}: ${failure}`);
      }
      return failures.length > 0 ? failures.join('; ') : null;
    }
    default:
      throw userError(`unknown assertion type "${a.type}"`, 'test');
  }
}

/** Collect the distinct top-level `at`-frames a spec needs checkpoints for (one level). */
export function collectCheckpointFrames(asserts: readonly unknown[]): Set<number> {
  const frames = new Set<number>();
  for (const raw of asserts) {
    const a = asAssertion(raw);
    if (a.type === 'at') {
      const frame = numField(a, 'frame');
      if (frame !== undefined && frame >= 1) frames.add(frame);
    }
  }
  return frames;
}

// --- the assertion reference (--list-assertions, ASSERT-PROD-LIST-001) -------

/** One row of the assertion reference: `{ type, fields, description }`. */
export interface AssertionDoc {
  type: string;
  fields: string[];
  description: string;
}

/**
 * The canonical 16-assertion reference (REC-PROD-AC-VOCAB-001): the 12 core types plus
 * the four v2 additions (`at`, `memInRange`, `memDelta`, `screenDiff`). The dropped
 * legacy `coloredCells` alias is intentionally absent. Printed by `test --list-assertions`.
 */
export const ASSERTION_REFERENCE: readonly AssertionDoc[] = [
  { type: 'status', fields: ['equals'], description: 'Final run outcome — "ok" or "hang".' },
  { type: 'haltSynced', fields: ['equals'], description: 'Whether the main loop aligned to the HALT/interrupt cadence (needs detectHangs).' },
  { type: 'screenIncludes', fields: ['text'], description: 'ROM-font OCR of the screen contains the text on some row.' },
  { type: 'cellsNonBlank', fields: ['min?', 'max?'], description: 'Count of 8×8 cells with ≥1 bitmap pixel set, within [min,max].' },
  { type: 'attrNonBlank', fields: ['min?', 'max?'], description: 'Count of attribute cells differing from the default 0x38, within [min,max].' },
  { type: 'screenChanged', fields: ['equals'], description: 'Whether the screen (bitmap + attributes) hash changed across the run.' },
  { type: 'memEquals', fields: ['addr', 'hex'], description: 'Memory at addr equals the whitespace-stripped hex bytes.' },
  { type: 'regEquals', fields: ['reg', 'value'], description: 'CPU register equals a numeric/address value (a,f,…,af,…,sp,pc,ix,iy,i,r,im).' },
  { type: 'pixelAt', fields: ['x', 'y', 'set'], description: 'The bitmap pixel at (x 0–255, y 0–191) is/!is set.' },
  { type: 'borderColor', fields: ['equals'], description: 'The ULA border colour (0..7).' },
  { type: 'beeperEdges', fields: ['min?', 'max?'], description: 'Count of port-0xFE bit-4 (speaker) edges during the run, within [min,max].' },
  { type: 'portFEWrites', fields: ['min?', 'max?'], description: 'Total writes to ULA port 0xFE during the run, within [min,max].' },
  { type: 'at', fields: ['frame', 'assert'], description: 'Temporal: evaluate the nested assertions at the state captured at frame (one level).' },
  { type: 'memInRange', fields: ['addr', 'size?', 'min?', 'max?'], description: 'Unsigned 1/2-byte LE value at addr is within [min,max].' },
  { type: 'memDelta', fields: ['addr', 'size?', 'min?', 'max?'], description: 'Signed change of the value at addr from start→end is within [min,max].' },
  { type: 'screenDiff', fields: ['baseline', 'maxDiff?'], description: 'Post-run framebuffer vs a golden PNG; differing-pixel count ≤ maxDiff (default 0).' },
];

/** The set of valid assertion type names (exactly 16, REC-PROD-AC-VOCAB-001). */
export const ASSERTION_TYPES: ReadonlySet<string> = new Set(ASSERTION_REFERENCE.map((d) => d.type));
