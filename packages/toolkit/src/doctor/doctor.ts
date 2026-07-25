// `zxs doctor` — toolchain/environment self-check (cli.md CLI-PROD-DOCTOR-001 +
// CLI-PROD-OUT-DOCTOR-001; errors.md ERR-PROD-ENV-001; this is the canonical
// surface for exit code 3 / ENV_ERROR, CLI-PROD-EXIT-004).
//
// Runs a fixed battery of environment checks and reports each as
// `{ name, ok, detail }`. The envelope is `{ ok, stage:"doctor", checks:[…] }`
// (CLI-PROD-OUT-DOCTOR-001); `ok` is the AND of every check. A single failing
// check makes the command exit 3 (ENV_ERROR, ERR-PROD-ENV-001) — the failure
// envelope carries the same `checks[]` PLUS the standard `{ message, exitCode }`
// so the one dispatcher maps it uniformly (mirrors the build report pattern).
//
// Checks (ERR-PROD-ENV-001): Node >= 20; the embedded `@zx-vibes/asm` importable
// (while it is the configured backend, i.e. the default `builtin`); the bundled
// 48K ROM present and exactly 16384 bytes; unambiguous/complete `zxs` resolution
// on PATH; and `sjasmplus` on PATH — but ONLY when it is the configured escape-
// hatch backend (CLI-PROD-DOCTOR-001 / ADR-0027 D3), never by default. No failure
// is swallowed (ERR-PROD-NOSILENT-001).

import { execFileSync } from 'node:child_process';
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  delimiter,
  dirname,
  join,
  resolve,
} from 'node:path';
import { assembleFile } from '@zx-vibes/asm';
import type { Command } from 'commander';
import {
  resolveConfig,
  type Assembler,
  type ZxProjectConfig,
} from '../config/config.js';
import { ExitCode, type Envelope } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { ROM_SIZE, findRomPath } from '../runtime/rom.js';

/** The minimum supported Node.js major version (cli.md CLI-PROD-PKG-001 / DOCTOR-001). */
export const MIN_NODE_MAJOR = 20;

/** One environment check result (CLI-PROD-OUT-DOCTOR-001 `checks[]` element). */
export interface DoctorCheck {
  /** Stable short name of the check (e.g. `"node"`, `"asm"`, `"rom"`, `"sjasmplus"`). */
  name: string;
  /** Whether the check passed. */
  ok: boolean;
  /** Human-readable (Incidental) detail: the observed value / why it failed. */
  detail: string;
}

type DoctorReport = {
  stage: 'doctor';
  /** Every check that ran, in a stable order. */
  checks: DoctorCheck[];
};

export type DoctorSuccessEnvelope = DoctorReport & { ok: true };

export type DoctorErrorEnvelope = DoctorReport & {
  ok: false;
  error: { message: string; exitCode: typeof ExitCode.ENV_ERROR };
};

/** The `doctor` report envelope — all-pass (exit 0) or any-fail (exit 3). */
export type DoctorEnvelope = DoctorSuccessEnvelope | DoctorErrorEnvelope;

export interface DoctorOptions {
  /** Project root (defaults to `process.cwd()`); only used to resolve the assembler backend. */
  cwd?: string | undefined;
  /** Pre-loaded project config (else loaded from `cwd`). */
  config?: ZxProjectConfig | undefined;
  /** Environment for assembler resolution (`ZXS_ASSEMBLER`). */
  env?: Record<string, string | undefined> | undefined;
  /** Override the located 48K ROM asset path (tests inject a missing / mis-sized file). */
  romPath?: string | undefined;
  /** Override the reported Node version string (tests force < 20). Defaults to `process.versions.node`. */
  nodeVersion?: string | undefined;
  /** Override the `@zx-vibes/asm` importability probe (tests force a failure). */
  checkAsm?: (() => boolean) | undefined;
  /** Override the `sjasmplus` availability probe (tests control the escape-hatch branch). */
  checkSjasmplus?: (() => boolean) | undefined;
  /** Override the discovered `zxs` PATH shims/executables (tests avoid host PATH coupling). */
  zxsPathCandidates?: string[] | undefined;
}

/** Parse the major version out of a `"20.11.0"`-style string (NaN-safe → 0). */
function nodeMajor(version: string): number {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : 0;
}

/** Default `@zx-vibes/asm` probe: the package resolved and the core export is present. */
function defaultAsmImportable(): boolean {
  // A static import at module load already guarantees the package resolved; this
  // confirms the documented entry point exists (a smoke-level importability check).
  return typeof assembleFile === 'function';
}

