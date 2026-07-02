// `zxs break` + `zxs watch` — manage the persistent breakpoint / watchpoint store
// (cli.md CLI-PROD-BREAK-001 / CLI-PROD-WATCH-001, RT-PROD-RUN-002).
//
// Both edit the LIVE debug store (`.zxs/debug.json`) so additions SURVIVE across
// separate, stateless `zxs` invocations and feed the ONE watchpoint model that
// `run --until-break`/`--until-watch` consume (CLI-PROD-EDGE-001 raises the budget).
// A `break add <spec>` resolves a label / `file.asm:line` against the built entry's
// SLD (CLI-PROD-EDGE-002 — raw addresses need no build). Read watchpoints CANNOT be
// observed by the cores, so `watch add --read` FAILS LOUD (W4-GAP-01), reusing the
// existing `run --watch-read` guard — never a silent no-op (ERR-PROD-NOSILENT-001).

import type { Command } from 'commander';
import { envError, userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { parseNumber, parseRange } from '../util/address.js';
import { READ_WATCH_UNAVAILABLE } from '../runtime/run.js';
import { resolveObserveMachine } from '../observe/source.js';
import {
  addBreakpoint,
  addWatchpoint,
  removeBreakpoints,
  removeWatchpoints,
  type Breakpoint,
  type Watchpoint,
} from './debug-store.js';
import { loadDebugStore, saveDebugStore } from './persist.js';

export type BreakEnvelope = {
  ok: true;
  stage: 'break';
  op: 'add' | 'list' | 'rm';
  breakpoint?: Breakpoint;
  removed?: number[];
  breakpoints: Breakpoint[];
};

export type WatchEnvelope = {
  ok: true;
  stage: 'watch';
  op: 'add' | 'list' | 'rm';
  watchpoint?: Watchpoint;
  removed?: number[];
  watchpoints: Watchpoint[];
};

// --- spec resolution -------------------------------------------------------

/** Whether a source-map file path matches a user-given (possibly bare) file name. */
function sameFile(mapped: string, given: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/');
  const m = norm(mapped);
  const g = norm(given);
  return m === g || m.endsWith(`/${g}`) || m.split('/').pop() === g.split('/').pop();
}

/**
 * Resolve a `break add` spec to a 16-bit address: a raw address resolves with no
 * build (CLI-PROD-EDGE-002); a label / `file.asm:line` is looked up in the built
 * entry's SLD (assembled in memory by the observe sourcer).
 */
export function resolveBreakSpec(spec: string, cwd: string): number {
  const s = spec.trim();
  const n = parseNumber(s);
  if (n !== undefined && n >= 0 && n <= 0xffff) return n;

  const src = resolveObserveMachine({ cwd, stage: 'break' });
  const sym = src.symbols.find((x) => x.name === s);
  if (sym) return sym.value & 0xffff;

  const colon = s.lastIndexOf(':');
  if (colon > 0) {
    const file = s.slice(0, colon);
    const line = parseNumber(s.slice(colon + 1));
    if (line !== undefined) {
      const entry = src.sourceMap.find((e) => sameFile(e.file, file) && e.line === line);
      if (entry) return entry.addr & 0xffff;
    }
  }
  throw userError(
    `break: cannot resolve "${spec}" (use an address, a label, or file.asm:line; ` +
      'label/file:line need symbols from a prior `zxs build`)',
    'break',
  );
}

/** Parse a `rm <id|all>` argument to the removal selector. */
function parseRmTarget(raw: string | undefined, stage: 'break' | 'watch'): 'all' | number {
  if (raw === undefined) throw userError(`${stage} rm requires <id|all>`, stage);
  if (raw.toLowerCase() === 'all') return 'all';
  const n = parseNumber(raw);
  if (n === undefined || n < 1) throw userError(`Invalid ${stage} id: "${raw}" (use a positive id or "all")`, stage);
  return n;
}

// --- break -----------------------------------------------------------------

/** Map the CLI context onto the `break` sub-commands (CLI-PROD-BREAK-001). */
export function breakCommand(context: CommandContext): BreakEnvelope {
  const sub = context.args[0];
  const cwd = process.cwd();
  const store = loadDebugStore(cwd);

  switch (sub) {
    case 'add': {
      const spec = context.args[1];
      if (spec === undefined) throw userError('break add requires <spec> (an address, a label, or file.asm:line)', 'break');
      const addr = resolveBreakSpec(spec, cwd);
      const breakpoint = addBreakpoint(store, addr, spec);
      saveDebugStore(store, cwd);
      return { ok: true, stage: 'break', op: 'add', breakpoint, breakpoints: store.breakpoints };
    }
    case 'rm': {
      const target = parseRmTarget(context.args[1], 'break');
      const removed = removeBreakpoints(store, target);
      if (removed.length === 0) throw userError(`break rm: no matching breakpoint (${context.args[1]})`, 'break');
      saveDebugStore(store, cwd);
      return { ok: true, stage: 'break', op: 'rm', removed: removed.map((b) => b.id), breakpoints: store.breakpoints };
    }
    case 'list':
    case undefined:
      return { ok: true, stage: 'break', op: 'list', breakpoints: store.breakpoints };
    default:
      throw userError(`Unknown break sub-command "${sub}" (use add | list | rm)`, 'break');
  }
}

/** Declare the `break` command's arguments (CLI-PROD-BREAK-001). */
export function configureBreakCommand(command: Command): void {
  command
    .description('Manage breakpoints: add <spec> | list | rm <id|all>')
    .argument('[args...]', '`add <spec>`, `list`, or `rm <id|all>`')
    .option('--json', 'emit a single machine-readable JSON envelope');
}

// --- watch -----------------------------------------------------------------

/** Map the CLI context onto the `watch` sub-commands (CLI-PROD-WATCH-001). */
export function watchCommand(context: CommandContext): WatchEnvelope {
  const sub = context.args[0];
  const options = context.options as Record<string, unknown>;
  const cwd = process.cwd();
  const store = loadDebugStore(cwd);

  switch (sub) {
    case 'add': {
      // Read watchpoints are unobservable (the cores expose no read-bus hook) — fail
      // loud on PRESENCE, before parsing the range, reusing the run guard (W4-GAP-01).
      if (options.read !== undefined) throw envError(READ_WATCH_UNAVAILABLE, 'watch');
      const rangeSpec = options.write as string | undefined;
      if (rangeSpec === undefined) {
        throw userError('watch add requires --write <range> (--read is unavailable; see W4-GAP-01)', 'watch');
      }
      const range = parseRange(rangeSpec, 'watch');
      const watchpoint = addWatchpoint(store, 'write', range.from, range.to, rangeSpec);
      saveDebugStore(store, cwd);
      return { ok: true, stage: 'watch', op: 'add', watchpoint, watchpoints: store.watchpoints };
    }
    case 'rm': {
      const target = parseRmTarget(context.args[1], 'watch');
      const removed = removeWatchpoints(store, target);
      if (removed.length === 0) throw userError(`watch rm: no matching watchpoint (${context.args[1]})`, 'watch');
      saveDebugStore(store, cwd);
      return { ok: true, stage: 'watch', op: 'rm', removed: removed.map((w) => w.id), watchpoints: store.watchpoints };
    }
    case 'clear': {
      const removed = removeWatchpoints(store, 'all');
      saveDebugStore(store, cwd);
      return { ok: true, stage: 'watch', op: 'rm', removed: removed.map((w) => w.id), watchpoints: store.watchpoints };
    }
    case 'list':
    case undefined:
      return { ok: true, stage: 'watch', op: 'list', watchpoints: store.watchpoints };
    default:
      throw userError(`Unknown watch sub-command "${sub}" (use add | list | rm | clear)`, 'watch');
  }
}

/** Declare the `watch` command's arguments / flags (CLI-PROD-WATCH-001). */
export function configureWatchCommand(command: Command): void {
  command
    .description('Manage memory watchpoints: add --write <range> | list | rm <id|all> | clear')
    .argument('[args...]', '`add`, `list`, `rm <id|all>`, or `clear`')
    .option('--write <range>', 'add a write watchpoint over an inclusive range')
    .option('--read <range>', 'add a read watchpoint (unavailable — fails loud, W4-GAP-01)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
