// Output envelope + exit-code model.
//
// The single source of truth for the toolkit's machine-readable contract:
//   - the `{ ok, stage, ... }` success/error envelope (cli.md CLI-PROD-CONV-JSON-001/002,
//     CLI-PROD-OUT-*),
//   - the exit-code enum 0=OK / 1=USER_ERROR / 2=HANG / 3=ENV_ERROR
//     (cli.md CLI-PROD-EXIT-00x, errors.md ERR-PROD-EXIT-001),
//   - the CLI error shape `{ message, exitCode, stage? }` and its JSON form
//     `{ ok:false, stage, error:{ message, exitCode } }` (errors.md ERR-PROD-CLIERR-001),
//   - one place that prints an envelope (human vs `--json`, CLI-PROD-CONV-JSON-001).
//
// No failure is swallowed: every error path produces an envelope + non-zero exit
// (errors.md ERR-PROD-NOSILENT-001).

/** Process outcome codes — errors.md ERR-PROD-EXIT-001 / cli.md CLI-PROD-EXIT-00x. */
export const ExitCode = {
  OK: 0,
  USER_ERROR: 1,
  HANG: 2,
  ENV_ERROR: 3,
} as const;
// The value/type pairing (idiomatic `as const` enum) shares a name on purpose; the
// base `no-redeclare` rule predates TS declaration merging and flags it falsely.
// eslint-disable-next-line no-redeclare
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** Error categories the toolkit raises, each mapping to one exit code. */
export type ErrorCategory = 'user' | 'hang' | 'env';

const CATEGORY_EXIT: Record<ErrorCategory, ExitCode> = {
  user: ExitCode.USER_ERROR,
  hang: ExitCode.HANG,
  env: ExitCode.ENV_ERROR,
};

/** Map an error category to its exit code (errors.md ERR-PROD-EXIT-001). */
export function categoryExitCode(category: ErrorCategory): ExitCode {
  return CATEGORY_EXIT[category];
}

/** A success envelope: `ok:true`, a `stage`, plus command-specific fields. */
export type SuccessEnvelope<T extends Record<string, unknown> = Record<string, unknown>> = {
  ok: true;
  stage: string;
} & T;

/** An error envelope (errors.md ERR-PROD-CLIERR-001). */
export interface ErrorEnvelope {
  ok: false;
  stage: string;
  error: {
    message: string;
    exitCode: ExitCode;
  };
}

export type Envelope = SuccessEnvelope | ErrorEnvelope;

/**
 * A user-facing CLI error: carries the message, the exit code it maps to, and
 * (optionally) the stage that raised it. The CLI catches it and renders the
 * `{ ok:false, stage, error }` envelope. errors.md ERR-PROD-CLIERR-001.
 */
export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly stage: string | undefined;

  constructor(message: string, exitCode: ExitCode, stage?: string) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.stage = stage;
  }
}

/** A user error → exit 1 (errors.md ERR-PROD-CLIERR-001 helper). */
export function userError(message: string, stage?: string): CliError {
  return new CliError(message, ExitCode.USER_ERROR, stage);
}

/** An environment/toolchain error → exit 3 (errors.md ERR-PROD-CLIERR-001 helper). */
export function envError(message: string, stage?: string): CliError {
  return new CliError(message, ExitCode.ENV_ERROR, stage);
}

/** A hang/crash verdict → exit 2 (cli.md CLI-PROD-EXIT-003). */
export function hangError(message: string, stage?: string): CliError {
  return new CliError(message, ExitCode.HANG, stage);
}

/** Build a success envelope: `{ ok:true, stage, ...data }`. */
export function successEnvelope<T extends Record<string, unknown>>(
  stage: string,
  data?: T,
): SuccessEnvelope<T> {
  return { ok: true, stage, ...(data ?? ({} as T)) };
}

/** Build an error envelope (errors.md ERR-PROD-CLIERR-001). */
export function errorEnvelope(stage: string, message: string, exitCode: ExitCode): ErrorEnvelope {
  return { ok: false, stage, error: { message, exitCode } };
}

/**
 * Normalize any thrown value into an error envelope. A {@link CliError} keeps its
 * exit code and stage; anything else is treated as a USER_ERROR (exit 1) — the
 * conservative default so nothing fails silently (ERR-PROD-NOSILENT-001).
 * `fallbackStage` names the active command when the error itself carries none.
 */
export function toErrorEnvelope(error: unknown, fallbackStage: string): ErrorEnvelope {
  if (error instanceof CliError) {
    return errorEnvelope(error.stage ?? fallbackStage, error.message, error.exitCode);
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorEnvelope(fallbackStage, message, ExitCode.USER_ERROR);
}

/** Injectable output sinks so the printer is testable. */
export interface OutputStreams {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** Default sinks: stdout / stderr (no `console.*`, to keep the JSON channel clean). */
export const defaultStreams: OutputStreams = {
  out: (text: string) => {
    process.stdout.write(text);
  },
  err: (text: string) => {
    process.stderr.write(text);
  },
};

export interface PrintOptions {
  json: boolean;
  streams?: OutputStreams;
}

/**
 * The ONE place that renders an envelope. In `--json` mode it prints a single
 * JSON object and nothing else (CLI-PROD-CONV-JSON-001); in human mode it prints
 * a concise, Incidental-worded summary (CLI-PROD-FREE-001). Success goes to
 * stdout; an error's human line goes to stderr.
 */
export function printEnvelope(envelope: Envelope, options: PrintOptions): void {
  const streams = options.streams ?? defaultStreams;
  if (options.json) {
    streams.out(`${JSON.stringify(envelope)}\n`);
    return;
  }
  if (envelope.ok) {
    streams.out(`${formatHuman(envelope)}\n`);
  } else {
    streams.err(`error: ${envelope.error.message}\n`);
  }
}

/** Human-readable (Incidental) one-line rendering of a success envelope. */
function formatHuman(envelope: SuccessEnvelope): string {
  const { ok: _ok, stage, ...rest } = envelope;
  const extras = Object.entries(rest)
    .map(([key, value]) => `${key}=${formatScalar(value)}`)
    .join(' ');
  return extras ? `${stage}: ${extras}` : `${stage}: ok`;
}

function formatScalar(value: unknown): string {
  if (value === null || typeof value !== 'object') return String(value);
  return JSON.stringify(value);
}