/** Default `sjasmplus` probe: is the external binary invocable on PATH? */
function defaultSjasmplusAvailable(): boolean {
  try {
    execFileSync('sjasmplus', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const TOOLKIT_PACKAGE = '@zx-vibes/toolkit';

/** Locate every command file named `zxs` that the current PATH can resolve. */
export function findZxsPathCandidates(
  pathValue = process.env.PATH ?? '',
  pathExtValue = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
  platform = process.platform,
): string[] {
  const windows = platform === 'win32';
  const extensions = windows
    ? [
        '',
        ...pathExtValue
          .split(';')
          .map((extension) => extension.trim().toLowerCase())
          .filter(Boolean),
        '.ps1',
      ]
    : [''];
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const rawEntry of pathValue.split(delimiter)) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, '$1');
    if (entry.length === 0) continue;
    for (const extension of extensions) {
      const candidate = join(entry, `zxs${extension}`);
      const key = windows ? candidate.toLowerCase() : candidate;
      if (seen.has(key) || !existsSync(candidate)) continue;
      try {
        if (!statSync(candidate).isFile()) continue;
        if (!windows) accessSync(candidate, fsConstants.X_OK);
      } catch {
        continue;
      }
      seen.add(key);
      candidates.push(resolve(candidate));
    }
  }
  return candidates;
}

interface ZxsPathInstallation {
  root: string;
  commands: string[];
  cliPresent: boolean | null;
}

function safeRealpath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/** Walk upward to the owning `@zx-vibes/toolkit` package, if any. */
function findToolkitRoot(start: string): string | undefined {
  let current = start;
  try {
    if (statSync(current).isFile()) current = dirname(current);
  } catch {
    return undefined;
  }
  for (;;) {
    const packageJson = join(current, 'package.json');
    if (existsSync(packageJson)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJson, 'utf8')) as {
          name?: unknown;
        };
        if (parsed.name === TOOLKIT_PACKAGE) return safeRealpath(current);
      } catch {
        // Keep walking: an unrelated malformed package must not hide the real owner.
      }
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Resolve npm's extensionless/`.cmd`/`.ps1` shim family to one canonical package
 * root. All three wrappers from one Windows install therefore count once.
 */
function owningToolkitRoot(command: string): string | undefined {
  const direct = findToolkitRoot(safeRealpath(command));
  if (direct !== undefined) return direct;

  let body = '';
  try {
    body = readFileSync(command, 'utf8').replaceAll('\\', '/');
  } catch {
    return undefined;
  }
  if (!body.includes('@zx-vibes/toolkit/bin/zxs.js')) return undefined;

  // Global npm wrappers target `$basedir/node_modules/@zx-vibes/toolkit`;
  // project/npx `.bin` wrappers target `$basedir/../@zx-vibes/toolkit`.
  const commandDir = dirname(command);
  const possibleRoots = [
    join(commandDir, 'node_modules', '@zx-vibes', 'toolkit'),
    join(commandDir, '..', '@zx-vibes', 'toolkit'),
    join(commandDir, '@zx-vibes', 'toolkit'),
  ];
  for (const possibleRoot of possibleRoots) {
    const root = findToolkitRoot(possibleRoot);
    if (root !== undefined) return root;
  }

  // Preserve an expected root even for a broken target so the missing dist check
  // fails loudly instead of downgrading it to an unknown shim directory.
  const expected = body.includes('node_modules/@zx-vibes/toolkit')
    ? possibleRoots[0]!
    : possibleRoots[1]!;
  return safeRealpath(expected);
}

/** Check for ambiguous or incomplete `zxs` installations on PATH. */
export function checkZxsPath(candidates: readonly string[]): DoctorCheck {
  const groups = new Map<string, ZxsPathInstallation>();
  for (const candidate of candidates) {
    const command = resolve(candidate);
    const root = owningToolkitRoot(command);
    const fallbackRoot = safeRealpath(dirname(command));
    const displayRoot = root ?? fallbackRoot;
    const key =
      process.platform === 'win32'
        ? displayRoot.toLowerCase()
        : displayRoot;
    const existing = groups.get(key);
    if (existing) {
      existing.commands.push(command);
      continue;
    }
    groups.set(key, {
      root: displayRoot,
      commands: [command],
      cliPresent: root === undefined ? null : existsSync(join(root, 'dist', 'cli.js')),
    });
  }

  const installations = [...groups.values()];
  if (installations.length === 0) {
    return {
      name: 'zxs-path',
      ok: true,
      detail: 'No zxs command found on PATH (this invocation may be direct)',
    };
  }

  const incomplete = installations.filter(
    (installation) => installation.cliPresent === false,
  );
  if (incomplete.length > 0) {
    return {
      name: 'zxs-path',
      ok: false,
      detail:
        'Incomplete zxs installation (missing dist/cli.js): ' +
        incomplete.map((installation) => installation.root).join('; ') +
        '. Rebuild the checkout or reinstall @zx-vibes/toolkit.',
    };
  }

  if (installations.length > 1) {
    const first = installations[0]!;
    return {
      name: 'zxs-path',
      ok: false,
      detail:
        `${installations.length} distinct zxs installations resolve on PATH; ` +
        `the first wins (${first.commands[0]} -> ${first.root}). Roots: ` +
        installations.map((installation) => installation.root).join('; ') +
        '. Remove stale global/npm/npx PATH entries.',
    };
  }

  const installation = installations[0]!;
  return {
    name: 'zxs-path',
    ok: true,
    detail:
      `One zxs installation on PATH (${installation.commands.length} command shim` +
      `${installation.commands.length === 1 ? '' : 's'}): ${installation.root}`,
  };
}

