// The optional reverse-engineering `gfx` seam (cli.md CLI-PROD-GFX-003 /
// CLI-PROD-REVENG-001, ADR-0027 D5).
//
// `gfx find` / `gfx blit-linear` inspect THIRD-PARTY games and live in the optional
// reverse-engineering add-on (`src/reveng/`), NOT in core `gfx` (which is `linear` /
// `attrs`). To keep core independent of the add-on (CLI-PROD-FREE-003: "core does not
// depend on it"), core `gfx.ts` never imports the add-on. Instead it consults THIS hook —
// a dependency-inversion seam the add-on fills at mount time (`registerRevengAddon`).
//
// When the add-on is NOT mounted the hook is empty and `gfx find`/`blit-linear` fail loud
// ("not installed"), never silently absent (ERR-PROD-NOSILENT-001). When it IS mounted,
// core delegates to the installed handler. This is the single point of coupling, and it
// points core -> interface -> add-on, so removing the add-on removes the whole capability
// with zero core edits.

import type { CommandContext } from '../registry.js';
import type { SuccessEnvelope } from '../output/envelope.js';

/**
 * A reveng `gfx` success envelope: a `stage: 'gfx'` success with an `op` naming the reveng
 * sub-command. Deliberately minimal here (core knows only this shape); the add-on's concrete
 * `find` / `blit-linear` envelopes are structurally richer supersets. Kept independent of
 * core `gfx.ts`'s own `GfxEnvelope` so this hook has no gfx-implementation coupling.
 */
export type RevengGfxEnvelope = SuccessEnvelope<{ op: string }> & { stage: 'gfx' };

/**
 * The reverse-engineering `gfx` handler the add-on installs. `run` dispatches a reveng
 * `gfx` sub-command (`find` / `blit-linear`); it returns a `stage: 'gfx'` success envelope
 * so the CLI renders it uniformly with core `gfx`.
 */
export interface RevengGfxHandler {
  run(sub: string, context: CommandContext): RevengGfxEnvelope;
}

let installed: RevengGfxHandler | undefined;

/** Install the reveng `gfx` handler (called by the add-on's `registerRevengAddon`). */
export function setRevengGfxHandler(handler: RevengGfxHandler): void {
  installed = handler;
}

/** The installed reveng `gfx` handler, or `undefined` when the add-on is not mounted. */
export function getRevengGfxHandler(): RevengGfxHandler | undefined {
  return installed;
}

/** Remove the installed handler (used by tests to exercise the add-on-absent path). */
export function clearRevengGfxHandler(): void {
  installed = undefined;
}
