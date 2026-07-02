// The 48K keyboard, host side. Pure (browser-safe).
//
// The Spectrum reads the keyboard through IN from an even port: the HIGH byte of
// the port pulls one or more of the eight half-rows low, and bits 0..4 of the
// result read the five keys of each selected half-row (0 = pressed, active low).

// Canonical key -> [half-row 0..7, bit 0..4]. Half-row r is selected when bit r of
// the port's high byte is 0.
export const KEY_MATRIX = {
  CAPS: [0, 0], Z: [0, 1], X: [0, 2], C: [0, 3], V: [0, 4],
  A: [1, 0], S: [1, 1], D: [1, 2], F: [1, 3], G: [1, 4],
  Q: [2, 0], W: [2, 1], E: [2, 2], R: [2, 3], T: [2, 4],
  1: [3, 0], 2: [3, 1], 3: [3, 2], 4: [3, 3], 5: [3, 4],
  0: [4, 0], 9: [4, 1], 8: [4, 2], 7: [4, 3], 6: [4, 4],
  P: [5, 0], O: [5, 1], I: [5, 2], U: [5, 3], Y: [5, 4],
  ENTER: [6, 0], L: [6, 1], K: [6, 2], J: [6, 3], H: [6, 4],
  SPACE: [7, 0], SYM: [7, 1], M: [7, 2], N: [7, 3], B: [7, 4],
};

/**
 * The keyboard byte (bits 0..4) for the half-rows selected by `highByte`, given a
 * set of currently-pressed canonical keys. Bits 5..7 and the EAR bit are added by
 * the caller.
 */
export function keyboardMatrixByte(pressed, highByte) {
  let result = 0x1f;
  for (const key of pressed) {
    const cell = KEY_MATRIX[key];
    if (!cell) continue;
    const [row, bit] = cell;
    if (((highByte >> row) & 1) === 0) result &= ~(1 << bit) & 0x1f;
  }
  return result;
}

// A printable character -> the canonical matrix keys that type it. On the 48K,
// punctuation is SYMBOL SHIFT + a key (the red legends), so "=" is SYM+L, "+" is
// SYM+K, '"' is SYM+P, and so on. The host produces these characters directly
// (often via its own Shift), so we resolve by the resulting *character* rather
// than the physical key. Letters and digits are deliberately absent — they are
// direct keys, resolved from the physical code instead. Bracket/backslash/tilde
// etc. need the Spectrum's EXTENDED mode and are out of scope here.
export const SYMBOL_KEYS = {
  '!': ['SYM', '1'], '@': ['SYM', '2'], '#': ['SYM', '3'], $: ['SYM', '4'], '%': ['SYM', '5'],
  '&': ['SYM', '6'], "'": ['SYM', '7'], '(': ['SYM', '8'], ')': ['SYM', '9'], _: ['SYM', '0'],
  '"': ['SYM', 'P'], ';': ['SYM', 'O'], ':': ['SYM', 'Z'], ',': ['SYM', 'N'], '.': ['SYM', 'M'],
  '=': ['SYM', 'L'], '+': ['SYM', 'K'], '-': ['SYM', 'J'], '*': ['SYM', 'B'], '/': ['SYM', 'V'],
  '?': ['SYM', 'C'], '<': ['SYM', 'R'], '>': ['SYM', 'T'], '^': ['SYM', 'H'], '£': ['SYM', 'X'],
};

/** Map a printable character to its canonical matrix keys, or null if unmapped. */
export function charToKeys(char) {
  return SYMBOL_KEYS[char] ?? null;
}

// Browser KeyboardEvent.code -> the canonical matrix key(s) it produces. Some host
// keys map to a Spectrum combo (e.g. Backspace = CAPS SHIFT + 0 = DELETE). Host
// Shift maps to CAPS SHIFT and Ctrl to SYMBOL SHIFT, so the two Spectrum shifts
// are reachable (needed for EXTENDED mode = CAPS+SYM, e.g. to type BEEP). The
// CAPS from a host Shift used only to *produce a symbol* is dropped in
// resolveMatrix so it does not corrupt the symbol chord.
const CODE_MAP = {
  Enter: ['ENTER'], NumpadEnter: ['ENTER'], Space: ['SPACE'],
  ShiftLeft: ['CAPS'], ShiftRight: ['CAPS'],
  ControlLeft: ['SYM'], ControlRight: ['SYM'], AltRight: ['SYM'],
  Backspace: ['CAPS', '0'], // DELETE
  ArrowLeft: ['CAPS', '5'], ArrowDown: ['CAPS', '6'],
  ArrowUp: ['CAPS', '7'], ArrowRight: ['CAPS', '8'],
};

/** Map a browser KeyboardEvent.code to canonical matrix keys, or null if unmapped. */
export function browserCodeToKeys(code) {
  if (CODE_MAP[code]) return CODE_MAP[code];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return [letter[1]];
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return [digit[1]];
  return null;
}

/**
 * Resolve the full set of currently-pressed canonical matrix keys from the set of
 * held host keys. `held` is any iterable of [code, key] pairs (event.code +
 * event.key). Punctuation is taken from the produced character (SYMBOL SHIFT
 * chords, so "=", "+", '"' work on any layout); everything else from the physical
 * key. The one subtlety: a host Shift held only to type a symbol must NOT also
 * press CAPS SHIFT, or CAPS+SYM would silently drop the machine into EXTENDED
 * mode. So when any symbol is being typed, CAPS coming from a Shift key is
 * dropped — while a Shift held on its own (with no symbol) still gives CAPS, so
 * Shift+Ctrl still enters EXTENDED mode.
 */
export function resolveMatrix(held) {
  const set = new Set();
  const entries = [...held];
  let symbolActive = false;
  for (const [, key] of entries) {
    if (key && key.length === 1 && SYMBOL_KEYS[key]) {
      for (const k of SYMBOL_KEYS[key]) set.add(k);
      symbolActive = true;
    }
  }
  for (const [code, key] of entries) {
    if (key && key.length === 1 && SYMBOL_KEYS[key]) continue; // handled above
    const byCode = browserCodeToKeys(code);
    if (!byCode) continue;
    for (const k of byCode) {
      if (k === 'CAPS' && symbolActive && (code === 'ShiftLeft' || code === 'ShiftRight')) continue;
      set.add(k);
    }
  }
  return set;
}
