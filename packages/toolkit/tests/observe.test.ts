// Slice 7a — the read-only observe command group (cli.md CLI-PROD-SCREEN/REGS/MEM/
// DISASM/STEP/TRACE/SYMBOLS/COVERAGE-*, toolkit-runtime.md RT-PROD-OBSERVE-001).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import { writeZ80 } from '@zx-vibes/machine';
import { runCli } from '../src/cli.js';
import { CliError, ExitCode, type OutputStreams } from '../src/output/envelope.js';
import { decodePng } from '../src/observe/screenshot.js';
import { tapImageBytes } from '../src/build/formats.js';
import { runScreen } from '../src/observe/screen-command.js';
import { runRegs } from '../src/observe/regs-command.js';
import { runMemRead, runMemDump } from '../src/observe/memory.js';
import { runDisasm } from '../src/observe/disasm.js';
import { runStep } from '../src/observe/step.js';
import { runTrace } from '../src/observe/trace.js';
import { runSymbols } from '../src/observe/symbols.js';
import { runCoverage } from '../src/observe/coverage.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-observe-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Assemble a tiny program string to a temp `.bin`; returns {file, org}. */
function asmBin(name: string, source: string): { file: string; org: number } {
  const result = assemble(source);
  if (!result.ok) throw new Error(`asm failed: ${result.errors.map((e) => e.message).join('; ')}`);
  const file = join(dir, `${name}.bin`);
  writeFileSync(file, result.bytes);
  return { file, org: result.origin };
}

/** Write a tiny project (zx.config.json + main.asm) in `dir`; returns dir. */
function project(source: string): string {
  writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'main.asm', org: '0x8000' }));
  writeFileSync(join(dir, 'main.asm'), source);
  return dir;
}

function capture(): { streams: OutputStreams; out: () => string; err: () => string } {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  return {
    streams: { out: (t) => outChunks.push(t), err: (t) => errChunks.push(t) },
    out: () => outChunks.join(''),
    err: () => errChunks.join(''),
  };
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A program with KNOWN opcodes (for disasm) and known first bytes (for mem).
const KNOWN = ['ORG 0x8000', '  ld a, 0x10', '  out (0xFE), a', '  nop', '  ret', ''].join('\n');

// A progressing program (never hangs) — for step / trace.
const PROGRESS = [
  'ORG 0x8000',
  'start:',
  '  ld hl, 0',
  'loop:',
  '  inc hl',
  '  ld (0x9000), hl',
  '  jr loop',
  '',
].join('\n');

// --- snapshot/tape observe sources (D2, CLI-PROD-CONV-SOURCE-001) ----------

/** Wrap an assembled program in a `.z80` v3 snapshot booting at its origin, written to `dir`. */
function z80In(name: string, src: string, extra: Record<string, number> = {}): string {
  const result = assemble(src);
  if (!result.ok) throw new Error(`asm failed: ${result.errors.map((e) => e.message).join('; ')}`);
  const memory = new Uint8Array(0x10000);
  memory.set(result.bytes, result.origin);
  const bytes = writeZ80({ registers: { pc: result.origin, sp: 0xff00, ...extra }, memory, border: 5 });
  writeFileSync(join(dir, name), Buffer.from(bytes));
  return name;
}

describe('observe --z80 / --tap / --sna sources (CLI-PROD-CONV-SOURCE-001)', () => {
  it('regs --z80 sources a snapshot: PC/registers + z80 boot descriptor', () => {
    const file = z80In('game.z80', KNOWN, { b: 0x42, c: 0x24 });
    const env = runRegs({ cwd: dir, z80: file });
    expect(env.boot.source).toBe('z80');
    expect(env.boot.version).toBe(3);
    expect(env.registers.pc).toBe(0x8000);
    expect(env.registers.bc).toBe(0x4224);
  });

  it('regs --z80 through the real CLI exits 0 with a z80 boot', async () => {
    const file = z80In('game.z80', KNOWN);
    const cap = capture();
    const code = await runCli(['regs', '--z80', join(dir, file), '--json'], { streams: cap.streams });
    expect(code).toBe(ExitCode.OK);
    const env = JSON.parse(cap.out().trim());
    expect(env.boot.source).toBe('z80');
    expect(env.registers.pc).toBe(0x8000);
  });

  it('screen --tap instant-loads a CODE tape as the observed machine', () => {
    const result = assemble(KNOWN);
    if (!result.ok) throw new Error('asm failed');
    const tap = tapImageBytes({ bytes: result.bytes, loadAddress: result.origin, name: 'game' });
    writeFileSync(join(dir, 'game.tap'), Buffer.from(tap));
    const env = runScreen({ cwd: dir, tap: 'game.tap' });
    expect(env.ok).toBe(true);
    expect(env.boot.source).toBe('tap');
    expect(env.boot.org).toBe(0x8000);
  });

  it('regs --sna fails loud with the missing-codec message (W4-GAP-03)', () => {
    writeFileSync(join(dir, 'game.sna'), Buffer.alloc(49179));
    try {
      runRegs({ cwd: dir, sna: 'game.sna' });
      expect.unreachable('a .sna source must fail loud, not mis-boot');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).message).toMatch(/\.sna codec/);
      expect((error as CliError).message).toMatch(/W4-GAP-03/);
    }
  });
});

