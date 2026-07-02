// Build service — cli.md CLI-PROD-BUILD-001..004 + CLI-PROD-OUT-BUILD-001/002,
// toolkit-runtime.md RT-PROD-BUILD-001, config-schema.md CFG-PROD-ERR-001/002,
// errors.md ERR-PROD-ASM-SHAPE-001 / ERR-PROD-ASM-OK-001 / ERR-PROD-ASM-CATS-001.
//
// `zxs build [file]` assembles the configured entry `.asm` with the SOLE embedded
// `@zx-vibes/asm` (ADR-0027 D3) into `outDir`, producing the `.bin` plus the SLD
// symbol/line debug data (CLI-PROD-BUILD-001). Path-sandbox confinement of
// includes/reads is always on (CLI-PROD-BUILD-002). An external `sjasmplus`
// backend is a documented escape hatch only (CLI-PROD-BUILD-004); selecting it
// when unavailable is an ENV_ERROR. Loadable `.tap`/`.scr`/`.z80` outputs route
// through the real formats emitter (CLI-PROD-BUILD-003, `./formats.ts`,
// `realFormatsEmitter` over the `@zx-vibes/machine` codecs).
//
// The result is the `build` report envelope (CLI-PROD-OUT-BUILD-001): on success
// `{ ok:true, ... }` (exit 0); on assembly failure `{ ok:false, ... , error }`
// (exit 1, ERR-PROD-ASM-OK-001) carrying the same rich report PLUS the standard
// `{ message, exitCode }` so the one dispatcher maps it uniformly.

import { isAbsolute, relative, resolve } from 'node:path';
import { assembleFile, writeAssemblyOutputs, type Diagnostic } from '@zx-vibes/asm';
import type { Command } from 'commander';
import {
  resolveConfig,
  requireEntry,
  type ZxProjectConfig,
} from '../config/config.js';
import {
  ExitCode,
  envError,
  userError,
  type Envelope,
} from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import {
  realFormatsEmitter,
  requestedFormats,
  type FormatRequest,
  type FormatsEmitter,
} from './formats.js';

/** A build diagnostic — the contract shape (errors.md ERR-PROD-ASM-SHAPE-001). */
export interface BuildDiagnostic {
  file: string;
  line: number;
  severity: 'error' | 'warning';
  message: string;
  sourceLine?: string;
  hint?: string;
}

/** The artifacts a build produced (CLI-PROD-OUT-BUILD-001 `outputs`). */
export interface BuildOutputs {
  /** Path of the written `.bin`, or `null` when the build failed. */
  bin: string | null;
  /** Path of the written `.sld`, or `null` when the build failed. */
  sld: string | null;
  /** Extra written artifacts (SAVEBIN outputs now; `.tap`/`.scr`/`.z80` later). */
  artifacts: string[];
}

// Fields common to a success and a failure build report (CLI-PROD-OUT-BUILD-001).
// These are `type` aliases (not interfaces) so the resulting envelope is a
// concrete object type assignable to the slice-1 `SuccessEnvelope`/`Envelope`
// (whose default `& Record<string, unknown>` rejects open interfaces).
type BuildReport = {
  stage: 'build';
  entry: string;
  errorCount: number;
  warningCount: number;
  errors: BuildDiagnostic[];
  warnings: BuildDiagnostic[];
  outputs: BuildOutputs;
  durationMs: number;
};

export type BuildSuccessEnvelope = BuildReport & {
  ok: true;
};

export type BuildErrorEnvelope = BuildReport & {
  ok: false;
  error: { message: string; exitCode: typeof ExitCode.USER_ERROR };
};

/** The `build` report envelope — success or assembly failure (CLI-PROD-OUT-BUILD-001). */
export type BuildEnvelope = BuildSuccessEnvelope | BuildErrorEnvelope;

export interface BuildOptions {
  /** Project root (defaults to `process.cwd()`). */
  cwd?: string | undefined;
  /** CLI file argument (overrides `entry` from config). */
  entry?: string | undefined;
  /** `--out-dir` override. */
  outDir?: string | undefined;
  /** `--assembler` override (escape hatch). */
  assembler?: string | undefined;
  /** Requested loadable outputs (`--tap`/`--scr`/`--z80`). */
  formats?: FormatRequest | undefined;
  /** Pre-loaded project config (else loaded from `cwd`). */
  config?: ZxProjectConfig | undefined;
  /** Environment for assembler resolution (`ZXS_ASSEMBLER`). */
  env?: Record<string, string | undefined> | undefined;
  /** Loadable-format emitter (defaults to the deferred stub; the formats slice injects the real one). */
  formatsEmitter?: FormatsEmitter | undefined;
}

/**
 * The build service (RT-PROD-BUILD-001). Resolves config, requires an entry
 * (CFG-PROD-ERR-002), dispatches the assembler backend (CFG-PROD-ERR-001),
 * assembles via the embedded `@zx-vibes/asm`, writes `.bin`+`.sld` into `outDir`,
 * and returns the `build` report envelope.
 *
 * Throws a {@link CliError} for the pre-assembly failures (no entry → USER_ERROR;
 * unknown backend → USER_ERROR; an unavailable external `sjasmplus` → ENV_ERROR;
 * a requested-but-deferred format → USER_ERROR). Assembly *diagnostics* are not
 * thrown — they become an `{ ok:false }` report (exit 1, ERR-PROD-ASM-OK-001).
 */
