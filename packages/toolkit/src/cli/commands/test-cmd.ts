import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { build } from '../../build/sjasmplus.js';
import { Watchdog } from '../../core/detect.js';
import { KeyPlanRunner, parseKeysSpec } from '../../core/input.js';
import type { Machine } from '../../core/machine.js';
import { screenText } from '../../core/screen-text.js';
import { configuredAssembler, loadProjectConfig } from '../config.js';
import { EXIT, emit, parseAddress, userError } from '../output.js';
import { bootCachedMachine } from '../session.js';

/**
 * Declarative test specs (test.json / *.test.json) for asm programs — the
 * assertion vocabulary mirrors the observation primitives agents use, so
 * recipes are executable documentation that cannot rot.
 */
interface TestSpec {
  build: string;
  org?: string;
  frames?: number;
  keys?: string;
  detectHangs?: boolean;
  assert: Assertion[];
}

type Assertion =
  | { type: 'status'; equals: 'ok' | 'hang' }
  | { type: 'haltSynced'; equals: boolean }
  | { type: 'screenIncludes'; text: string }
  | { type: 'cellsNonBlank'; min?: number; max?: number }
  | { type: 'attrNonBlank'; min?: number; max?: number }
  | { type: 'coloredCells'; min?: number; max?: number }
  | { type: 'memEquals'; addr: string; hex: string }
  | { type: 'regEquals'; reg: string; value: number | string }
  | { type: 'borderColor'; equals: number }
  | { type: 'pixelAt'; x: number; y: number; set: boolean }
  | { type: 'screenChanged'; equals: boolean }
  | { type: 'beeperEdges'; min?: number; max?: number }
  | { type: 'portFEWrites'; min?: number; max?: number };

export interface TestResult {
  spec: string;
  ok: boolean;
  failures: string[];
}

export interface TestSuiteResult {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}

export const ASSERTION_REFERENCE = [
  { type: 'status', fields: { equals: ['ok', 'hang'] }, description: 'Expected run status.' },
  { type: 'haltSynced', fields: { equals: 'boolean' }, description: 'Whether the main loop stayed synchronized to HALT/frame cadence.' },
  { type: 'screenChanged', fields: { equals: 'boolean' }, description: 'Whether bitmap or attribute memory changed during the run.' },
  { type: 'cellsNonBlank', fields: { min: 'number?', max: 'number?' }, description: 'Counts 8x8 cells with at least one set bitmap pixel.' },
  { type: 'attrNonBlank', fields: { min: 'number?', max: 'number?' }, description: 'Counts attribute cells whose byte is not the default 0x38.' },
  { type: 'coloredCells', fields: { min: 'number?', max: 'number?' }, description: 'Alias of attrNonBlank for attribute-only colour tests.' },
  { type: 'screenIncludes', fields: { text: 'string' }, description: 'Checks ROM-font/OCR text rows.' },
  { type: 'memEquals', fields: { addr: 'address', hex: 'hex bytes' }, description: 'Checks exact memory bytes.' },
  { type: 'regEquals', fields: { reg: 'register', value: 'number|address string' }, description: 'Checks a CPU register value.' },
  { type: 'pixelAt', fields: { x: '0..255', y: '0..191', set: 'boolean' }, description: 'Checks a Spectrum bitmap pixel.' },
  { type: 'borderColor', fields: { equals: '0..7' }, description: 'Checks ULA border colour.' },
  { type: 'beeperEdges', fields: { min: 'number?', max: 'number?' }, description: 'Checks changes of port 0xFE bit 4.' },
  { type: 'portFEWrites', fields: { min: 'number?', max: 'number?' }, description: 'Checks writes to ULA port 0xFE.' },
] as const;

const SKIP_DIRS = new Set(['node_modules', '.git', '.zxs', 'build', 'dist']);

function findSpecs(path: string): string[] {
  const st = statSync(path);
  if (st.isFile()) return [path];
  const out: string[] = [];
  for (const entry of readdirSync(path)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(path, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findSpecs(full));
    } else if (entry === 'test.json' || entry.endsWith('.test.json')) {
      out.push(full);
    }
  }
  return out.sort();
}

function screenHash(m: Machine): string {
  const h = createHash('sha1');
  h.update(m.memory.getScreenMemory());
  h.update(m.memory.getAttributeMemory());
  return h.digest('hex');
}