// A program with a reached routine (start/loop) and an UNREACHED routine — for coverage.
const COVER = [
  'ORG 0x8000',
  'start:',
  '  ld hl, 0',
  'loop:',
  '  inc hl',
  '  ld (0x9000), hl',
  '  jr loop',
  'unreached:',
  '  ld a, 5',
  '  ret',
  '',
].join('\n');

// A program whose first instruction is a CALL — for `step --over`.
const CALLER = [
  'ORG 0x8000',
  '  call sub', // 0x8000 (3 bytes) -> fallthrough 0x8003
  '  ld a, 0xFF', // 0x8003
  'spin:',
  '  jr spin', // 0x8005
  'sub:', // 0x8007
  '  ld b, 1',
  '  ret',
  '',
].join('\n');

// =========================================================================
// screen (CLI-PROD-SCREEN-001/002/003)
// =========================================================================

describe('screen (CLI-PROD-SCREEN-001/002/003)', () => {
  it('text: reports the 24-row OCR grid + image facts (no execution)', () => {
    const env = runScreen({ cwd: dir });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.rows).toHaveLength(24);
    expect(env.rows.every((r) => r.length === 32)).toBe(true);
    expect(typeof env.hash).toBe('string');
    expect(env.nonBlankCells).toBe(0); // fresh boot screen is blank
    expect(env.boot.source).toBe('fresh');
  });

  it('png: writes a valid PNG (magic) via the one encoder', () => {
    const env = runScreen({ cwd: dir, png: 'shot.png' });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.png).toBe('shot.png');
    const bytes = readFileSync(join(dir, 'shot.png'));
    expect([...bytes.subarray(0, 8)]).toEqual(PNG_MAGIC);
  });

  it('png --scale 2: upscales 256x192 -> 512x384', () => {
    runScreen({ cwd: dir, png: 'shot2.png', scale: 2 });
    const decoded = decodePng(join(dir, 'shot2.png'));
    expect(decoded).not.toBeNull();
    expect(decoded?.width).toBe(512);
    expect(decoded?.height).toBe(384);
  });

  it('base64: emits a PNG data-URI that decodes to a valid PNG', () => {
    const env = runScreen({ cwd: dir, base64: true });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.base64?.startsWith('data:image/png;base64,')).toBe(true);
    const b64 = env.base64!.slice('data:image/png;base64,'.length);
    const bytes = Buffer.from(b64, 'base64');
    expect([...bytes.subarray(0, 8)]).toEqual(PNG_MAGIC);
  });

  it('diff: matches its own baseline (0 differing pixels) and flags a changed screen', () => {
    // Write a baseline from the (blank) fresh screen.
    const made = runScreen({ cwd: dir, diff: 'base.png', updateBaseline: true });
    expect(made.ok).toBe(true);
    if (made.ok) expect(made.diff).toMatchObject({ updated: true, pass: true });

    // Same screen vs baseline -> pass, 0 diff.
    const match = runScreen({ cwd: dir, diff: 'base.png' });
    expect(match.ok).toBe(true);
    if (match.ok) expect(match.diff).toMatchObject({ diffPixels: 0, pass: true });

    // A different screen: a full 6912-byte image whose attribute file is paper-7 (white)
    // renders all-white vs the blank baseline's all-black -> a real regression (exit-1 envelope).
    const screenBin = join(dir, 'fill.bin');
    const fill = new Uint8Array(6912);
    fill.fill(0x38, 6144); // attribute file (last 768 bytes) = ink 0 / paper 7
    writeFileSync(screenBin, fill);
    const mismatch = runScreen({ cwd: dir, bin: 'fill.bin', org: '0x4000', diff: 'base.png' });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.diff?.pass).toBe(false);
    expect((mismatch.diff?.diffPixels ?? 0) > 0).toBe(true);
  });

  it('diff: a missing baseline without --update-baseline is a USER_ERROR', () => {
    expect(() => runScreen({ cwd: dir, diff: 'nope.png' })).toThrow(/baseline not found/);
  });
});

