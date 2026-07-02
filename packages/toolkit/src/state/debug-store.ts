// The persistent debug store — breakpoints + watchpoints (Slice 7b).
//
// cli.md CLI-PROD-BREAK-001 / CLI-PROD-WATCH-001 and toolkit-runtime.md
// RT-PROD-RUN-002: there is ONE watchpoint model, fed identically by the ephemeral
// `run --watch-*`/`--until-pc` flags and this persistent store. break/watch
// additions must SURVIVE across separate, stateless `zxs` invocations (the CLI is
// stateless-by-default), so the store lives on disk under the project's `.zxs/`
// (`.zxs/debug.json`) — independent of the opt-in `.zxstate` session. `run
// --until-break`/`--until-watch` (Slice 3) load it to terminate early at a stored
// breakpoint/watchpoint (CLI-PROD-EDGE-001 raises the budget so it can fire).
//
// The store is ALSO embedded (a copy) inside a saved `.zxstate` so a session handed
// between the CLI and the MCP server (Slice 10) carries its breakpoints with it
// (MCP-PROD-TOOL-DEBUG-002, MCP-PROD-RULE-INTEROP-001); `state load` republishes the
// embedded copy back to `.zxs/debug.json`.

/** One PC breakpoint (cli.md CLI-PROD-BREAK-001). */
export interface Breakpoint {
  /** Stable id for `break rm <id>` (monotonic within the store). */
  id: number;
  /** The resolved 16-bit program-counter address it fires on. */
  addr: number;
  /** The original `add` spec (label / `file.asm:line` / address) for display. */
  spec: string;
}

/** A read or write memory watchpoint (cli.md CLI-PROD-WATCH-001 — the one watchpoint model). */
export interface Watchpoint {
  id: number;
  /** `write` is honored; `read` is a tracked capability gap (W4-GAP-01, fail-loud). */
  type: 'read' | 'write';
  /** Inclusive watched range. */
  from: number;
  to: number;
  /** The original `--read`/`--write` range spec for display. */
  spec: string;
}

/** The on-disk debug store (`.zxs/debug.json`). Monotonic id counters keep ids stable across rm. */
export interface DebugStore {
  breakpoints: Breakpoint[];
  watchpoints: Watchpoint[];
  nextBreakId: number;
  nextWatchId: number;
}

/** A fresh, empty debug store. */
export function emptyDebugStore(): DebugStore {
  return { breakpoints: [], watchpoints: [], nextBreakId: 1, nextWatchId: 1 };
}

/**
 * Coerce an arbitrary parsed object into a well-formed {@link DebugStore} (tolerant
 * of a partial/foreign store, e.g. one embedded by a different MCP build): drop
 * malformed entries, recompute the id counters so a subsequent add never collides.
 */
export function normalizeDebugStore(raw: unknown): DebugStore {
  const store = emptyDebugStore();
  if (raw === null || typeof raw !== 'object') return store;
  const obj = raw as Partial<DebugStore>;

  for (const bp of Array.isArray(obj.breakpoints) ? obj.breakpoints : []) {
    if (bp && typeof bp.addr === 'number') {
      store.breakpoints.push({
        id: typeof bp.id === 'number' ? bp.id : store.breakpoints.length + 1,
        addr: bp.addr & 0xffff,
        spec: typeof bp.spec === 'string' ? bp.spec : `0x${(bp.addr & 0xffff).toString(16)}`,
      });
    }
  }
  for (const wp of Array.isArray(obj.watchpoints) ? obj.watchpoints : []) {
    if (wp && typeof wp.from === 'number' && typeof wp.to === 'number') {
      store.watchpoints.push({
        id: typeof wp.id === 'number' ? wp.id : store.watchpoints.length + 1,
        type: wp.type === 'read' ? 'read' : 'write',
        from: wp.from & 0xffff,
        to: wp.to & 0xffff,
        spec: typeof wp.spec === 'string' ? wp.spec : `${wp.from}-${wp.to}`,
      });
    }
  }
  store.nextBreakId = Math.max(
    1,
    typeof obj.nextBreakId === 'number' ? obj.nextBreakId : 0,
    ...store.breakpoints.map((b) => b.id + 1),
  );
  store.nextWatchId = Math.max(
    1,
    typeof obj.nextWatchId === 'number' ? obj.nextWatchId : 0,
    ...store.watchpoints.map((w) => w.id + 1),
  );
  return store;
}

/** Add a breakpoint at a resolved address, returning the created entry (mutates the store). */
export function addBreakpoint(store: DebugStore, addr: number, spec: string): Breakpoint {
  const bp: Breakpoint = { id: store.nextBreakId, addr: addr & 0xffff, spec };
  store.breakpoints.push(bp);
  store.nextBreakId += 1;
  return bp;
}

/** Add a watchpoint, returning the created entry (mutates the store). */
export function addWatchpoint(
  store: DebugStore,
  type: 'read' | 'write',
  from: number,
  to: number,
  spec: string,
): Watchpoint {
  const wp: Watchpoint = { id: store.nextWatchId, type, from: from & 0xffff, to: to & 0xffff, spec };
  store.watchpoints.push(wp);
  store.nextWatchId += 1;
  return wp;
}

/**
 * Remove breakpoints by id or all (`break rm <id|all>`). Returns the removed
 * entries; an empty result lets the caller exit 1 (CLI-PROD-EDGE-003).
 */
export function removeBreakpoints(store: DebugStore, idOrAll: 'all' | number): Breakpoint[] {
  const removed = store.breakpoints.filter((b) => idOrAll === 'all' || b.id === idOrAll);
  store.breakpoints = store.breakpoints.filter((b) => !removed.includes(b));
  return removed;
}

/** Remove watchpoints by id or all (`watch rm <id|all>` / `watch clear`). */
export function removeWatchpoints(store: DebugStore, idOrAll: 'all' | number): Watchpoint[] {
  const removed = store.watchpoints.filter((w) => idOrAll === 'all' || w.id === idOrAll);
  store.watchpoints = store.watchpoints.filter((w) => !removed.includes(w));
  return removed;
}
