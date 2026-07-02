// Declarative test runner — cli.md CLI-PROD-TEST-001 + CLI-PROD-OUT-TEST-001,
// toolkit-runtime.md RT-PROD-TEST-001..004, recipes-and-assertions.md REC-PROD-*.
//
// `zxs test [path]` discovers `test.json` / `*.test.json` specs, runs each in
// isolation, and reports `{ ok, stage:"test", total, passed, failed, results[] }`
// (exit 0 iff all pass). Each spec: assemble its `build` entry (in-memory temp,
// REC-PROD-RUN-001) → boot a clean-ROM machine → load at `org` → run a fixed budget
// (default 120) with the `keys`/`joy` schedule and the hang watchdog → evaluate the
// assertions against the post-run state, using start-of-run + per-`at`-frame
// checkpoints captured in ONE run (REC-PROD-RUN-005, the temporal/delta seam).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Command } from 'commander';
import { assembleFile, type Diagnostic } from '@zx-vibes/asm';
import type { Machine } from '@zx-vibes/machine';
import {
  ExitCode,
  successEnvelope,
  userError,
  type Envelope,
} from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { loadBytesMachine } from '../runtime/session.js';
import { runProgram } from '../runtime/run.js';
import { DEFAULT_BORDER, type HostIo } from '../runtime/io-device.js';
import { readRegisters } from '../observe/registers.js';
import { SCREEN_BASE, SCREEN_IMAGE_SIZE, hashBytes } from '../observe/screen.js';
import { parseAddress } from '../util/address.js';
import {
  ASSERTION_REFERENCE,
  asAssertion,
  collectCheckpointFrames,
  evaluateAssertion,
  type RunContext,
  type Snapshot,
} from './assertions.js';

/** The default per-spec frame budget (REC-PROD-SPEC-003). NB: `run`'s default is 300. */
export const DEFAULT_TEST_FRAMES = 120;
/** Directories the spec walk skips (REC-PROD-SPEC-002). */
export const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', '.zxs', 'build', 'dist']);

/** One spec's verdict (REC-PROD-REPORT-001). */
export interface SpecResult {
  /** The spec file path (relative to cwd, `/`-separated). */
  spec: string;
  /** True iff every assertion passed (and the build succeeded). */
  ok: boolean;
  /** Human-readable failure strings (assertion mismatches or build diagnostics). */
  failures: string[];
}

/** The whole-suite verdict (REC-PROD-REPORT-002). */
export interface SuiteResult {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  results: SpecResult[];
}

/** A parsed test spec (REC-PROD-SPEC-003). Validated loosely; bad shapes fail the spec. */
interface TestSpec {
  build: string;
  org?: string | number;
  frames?: number;
  keys?: string;
  joy?: string;
  detectHangs?: boolean;
  assert: unknown[];
}

// --- spec discovery (REC-PROD-SPEC-001/002) --------------------------------