export function runBuild(options: BuildOptions = {}): BuildEnvelope {
  const cwd = resolve(options.cwd ?? process.cwd());
  // Resolution precedence + assembler normalization (unknown → USER_ERROR,
  // CFG-PROD-ERR-001) live in the config service.
  const resolved = resolveConfig({
    cwd,
    ...(options.config !== undefined ? { config: options.config } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    flags: {
      entry: options.entry,
      outDir: options.outDir,
      assembler: options.assembler,
    },
  });
  const entry = requireEntry(resolved); // CFG-PROD-ERR-002 → USER_ERROR (stage "build")

  const emitter = options.formatsEmitter ?? realFormatsEmitter;
  // Reject a requested-but-unsupported loadable format BEFORE assembling so a
  // deferred kind never half-builds (no silent breakage, ERR-PROD-NOSILENT-001).
  const wanted = requestedFormats(options.formats);
  const unsupported = wanted.filter((kind) => !emitter.supported.has(kind));
  if (unsupported.length > 0) {
    throw userError(
      `Loadable format output is not implemented yet: ${unsupported
        .map((kind) => `--${kind}`)
        .join(', ')} (planned for the formats slice)`,
      'build',
    );
  }

  const start = Date.now();

  // The external escape hatch (CLI-PROD-BUILD-004): not invoked in this slice.
  // Selecting an unavailable external backend is an environment error (exit 3),
  // not a silent fallback (errors.md ERR-PROD-ENV-001 / RT-PROD-ERR-001).
  if (resolved.assembler === 'sjasmplus') {
    throw envError(
      'External assembler backend "sjasmplus" is not available in this environment; ' +
        'use the embedded builtin assembler or install sjasmplus',
      'build',
    );
  }

  // The embedded `@zx-vibes/asm` is the sole assembler (ADR-0027 D3). Sandbox is
  // always on (CLI-PROD-BUILD-002).
  const result = assembleFile(entry, { cwd, sandbox: true });
  const durationMs = Date.now() - start;

  const errors = result.errors.map((d) => toBuildDiagnostic(d, cwd));
  const warnings = result.warnings.map((d) => toBuildDiagnostic(d, cwd));

  if (!result.ok) {
    // ERR-PROD-ASM-OK-001: ≥1 error → exit 1, forward errors/warnings.
    return {
      ok: false,
      stage: 'build',
      entry,
      errorCount: errors.length,
      warningCount: warnings.length,
      errors,
      warnings,
      outputs: { bin: null, sld: null, artifacts: [] },
      durationMs,
      error: {
        message: `Assembly failed: ${errors.length} error(s) in ${entry}`,
        exitCode: ExitCode.USER_ERROR,
      },
    };
  }

  const outDir = resolve(cwd, resolved.outDir);
  const files = writeAssemblyOutputs(result, { entry, outDir });
  const formatArtifacts = emitter.emit(options.formats ?? {}, {
    cwd,
    outDir,
    entry,
    binPath: files.bin ?? '',
    result,
  });

  const artifacts = [
    ...(files.artifacts ?? []),
    ...formatArtifacts.map((a) => a.path),
  ].map((p) => portablePath(p, cwd));

  return {
    ok: true,
    stage: 'build',
    entry,
    errorCount: 0,
    warningCount: warnings.length,
    errors,
    warnings,
    outputs: {
      bin: files.bin ? portablePath(files.bin, cwd) : null,
      sld: files.sld ? portablePath(files.sld, cwd) : null,
      artifacts,
    },
    durationMs,
  };
}

/** Map an assembler {@link Diagnostic} to the contract build-diagnostic shape. */
function toBuildDiagnostic(diagnostic: Diagnostic, cwd: string): BuildDiagnostic {
  const mapped: BuildDiagnostic = {
    file: portablePath(diagnostic.file, cwd),
    line: diagnostic.line,
    severity: diagnostic.severity,
    message: diagnostic.message,
  };
  if (diagnostic.sourceLine !== undefined) mapped.sourceLine = diagnostic.sourceLine;
  if (diagnostic.hint !== undefined) mapped.hint = diagnostic.hint;
  return mapped;
}

/**
 * Make a path stable and portable: relative to `cwd` when inside it, with `/`
 * separators (deterministic across OSes, normalization-friendly for the
 * CLI-snapshot fixtures). Absolute paths outside `cwd` are kept, only
 * separator-normalized.
 */
function portablePath(path: string, cwd: string): string {
  const abs = resolve(path);
  const rel = relative(cwd, abs);
  const chosen = rel === '' || rel.startsWith('..') || isAbsolute(rel) ? abs : rel;
  return chosen.split('\\').join('/');
}

/** Declare the `build` command's arguments and flags on its commander instance. */
export function configureBuildCommand(command: Command): void {
  command
    .argument('[file]', 'entry .asm file (defaults to config "entry")')
    .option('--out-dir <dir>', 'output directory for .bin/.sld (default "build")')
    .option('--assembler <name>', 'assembler backend (escape hatch; default builtin)')
    .option('--tap [path]', 'also emit a loadable .tap (formats slice)')
    .option('--scr [path]', 'also emit a loadable .scr (formats slice)')
    .option('--z80 [path]', 'also emit a loadable .z80 snapshot (formats slice)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}

/** The `build` command handler: maps the CLI context onto the build service. */
export function buildCommand(context: CommandContext): BuildEnvelope {
  const options = context.options;
  const file = context.args[0];
  const formats: FormatRequest = {
    tap: options.tap as string | boolean | undefined,
    scr: options.scr as string | boolean | undefined,
    z80: options.z80 as string | boolean | undefined,
  };
  return runBuild({
    entry: file,
    outDir: options.outDir as string | undefined,
    assembler: options.assembler as string | undefined,
    formats,
  });
}

// `buildCommand` returns `BuildEnvelope`, which is structurally an `Envelope`
// (success: a SuccessEnvelope with extra fields; failure: an ErrorEnvelope with
// extra fields). This assertion documents that contract for the registry.
const _envelopeCheck: (c: CommandContext) => Envelope = buildCommand;
void _envelopeCheck;
