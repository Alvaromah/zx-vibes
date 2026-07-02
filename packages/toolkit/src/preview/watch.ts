// Preview source watcher — toolkit-runtime.md RT-PROD-PREVIEW-005, RT-PROD-FREE-001.
//
// `preview --watch` polls the project source for changes (~500 ms) and pushes build/reload
// events to connected clients over the SSE stream (RT-PROD-PREVIEW-005). This module is the
// poller: it samples a set of file paths' mtimes/sizes on an interval and fires `onChange`
// when any differs (added, modified, or removed). The poll interval and the change-detection
// internals are Incidental (RT-PROD-FREE-001); only the observable "a source change pushes a
// reload" contract matters. The server wires `onChange` to a rebuild + SSE broadcast.

import { existsSync, statSync } from 'node:fs';

/** Default source-poll interval (RT-PROD-PREVIEW-005 — "~500 ms"). */
export const DEFAULT_WATCH_INTERVAL_MS = 500;

/** A snapshot signature of one file: `-1` when absent, else `mtimeMs:size`. */
function signature(path: string): string {
  try {
    if (!existsSync(path)) return '-1';
    const st = statSync(path);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '-1';
  }
}

/**
 * Polls `paths` every `intervalMs` and calls `onChange` once per poll in which any path's
 * signature changed from the previous poll. The timer is `unref`'d so it never keeps the
 * process alive on its own, and {@link stop} clears it (no leaked handles).
 */
export class SourceWatcher {
  private readonly paths: string[];
  private readonly intervalMs: number;
  private readonly onChange: () => void;
  private timer: ReturnType<typeof setInterval> | undefined;
  private last: Map<string, string> = new Map();

  constructor(paths: string[], onChange: () => void, intervalMs: number = DEFAULT_WATCH_INTERVAL_MS) {
    this.paths = [...new Set(paths)];
    this.onChange = onChange;
    this.intervalMs = intervalMs;
  }

  /** Begin polling. Captures the baseline signatures first so the first poll is a no-op. */
  start(): this {
    for (const p of this.paths) this.last.set(p, signature(p));
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    return this;
  }

  /** One poll: fire `onChange` iff any watched path's signature changed. */
  poll(): void {
    let changed = false;
    for (const p of this.paths) {
      const sig = signature(p);
      if (this.last.get(p) !== sig) {
        changed = true;
        this.last.set(p, sig);
      }
    }
    if (changed) this.onChange();
  }

  /** Stop polling and release the timer (idempotent). */
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** The watched paths (deduped) — for diagnostics/tests. */
  watchedPaths(): readonly string[] {
    return this.paths;
  }
}
