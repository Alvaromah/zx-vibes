import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** CLI exit codes, branchable by agents via $?. */
export const EXIT = {
  OK: 0,
  USER_ERROR: 1, // build errors, bad arguments
  HANG: 2, // reserved for Phase 1 hang detection
  ENV_ERROR: 3, // missing toolchain, unreadable ROM
} as const;

export class CliError extends Error {
  readonly exitCode: number;
  readonly stage: string | undefined;

  constructor(message: string, exitCode: number = EXIT.USER_ERROR, stage?: string) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.stage = stage;
  }
}

export function userError(message: string, stage?: string): CliError {
  return new CliError(message, EXIT.USER_ERROR, stage);
}

export function envError(message: string, stage?: string): CliError {
  return new CliError(message, EXIT.ENV_ERROR, stage);
}

export function isCliError(err: unknown): err is CliError {
  return err instanceof CliError;
}

export function emitCliError(err: unknown, json: boolean, fallbackStage?: string): number {
  const cliErr = isCliError(err) ? err : new CliError(errorMessage(err), EXIT.USER_ERROR, fallbackStage);
  const stage = cliErr.stage ?? fallbackStage ?? 'cli';
  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          stage,
          error: {
            message: cliErr.message,
            exitCode: cliErr.exitCode,
          },
        },
        null,
        2
      )
    );
  } else {
    console.error(`error: ${cliErr.message}`);
  }
  return cliErr.exitCode;
}

export function argvWantsJson(argv = process.argv.slice(2)): boolean {
  return argv.includes('--json');
}

export function hex(n: number, width = 4): string {
  return `0x${n.toString(16).toUpperCase().padStart(width, '0')}`;
}

/** Parses 0x8000, $8000, 8000h or decimal 32768. */
export function parseAddress(value: string): number {
  let n: number;
  if (/^0x[0-9a-f]+$/i.test(value)) n = parseInt(value, 16);
  else if (/^\$[0-9a-f]+$/i.test(value)) n = parseInt(value.slice(1), 16);
  else if (/^[0-9a-f]+h$/i.test(value)) n = parseInt(value.slice(0, -1), 16);
  else if (/^\d+$/.test(value)) n = parseInt(value, 10);
  else n = NaN;
  if (Number.isNaN(n) || n < 0 || n > 0xffff) {
    throw new Error(`Invalid 16-bit address: '${value}' (use 0x8000, $8000 or 32768)`);
  }
  return n;
}

export interface ParseIntegerOptions {
  min?: number;
  max?: number;
}

export function parseInteger(value: string, name: string, opts: ParseIntegerOptions = {}): number {
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw userError(`Invalid ${name}: '${value}' must be an integer`);
  }
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n)) {
    throw userError(`Invalid ${name}: '${value}' is outside the safe integer range`);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw userError(`Invalid ${name}: '${value}' must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw userError(`Invalid ${name}: '${value}' must be <= ${opts.max}`);
  }
  return n;
}

export function parseCount(value: string, name: string, max?: number): number {
  return parseInteger(value, name, { min: 1, ...(max !== undefined ? { max } : {}) });
}

export function parsePort(value: string): number {
  return parseInteger(value, 'port', { min: 1, max: 65535 });
}

export function ensureParentDir(file: string): void {
  const dir = dirname(file);
  if (dir !== '.') mkdirSync(dir, { recursive: true });
}

/**
 * Prints the result as JSON (machine mode) or human-readable lines.
 * Every command goes through this so agents always get one JSON document.
 */
export function emit(result: object, json: boolean, pretty: () => string): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(pretty());
  }
}

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^error:\s*/i, '');
}