// =========================================================================
// regs (CLI-PROD-REGS-001)
// =========================================================================

describe('regs (CLI-PROD-REGS-001)', () => {
  it('reports the decoded register view of the sourced machine', () => {
    const { file } = asmBin('known', KNOWN);
    const env = runRegs({ cwd: dir, bin: 'known.bin', org: '0x8000' });
    void file;
    expect(env.ok).toBe(true);
    expect(env.registers.pc).toBe(0x8000); // PC at the bin entry
    expect(typeof env.registers.sp).toBe('number');
    expect(typeof env.registers.flags.z).toBe('boolean');
    expect(env.registers.alt).toHaveProperty('hl');
  });

  it('regs set writes a register on a fresh machine (Slice 7b, stateless = not persisted)', async () => {
    const cap = capture();
    const code = await runCli(['regs', 'set', 'af', '0x1234', '--json'], { streams: cap.streams });
    expect(code).toBe(ExitCode.OK);
    const env = JSON.parse(cap.out().trim());
    expect(env.ok).toBe(true);
    expect(env.op).toBe('set');
    expect(env.reg).toBe('af');
    expect(env.registers.af).toBe(0x1234);
    expect(env.persisted).toBe(false); // no --state: applied in-memory, nothing saved
  });
});

// =========================================================================
// mem (CLI-PROD-MEM-001)
// =========================================================================

describe('mem (CLI-PROD-MEM-001)', () => {
  it('read: hex + ascii of a known region', () => {
    asmBin('known', KNOWN); // first bytes: 3E 10 (ld a,0x10)
    const env = runMemRead({ cwd: dir, bin: 'known.bin', org: '0x8000', addr: '0x8000', len: '2' });
    expect(env.ok).toBe(true);
    expect(env.op).toBe('read');
    expect(env.bytes).toEqual([0x3e, 0x10]);
    expect(env.hex).toBe('3E 10');
    expect(env.ascii).toBe('>.'); // 0x3E='>', 0x10 non-printable
  });

  it('dump --out: writes the range bytes to a file with a content hash', () => {
    asmBin('known', KNOWN);
    const env = runMemDump({
      cwd: dir,
      bin: 'known.bin',
      org: '0x8000',
      range: '0x8000-0x8001',
      out: 'dump.bin',
    });
    expect(env.ok).toBe(true);
    expect(env.op).toBe('dump');
    expect(env.len).toBe(2);
    expect(env.out).toBe('dump.bin');
    expect([...readFileSync(join(dir, 'dump.bin'))]).toEqual([0x3e, 0x10]);
  });

  it('mem write pokes a byte on a fresh machine (Slice 7b, stateless = not persisted)', async () => {
    const cap = capture();
    const code = await runCli(['mem', 'write', '0x8000', '3E', '01', '--json'], { streams: cap.streams });
    expect(code).toBe(ExitCode.OK);
    const env = JSON.parse(cap.out().trim());
    expect(env.ok).toBe(true);
    expect(env.op).toBe('write');
    expect(env.addr).toBe(0x8000);
    expect(env.bytes).toEqual([0x3e, 0x01]);
    expect(env.persisted).toBe(false);
  });
});

// =========================================================================
// disasm (CLI-PROD-DISASM-001)
// =========================================================================