function pixelSet(m: Machine, x: number, y: number): boolean {
  if (x < 0 || x > 255 || y < 0 || y > 191) return false;
  const offset = ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | (x >> 3);
  const byte = m.memory.getScreenMemory()[offset]!;
  return ((byte >> (7 - (x & 7))) & 1) === 1;
}

function regValue(m: Machine, reg: string): number {
  const r = m.getRegisters();
  const map: Record<string, number> = {
    a: r.af >> 8,
    f: r.af & 0xff,
    b: r.bc >> 8,
    c: r.bc & 0xff,
    d: r.de >> 8,
    e: r.de & 0xff,
    h: r.hl >> 8,
    l: r.hl & 0xff,
    af: r.af,
    bc: r.bc,
    de: r.de,
    hl: r.hl,
    sp: r.sp,
    pc: r.pc,
    ix: r.ix,
    iy: r.iy,
    i: r.i,
    r: r.r,
    im: r.im,
  };
  const v = map[reg.toLowerCase()];
  if (v === undefined) throw new Error(`unknown register '${reg}'`);
  return v;
}

async function runSpec(specPath: string): Promise<TestResult> {
  const failures: string[] = [];
  const dir = dirname(specPath);
  const loaded = loadProjectConfig();
  const assembler = configuredAssembler(undefined, loaded.config);
  let spec: TestSpec;
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8')) as TestSpec;
  } catch (err) {
    return { spec: specPath, ok: false, failures: [`invalid JSON: ${(err as Error).message}`] };
  }

  const outDir = mkdtempSync(join(tmpdir(), 'zxs-test-'));
  const result = await build(resolve(dir, spec.build), {
    outDir,
    cwd: dir,
    ...(assembler ? { assembler } : {}),
  });
  if (!result.ok || !result.outputs.bin) {
    return {
      spec: specPath,
      ok: false,
      failures: result.errors.map((e) => `build: ${e.file}:${e.line} ${e.message}`),
    };
  }

  const m = bootCachedMachine();
  const org = spec.org !== undefined ? parseAddress(spec.org) : 0x8000;
  m.loadBinary(new Uint8Array(readFileSync(result.outputs.bin)), org);
  const beforeHash = screenHash(m);

  const runner = new KeyPlanRunner(spec.keys ? parseKeysSpec(spec.keys) : [], m);
  runner.applyDue(0);
  const wd = (spec.detectHangs ?? true) ? new Watchdog() : undefined;
  wd?.attach(m);
  m.resetAudioActivity();
  const outcome = m.run({
    frames: Math.max(spec.frames ?? 120, runner.planFrames),
    onFrame: (f) => runner.applyDue(f),
    ...(wd ? { watchdog: wd } : {}),
  });
  wd?.detach();

  const status = outcome.hang ? 'hang' : 'ok';
  const text = screenText(m);
  const audio = m.getAudioActivity();
  const allRows = text.rows.join('\n');
  const attrChangedCells = text.attrs
    .filter((a) => a.attr !== 0x38)
    .reduce((sum, a) => sum + a.count, 0);

  for (const a of spec.assert) {
    switch (a.type) {
      case 'status':
        if (status !== a.equals) {
          failures.push(
            `status: expected '${a.equals}', got '${status}'` +
              (outcome.hang ? ` (${outcome.hang.kind}: ${outcome.hang.detail})` : '')
          );
        }
        break;
      case 'haltSynced': {
        const synced = wd ? wd.haltSynced(outcome.framesRun) : undefined;
        if (synced !== a.equals) failures.push(`haltSynced: expected ${a.equals}, got ${synced}`);
        break;
      }
      case 'screenIncludes':
        if (!allRows.includes(a.text)) failures.push(`screenIncludes: '${a.text}' not on screen`);
        break;
      case 'cellsNonBlank':
        if (a.min !== undefined && text.nonBlankCells < a.min)
          failures.push(`cellsNonBlank: ${text.nonBlankCells} < min ${a.min}`);
        if (a.max !== undefined && text.nonBlankCells > a.max)
          failures.push(`cellsNonBlank: ${text.nonBlankCells} > max ${a.max}`);
        break;
      case 'attrNonBlank':
      case 'coloredCells':
        if (a.min !== undefined && attrChangedCells < a.min)
          failures.push(`${a.type}: ${attrChangedCells} < min ${a.min}`);
        if (a.max !== undefined && attrChangedCells > a.max)
          failures.push(`${a.type}: ${attrChangedCells} > max ${a.max}`);
        break;
      case 'memEquals': {
        const addr = parseAddress(a.addr);
        const want = a.hex.toLowerCase().replace(/\s/g, '');
        const got = Buffer.from(m.readMemory(addr, want.length / 2)).toString('hex');
        if (got !== want) failures.push(`memEquals @${a.addr}: expected ${want}, got ${got}`);
        break;
      }
      case 'regEquals': {
        const want = typeof a.value === 'string' ? parseAddress(a.value) : a.value;
        const got = regValue(m, a.reg);
        if (got !== want)
          failures.push(`regEquals ${a.reg}: expected 0x${want.toString(16)}, got 0x${got.toString(16)}`);
        break;
      }
      case 'borderColor':
        if (m.ula.getBorderColor() !== a.equals)
          failures.push(`borderColor: expected ${a.equals}, got ${m.ula.getBorderColor()}`);
        break;
      case 'pixelAt': {
        const set = pixelSet(m, a.x, a.y);
        if (set !== a.set) failures.push(`pixelAt (${a.x},${a.y}): expected set=${a.set}, got ${set}`);
        break;
      }
      case 'screenChanged': {
        const changed = screenHash(m) !== beforeHash;
        if (changed !== a.equals) failures.push(`screenChanged: expected ${a.equals}, got ${changed}`);
        break;
      }
      case 'beeperEdges':
        if (a.min !== undefined && audio.beeperEdges < a.min)
          failures.push(`beeperEdges: ${audio.beeperEdges} < min ${a.min}`);
        if (a.max !== undefined && audio.beeperEdges > a.max)
          failures.push(`beeperEdges: ${audio.beeperEdges} > max ${a.max}`);
        break;
      case 'portFEWrites':
        if (a.min !== undefined && audio.portFEWrites < a.min)
          failures.push(`portFEWrites: ${audio.portFEWrites} < min ${a.min}`);
        if (a.max !== undefined && audio.portFEWrites > a.max)
          failures.push(`portFEWrites: ${audio.portFEWrites} > max ${a.max}`);
        break;
    }
  }

  return { spec: specPath, ok: failures.length === 0, failures };
}

