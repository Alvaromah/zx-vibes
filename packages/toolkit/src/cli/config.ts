import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { userError } from './output.js';

export type AssemblerBackend = 'sjasmplus' | 'spectral';

export interface ZxProjectConfig {
  name?: string;
  entry?: string;
  org?: string;
  assembler?: AssemblerBackend;
  outDir?: string;
  template?: string;
  toolkit?: string;
}

export interface LoadedProjectConfig {
  cwd: string;
  path?: string;
  config: ZxProjectConfig;
}

export function loadProjectConfig(cwd = process.cwd()): LoadedProjectConfig {
  const path = join(cwd, 'zx.config.json');
  if (!existsSync(path)) return { cwd, config: {} };

  let parsed: ZxProjectConfig;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as ZxProjectConfig;
  } catch (err) {
    throw userError(`Invalid zx.config.json: ${(err as Error).message}`, 'config');
  }
  const loaded: LoadedProjectConfig = { cwd, path, config: parsed };
  return loaded;
}

export function resolveProjectPath(path: string, cwd = process.cwd()): string {
  return resolve(cwd, path);
}

export function normalizeAssembler(value: string | undefined): AssemblerBackend | undefined {
  if (value === undefined || value === '') return 'sjasmplus';
  const normalized = value.toLowerCase();
  return normalized === 'sjasmplus' || normalized === 'spectral' ? normalized : undefined;
}

export function configuredAssembler(
  cliValue: string | undefined,
  config: ZxProjectConfig
): AssemblerBackend | undefined {
  return normalizeAssembler(cliValue ?? process.env['ZXS_ASSEMBLER'] ?? config.assembler);
}

export function configuredEntry(entryArg: string | undefined, config: ZxProjectConfig): string | undefined {
  return entryArg ?? config.entry;
}

export function configuredOutDir(cliValue: string | undefined, config: ZxProjectConfig): string {
  return cliValue ?? config.outDir ?? 'build';
}

export function configuredOrg(cliValue: string | undefined, config: ZxProjectConfig): string {
  return cliValue ?? config.org ?? '0x8000';
}
