// Test-runner integration (CLI-PROD-TEST-001 / CLI-PROD-OUT-TEST-001, REC-PROD-RUN-*):
// real specs assembled + run end-to-end through `runSpec`/`runTestSuite`/`zxs test`,
// proving the multi-assertion path, single-run `at` checkpoint capture (REC-PROD-RUN-005),
// signed `memDelta`, `screenDiff` against a renderer-generated baseline, build-fail
// handling (REC-PROD-RULE-BUILDFAIL-001), discovery, and the suite exit discipline.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import { runSpec, runTestSuite } from '../src/test/runner.js';
import * as runModule from '../src/runtime/run.js';
import { loadBytesMachine } from '../src/runtime/session.js';
import { readScreenImage, renderRgbaImage } from '../src/observe/screen.js';
import { assemble } from '@zx-vibes/asm';
import { runCli } from '../src/cli.js';
import { ExitCode, type OutputStreams } from '../src/output/envelope.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: string): void {
  writeFileSync(join(dir, name), contents, 'utf8');
}
function writeSpec(name: string, spec: object): string {
  write(name, JSON.stringify(spec, null, 2));
  return join(dir, name);
}

// --- programs --------------------------------------------------------------

// Sets border red (2), writes 0x2A to 0x9000, then a HALT-synced idle loop.
const SETUP = [
  'ORG 0x8000',
  '  ld sp, 0xFF00',
  '  ld a, 2',
  '  out (0xFE), a', // border 2 (b4=0, no beeper edge)
  '  ld a, 0x2A',
  '  ld (0x9000), a',
  '  im 1',
  '  ei',
  'main:',
  '  halt',
  '  jr main',
  '',
].join('\n');

// Increments a 16-bit counter at 0x9000 once per frame (HALT-paced) — the temporal probe.
const COUNTER = [
  'ORG 0x8000',
  '  ld sp, 0xFF00',
  '  im 1',
  '  ei',
  'main:',
  '  halt',
  '  ld hl, (0x9000)',
  '  inc hl',
  '  ld (0x9000), hl',
  '  jr main',
  '',
].join('\n');

// Fills the whole screen white (display 0xFF, attr 0x07 = paper black / ink white).
const SCRWHITE = [
  'ORG 0x8000',
  '  ld sp, 0xFF00',
  '  ld hl, 0x4000',
  '  ld (hl), 0xFF',
  '  ld de, 0x4001',
  '  ld bc, 0x17FF', // 6143 → fill 0x4000..0x57FF
  '  ldir',
  '  ld hl, 0x5800',
  '  ld (hl), 0x07',
  '  ld de, 0x5801',
  '  ld bc, 0x02FF', // 767 → fill attrs
  '  ldir',
  '  im 1',
  '  ei',
  'idle:',
  '  halt',
  '  jr idle',
  '',
].join('\n');

// Fills only part of the display white → differs from the all-white baseline.
const SCRHALF = SCRWHITE.replace('  ld bc, 0x17FF', '  ld bc, 0x0BFF');

const BAD = ['ORG 0x8000', 'dup:', 'dup:', '  ret', ''].join('\n');

// ===========================================================================