describe('disasm (CLI-PROD-DISASM-001)', () => {
  it('decodes known opcodes from a numeric address', () => {
    asmBin('known', KNOWN);
    const env = runDisasm({ cwd: dir, bin: 'known.bin', org: '0x8000', spec: '0x8000', count: '4' });
    expect(env.ok).toBe(true);
    expect(env.addr).toBe(0x8000);
    expect(env.instructions.map((i) => i.text)).toEqual([
      'LD A,0x10',
      'OUT (0xFE),A',
      'NOP',
      'RET',
    ]);
  });

  it('resolves a label spec and annotates the line with its SLD label', () => {
    project(COVER);
    const env = runDisasm({ cwd: dir, spec: 'start', count: '2' });
    expect(env.ok).toBe(true);
    expect(env.addr).toBe(0x8000);
    expect(env.instructions[0]?.label).toBe('start');
    expect(env.instructions[1]?.label).toBe('loop');
  });
});

// =========================================================================
// step (CLI-PROD-STEP-001)
// =========================================================================

describe('step (CLI-PROD-STEP-001)', () => {
  it('steps N instructions and advances PC/state', () => {
    asmBin('progress', PROGRESS);
    const env = runStep({ cwd: dir, bin: 'progress.bin', org: '0x8000', steps: 3 });
    expect(env.ok).toBe(true);
    expect(env.from).toBe(0x8000);
    expect(env.steps).toBe(3);
    expect(env.instructions).toHaveLength(3);
    expect(env.pc).toBeGreaterThan(0x8000); // PC advanced
    expect(env.instructions[0]?.text).toBe('LD HL,0x0000');
  });

  it('--over steps over a CALL, landing at the return address (vs stepping into it)', () => {
    asmBin('caller', CALLER);
    const into = runStep({ cwd: dir, bin: 'caller.bin', org: '0x8000', steps: 1 });
    expect(into.pc).toBe(0x8007); // CALL stepped INTO sub:

    const over = runStep({ cwd: dir, bin: 'caller.bin', org: '0x8000', steps: 1, over: true });
    expect(over.pc).toBe(0x8003); // CALL stepped OVER -> fallthrough
  });
});

// =========================================================================
// trace (CLI-PROD-TRACE-001)
// =========================================================================

describe('trace (CLI-PROD-TRACE-001)', () => {
  it('records a per-instruction trace over a bounded run', () => {
    asmBin('progress', PROGRESS);
    const env = runTrace({ cwd: dir, bin: 'progress.bin', org: '0x8000', frames: 3 });
    expect(env.ok).toBe(true);
    expect(env.framesRun).toBe(3);
    expect(env.instructionsTraced).toBeGreaterThan(env.framesRun); // many instructions/frame
    expect(env.top.length).toBeGreaterThan(0);
    expect(env.top[0]?.count).toBeGreaterThan(0);
    expect(env.last.length).toBeGreaterThan(0);
  });

  it('--out writes a full trace whose line count equals instructionsTraced', () => {
    asmBin('progress', PROGRESS);
    const env = runTrace({ cwd: dir, bin: 'progress.bin', org: '0x8000', frames: 2, last: 10, out: 'trace.log' });
    expect(env.out).toBe('trace.log');
    const text = readFileSync(join(dir, 'trace.log'), 'utf8');
    const lines = text.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(env.instructionsTraced);
    expect(env.last.length).toBeLessThanOrEqual(10);
  });
});

// =========================================================================
// symbols (CLI-PROD-SYMBOLS-001)
// =========================================================================

describe('symbols (CLI-PROD-SYMBOLS-001)', () => {
  it('dumps the SLD label table as {name, addr, kind}', () => {
    project(COVER);
    const env = runSymbols({ cwd: dir });
    if (!('symbols' in env)) throw new Error('expected a symbol dump');
    const names = env.symbols.map((s) => s.name);
    expect(names).toContain('start');
    expect(names).toContain('loop');
    expect(names).toContain('unreached');
    const start = env.symbols.find((s) => s.name === 'start');
    expect(start).toMatchObject({ addr: 0x8000, kind: 'F' });
  });

  it('get <name> reports a single entry; an unknown name is a USER_ERROR', () => {
    project(COVER);
    const env = runSymbols({ cwd: dir, get: 'loop' });
    if (!('symbol' in env)) throw new Error('expected a single symbol');
    expect(env.symbol.name).toBe('loop');
    expect(() => runSymbols({ cwd: dir, get: 'ghost' })).toThrow(/no symbol named/);
  });
});

