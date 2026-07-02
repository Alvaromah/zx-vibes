import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import { writeZ80 } from '@zx-vibes/machine';
import { runCli } from '../src/cli.js';
import { CliError, ExitCode, type OutputStreams } from '../src/output/envelope.js';
import { loadBinMachine } from '../src/runtime/session.js';
import { tapImageBytes } from '../src/build/formats.js';
import { runProgram, DEFAULT_FRAMES } from '../src/runtime/run.js';
import { samplesForDuration, renderBeeperPcm } from '../src/runtime/wav.js';
import { runFrameObserved } from '../src/runtime/run-loop.js';
import { parseAddress, parseRange } from '../src/util/address.js';
import { parseKeySchedule, parseJoySchedule, keyboardByte } from '../src/runtime/schedule.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-run-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Assemble a tiny program string and write its bytes to a temp `.bin`; returns {file, org}. */
function asmBin(name: string, source: string): { file: string; org: number } {
  const result = assemble(source);
  if (!result.ok) {
    throw new Error(`asm failed: ${result.errors.map((e) => e.message).join('; ')}`);
  }
  const file = join(dir, `${name}.bin`);
  writeFileSync(file, result.bytes);
  return { file, org: result.origin };
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

// --- programs --------------------------------------------------------------

// A program that makes RAM progress every iteration (never a hang, RT-PROD-EDGE-001).
const PROGRESS = [
  'ORG 0x8000',
  'loop:',
  '  ld hl, (0x9000)',
  '  inc hl',
  '  ld (0x9000), hl',
  '  jr loop',
  '',
].join('\n');

// A beeper program: toggles port 0xFE bit 4 (the speaker) AND makes RAM progress.
const BEEPER = [
  'ORG 0x8000',
  'loop:',
  '  ld a, 0x10', // b4 = 1
  '  out (0xFE), a',
  '  ld hl, (0x9000)',
  '  inc hl',
  '  ld (0x9000), hl',
  '  ld a, 0x00', // b4 = 0
  '  out (0xFE), a',
  '  jr loop',
  '',
].join('\n');

// Straight-line then a self-loop at a known label (for --until-pc).
const UNTIL = [
  'ORG 0x8000',
  '  ld a, 1', // 0x8000
  '  ld b, 2', // 0x8002
  '  ld c, 3', // 0x8004
  'target:', // 0x8006
  '  jr target',
  '',
].join('\n');

// HALT with interrupts disabled — a DEFINITE di-halt hang.
const DI_HALT = ['ORG 0x8000', '  di', '  halt', ''].join('\n');

// Tight self-loop with interrupts disabled — a PROBABLE tight-loop hang.
const TIGHT = ['ORG 0x8000', '  di', 'self:', '  jr self', ''].join('\n');

// Read the Kempston port (low byte 0x1F) and store the byte to RAM.
const READ_JOY = [
  'ORG 0x8000',
  'loop:',
  '  ld bc, 0x001F',
  '  in a, (c)',
  '  ld (0x9000), a',
  '  jr loop',
  '',
].join('\n');

// Read keyboard row 0 (port high byte 0xFE) and store the byte to RAM.
const READ_KEYS = [
  'ORG 0x8000',
  'loop:',
  '  ld bc, 0xFEFE',
  '  in a, (c)',
  '  ld (0x9000), a',
  '  jr loop',
  '',
].join('\n');

// EI/IM1 loop that takes the once-per-frame interrupt (exercises the observed loop's
// interrupt + post-EI-delay path for the determinism guard).
const INT_LOOP = ['ORG 0x8000', '  im 1', '  ei', 'main:', '  nop', '  jr main', ''].join('\n');

// --- run envelope shape (CLI-PROD-OUT-RUN-001) -----------------------------

describe('runProgram — envelope shape (CLI-PROD-OUT-RUN-001 / RT-PROD-RUN-001/005)', () => {
  it('runs the default budget and reports a well-formed ok result', () => {
    const { file, org } = asmBin('progress', PROGRESS);
    const result = runProgram(loadBinMachine(file, org), org);

    expect(result.status).toBe('ok');
    expect(result.framesRun).toBe(DEFAULT_FRAMES);
    expect(result.tstatesRun).toBeGreaterThan(0);
    expect(result.exit.reason).toBe('frame-budget');

    // audio.beeperEdges is an integer >= 0 (RUN-BEEPER-001 / CLI-PROD-OUT-RUN-AUDIO-001).
    expect(Number.isInteger(result.audio.beeperEdges)).toBe(true);
    expect(result.audio.beeperEdges).toBeGreaterThanOrEqual(0);
    expect(result.audio.beeperEdges).toBe(0); // this program never writes the beeper

    // registers / screen / input are present and typed.
    expect(typeof result.registers.pc).toBe('number');
    expect(typeof result.screen.border).toBe('number');
    expect(typeof result.screen.hash).toBe('string');
    expect(result.input).toEqual({ keys: [], joy: [] });
  });

  it('honors a smaller --frames budget', () => {
    const { file, org } = asmBin('progress', PROGRESS);
    const result = runProgram(loadBinMachine(file, org), org, { frames: 20 });
    expect(result.framesRun).toBe(20);
    expect(result.status).toBe('ok');
  });
});

// --- beeper edge observability (RUN-BEEPER-001) ----------------------------

describe('runProgram — beeper edges (RUN-BEEPER-001 / HOST-IO-PORTFE-BEEPER-001)', () => {
  it('a program toggling port 0xFE bit 4 reports beeperEdges > 0', () => {
    const { file, org } = asmBin('beeper', BEEPER);
    const result = runProgram(loadBinMachine(file, org), org, { frames: 30 });
    expect(result.status).toBe('ok');
    expect(result.audio.beeperEdges).toBeGreaterThan(0);
    expect(result.audio.portFEWrites).toBeGreaterThan(0);
    // Each loop writes b4=1 then b4=0 → two edges per loop; many loops per frame.
    expect(result.audio.beeperEdges).toBeGreaterThan(result.framesRun);
    expect(result.audio.toneHz).toBeGreaterThan(0);
  });
});

// --- stop conditions (RT-PROD-RUN-002) -------------------------------------

describe('runProgram — --until-pc stop (RT-PROD-RUN-002)', () => {
  it('stops at the target PC with status breakpoint', () => {
    const { file, org } = asmBin('until', UNTIL);
    const result = runProgram(loadBinMachine(file, org), org, { untilPc: 0x8006, frames: 50 });
    expect(result.status).toBe('breakpoint');
    expect(result.exit.reason).toBe('until-pc');
    expect(result.exit.pc).toBe(0x8006);
    expect(result.registers.pc).toBe(0x8006);
    expect(result.framesRun).toBe(1); // reached within the first frame
  });
});

describe('runProgram — write/change watchpoint stop (RT-PROD-RUN-002)', () => {
  it('stops with status watchpoint when a watched byte changes', () => {
    const { file, org } = asmBin('progress', PROGRESS);
    // 0x9000 is the counter the program increments.
    const result = runProgram(loadBinMachine(file, org), org, {
      untilChange: 0x9000,
      frames: 50,
    });
    expect(result.status).toBe('watchpoint');
    expect(result.exit.reason).toBe('watchpoint');
  });
});

describe('runProgram — read watchpoints fail loudly (no silent debt, ERR-PROD-NOSILENT-001)', () => {
  it('throws an ENV_ERROR rather than accepting --watch-read and never firing', () => {
    const { file, org } = asmBin('progress', PROGRESS);
    try {
      runProgram(loadBinMachine(file, org), org, { watchRead: [{ from: 0x8000, to: 0x8000 }], frames: 5 });
      expect.unreachable('a read watchpoint must fail loudly, not silently never fire');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(ExitCode.ENV_ERROR);
      expect((error as CliError).message).toMatch(/read watchpoints/i);
      expect((error as CliError).message).toMatch(/--watch-write|--until-change/);
    }
  });

  it('still honors --watch-write / --until-change (the observable stop conditions)', () => {
    const { file, org } = asmBin('progress', PROGRESS);
    const byWrite = runProgram(loadBinMachine(file, org), org, {
      watchWrite: [{ from: 0x9000, to: 0x9001 }],
      frames: 50,
    });
    expect(byWrite.status).toBe('watchpoint');
  });
});

// --- hang watchdog (ERR-PROD-HANG-* / CLI-PROD-OUT-RUN-002) -----------------

describe('runProgram — hang watchdog (ERR-PROD-HANG-SHAPE-001 / -KINDS-001)', () => {
  it('detects DI:HALT as a definite di-halt hang', () => {
    const { file, org } = asmBin('dihalt', DI_HALT);
    const result = runProgram(loadBinMachine(file, org), org, { frames: 100 });
    expect(result.status).toBe('hang');
    expect(result.hang?.kind).toBe('di-halt');
    expect(result.hang?.confidence).toBe('definite');
    expect(typeof result.hang?.likelyCause).toBe('string');
    expect(result.exit.kind).toBe('di-halt');
    expect(result.framesRun).toBe(1); // stops immediately
  });

  it('detects a tight JR $ loop as a probable tight-loop hang', () => {
    const { file, org } = asmBin('tight', TIGHT);
    const result = runProgram(loadBinMachine(file, org), org, { frames: 100 });
    expect(result.status).toBe('hang');
    expect(result.hang?.kind).toBe('tight-loop');
    expect(result.hang?.confidence).toBe('probable');
  });

  it('does NOT flag a progressing program as a hang (RT-PROD-EDGE-001)', () => {
    const { file, org } = asmBin('progress', PROGRESS);
    const result = runProgram(loadBinMachine(file, org), org, { frames: 100 });
    expect(result.status).toBe('ok');
    expect(result.hang).toBeUndefined();
  });
});

// --- scheduled input (RT-PROD-RUN-004/005, JOY-KEMPSTON / KBD-MATRIX) -------

describe('runProgram — scheduled Kempston input (CLI-PROD-RUN-005 / JOY-KEMPSTON-READ-001)', () => {
  it('a scheduled --joy right makes the program read 0x01 from port 0x1F', () => {
    const { file, org } = asmBin('joy', READ_JOY);
    const pressed = runProgram(loadBinMachine(file, org), org, {
      joy: '0:R*40',
      frames: 20,
      detectHangs: false,
    });
    expect(pressed.machine.memory[0x9000]).toBe(0x01); // KEMPSTON_RIGHT bit
    expect(pressed.input.joy).toEqual([{ frame: 0, value: 'R', hold: 40, byte: 0x01 }]);

    const idle = runProgram(loadBinMachine(file, org), org, { frames: 20, detectHangs: false });
    expect(idle.machine.memory[0x9000]).toBe(0x00); // nothing pressed → idle
  });
});

describe('runProgram — scheduled keyboard input (CLI-PROD-RUN-004 / KBD-MATRIX-001)', () => {
  it('a scheduled CAPS_SHIFT clears its matrix bit in the row-0 read', () => {
    const { file, org } = asmBin('keys', READ_KEYS);
    const pressed = runProgram(loadBinMachine(file, org), org, {
      keys: '0:CAPS_SHIFT*40',
      frames: 20,
      detectHangs: false,
    });
    // CAPS SHIFT is row 0 bit 0 (active-low): the read byte has bit 0 = 0 when pressed.
    expect((pressed.machine.memory[0x9000]! & 0x01)).toBe(0);

    const idle = runProgram(loadBinMachine(file, org), org, { frames: 20, detectHangs: false });
    expect((idle.machine.memory[0x9000]! & 0x01)).toBe(1); // no key → bit 0 set
  });
});

// --- determinism guard: runFrameObserved == Machine.runFrame ----------------

describe('run-loop — runFrameObserved mirrors Machine.runFrame (MACHINE-FRAME-LOOP-001)', () => {
  it('leaves byte-identical machine state for an EI/IM1/interrupt program', () => {
    const { file, org } = asmBin('int', INT_LOOP);

    // Reference: the core's own frame loop.
    const ref = loadBinMachine(file, org);
    for (let f = 0; f < 4; f += 1) ref.runFrame();

    // Mirror: our instruction-granular driver with a no-op observer (same default io).
    const obs = loadBinMachine(file, org);
    for (let f = 0; f < 4; f += 1) runFrameObserved(obs, () => false);

    expect(obs.registers).toEqual(ref.registers);
    expect(obs.clock).toBe(ref.clock);
    expect(obs.tStatesTotal).toBe(ref.tStatesTotal);
    expect(obs.frames).toBe(ref.frames);
    expect(Buffer.from(obs.memory)).toEqual(Buffer.from(ref.memory));
  });
});

// --- bin MachineSource load (RT-PROD-SESSION-002 / ERR-PROD-EMU-001) --------

describe('loadBinMachine — the bin source (RT-PROD-SESSION-002)', () => {
  it('loads bytes at org and sets PC to the entry', () => {
    const { file, org } = asmBin('progress', PROGRESS);
    const machine = loadBinMachine(file, org);
    expect(machine.registers.pc).toBe(0x8000);
    expect(machine.memory[0x8000]).not.toBe(0x00); // program bytes present
    expect(machine.memory[0x0000]).toBe(0xf3); // ROM still mapped (DI)
  });

  it('rejects an origin below RAM (cannot overwrite ROM)', () => {
    const file = join(dir, 'x.bin');
    writeFileSync(file, Uint8Array.from([0, 1, 2]));
    expect(() => loadBinMachine(file, 0x2000)).toThrow();
  });

  it('rejects a binary that overruns 0xFFFF', () => {
    const file = join(dir, 'big.bin');
    writeFileSync(file, new Uint8Array(0x100));
    expect(() => loadBinMachine(file, 0xff80)).toThrow();
  });
});

// --- CLI end-to-end (CLI-PROD-CONV-JSON-001) -------------------------------

describe('zxs run — CLI wiring end-to-end', () => {
  it('run --bin --json prints a single run envelope and exits 0', async () => {
    const { file } = asmBin('beeper', BEEPER);
    const cap = capture();
    const code = await runCli(['run', '--bin', file, '--org', '0x8000', '--frames', '30', '--json'], {
      streams: cap.streams,
    });
    expect(code).toBe(ExitCode.OK);
    const lines = cap.out().trim().split('\n');
    expect(lines).toHaveLength(1);
    const env = JSON.parse(lines[0]!);
    expect(env.ok).toBe(true);
    expect(env.stage).toBe('run');
    expect(env.status).toBe('ok');
    expect(Number.isInteger(env.audio.beeperEdges)).toBe(true);
    expect(env.audio.beeperEdges).toBeGreaterThan(0);
    expect(env.boot).toMatchObject({ source: 'bin', org: 0x8000 });
    expect(cap.err()).toBe('');
  });

  it('a DI:HALT program exits 2 (HANG) with a hang verdict in the envelope', async () => {
    const { file } = asmBin('dihalt', DI_HALT);
    const cap = capture();
    const code = await runCli(['run', '--bin', file, '--org', '0x8000', '--json'], {
      streams: cap.streams,
    });
    expect(code).toBe(ExitCode.HANG);
    const env = JSON.parse(cap.out().trim());
    expect(env.ok).toBe(false);
    expect(env.status).toBe('hang');
    expect(env.hang.kind).toBe('di-halt');
    expect(env.error.exitCode).toBe(ExitCode.HANG);
  });

  it('run --watch-read exits 3 (ENV_ERROR) with a clear unavailable message, not a silent pass', async () => {
    const { file } = asmBin('progress', PROGRESS);
    const cap = capture();
    const code = await runCli(
      ['run', '--bin', file, '--org', '0x8000', '--watch-read', '0x9000', '--json'],
      { streams: cap.streams },
    );
    expect(code).toBe(ExitCode.ENV_ERROR);
    const env = JSON.parse(cap.out().trim());
    expect(env.ok).toBe(false);
    expect(env.stage).toBe('run');
    expect(env.error.exitCode).toBe(ExitCode.ENV_ERROR);
    expect(env.error.message).toMatch(/read watchpoints/i);
  });

  it('run --until-pc stops early with status breakpoint (exit 0)', async () => {
    const { file } = asmBin('until', UNTIL);
    const cap = capture();
    const code = await runCli(
      ['run', '--bin', file, '--org', '0x8000', '--until-pc', '0x8006', '--frames', '50', '--json'],
      { streams: cap.streams },
    );
    expect(code).toBe(ExitCode.OK);
    const env = JSON.parse(cap.out().trim());
    expect(env.status).toBe('breakpoint');
    expect(env.exit.pc).toBe(0x8006);
  });
});

// --- file-source boot + output capture (D1/D3/D4/D5/D6) --------------------

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Assemble a program and wrap its bytes in a `.z80` v3 snapshot booting at its origin. */
function z80File(name: string, src: string): { file: string; org: number } {
  const result = assemble(src);
  if (!result.ok) throw new Error(`asm failed: ${result.errors.map((e) => e.message).join('; ')}`);
  const memory = new Uint8Array(0x10000);
  memory.set(result.bytes, result.origin);
  const bytes = writeZ80({ registers: { pc: result.origin, sp: 0xff00 }, memory, border: 2 });
  const file = join(dir, `${name}.z80`);
  writeFileSync(file, Buffer.from(bytes));
  return { file, org: result.origin };
}

/** Assemble a program and wrap its bytes as a loadable CODE `.tap` at its origin. */
function tapFile(name: string, src: string): { file: string; org: number } {
  const result = assemble(src);
  if (!result.ok) throw new Error(`asm failed: ${result.errors.map((e) => e.message).join('; ')}`);
  const bytes = tapImageBytes({ bytes: result.bytes, loadAddress: result.origin, name });
  const file = join(dir, `${name}.tap`);
  writeFileSync(file, Buffer.from(bytes));
  return { file, org: result.origin };
}

describe('zxs run — --z80 snapshot boot (D1, CLI-PROD-RUN-001)', () => {
  it('boots from a .z80 snapshot, runs it, and observes its beeper edges', async () => {
    const { file } = z80File('beeper', BEEPER);
    const cap = capture();
    const code = await runCli(['run', '--z80', file, '--frames', '30', '--json'], { streams: cap.streams });
    expect(code).toBe(ExitCode.OK);
    const env = JSON.parse(cap.out().trim());
    expect(env.ok).toBe(true);
    expect(env.status).toBe('ok');
    expect(env.boot).toMatchObject({ source: 'z80', org: 0x8000, version: 3 });
    expect(env.audio.beeperEdges).toBeGreaterThan(0);
  });
});

describe('zxs run — --tap tape boot (D4, CLI-PROD-RUN-001)', () => {
  it('instant-loads a CODE tape, runs it, and observes its beeper edges', async () => {
    const { file } = tapFile('beeper', BEEPER);
    const cap = capture();
    const code = await runCli(['run', '--tap', file, '--frames', '30', '--json'], { streams: cap.streams });
    expect(code).toBe(ExitCode.OK);
    const env = JSON.parse(cap.out().trim());
    expect(env.boot).toMatchObject({ source: 'tap', org: 0x8000 });
    expect(env.status).toBe('ok');
    expect(env.audio.beeperEdges).toBeGreaterThan(0);
  });
});

describe('zxs run — --sna fails loud (D6, W4-GAP-03)', () => {
  it('rejects a .sna source with the honest missing-codec message (naming the reader + W4-GAP-03)', async () => {
    const file = join(dir, 'game.sna');
    writeFileSync(file, Buffer.alloc(49179));
    const cap = capture();
    const code = await runCli(['run', '--sna', file, '--json'], { streams: cap.streams });
    expect(code).toBe(ExitCode.USER_ERROR);
    const env = JSON.parse(cap.out().trim());
    expect(env.ok).toBe(false);
    expect(env.error.message).toMatch(/\.sna codec/);
    expect(env.error.message).toMatch(/W4-GAP-03/);
  });
});

describe('zxs run — --screenshot capture (D3, CLI-PROD-RUN-004 / -RULE-SCREENSHOT-001)', () => {
  it('writes a valid PNG of the post-run screen (the one encoder)', async () => {
    const { file } = asmBin('progress', PROGRESS);
    const png = join(dir, 'out', 'shot.png');
    const cap = capture();
    const code = await runCli(
      ['run', '--bin', file, '--org', '0x8000', '--frames', '10', '--screenshot', png, '--json'],
      { streams: cap.streams },
    );
    expect(code).toBe(ExitCode.OK);
    const bytes = readFileSync(png);
    expect(bytes.length).toBeGreaterThan(8);
    expect([...bytes.subarray(0, 8)]).toEqual(PNG_MAGIC);
  });
});

describe('zxs run — --wav capture (D5, CLI-PROD-RUN-004 / RT-PROD-OUT-002 / beeper-output.md)', () => {
  it('writes a valid RIFF/WAVE with a non-empty PCM data chunk', async () => {
    const { file } = asmBin('beeper', BEEPER);
    const wav = join(dir, 'out', 'beeper.wav');
    const cap = capture();
    const code = await runCli(
      ['run', '--bin', file, '--org', '0x8000', '--frames', '20', '--wav', wav, '--json'],
      { streams: cap.streams },
    );
    expect(code).toBe(ExitCode.OK);
    const bytes = readFileSync(wav);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(bytes.readUInt16LE(20)).toBe(1); // audio format = PCM
    expect(bytes.readUInt16LE(22)).toBe(1); // mono
    expect(bytes.readUInt32LE(24)).toBe(44100); // sample rate
    const dataLen = bytes.readUInt32LE(40);
    expect(dataLen).toBeGreaterThan(0);
    expect(bytes.length).toBe(44 + dataLen);
  });

  it('renders PCM per beeper-output.md fractional accounting (BEEPER-PCM-FRACTIONAL-001 / -LEVEL-001)', () => {
    const T = 200 * 69888; // 200 frames of a 48K frame (the DNA audio-duration fixture span)
    expect(samplesForDuration(T, 44100)).toBe(176117);
    expect(samplesForDuration(T, 48000)).toBe(191692);
    // Rest level 0 → −amplitude before the first edge; a level-1 edge at capture start → +amplitude.
    const rest = renderBeeperPcm([], 0, 3_500_000, { sampleRate: 10, amplitude: 100 });
    expect(rest.length).toBe(10);
    expect([...rest].every((s) => s === -100)).toBe(true);
    const high = renderBeeperPcm([{ t: 0, level: 1 }], 0, 3_500_000, { sampleRate: 10, amplitude: 100 });
    expect([...high].every((s) => s === 100)).toBe(true);
  });
});

// --- argument / schedule parsing (unit) ------------------------------------

describe('address parsing (CLI-PROD-CONV-ADDR-001 / -RANGE-001)', () => {
  it('accepts 0x / $ / h / decimal address forms', () => {
    expect(parseAddress('0x8000')).toBe(0x8000);
    expect(parseAddress('$8000')).toBe(0x8000);
    expect(parseAddress('8000h')).toBe(0x8000);
    expect(parseAddress('32768')).toBe(0x8000);
  });
  it('parses an inclusive from-to range', () => {
    expect(parseRange('0x4000-0x5aff')).toEqual({ from: 0x4000, to: 0x5aff });
  });
  it('rejects a malformed address / range', () => {
    expect(() => parseAddress('nope')).toThrow();
    expect(() => parseRange('0x4000')).toThrow();
  });
});

describe('input schedule parsing (CLI-PROD-RUN-004/005)', () => {
  it('parses a keys schedule with default and explicit holds', () => {
    expect(parseKeySchedule('60:O*30,120:SPACE')).toEqual([
      { frame: 60, key: 'O', hold: 30 },
      { frame: 120, key: 'SPACE', hold: 3 },
    ]);
  });
  it('parses a joy schedule into active-high 000FUDLR bytes', () => {
    expect(parseJoySchedule('60:R*30,90:RF*10')).toEqual([
      { frame: 60, value: 'R', hold: 30, byte: 0x01 },
      { frame: 90, value: 'RF', hold: 10, byte: 0x11 },
    ]);
  });
  it('rejects an unknown key / control', () => {
    expect(() => parseKeySchedule('0:NOPE')).toThrow();
    expect(() => parseJoySchedule('0:Q')).toThrow();
  });
  it('keyboardByte returns the documented IN (0xFE) byte (KBD-MATRIX-001 worked points)', () => {
    // No key, EAR idle 1, all rows: 0xFF.
    expect(keyboardByte(new Set(), 0x00, 1)).toBe(0xff);
    // CAPS SHIFT pressed, read row 0 (high 0xFE), EAR 0 → bit0 clear, b6 clear.
    expect(keyboardByte(new Set(['CAPS_SHIFT']), 0xfe, 0)).toBe(0xbe);
  });
});