describe('runSpec — multi-assertion spec over the real pipeline (REC-PROD-REPORT-001)', () => {
  it('assembles, runs, and passes a spec asserting status/halt/border/mem/portFE', () => {
    write('setup.asm', SETUP);
    const file = writeSpec('setup.test.json', {
      build: 'setup.asm',
      frames: 60,
      assert: [
        { type: 'status', equals: 'ok' },
        { type: 'haltSynced', equals: true },
        { type: 'borderColor', equals: 2 },
        { type: 'memEquals', addr: '0x9000', hex: '2A' },
        { type: 'portFEWrites', min: 1 },
        { type: 'beeperEdges', max: 0 },
      ],
    });
    const result = runSpec(file, dir);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('runSpec — at temporal checkpoints captured in ONE run (REC-PROD-RUN-005)', () => {
  it('evaluates distinct at-frames + memDelta from a single runProgram call', () => {
    write('counter.asm', COUNTER);
    const file = writeSpec('counter.test.json', {
      build: 'counter.asm',
      frames: 40,
      assert: [
        // memDelta: the counter strictly increased over the run (signed start→end).
        { type: 'memDelta', addr: '0x9000', size: 2, min: 1 },
        // Two distinct temporal checkpoints — the value grew between them.
        { type: 'at', frame: 5, assert: [{ type: 'memInRange', addr: '0x9000', size: 2, max: 7 }] },
        { type: 'at', frame: 10, assert: [{ type: 'memInRange', addr: '0x9000', size: 2, min: 7 }] },
      ],
    });

    const spy = vi.spyOn(runModule, 'runProgram');
    const result = runSpec(file, dir);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    // The contract: ONE run serves the start snapshot + both checkpoints (no re-run).
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('fails an at-frame past the run length (no snapshot)', () => {
    write('counter.asm', COUNTER);
    const file = writeSpec('past.test.json', {
      build: 'counter.asm',
      frames: 10,
      assert: [{ type: 'at', frame: 999, assert: [{ type: 'status', equals: 'ok' }] }],
    });
    const result = runSpec(file, dir);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/no checkpoint/);
  });
});

describe('runSpec — memDelta signed-change spec (ASSERT-PROD-MEMDELTA-001)', () => {
  it('a too-large min bound fails the otherwise-passing increase', () => {
    write('counter.asm', COUNTER);
    const file = writeSpec('delta.test.json', {
      build: 'counter.asm',
      frames: 20,
      assert: [{ type: 'memDelta', addr: '0x9000', size: 2, min: 1000 }],
    });
    const result = runSpec(file, dir);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/memDelta/);
  });
});

describe('runSpec — screenDiff vs a renderer-generated baseline (ASSERT-PROD-SCREENDIFF-001)', () => {
  it('exact-match passes; a divergent screen exceeds maxDiff and fails', () => {
    // Generate the baseline deterministically from SCRWHITE's actual post-run frame.
    const asmWhite = assemble(SCRWHITE);
    expect(asmWhite.ok).toBe(true);
    const m = loadBytesMachine(asmWhite.bytes, asmWhite.origin);
    runModule.runProgram(m, asmWhite.origin, { frames: 30 });
    const rgba = renderRgbaImage(readScreenImage(m), 0);
    const png = new PNG({ width: rgba.width, height: rgba.height });
    png.data = Buffer.from(rgba.data);
    writeFileSync(join(dir, 'golden.png'), PNG.sync.write(png));

    // PASS: the same program reproduces the baseline frame exactly.
    write('white.asm', SCRWHITE);
    const passFile = writeSpec('white.test.json', {
      build: 'white.asm',
      frames: 30,
      assert: [{ type: 'screenDiff', baseline: 'golden.png', maxDiff: 0 }],
    });
    expect(runSpec(passFile, dir).ok).toBe(true);

    // FAIL: a partially-filled screen differs from the all-white baseline.
    write('half.asm', SCRHALF);
    const failFile = writeSpec('half.test.json', {
      build: 'half.asm',
      frames: 30,
      assert: [{ type: 'screenDiff', baseline: 'golden.png', maxDiff: 0 }],
    });
    const failed = runSpec(failFile, dir);
    expect(failed.ok).toBe(false);
    expect(failed.failures.join(' ')).toMatch(/differing pixel/);
  });
});

describe('runSpec — build failure fails the spec with diagnostics (REC-PROD-RULE-BUILDFAIL-001)', () => {
  it('reports the assembler diagnostics and evaluates no assertions', () => {
    write('bad.asm', BAD);
    const file = writeSpec('bad.test.json', {
      build: 'bad.asm',
      assert: [{ type: 'status', equals: 'ok' }],
    });
    const result = runSpec(file, dir);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/build failed/i);
  });
});

describe('runTestSuite — discovery + suite verdict (REC-PROD-SPEC-002 / REC-PROD-REPORT-002)', () => {
  it('walks a directory, runs each spec, and the suite fails iff any spec fails', () => {
    write('setup.asm', SETUP);
    write('counter.asm', COUNTER);
    writeSpec('pass.test.json', {
      build: 'setup.asm',
      frames: 30,
      assert: [{ type: 'borderColor', equals: 2 }],
    });
    writeSpec('fail.test.json', {
      build: 'setup.asm',
      frames: 30,
      assert: [{ type: 'borderColor', equals: 5 }],
    });
    const suite = runTestSuite(dir, dir);
    expect(suite.total).toBe(2);
    expect(suite.passed).toBe(1);
    expect(suite.failed).toBe(1);
    expect(suite.ok).toBe(false);
  });
});

describe('zxs test <spec> --json — CLI end-to-end (CLI-PROD-OUT-TEST-001)', () => {
  function capture(): { streams: OutputStreams; out: () => string } {
    const chunks: string[] = [];
    return { streams: { out: (t) => chunks.push(t), err: () => {} }, out: () => chunks.join('') };
  }

  it('a passing spec exits 0 with a well-formed suite envelope', async () => {
    write('setup.asm', SETUP);
    const file = writeSpec('setup.test.json', {
      build: 'setup.asm',
      frames: 30,
      assert: [
        { type: 'status', equals: 'ok' },
        { type: 'memEquals', addr: '0x9000', hex: '2A' },
      ],
    });
    const cap = capture();
    const code = await runCli(['test', file, '--json'], { streams: cap.streams });
    expect(code).toBe(ExitCode.OK);
    const env = JSON.parse(cap.out().trim());
    expect(env).toMatchObject({ ok: true, stage: 'test', total: 1, passed: 1, failed: 0 });
    expect(env.results[0].ok).toBe(true);
  });

  it('a failing spec exits 1 (USER_ERROR) and lists the failure', async () => {
    write('setup.asm', SETUP);
    const file = writeSpec('bad.test.json', {
      build: 'setup.asm',
      frames: 30,
      assert: [{ type: 'borderColor', equals: 5 }],
    });
    const cap = capture();
    const code = await runCli(['test', file, '--json'], { streams: cap.streams });
    expect(code).toBe(ExitCode.USER_ERROR);
    const env = JSON.parse(cap.out().trim());
    expect(env.ok).toBe(false);
    expect(env.stage).toBe('test');
    expect(env.failed).toBe(1);
    expect(env.results[0].failures.join(' ')).toMatch(/borderColor/);
  });
});
