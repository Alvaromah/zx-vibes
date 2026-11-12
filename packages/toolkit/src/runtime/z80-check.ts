// Structural check of a 48K `.z80` snapshot before it is decoded — errors.md
// ERR-PROD-EMU-001 ("a `.z80` too small" must fail as a user error, never silently).
//
// The validation lives in the core reader: `readZ80` throws on any file that is not a
// complete 48K snapshot (snapshot-z80.md FMT-Z80-VALIDATE-001) — too short, truncated,
// a 128K-class hardware mode, a page that expands short, a missing 48K page. Asking the
// core keeps every surface (run/observe sources, the reveng add-on, the `.zxstate`
// session envelope, the preview player) rejecting exactly the same files; this wrapper
// only turns the core's exception into the reason string the toolkit's errors embed.

import { readZ80 } from '@zx-vibes/machine';

/** The prefix the core puts on its rejection messages. */
const CORE_PREFIX = /^readZ80: /;

/**
 * Why `bytes` is not a loadable 48K `.z80` snapshot, or `undefined` when it is.
 */
export function z80SnapshotProblem(bytes: Uint8Array): string | undefined {
  try {
    readZ80(bytes);
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(CORE_PREFIX, '');
  }
}
