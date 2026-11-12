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
    // The message alone hid WHY a build or test failed: the diagnostics, failing specs
    // and hang verdicts were only in --json. Print them under the error line.
    const details = errorDetails(envelope as unknown as Record<string, unknown>);
    streams.err(`${[`error: ${envelope.error.message}`, ...details].join('\n')}\n`);
  }
}

// --- human-mode error details (Incidental wording, CLI-PROD-FREE-001) ---------------

/**
 * The reasons behind a failed envelope, as indented lines: assembler diagnostics
 * (`build`), failing specs (`test`), the watchdog verdict (`run`/`key`/`type`), a
 * `screen --diff` result, and — for `verify` — the same for its failed stages.
 */
function errorDetails(envelope: Record<string, unknown>, indent = '  '): string[] {
  const lines: string[] = [];
  const errors = envelope.errors;
  if (Array.isArray(errors)) {
    for (const d of errors as Array<Record<string, unknown>>) {
      if (d === null || typeof d !== 'object' || typeof d.message !== 'string') continue;
      const where = typeof d.file === 'string' ? `${d.file}:${String(d.line ?? '?')}: ` : '';
      lines.push(`${indent}${where}${d.message}`);
      if (typeof d.sourceLine === 'string' && d.sourceLine.trim() !== '') {
        lines.push(`${indent}    ${d.sourceLine.trim()}`);
      }
      if (typeof d.hint === 'string') lines.push(`${indent}    hint: ${d.hint}`);
    }
  }
  const results = envelope.results;
  if (Array.isArray(results)) {
    for (const r of results as Array<Record<string, unknown>>) {
      if (r === null || typeof r !== 'object' || r.ok !== false) continue;
      lines.push(`${indent}FAIL ${String(r.spec ?? '?')}`);
      for (const failure of Array.isArray(r.failures) ? r.failures : []) {
        lines.push(`${indent}    ${String(failure)}`);
      }
    }
  }
  // `doctor`: each failing check with its detail — the detail carries the fix.
  const checks = envelope.checks;
  if (Array.isArray(checks)) {
    for (const c of checks as Array<Record<string, unknown>>) {
      if (c === null || typeof c !== 'object' || c.ok !== false) continue;
      lines.push(`${indent}FAIL ${String(c.name ?? '?')}: ${String(c.detail ?? '')}`);
    }
  }
  const hang = envelope.hang as Record<string, unknown> | undefined;
  if (hang !== null && typeof hang === 'object' && typeof hang.kind === 'string') {
    const pc = typeof hang.pc === 'number' ? ` at PC ${hex(hang.pc, 4)}` : '';
    const confidence = typeof hang.confidence === 'string' ? ` (${hang.confidence})` : '';
    const detail = typeof hang.detail === 'string' ? `: ${hang.detail}` : '';
    lines.push(`${indent}hang: ${hang.kind}${pc}${confidence}${detail}`);
    if (typeof hang.likelyCause === 'string') lines.push(`${indent}likely cause: ${hang.likelyCause}`);
  }
  const diff = envelope.diff as Record<string, unknown> | undefined;
  if (diff !== null && typeof diff === 'object' && typeof diff.baseline === 'string') {
    const pixels = typeof diff.diffPixels === 'number' ? String(diff.diffPixels) : 'dimension mismatch:';
    lines.push(
      `${indent}diff: ${pixels} differing pixel(s), maxDiff ${String(diff.maxDiff ?? 0)}, baseline ${diff.baseline}`,
    );
  }
  // `verify` composes stage envelopes: explain each failed one.
  for (const key of ['build', 'run', 'tests']) {
    const stage = envelope[key];
    if (isEnvelopeLike(stage) && !stage.ok) {
      lines.push(`${indent}${key} failed:`);
      lines.push(...errorDetails(stage as unknown as Record<string, unknown>, `${indent}  `));
    }
  }
  return lines;
}