/** The 48K-ROM presence/size check (ERR-PROD-ENV-001: present and exactly 16384 bytes). */
function checkRom(romPath: string | undefined): DoctorCheck {
  let path = romPath;
  if (path === undefined) {
    try {
      path = findRomPath();
    } catch {
      path = undefined;
    }
  }
  if (path === undefined || !existsSync(path)) {
    return {
      name: 'rom',
      ok: false,
      detail: `48K ROM asset not found (expected ${ROM_SIZE} bytes at assets/48k.rom)`,
    };
  }
  const size = statSync(path).size;
  if (size !== ROM_SIZE) {
    return {
      name: 'rom',
      ok: false,
      detail: `48K ROM is ${size} bytes, expected exactly ${ROM_SIZE}`,
    };
  }
  return { name: 'rom', ok: true, detail: `48K ROM present (${size} bytes)` };
}

/**
 * Run the environment self-check (CLI-PROD-DOCTOR-001). Returns the `doctor`
 * envelope: `{ ok, stage:"doctor", checks:[…] }`. When any check fails the
 * returned envelope is `ok:false` carrying `error.exitCode = ENV_ERROR` (exit 3,
 * ERR-PROD-ENV-001); the dispatcher renders it and maps the code uniformly.
 */
export function runDoctor(options: DoctorOptions = {}): DoctorEnvelope {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolved = resolveConfig({
    cwd,
    ...(options.config !== undefined ? { config: options.config } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
  });
  const assembler: Assembler = resolved.assembler;

  const checks: DoctorCheck[] = [];

  // 1) Node >= 20 (CLI-PROD-PKG-001 / CLI-PROD-DOCTOR-001).
  const version = options.nodeVersion ?? process.versions.node;
  const major = nodeMajor(version);
  checks.push({
    name: 'node',
    ok: major >= MIN_NODE_MAJOR,
    detail: `Node.js ${version} (>= ${MIN_NODE_MAJOR} required)`,
  });

  // 2) The embedded `@zx-vibes/asm` is importable — checked while it is the
  //    configured backend (the default `builtin`, ADR-0027 D3).
  if (assembler === 'builtin') {
    const asmOk = (options.checkAsm ?? defaultAsmImportable)();
    checks.push({
      name: 'asm',
      ok: asmOk,
      detail: asmOk
        ? 'Embedded @zx-vibes/asm is importable'
        : 'Embedded @zx-vibes/asm could not be imported',
    });
  }

  // 3) The bundled 48K ROM is present and exactly 16384 bytes (ERR-PROD-ENV-001).
  checks.push(checkRom(options.romPath));

  // Detect ambiguous or incomplete zxs installations. Windows npm generates
  // three shims for one install; checkZxsPath groups them by canonical root.
  checks.push(
    checkZxsPath(
      options.zxsPathCandidates ?? findZxsPathCandidates(),
    ),
  );

  // 5) `sjasmplus` on PATH — ONLY when it is the configured escape-hatch backend
  //    (CLI-PROD-DOCTOR-001: not checked by default).
  if (assembler === 'sjasmplus') {
    const sjasmOk = (options.checkSjasmplus ?? defaultSjasmplusAvailable)();
    checks.push({
      name: 'sjasmplus',
      ok: sjasmOk,
      detail: sjasmOk
        ? 'External assembler "sjasmplus" found on PATH'
        : 'External assembler "sjasmplus" is configured but was not found on PATH',
    });
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    return {
      ok: false,
      stage: 'doctor',
      checks,
      error: {
        message: `Environment check failed: ${failed.map((c) => c.name).join(', ')}`,
        exitCode: ExitCode.ENV_ERROR,
      },
    };
  }
  return { ok: true, stage: 'doctor', checks };
}

/** The `doctor` command handler: maps the CLI context onto {@link runDoctor}. */
export function doctorCommand(_context: CommandContext): DoctorEnvelope {
  return runDoctor({ cwd: process.cwd() });
}

/** Declare the `doctor` command's flags (CLI-PROD-DOCTOR-001). */
export function configureDoctorCommand(command: Command): void {
  command
    .description('Check Node, runtime assets, and zxs PATH resolution; exit 3 on failure')
    .option('--json', 'emit a single machine-readable JSON envelope');
}

// `doctorCommand` returns a `DoctorEnvelope`, structurally an `Envelope` (success:
// a SuccessEnvelope with `checks`; failure: an ErrorEnvelope with `checks`). This
// assertion documents that contract for the registry.
const _envelopeCheck: (c: CommandContext) => Envelope = doctorCommand;
void _envelopeCheck;
