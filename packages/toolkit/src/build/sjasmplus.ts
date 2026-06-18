import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface Diagnostic {
  file: string;
  line: number;
  severity: 'error' | 'warning';
  message: string;
  /** The offending source line, inlined so agents need not re-read the file. */
  sourceLine?: string;
  /** Did-you-mean suggestion for misspelled labels. */
  hint?: string;
}

export interface BuildOptions {
  /** Directory for .bin/.sld outputs. Default: ./build */
  outDir?: string;
  /** Extra raw CLI arguments to sjasmplus. */
  extraArgs?: string[];
  /** Binary name/path of the assembler. Default: sjasmplus (from PATH). */
  assemblerPath?: string;
  /**
   * Working directory for the assembler process. SAVETAP/SAVESNA paths in
   * the source resolve relative to this. Default: process cwd.
   */
  cwd?: string;
  /**
   * Assembler backend. Default is the embedded @zx-vibes/asm backend.
   */
  assembler?: 'sjasmplus' | 'spectral';
  /**
   * Confine INCLUDE/INCBIN reads to the project (cwd + include paths). Only the
   * embedded `spectral` backend honors this; the external sjasmplus binary does
   * not. Used by the MCP server to sandbox agent-driven builds.
   */
  sandbox?: boolean;
}

export interface BuildResult {
  ok: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  outputs: { bin?: string; sld?: string; artifacts?: string[] };
  /** Raw assembler output, for the rare case the parser misses something. */
  rawOutput: string;
  durationMs: number;
}

interface SpectralAsmDiagnostic {
  file: string;
  line: number;
  severity: 'error' | 'warning';
  message: string;
  sourceLine?: string;
  hint?: string;
}

interface SpectralAsmResult {
  ok: boolean;
  sld: string;
  errors: SpectralAsmDiagnostic[];
  warnings: SpectralAsmDiagnostic[];
}

interface SpectralAsmModule {
  assembleFile(entry: string, opts?: { cwd?: string; sandbox?: boolean }): SpectralAsmResult;
  writeAssemblyOutputs(
    result: SpectralAsmResult,
    opts: { entry: string; outDir: string }
  ): { bin?: string; sld?: string; artifacts?: string[] };
}

export interface ToolchainStatus {
  found: boolean;
  version?: string;
  path?: string;
  installHint?: string;
}

export const INSTALL_HINT = [
  'sjasmplus not found on PATH. Install it:',
  '  macOS:  download the source from https://github.com/z00m128/sjasmplus/releases,',
  '          then: tar xf sjasmplus-*-src.tar.xz && cd sjasmplus-* && make && sudo make install',
  '  Linux:  apt install sjasmplus  (or build from source as above)',
  '  Windows: download sjasmplus-*.win.zip from the releases page',
].join('\n');

const DIAGNOSTIC_RE = /^(.+?)\((\d+)\): (error|warning): (.*)$/;
const LABEL_NOT_FOUND_RE = /^Label not found: (\S+)/;

export async function checkToolchain(assemblerPath = 'sjasmplus'): Promise<ToolchainStatus> {
  try {
    // sjasmplus prints its version banner to stderr
    const { stdout, stderr } = await execFileAsync(assemblerPath, ['--version']);
    const match = (stdout + stderr).match(/v(\d+\.\d+[^\s)]*)/);
    return {
      found: true,
      ...(match?.[1] !== undefined ? { version: match[1] } : {}),
      path: assemblerPath,
    };
  } catch {
    return { found: false, installHint: INSTALL_HINT };
  }
}

/**
 * Assembles a Z80 source file with sjasmplus, producing a raw binary and an
 * SLD source-level-debug file, and parsing diagnostics into structured form.
 */
export async function build(entry: string, opts: BuildOptions = {}): Promise<BuildResult> {
  if (selectedAssembler(opts) === 'spectral') {
    return buildWithSpectralAsm(entry, opts);
  }

  const started = performance.now();
  const assembler = opts.assemblerPath ?? 'sjasmplus';
  const outDir = resolve(opts.outDir ?? 'build');
  mkdirSync(outDir, { recursive: true });

  const stem = basename(entry).replace(/\.[^.]+$/, '');
  const binPath = join(outDir, `${stem}.bin`);
  const sldPath = join(outDir, `${stem}.sld`);

  const args = [
    '--nologo',
    '--fullpath',
    `--raw=${binPath}`,
    `--sld=${sldPath}`,
    ...(opts.extraArgs ?? []),
    resolve(entry),
  ];

  let stdout = '';
  let stderr = '';
  let assemblyFailed = false;
  try {
    ({ stdout, stderr } = await execFileAsync(
      assembler,
      args,
      opts.cwd !== undefined ? { cwd: opts.cwd } : {}
    ));
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (e.code === 'ENOENT') {
      throw new Error(INSTALL_HINT);
    }
    // Non-zero exit: assembly errors. Diagnostics are in the captured output.
    assemblyFailed = true;
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
  }

  const rawOutput = stdout + stderr;
  const diagnostics = parseDiagnostics(rawOutput);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const ok = !assemblyFailed && errors.length === 0;

  return {
    ok,
    errors,
    warnings,
    outputs: ok
      ? {
          ...(existsSync(binPath) ? { bin: binPath } : {}),
          ...(existsSync(sldPath) ? { sld: sldPath } : {}),
        }
      : {},
    rawOutput,
    durationMs: Math.round(performance.now() - started),
  };
}

