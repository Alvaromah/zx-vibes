// Verify pipeline — cli.md CLI-PROD-VERIFY-001/002, CLI-PROD-OUT-VERIFY-001/002,
// CLI-PROD-RULE-VERIFY-001, CLI-PROD-AC-VERIFY-001; toolkit-runtime.md
// RT-PROD-VERIFY-001..003, RT-PROD-EDGE-002, RT-PROD-RULE-EXIT-001.
//
// `zxs verify` is the single project acceptance gate. It runs, IN ORDER
// (RT-PROD-VERIFY-001):
//   1. load project config (entry, outDir, org) — missing required config is a USER_ERROR;
//   2. build via the SOLE build service (`runBuild`, the same `zxs build` uses);
//   3. if the build succeeded, invoke the REAL run service (fresh boot, load the produced
//      binary at the configured origin, 300 frames under the hang watchdog) and compose its
//      FULL report verbatim — `runProgram` + `buildRunEnvelope`, the exact shape `run --json`
//      emits (CLI-PROD-RULE-VERIFY-001: NOT a trimmed inline re-implementation);
//   4. capture a screenshot of the post-run screen to a PNG (the one encoder,
//      CLI-PROD-RULE-SCREENSHOT-001; default `.zxs/verify-screen.png`);
//   5. if a `tests/` directory exists, run the declarative test suite and embed its report.
//
// `ok` is the conjunction `build.ok && run.ok && (no tests ran || tests.failed === 0)`
// (RT-PROD-VERIFY-002, CLI-PROD-OUT-VERIFY-001). Exit mapping (CLI-PROD-OUT-VERIFY-002,
// verbatim): `verify` exits `0` when `ok` is true and `1` otherwise — for ANY failing stage,
// including a run-detected hang. Exit `2` (HANG) is reserved for the `run` command
// (CLI-PROD-EXIT-003), so `verify` NEVER exits 2; the hang stays observable inside the
// embedded run report (`run.status:"hang"` + the watchdog verdict), it just does not change
// verify's own exit code. A build failure SHORT-CIRCUITS: no run, no screenshot, no tests
// (step 3 is gated on build success).

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { resolveConfig } from '../config/config.js';
import { ExitCode, userError, type Envelope } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { parseAddress } from '../util/address.js';
import { runBuild, type BuildEnvelope } from '../build/build.js';
import { loadBinMachine } from '../runtime/session.js';
import {
  DEFAULT_FRAMES,
  buildRunEnvelope,
  runProgram,
  type RunBoot,
  type RunEnvelope,
} from '../runtime/run.js';
import { buildTestEnvelope, runTestSuite, type TestEnvelope } from '../test/runner.js';
import { captureScreenshot } from '../observe/screenshot.js';

/** Default screenshot artifact path (CLI-PROD-VERIFY-002), relative to the project root. */
export const DEFAULT_VERIFY_SCREENSHOT = '.zxs/verify-screen.png';
/** The project-root directory whose presence enables the test stage (CLI-PROD-VERIFY-001). */
export const TESTS_DIR = 'tests';

// The verify report fields (CLI-PROD-OUT-VERIFY-001 `{ ok, stage, build, run?, tests? }`).
// A `type` alias (not an interface) so the envelope stays assignable to the slice-1
// `SuccessEnvelope`/`Envelope` (whose `& Record<string, unknown>` rejects open interfaces).
// `build`/`run`/`tests` embed the FULL per-stage reports (the same shapes `build`/`run`/
// `test --json` emit). `screenshot` is the written artifact path — an additive, Incidental
// field (like `next`, CLI-PROD-CONV-JSON-003) surfacing the spec-mandated screenshot.
type VerifyReport = {
  stage: 'verify';
  build: BuildEnvelope;
  run?: RunEnvelope;
  tests?: TestEnvelope;
  screenshot?: string;
};

export type VerifySuccessEnvelope = VerifyReport & { ok: true };
export type VerifyErrorEnvelope = VerifyReport & {
  ok: false;
  error: { message: string; exitCode: ExitCode };
};

/** The `verify` report envelope — a passing gate (exit 0) or a failing stage (exit 1/2). */
export type VerifyEnvelope = VerifySuccessEnvelope | VerifyErrorEnvelope;

export interface VerifyOptions {
  /** Project root (defaults to `process.cwd()`). */
  cwd?: string | undefined;
  /** `--screenshot` override (defaults to {@link DEFAULT_VERIFY_SCREENSHOT}). */
  screenshot?: string | undefined;
}

/**
 * Run the verify acceptance pipeline (RT-PROD-VERIFY-001..003) and produce the verify
 * envelope. Stateless: each stage boots fresh (RT-PROD-SESSION-001). Throws a
 * {@link CliError} only for a pre-pipeline user error (missing entry, via `runBuild`);
 * a failing STAGE is reported as `{ ok:false, ... }` with the mapped exit code, never thrown.
 */