// =========================================================================
// coverage (CLI-PROD-COVERAGE-001)
// =========================================================================

describe('coverage (CLI-PROD-COVERAGE-001)', () => {
  it('reports reached vs unreached routines over a run', () => {
    project(COVER);
    const env = runCoverage({ cwd: dir, frames: 50 });
    expect(env.ok).toBe(true);
    expect(env.stage).toBe('coverage');
    expect(env.executed.length).toBeGreaterThan(0);

    const byName = Object.fromEntries(env.routines.map((r) => [r.name, r.reached]));
    expect(byName.start).toBe(true);
    expect(byName.loop).toBe(true);
    expect(byName.unreached).toBe(false);

    expect(env.totalSymbols).toBe(env.routines.length);
    expect(env.reachedCount).toBe(env.routines.filter((r) => r.reached).length);
    expect(env.reachedCount).toBeLessThan(env.totalSymbols); // `unreached` is not reached
  });
});

// =========================================================================
// CLI end-to-end smokes — `zxs <cmd> --json` (CLI-PROD-CONV-JSON-001)
// =========================================================================

describe('zxs observe — CLI end-to-end (--json single envelope, exit 0)', () => {
  /** Run a command via the CLI from a given cwd, returning {code, env}. */
  async function cli(argv: string[], cwd: string): Promise<{ code: number; env: Record<string, unknown> }> {
    const prev = process.cwd();
    process.chdir(cwd);
    try {
      const cap = capture();
      const code = await runCli(argv, { streams: cap.streams });
      const lines = cap.out().trim().split('\n');
      expect(lines).toHaveLength(1);
      return { code, env: JSON.parse(lines[0]!) as Record<string, unknown> };
    } finally {
      process.chdir(prev);
    }
  }

  it('screen / regs / mem / disasm / step / trace via --bin', async () => {
    const { file } = asmBin('known', KNOWN);
    const bin = file; // absolute path

    const screen = await cli(['screen', '--bin', bin, '--org', '0x8000', '--json'], dir);
    expect(screen.code).toBe(ExitCode.OK);
    expect((screen.env as { rows: string[] }).rows).toHaveLength(24);

    const regs = await cli(['regs', '--bin', bin, '--org', '0x8000', '--json'], dir);
    expect(regs.code).toBe(ExitCode.OK);
    expect((regs.env as { registers: { pc: number } }).registers.pc).toBe(0x8000);

    const mem = await cli(['mem', 'read', '0x8000', '--bin', bin, '--org', '0x8000', '--len', '2', '--json'], dir);
    expect(mem.code).toBe(ExitCode.OK);
    expect((mem.env as { hex: string }).hex).toBe('3E 10');

    const disasm = await cli(['disasm', '0x8000', '--bin', bin, '--org', '0x8000', '--count', '2', '--json'], dir);
    expect(disasm.code).toBe(ExitCode.OK);
    expect((disasm.env as { instructions: { text: string }[] }).instructions[0]!.text).toBe('LD A,0x10');

    const step = await cli(['step', '2', '--bin', bin, '--org', '0x8000', '--json'], dir);
    expect(step.code).toBe(ExitCode.OK);
    expect((step.env as { steps: number }).steps).toBe(2);

    const trace = await cli(['trace', '--bin', bin, '--org', '0x8000', '--frames', '2', '--json'], dir);
    expect(trace.code).toBe(ExitCode.OK);
    expect((trace.env as { instructionsTraced: number }).instructionsTraced).toBeGreaterThan(0);
  });

  it('symbols / coverage via a configured entry', async () => {
    const proj = project(COVER);

    const symbols = await cli(['symbols', '--json'], proj);
    expect(symbols.code).toBe(ExitCode.OK);
    expect((symbols.env as { symbols: { name: string }[] }).symbols.map((s) => s.name)).toContain('start');

    const coverage = await cli(['coverage', '--frames', '40', '--json'], proj);
    expect(coverage.code).toBe(ExitCode.OK);
    const cov = coverage.env as { reachedCount: number; totalSymbols: number; routines: { name: string; reached: boolean }[] };
    expect(cov.routines.find((r) => r.name === 'unreached')?.reached).toBe(false);
    expect(cov.reachedCount).toBeLessThan(cov.totalSymbols);
  });
});
