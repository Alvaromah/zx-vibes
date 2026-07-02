// Project config service — config-schema.md (CFG-PROD-*), toolkit-runtime.md
// RT-PROD-CONFIG-001.
//
// Loads `zx.config.json` from the project root and resolves each value by the
// precedence CLI flag > env var > zx.config.json > built-in default
// (CFG-PROD-RESOLVE-001). Absent file = all-defaults, not an error
// (CFG-PROD-FILE-002); invalid JSON = USER_ERROR naming the file
// (CFG-PROD-FILE-003). The config is not schema-validated; unknown keys are
// ignored (CFG-PROD-FREE-002).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userError } from '../output/envelope.js';

/** The canonical config file name (CFG-PROD-FILE-001). */
export const CONFIG_FILE = 'zx.config.json';

/** Built-in defaults (CFG-PROD-FIELD-ORG-001, -ASM-001, -OUTDIR-001). */
export const DEFAULT_ORG = '0x8000';
export const DEFAULT_ASSEMBLER = 'builtin';
export const DEFAULT_OUT_DIR = 'build';

/** The resolved assembler backend (config-schema.md CFG-PROD-FIELD-ASM-001). */
export type Assembler = 'builtin' | 'sjasmplus';

/**
 * The on-disk `zx.config.json` shape. Every field is optional (CFG-PROD-FILE-004);
 * `name`/`template`/`toolkit` are informational only (CFG-PROD-FREE-001).
 */
export interface ZxProjectConfig {
  entry?: string;
  org?: string;
  assembler?: string;
  outDir?: string;
  name?: string;
  template?: string;
  toolkit?: string;
}

/** A fully-resolved config: defaults applied, assembler normalized. */
export interface ResolvedConfig {
  entry: string | undefined;
  org: string;
  assembler: Assembler;
  outDir: string;
  name: string | undefined;
  template: string | undefined;
  toolkit: string | undefined;
}

/** CLI flags that override config/env (the highest precedence tier). */
export interface ConfigFlags {
  entry?: string | undefined;
  org?: string | undefined;
  assembler?: string | undefined;
  outDir?: string | undefined;
}

export interface ResolveOptions {
  cwd?: string;
  /** Pre-loaded config; when omitted it is loaded from `cwd`. */
  config?: ZxProjectConfig;
  flags?: ConfigFlags;
  env?: Record<string, string | undefined>;
}

/**
 * Load `zx.config.json` from `cwd`. Absent → empty config (not an error,
 * CFG-PROD-FILE-002). Present but invalid JSON (or not a JSON object) → USER_ERROR
 * naming the file (CFG-PROD-FILE-003).
 */
export function loadProjectConfig(cwd: string = process.cwd()): ZxProjectConfig {
  const path = join(cwd, CONFIG_FILE);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return {};
    // A different read failure (e.g. permissions) is still a user-facing problem.
    throw userError(`Failed to read ${CONFIG_FILE}: ${describe(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw userError(`Invalid JSON in ${CONFIG_FILE}: ${describe(error)}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw userError(`Invalid ${CONFIG_FILE}: expected a JSON object`);
  }
  return parsed as ZxProjectConfig;
}

/**
 * Normalize the assembler backend (CFG-PROD-RESOLVE-002): case-insensitive;
 * empty/absent → `builtin`; legacy `spectral` → `builtin` (ADR-0027 alias);
 * `sjasmplus` allowed; anything else is a USER_ERROR (CFG-PROD-ERR-001).
 */
export function normalizeAssembler(value: string | undefined): Assembler {
  const name = (value ?? '').trim().toLowerCase();
  if (name === '') return DEFAULT_ASSEMBLER;
  if (name === 'builtin' || name === 'spectral') return 'builtin';
  if (name === 'sjasmplus') return 'sjasmplus';
  throw userError(`Unknown assembler backend: ${value}`);
}

/**
 * Resolve the effective config by the documented precedence (CFG-PROD-RESOLVE-001):
 * CLI flag > env var > zx.config.json > built-in default. Only `assembler` has a
 * named env var (`ZXS_ASSEMBLER`, CFG-PROD-RESOLVE-002); the other fields have no
 * standard env override.
 */
export function resolveConfig(options: ResolveOptions = {}): ResolvedConfig {
  const cwd = options.cwd ?? process.cwd();
  const config = options.config ?? loadProjectConfig(cwd);
  const flags = options.flags ?? {};
  const env = options.env ?? process.env;

  const assembler = normalizeAssembler(
    firstDefined(flags.assembler, env.ZXS_ASSEMBLER, config.assembler),
  );

  return {
    entry: firstDefined(flags.entry, config.entry),
    org: firstDefined(flags.org, config.org) ?? DEFAULT_ORG,
    assembler,
    outDir: firstDefined(flags.outDir, config.outDir) ?? DEFAULT_OUT_DIR,
    name: config.name,
    template: config.template,
    toolkit: config.toolkit,
  };
}

/**
 * Require a resolvable entry source (CFG-PROD-ERR-002). Build-time helper: throws
 * a USER_ERROR advising the file argument or an `entry` in `zx.config.json` when
 * none is configured. (The build service, a later slice, calls this.)
 */
export function requireEntry(resolved: ResolvedConfig): string {
  if (!resolved.entry) {
    throw userError(
      `No entry file: pass a file argument or add "entry" to ${CONFIG_FILE}`,
      'build',
    );
  }
  return resolved.entry;
}

/** First argument that is not `undefined`/empty-string (precedence helper). */
function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