function hex(value: number, digits: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`;
}

/**
 * Fields that carry a machine-readable payload an agent parses from `--json` but
 * a human never wants dumped inline: file manifests, per-item result arrays. In
 * human mode these are SUMMARIZED (a count) instead of stringified — `zxs setup`
 * otherwise prints 27 absolute paths on one line. The exceptions a human does read
 * item by item (`next`/`deferred` strings, the assertion reference) are printed as
 * lines under the summary instead (see `formatHuman`). Wording is Incidental
 * (CLI-PROD-FREE-001); `--json` is untouched.
 */
const SUMMARIZED_FIELDS = new Set([
  'files', 'created', 'skipped', 'installed', 'deferred', 'removed',
  'artifacts', 'results', 'errors', 'warnings', 'next', 'checks', 'assertions',
  'symbols', 'top', 'last', 'entries', 'executed', 'routines', 'edges',
]);

/**
 * Short string lists a human reads as steps or notes rather than counts: the `next`
 * commands `new`/`init`/`setup` suggest, and what `setup` deferred. Printed one item
 * per line under the summary line (a count, `next=3`, hid the steps themselves).
 */
const LINE_LIST_FIELDS = new Set(['next', 'deferred']);

/** A non-empty list of strings. */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');
}

/** One entry of the `test --list-assertions` reference (recipes-and-assertions.md ASSERT-PROD-LIST-001). */
interface AssertionReferenceEntry {
  type: string;
  fields: string[];
  description: string;
}

/** A non-empty list of `{ type, fields, description }` reference entries. */
function isAssertionReference(value: unknown): value is AssertionReferenceEntry[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => {
      if (item === null || typeof item !== 'object') return false;
      const entry = item as Partial<AssertionReferenceEntry>;
      return (
        typeof entry.type === 'string' &&
        Array.isArray(entry.fields) &&
        entry.fields.every((field) => typeof field === 'string') &&
        typeof entry.description === 'string'
      );
    })
  );
}

/** The parts of a `run` `frameBudget` record the human line shows. */
interface FrameBudgetRecord {
  measuredFrames: number;
  overrunFrames: number;
  overruns?: Array<{ frame: number }>;
  worstFrame: { frame: number; busyTStates: number } | null;
}

function isFrameBudgetRecord(value: unknown): value is FrameBudgetRecord {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Partial<FrameBudgetRecord>;
  return typeof record.measuredFrames === 'number' && typeof record.overrunFrames === 'number';
}

/** How many late frames the human `run` line names. */
const HUMAN_OVERRUN_FRAMES = 8;

/** `{measured=40 overruns=2 frames=10,21 worst=69895T@21}`. */
function formatFrameBudget(budget: FrameBudgetRecord): string {
  const parts = [`measured=${budget.measuredFrames}`, `overruns=${budget.overrunFrames}`];
  const frames = (budget.overruns ?? []).slice(0, HUMAN_OVERRUN_FRAMES).map((overrun) => overrun.frame);
  if (frames.length > 0) {
    parts.push(`frames=${frames.join(',')}${budget.overrunFrames > frames.length ? ',…' : ''}`);
  }
  if (budget.worstFrame) parts.push(`worst=${budget.worstFrame.busyTStates}T@${budget.worstFrame.frame}`);
  return `{${parts.join(' ')}}`;
}

/** The assertion reference as one aligned line per type: `type  {fields}  description`. */
function formatAssertionReference(entries: readonly AssertionReferenceEntry[]): string[] {
  const typeWidth = Math.max(...entries.map((entry) => entry.type.length));
  const shapes = entries.map((entry) => `{ ${entry.fields.join(', ')} }`);
  const shapeWidth = Math.max(...shapes.map((shape) => shape.length));
  return entries.map(
    (entry, i) => `  ${entry.type.padEnd(typeWidth)}  ${shapes[i]!.padEnd(shapeWidth)}  ${entry.description}`,
  );
}

/**
 * Summarize one bulk list. The KEY already names what is being counted, so the
 * count alone reads best (`installed=27`, not `installed=27 files`). Lists whose
 * items carry a boolean `ok` — `doctor` checks, `test` results — report the
 * verdict too, because a bare count would hide the one fact worth reading.
 */
function summarizeList(items: readonly unknown[]): string {
  const verdicts = items.filter(
    (item): item is { ok: boolean } =>
      item !== null && typeof item === 'object' && typeof (item as { ok?: unknown }).ok === 'boolean',
  );
  if (verdicts.length === items.length && items.length > 0) {
    const passed = verdicts.filter((v) => v.ok).length;
    return passed === items.length ? `${items.length}/${items.length} ok` : `${passed}/${items.length} ok`;
  }
  return String(items.length);
}

/**
 * Human-readable (Incidental, CLI-PROD-FREE-001) rendering of a success envelope:
 * one summary line with the scalar facts inline and bulk payloads as counts, then
 * any text grid as a block below it. The full data is always one `--json` away,
 * so nothing is lost — only the wall of text.
 */
function formatHuman(envelope: SuccessEnvelope): string {
  const { ok: _ok, stage, ...rest } = envelope;
  const parts: string[] = [];
  const blocks: string[] = [];
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    // An instruction listing (`disasm`/`step` `instructions`, `trace` `top`/`last`) is the
    // answer the command exists for: one line per instruction under the summary, never a
    // count or a JSON blob cut at 120 characters.
    if (isInstructionList(value)) {
      parts.push(`${key}=${value.length}`);
      blocks.push(`${key}:`, ...value.map(formatInstruction));
      continue;
    }
    // The register file is the payload of `regs` / `step`; elsewhere (e.g. `run`) it stays
    // a compact inline record.
    if (key === 'registers' && (stage === 'regs' || stage === 'step') && isRegisterSnapshot(value)) {
      blocks.push('registers:', ...formatRegisters(value));
      continue;
    }
    // `trace --profile`: the routine table is the answer, so print it as one.
    if (key === 'profile' && isProfile(value)) {
      blocks.push(...formatProfile(value));
      continue;
    }
    // `next` steps and `deferred` notes are read, not counted: one per line.
    if (LINE_LIST_FIELDS.has(key) && isStringList(value)) {
      blocks.push(`${key}:`, ...value.map((item) => `  ${item}`));
      continue;
    }
    // `run`'s frame-budget record: the facts a human checks, late frames included (the
    // JSON blob was cut at 120 characters before reaching them).
    if (key === 'frameBudget' && isFrameBudgetRecord(value)) {
      parts.push(`${key}=${formatFrameBudget(value)}`);
      continue;
    }
    // `test --list-assertions`: the reference is the answer, so print it as a table.
    if (key === 'assertions' && isAssertionReference(value)) {
      parts.push(`${key}=${value.length}`);
      blocks.push(`${key}:`, ...formatAssertionReference(value));
      continue;
    }
    if (Array.isArray(value) && SUMMARIZED_FIELDS.has(key)) {
      // Empty bulk lists are noise in human mode — an agent reads them in --json.
      if (value.length > 0) parts.push(`${key}=${summarizeList(value)}`);
      continue;
    }
    // A text grid (`screen` OCR `rows`, `--attrs`) is read as a picture: truncating
    // it into the line would show nothing, so print it whole under the line.
    if (isTextGrid(value)) {
      parts.push(`${key}=${value.length}`);
      blocks.push(`${key}:`, ...value);
      continue;
    }
    // A nested envelope (`verify` composes build/run/tests) collapses to its
    // verdict: three truncated JSON blobs told the reader nothing, and the
    // whole point of the gate line is which stage passed.
    if (isEnvelopeLike(value)) {
      parts.push(`${key}=${value.ok ? 'ok' : 'failed'}`);
      continue;
    }
    parts.push(`${key}=${formatScalar(value)}`);
  }
  const line = parts.length > 0 ? `${stage}: ${parts.join(' ')}` : `${stage}: ok`;
  return [line, ...blocks].join('\n');
}

/** One reported instruction: `disasm`/`step` lines and `trace` hot-spots / tail. */
interface InstructionLine {
  addr: number;
  text: string;
  bytes?: number[];
  label?: string;
  count?: number;
}

/** A non-empty list whose every item has a numeric `addr` and a `text` decode. */
function isInstructionList(value: unknown): value is InstructionLine[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as { addr?: unknown }).addr === 'number' &&
        typeof (item as { text?: unknown }).text === 'string',
    )
  );
}

/** `  8000  3E 01         LD A,1  ; label`, or `  8000     x1234  LD A,1` for a hot-spot. */
function formatInstruction(line: InstructionLine): string {
  const addr = line.addr.toString(16).toUpperCase().padStart(4, '0');
  const count = line.count !== undefined ? `${`x${line.count}`.padStart(8)}  ` : '';
  const bytes = Array.isArray(line.bytes)
    ? `${line.bytes.map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join(' ').padEnd(12)}  `
    : '';
  const label = line.label !== undefined ? `  ; ${line.label}` : '';
  return `  ${addr}  ${count}${bytes}${line.text}${label}`;
}

/** The decoded register view (`observe/registers.ts` RegisterSnapshot), structurally. */
interface RegisterView {
  pc: number;
  sp: number;
  af: number;
  bc: number;
  de: number;
  hl: number;
  ix: number;
  iy: number;
  i: number;
  r: number;
  im: number;
  iff1: boolean;
  iff2: boolean;
  halted: boolean;
  alt: { af: number; bc: number; de: number; hl: number };
  flags: Record<string, boolean>;
}

function isRegisterSnapshot(value: unknown): value is RegisterView {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<RegisterView>;
  return (
    typeof v.pc === 'number' &&
    typeof v.af === 'number' &&
    v.alt !== null &&
    typeof v.alt === 'object' &&
    v.flags !== null &&
    typeof v.flags === 'object'
  );
}

/** Three lines: the main set, the alternates + control state, the decoded flags. */
function formatRegisters(r: RegisterView): string[] {
  const w = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
  const b = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');
  const f = r.flags;
  const flag = (on: boolean | undefined, name: string): string => (on ? name : '-');
  return [
    `  PC=${w(r.pc)} SP=${w(r.sp)} AF=${w(r.af)} BC=${w(r.bc)} DE=${w(r.de)} HL=${w(r.hl)} IX=${w(r.ix)} IY=${w(r.iy)}`,
    `  AF'=${w(r.alt.af)} BC'=${w(r.alt.bc)} DE'=${w(r.alt.de)} HL'=${w(r.alt.hl)} I=${b(r.i)} R=${b(r.r)} ` +
      `IM=${r.im} IFF1=${r.iff1 ? 1 : 0} IFF2=${r.iff2 ? 1 : 0}${r.halted ? ' HALTED' : ''}`,
    `  flags: ${flag(f.s, 'S')}${flag(f.z, 'Z')}${flag(f.f5, '5')}${flag(f.h, 'H')}${flag(f.f3, '3')}` +
      `${flag(f.pv, 'P')}${flag(f.n, 'N')}${flag(f.c, 'C')}`,
  ];
}

/** The `trace --profile` summary (observe/trace.ts TraceProfile), structurally. */
interface ProfileView {
  activePercentOfRun: number;
  idlePercentOfRun: number;
  interruptPercentOfRun: number;
  entries: Array<{ symbol: string; tStates: number; percentOfActive: number; percentOfFrame: number }>;
}

function isProfile(value: unknown): value is ProfileView {
  return (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray((value as { entries?: unknown }).entries) &&
    typeof (value as { activePercentOfRun?: unknown }).activePercentOfRun === 'number'
  );
}

/** The time split, then one line per routine bucket (attribution is heuristic). */
function formatProfile(p: ProfileView): string[] {
  return [
    `profile: active ${p.activePercentOfRun}%  HALT idle ${p.idlePercentOfRun}%  ` +
      `interrupt ${p.interruptPercentOfRun}%  (by nearest preceding SLD label, heuristic)`,
    ...p.entries.map(
      (e) =>
        `  ${e.symbol.padEnd(24)} ${String(e.tStates).padStart(10)} T  ` +
        `${String(e.percentOfActive).padStart(6)}% of active  ${String(e.percentOfFrame).padStart(6)}% of frame`,
    ),
  ];
}

/** Two or more strings of one length: a fixed-width text grid, not a list of items. */
function isTextGrid(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length < 2) return false;
  const width = typeof value[0] === 'string' ? value[0].length : -1;
  return width > 0 && value.every((line) => typeof line === 'string' && line.length === width);
}

/** A nested command envelope — `{ ok, stage, … }` — rather than a plain record. */
function isEnvelopeLike(value: unknown): value is { ok: boolean } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { ok?: unknown; stage?: unknown };
  return typeof candidate.ok === 'boolean' && typeof candidate.stage === 'string';
}

/**
 * A scalar renders as itself; a nested object/array that is NOT a summarized bulk
 * field (a small record like `audio` or `registers`) still renders as compact
 * JSON, but is truncated so one oversized field cannot swamp the line.
 */
const MAX_INLINE_JSON = 120;

function formatScalar(value: unknown): string {
  if (value === null || typeof value !== 'object') return String(value);
  const json = JSON.stringify(value);
  return json.length > MAX_INLINE_JSON ? `${json.slice(0, MAX_INLINE_JSON - 1)}…` : json;
}