function isSpecFile(name: string): boolean {
  return name === 'test.json' || name.endsWith('.test.json');
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile() && isSpecFile(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

/**
 * Discover spec files at `target` (default `.`): an explicit file is used directly; a
 * directory is walked recursively, skipping {@link SKIP_DIRS} (REC-PROD-SPEC-002). A
 * missing path is a USER_ERROR.
 */
export function discoverSpecs(target: string): string[] {
  let stat;
  try {
    stat = statSync(target);
  } catch {
    throw userError(`test path not found: ${target}`, 'test');
  }
  if (stat.isFile()) return [target];
  const out: string[] = [];
  walk(target, out);
  out.sort();
  return out;
}

// --- snapshot capture (REC-PROD-RUN-005) -----------------------------------

/** Capture a full machine snapshot for assertion evaluation (deep memory copy). */
function captureSnapshot(
  frame: number,
  machine: Machine,
  border: number,
  beeperEdges: number,
  portFEWrites: number,
): Snapshot {
  const memory = machine.memory.slice(); // independent 64 KB copy
  const screen = memory.subarray(SCREEN_BASE, SCREEN_BASE + SCREEN_IMAGE_SIZE);
  return {
    frame,
    memory,
    screen,
    screenHash: hashBytes(screen),
    border,
    registers: readRegisters(machine),
    beeperEdges,
    portFEWrites,
  };
}

function portableSpecPath(file: string, cwd: string): string {
  const rel = relative(cwd, file);
  const chosen = rel === '' || rel.startsWith('..') ? file : rel;
  return chosen.split(sep).join('/');
}

function toDiagnosticLine(d: Diagnostic): string {
  return `${d.file}:${d.line}: ${d.message}`;
}

// --- one spec (REC-PROD-RUN-001..005) --------------------------------------

/**
 * Run one spec in isolation and produce its verdict. Assembles `build` (a build
 * failure fails the spec with diagnostics, no assertions evaluated —
 * REC-PROD-RULE-BUILDFAIL-001), boots a clean machine, captures the start snapshot,
 * runs once capturing each `at`-frame checkpoint (REC-PROD-RUN-005), then evaluates
 * every assertion against the post-run snapshot.
 */
export function runSpec(specFile: string, cwd: string): SpecResult {
  const spec = portableSpecPath(specFile, cwd);
  const specDir = dirname(specFile);

  let parsed: TestSpec;
  try {
    const raw = JSON.parse(readFileSync(specFile, 'utf8')) as unknown;
    parsed = validateSpec(raw);
  } catch (error) {
    return { spec, ok: false, failures: [describe(error)] };
  }

  try {
    // Assemble the build entry in-memory (REC-PROD-RUN-001, "temp output").
    const buildPath = resolve(specDir, parsed.build);
    const asm = assembleFile(buildPath, { cwd: specDir, sandbox: true });
    if (!asm.ok) {
      // REC-PROD-RULE-BUILDFAIL-001: build failure → spec fails, no assertions run.
      return {
        spec,
        ok: false,
        failures: [`build failed (${parsed.build}):`, ...asm.errors.map(toDiagnosticLine)],
      };
    }

    const symbols = new Map<string, number>(asm.symbols.map((s) => [s.name, s.value]));
    const loadOrg =
      parsed.org === undefined
        ? asm.origin
        : typeof parsed.org === 'number'
          ? parsed.org & 0xffff
          : parseAddress(parsed.org, 'test');

    const machine = loadBytesMachine(asm.bytes, loadOrg);
    // Start-of-run snapshot (pre-input, REC-PROD-RUN-001): clean border, no audio yet.
    const start = captureSnapshot(0, machine, DEFAULT_BORDER, 0, 0);

    const checkpointFrames = collectCheckpointFrames(parsed.assert);
    const checkpoints = new Map<number, Snapshot>();
    const onFrame = (f: number, m: Machine, io: HostIo): void => {
      const done = f + 1; // frames elapsed after this frame
      if (checkpointFrames.has(done)) {
        checkpoints.set(done, captureSnapshot(done, m, io.borderColor(), io.beeperEdges, io.portFEWrites));
      }
    };

    const result = runProgram(machine, loadOrg, {
      frames: parsed.frames ?? DEFAULT_TEST_FRAMES,
      keys: parsed.keys,
      joy: parsed.joy,
      detectHangs: parsed.detectHangs ?? true,
      onFrame,
    });

    const final = captureSnapshot(
      result.framesRun,
      result.machine,
      result.io.borderColor(),
      result.io.beeperEdges,
      result.io.portFEWrites,
    );

    const ctx: RunContext = {
      start,
      status: result.status === 'hang' ? 'hang' : 'ok',
      haltSynced: result.haltSynced,
      framesRun: result.framesRun,
      checkpoints,
      symbols,
      specDir,
    };

    const failures: string[] = [];
    for (const raw of parsed.assert) {
      try {
        const failure = evaluateAssertion(asAssertion(raw), final, ctx);
        if (failure) failures.push(failure);
      } catch (error) {
        failures.push(describe(error));
      }
    }

    return { spec, ok: failures.length === 0, failures };
  } catch (error) {
    // A run/load error (bad org, unreadable include, …) fails this spec, not the suite.
    return { spec, ok: false, failures: [describe(error)] };
  }
}

function validateSpec(raw: unknown): TestSpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw userError('a test spec must be a JSON object', 'test');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.build !== 'string') {
    throw userError('test spec requires a string "build" (path to the .asm entry)', 'test');
  }
  if (!Array.isArray(obj.assert)) {
    throw userError('test spec requires an "assert" array', 'test');
  }
  return obj as unknown as TestSpec;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- the suite (REC-PROD-REPORT-002) ---------------------------------------

/**
 * Run every discovered spec under `path` (default `.`) and compose the suite result
 * (RT-PROD-TEST-001). Programmatic entry the `verify` pipeline (Slice 5) calls when a
 * `tests/` directory exists; `ok` is true iff every spec passed (an empty suite passes
 * vacuously).
 */
export function runTestSuite(path = '.', cwd: string = process.cwd()): SuiteResult {
  const target = resolve(cwd, path);
  const specs = discoverSpecs(target);
  const results = specs.map((file) => runSpec(file, cwd));
  const failed = results.filter((r) => !r.ok).length;
  return {
    ok: failed === 0,
    total: results.length,
    passed: results.length - failed,
    failed,
    results,
  };
}

// --- CLI command (CLI-PROD-TEST-001 / CLI-PROD-OUT-TEST-001) ----------------

type TestReport = {
  stage: 'test';
  total: number;
  passed: number;
  failed: number;
  results: SpecResult[];
};
export type TestSuccessEnvelope = TestReport & { ok: true };
export type TestErrorEnvelope = TestReport & {
  ok: false;
  error: { message: string; exitCode: typeof ExitCode.USER_ERROR };
};
/** The `test` suite envelope — all-green (exit 0) or any-failure (exit 1). */
export type TestEnvelope = TestSuccessEnvelope | TestErrorEnvelope;

/** Build the suite envelope from a {@link SuiteResult} (CLI-PROD-OUT-TEST-001). */
export function buildTestEnvelope(suite: SuiteResult): TestEnvelope {
  const report: TestReport = {
    stage: 'test',
    total: suite.total,
    passed: suite.passed,
    failed: suite.failed,
    results: suite.results,
  };
  if (suite.ok) return { ok: true, ...report };
  return {
    ok: false,
    ...report,
    error: {
      message: `${suite.failed} of ${suite.total} test spec(s) failed`,
      exitCode: ExitCode.USER_ERROR,
    },
  };
}

interface TestCliOptions {
  listAssertions?: boolean;
}

/** The `test` command handler: `--list-assertions` reference, else run the suite. */
export function testCommand(context: CommandContext): Envelope {
  const options = context.options as TestCliOptions;
  if (options.listAssertions) {
    // ASSERT-PROD-LIST-001: print the 16-assertion reference.
    return successEnvelope('test', { assertions: ASSERTION_REFERENCE });
  }
  const path = context.args[0] ?? '.';
  const suite = runTestSuite(path, process.cwd());
  return buildTestEnvelope(suite);
}

/** Declare the `test` command's argument and flags. */
export function configureTestCommand(command: Command): void {
  command
    .description('Run declarative asm tests (or print the assertion reference)')
    .argument('[path]', 'spec file or directory to walk (default ".")')
    .option('--list-assertions', 'print the 16-assertion reference')
    .option('--json', 'emit a single machine-readable JSON envelope');
}

// `testCommand` returns `Envelope` (success report, list-assertions, or failure report
// with an error). This assertion documents that contract for the registry.
const _envelopeCheck: (c: CommandContext) => Envelope = testCommand;
void _envelopeCheck;