function selectedAssembler(opts: BuildOptions): 'sjasmplus' | 'spectral' {
  if (opts.assembler) return opts.assembler;
  const envAssembler = process.env['ZXS_ASSEMBLER']?.toLowerCase();
  return envAssembler === 'sjasmplus' || envAssembler === 'spectral' ? envAssembler : 'spectral';
}

async function buildWithSpectralAsm(entry: string, opts: BuildOptions): Promise<BuildResult> {
  const started = performance.now();
  const outDir = resolve(opts.outDir ?? 'build');
  mkdirSync(outDir, { recursive: true });

  const { assembleFile, writeAssemblyOutputs } = await loadSpectralAsm();
  const result = assembleFile(entry, {
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.sandbox !== undefined ? { sandbox: opts.sandbox } : {}),
  });
  const outputs = result.ok ? writeAssemblyOutputs(result, { entry, outDir }) : {};
  return {
    ok: result.ok,
    errors: result.errors.map(toDiagnostic),
    warnings: result.warnings.map(toDiagnostic),
    outputs,
    rawOutput: result.sld,
    durationMs: Math.round(performance.now() - started),
  };
}

async function loadSpectralAsm(): Promise<SpectralAsmModule> {
  const packageName = '@zx-vibes/asm';
  try {
    return (await import(packageName)) as SpectralAsmModule;
  } catch (err) {
    throw new Error(
      `@zx-vibes/asm is not installed or has not been built: ${(err as Error).message}`
    );
  }
}

function toDiagnostic(d: SpectralAsmDiagnostic): Diagnostic {
  return {
    file: d.file,
    line: d.line,
    severity: d.severity,
    message: d.message,
    ...(d.sourceLine !== undefined ? { sourceLine: d.sourceLine } : {}),
    ...(d.hint !== undefined ? { hint: d.hint } : {}),
  };
}

export function parseDiagnostics(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const sourceCache = new Map<string, string[]>();

  for (const rawLine of output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const lineText = rawLine.trimEnd();
    const match = lineText.match(DIAGNOSTIC_RE);
    if (!match) continue;
    const [, file, lineStr, severity, message] = match;
    const line = Number(lineStr);
    const diag: Diagnostic = {
      file: file!,
      line,
      severity: severity as 'error' | 'warning',
      message: message!,
    };

    const source = readSourceLines(file!, sourceCache);
    const sourceLine = source?.[line - 1];
    if (sourceLine !== undefined) {
      diag.sourceLine = sourceLine.trimEnd();
    }

    const labelMatch = message!.match(LABEL_NOT_FOUND_RE);
    if (labelMatch && source) {
      const hint = suggestLabel(labelMatch[1]!, source);
      if (hint) diag.hint = hint;
    }

    diagnostics.push(diag);
  }
  return diagnostics;
}

function readSourceLines(file: string, cache: Map<string, string[]>): string[] | undefined {
  if (cache.has(file)) return cache.get(file);
  try {
    const lines = readFileSync(file, 'utf8').split('\n');
    cache.set(file, lines);
    return lines;
  } catch {
    return undefined;
  }
}

/** Labels defined at column 0 (optionally ending with ':'), per sjasmplus convention. */
const LABEL_DEF_RE = /^(\.?[A-Za-z_][A-Za-z0-9_.]*):?(?:\s|$)/;

function suggestLabel(missing: string, sourceLines: string[]): string | undefined {
  let best: { label: string; distance: number } | undefined;
  for (const line of sourceLines) {
    const match = line.match(LABEL_DEF_RE);
    if (!match) continue;
    const label = match[1]!;
    if (label === missing) continue;
    const distance = levenshtein(missing.toLowerCase(), label.toLowerCase());
    if (distance <= 2 && (!best || distance < best.distance)) {
      best = { label, distance };
    }
  }
  return best ? `Did you mean '${best.label}'?` : undefined;
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}
