// Browser-key → 48K-matrix mapping for the bundled preview player — the host
// input policy of keyboard-input.md KBD-BROWSERMAP-001 (letters/digits/named
// keys/CAPS-SHIFT combos) + KBD-BROWSERMAP-002 (printable symbol characters as
// SYMBOL SHIFT chords, with the Shift-suppression rule).
//
// Pure and DOM-free so the mapping is unit-testable and shared verbatim by the
// tsup-bundled player. The matrix itself (key name → row/bit) lives with its
// consumers (player/main.js, runtime/schedule.ts); this module only names keys.

/**
 * A printable character → the SYMBOL SHIFT chord that types it — the 48K's red
 * key legends (KBD-BROWSERMAP-002). Resolved from the PRODUCED character
 * (`KeyboardEvent.key`), not the physical key, so `"` works whether the host
 * layout puts it on Shift+2 (UK) or its own key. Letters and digits are
 * deliberately absent — they are direct keys. Bracket/backslash/tilde need the
 * Spectrum's EXTENDED mode and stay unmapped.
 */
export const SYMBOL_CHAR_KEYS: Readonly<Record<string, readonly [string, string]>> = {
  '!': ['SYMBOL_SHIFT', '1'], '@': ['SYMBOL_SHIFT', '2'], '#': ['SYMBOL_SHIFT', '3'],
  $: ['SYMBOL_SHIFT', '4'], '%': ['SYMBOL_SHIFT', '5'], '&': ['SYMBOL_SHIFT', '6'],
  "'": ['SYMBOL_SHIFT', '7'], '(': ['SYMBOL_SHIFT', '8'], ')': ['SYMBOL_SHIFT', '9'],
  _: ['SYMBOL_SHIFT', '0'], '"': ['SYMBOL_SHIFT', 'P'], ';': ['SYMBOL_SHIFT', 'O'],
  ':': ['SYMBOL_SHIFT', 'Z'], ',': ['SYMBOL_SHIFT', 'N'], '.': ['SYMBOL_SHIFT', 'M'],
  '=': ['SYMBOL_SHIFT', 'L'], '+': ['SYMBOL_SHIFT', 'K'], '-': ['SYMBOL_SHIFT', 'J'],
  '*': ['SYMBOL_SHIFT', 'B'], '/': ['SYMBOL_SHIFT', 'V'], '?': ['SYMBOL_SHIFT', 'C'],
  '<': ['SYMBOL_SHIFT', 'R'], '>': ['SYMBOL_SHIFT', 'T'], '^': ['SYMBOL_SHIFT', 'H'],
  '£': ['SYMBOL_SHIFT', 'X'],
};

/** Named `KeyboardEvent.key` values → Spectrum keys (KBD-BROWSERMAP-001). */
const NAMED_KEYS: Readonly<Record<string, readonly string[]>> = {
  Enter: ['ENTER'],
  ' ': ['SPACE'],
  Shift: ['CAPS_SHIFT'],
  Control: ['SYMBOL_SHIFT'],
  ArrowLeft: ['CAPS_SHIFT', '5'],
  ArrowDown: ['CAPS_SHIFT', '6'],
  ArrowUp: ['CAPS_SHIFT', '7'],
  ArrowRight: ['CAPS_SHIFT', '8'],
  Backspace: ['CAPS_SHIFT', '0'],
  Delete: ['CAPS_SHIFT', '0'],
  Escape: ['CAPS_SHIFT', 'SPACE'],
};

/**
 * Map one browser `KeyboardEvent.key` to zero or more Spectrum matrix keys —
 * KBD-BROWSERMAP-001 (letters/digits/named/combos) + KBD-BROWSERMAP-002
 * (symbol characters). An unmapped key maps to no Spectrum key.
 */
export function mapBrowserKey(key: string): readonly string[] {
  if (key.length === 1) {
    const symbol = SYMBOL_CHAR_KEYS[key];
    if (symbol) return symbol;
    const up = key.toUpperCase();
    if (up >= 'A' && up <= 'Z') return [up];
    if (up >= '0' && up <= '9') return [up];
    if (key === ' ') return ['SPACE'];
  }
  return NAMED_KEYS[key] ?? [];
}

/** True when this physical code is a host Shift key. */
export function isHostShiftCode(code: string): boolean {
  return code === 'ShiftLeft' || code === 'ShiftRight';
}

/**
 * Resolve the full set of pressed Spectrum keys from the currently-held host
 * keys — `held` iterates `[event.code, event.key-at-keydown]` pairs. Recomputing
 * the whole set on every key event (rather than mapping each event in isolation)
 * is what keeps chords correct when modifiers go up and down asymmetrically:
 * the `key` stored at keydown identifies the entry even after the host Shift is
 * released (a lone per-event `keyup` mapping would see `"2"` where the keydown
 * saw `"` and leave SYMBOL_SHIFT+P stuck).
 *
 * The one subtlety (KBD-BROWSERMAP-002): a host Shift held only to PRODUCE a
 * symbol character must not also press CAPS SHIFT — CAPS+SYM would silently
 * drop the machine into EXTENDED mode mid-chord. Suppression is applied while
 * any symbol character is held, and — via `stickyShiftCodes` — for the rest of
 * a Shift hold that has already produced one: releasing the symbol key a few
 * milliseconds before the Shift (every host does) briefly leaves the Shift
 * alone in `held`, and without the sticky memory CAPS would pulse back in that
 * gap, land in the same 50 Hz scan as the latched chord, and read as EXTENDED
 * mode. A Shift held with no symbol involvement still maps to CAPS SHIFT (so
 * Shift+Ctrl reaches EXTENDED on purpose).
 */
export function resolveHeldMatrix(
  held: Iterable<readonly [code: string, key: string]>,
  stickyShiftCodes?: ReadonlySet<string>,
): Set<string> {
  const entries = [...held];
  const set = new Set<string>();
  let symbolActive = false;
  for (const [, key] of entries) {
    const symbol = key.length === 1 ? SYMBOL_CHAR_KEYS[key] : undefined;
    if (symbol) {
      for (const k of symbol) set.add(k);
      symbolActive = true;
    }
  }
  for (const [code, key] of entries) {
    if (key.length === 1 && SYMBOL_CHAR_KEYS[key]) continue; // handled above
    for (const k of mapBrowserKey(key)) {
      if (
        k === 'CAPS_SHIFT' &&
        isHostShiftCode(code) &&
        (symbolActive || stickyShiftCodes?.has(code) === true)
      ) {
        continue;
      }
      set.add(k);
    }
  }
  return set;
}

/**
 * Does this host key reach the Spectrum at all? Only claimed keys are
 * `preventDefault`ed: function keys (F12 = DevTools, F5 = reload) and OS-level
 * chords must keep working — an embedded preview must not disable the browser.
 */
export function claimsBrowserEvent(event: {
  key: string;
  metaKey?: boolean;
}): boolean {
  if (/^F\d{1,2}$/.test(event.key)) return false; // F1..F24 belong to the browser/OS
  if (event.metaKey) return false; // OS-level chords
  return mapBrowserKey(event.key).length > 0;
}