export async function runTestSuite(path: string): Promise<TestSuiteResult> {
  const specs = findSpecs(resolve(path));
  if (specs.length === 0) {
    return { ok: false, total: 0, passed: 0, failed: 1, results: [{ spec: path, ok: false, failures: [`No test.json / *.test.json found under ${path}`] }] };
  }

  const results: TestResult[] = [];
  for (const spec of specs) {
    results.push(await runSpec(spec));
  }
  const failed = results.filter((r) => !r.ok);

  return {
    ok: failed.length === 0,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
}

export async function testCommand(path: string, opts: { json: boolean; listAssertions?: boolean }): Promise<number> {
  if (opts.listAssertions) {
    emit(
      { ok: true, stage: 'test', assertions: ASSERTION_REFERENCE },
      opts.json,
      () =>
        ASSERTION_REFERENCE.map((a) => `${a.type}: ${a.description}`).join('\n')
    );
    return EXIT.OK;
  }

  const suite = await runTestSuite(path);
  if (suite.total === 0) {
    throw userError(`No test.json / *.test.json found under ${path}`, 'test');
  }

  emit(
    {
      ok: suite.ok,
      stage: 'test',
      total: suite.total,
      passed: suite.passed,
      failed: suite.failed,
      results: suite.results.map((r) => ({
        spec: r.spec,
        ok: r.ok,
        ...(r.failures.length > 0 ? { failures: r.failures } : {}),
      })),
    },
    opts.json,
    () =>
      suite.results
        .map(
          (r) =>
            `${r.ok ? '✓' : '✗'} ${basename(dirname(r.spec))}/${basename(r.spec)}` +
            (r.failures.length > 0 ? '\n' + r.failures.map((f) => `    ${f}`).join('\n') : '')
        )
        .join('\n') + `\n${suite.passed}/${suite.total} passed`
  );

  return suite.ok ? EXIT.OK : EXIT.USER_ERROR;
}