export function runVerify(options: VerifyOptions = {}): VerifyEnvelope {
  const cwd = resolve(options.cwd ?? process.cwd());

  // Stage 1 — load project config (RT-PROD-VERIFY-001 step 1). `org`/`outDir` feed the run
  // stage; the entry requirement is enforced by `runBuild` (a missing entry → USER_ERROR).
  const resolved = resolveConfig({ cwd });
  const org = parseAddress(resolved.org, 'verify');

  // Stage 2 — build (the sole build service; CLI-PROD-RULE-VERIFY-001).
  const build = runBuild({ cwd, outDir: resolved.outDir });
  if (!build.ok) {
    // Build failure short-circuits: no run, no screenshot, no tests (step 3 gate).
    return {
      ok: false,
      ...report(build),
      error: { message: build.error.message, exitCode: ExitCode.USER_ERROR },
    };
  }

  // Stage 3 — invoke the REAL run service and compose its full report verbatim
  // (CLI-PROD-RULE-VERIFY-001): fresh boot, load the built binary at `org`, 300 frames
  // under the hang watchdog — exactly what `zxs run` (no source) does.
  const binPath = build.outputs.bin;
  if (binPath === null) {
    throw userError('verify: the build reported success but produced no binary', 'verify');
  }
  const machine = loadBinMachine(resolve(cwd, binPath), org);
  const result = runProgram(machine, org, { frames: DEFAULT_FRAMES, detectHangs: true });
  const boot: RunBoot = { source: 'build', org, entry: build.entry };
  const run = buildRunEnvelope(result, boot);

  // Stage 4 — screenshot the post-run screen to a PNG (the one encoder; default
  // `.zxs/verify-screen.png`, CLI-PROD-VERIFY-002). The artifact is written even on a hang
  // (it documents the final screen); its path is reported in the envelope.
  const screenshot = options.screenshot ?? DEFAULT_VERIFY_SCREENSHOT;
  captureScreenshot(result.machine, resolve(cwd, screenshot));

  // Stage 5 — run the `tests/` suite iff the directory exists (CLI-PROD-VERIFY-001).
  // RT-PROD-EDGE-002: an absent `tests/` passes on build+run alone; an empty suite passes
  // vacuously (`runTestSuite` reports total 0 → ok true).
  const tests = hasTestsDir(cwd) ? buildTestEnvelope(runTestSuite(TESTS_DIR, cwd)) : undefined;

  // ok = build.ok AND run.ok AND (no tests ran OR tests.failed === 0) (RT-PROD-VERIFY-002).
  const ok = build.ok && run.ok && (tests === undefined || tests.failed === 0);
  const fields = report(build, run, tests, screenshot);
  if (ok) {
    return { ok: true, ...fields };
  }

  // Failure exit mapping (CLI-PROD-OUT-VERIFY-002): `verify` exits 1 (USER_ERROR) for ANY
  // failing stage. Exit 2 (HANG) is reserved for the `run` command (CLI-PROD-EXIT-003), so a
  // run-detected hang here is still a USER_ERROR for verify — the hang remains visible in the
  // embedded `run.status:"hang"` report, only verify's exit code does not become 2. The
  // message distinguishes the cause for the human channel (Incidental wording).
  const message = run.ok
    ? `verify failed: ${tests?.failed ?? 0} of ${tests?.total ?? 0} test spec(s) failed`
    : 'verify failed: the run detected a hang';
  return { ok: false, ...fields, error: { message, exitCode: ExitCode.USER_ERROR } };
}

/** Assemble the verify report fields, omitting absent stages (exactOptionalPropertyTypes). */
function report(
  build: BuildEnvelope,
  run?: RunEnvelope,
  tests?: TestEnvelope,
  screenshot?: string,
): VerifyReport {
  return {
    stage: 'verify',
    build,
    ...(run !== undefined ? { run } : {}),
    ...(tests !== undefined ? { tests } : {}),
    ...(screenshot !== undefined ? { screenshot } : {}),
  };
}

/** Whether a `tests/` directory exists at the project root (the test-stage gate). */
function hasTestsDir(cwd: string): boolean {
  try {
    return statSync(resolve(cwd, TESTS_DIR)).isDirectory();
  } catch {
    return false;
  }
}

// --- CLI wiring ------------------------------------------------------------

interface VerifyCliOptions {
  screenshot?: string;
}

/** The `verify` command handler: maps the CLI context onto the verify pipeline. */
export function verifyCommand(context: CommandContext): VerifyEnvelope {
  const options = context.options as VerifyCliOptions;
  return runVerify({
    cwd: process.cwd(),
    screenshot: options.screenshot,
  });
}

/** Declare the `verify` command's flags (CLI-PROD-VERIFY-002). */
export function configureVerifyCommand(command: Command): void {
  command
    .description('Project acceptance gate: build -> run -> screenshot -> tests')
    .option('--screenshot <file>', 'screenshot output path (default .zxs/verify-screen.png)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}

// `verifyCommand` returns `VerifyEnvelope`, which is structurally an `Envelope`
// (success/error with extra per-stage fields). This assertion documents that contract.
const _envelopeCheck: (c: CommandContext) => Envelope = verifyCommand;
void _envelopeCheck;
