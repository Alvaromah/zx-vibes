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

/**
 * The currently-held canonical matrix keys (`zx.pressed`) with the quick-tap latch of
 * dna/product/keyboard-input.md KBD-LATCH-001. The ROM — and most games — scan the
 * keyboard once per 50 Hz frame, so a key pressed AND released between two scans
 * would never be seen if the matrix only followed the live set. Here every key that
 * goes down (is added) is also buffered as a tap; the first keyboard read of the next
 * frame starts a new scan that sees the live keys plus those taps, and the taps retire
 * when the following scan starts. So a quick tap is visible for exactly one scan, a
 * held key for every scan it spans, and a release of a key that is not down has no
 * effect (nothing is ever latched by a release).
 *
 * It IS the live Set — pages may add/delete/clear keys directly, as before — and it
 * answers the matrix read itself: `keyBits(highByte, frame)`, where `frame` is the
 * machine's frame counter (a change of frame = a new scan). The per-row masks are
 * computed once per scan or change, so the many IN (0xFE) reads of a frame allocate
 * nothing.
 */
export class PressedKeys extends Set {
  constructor() {
    super();
    this._taps = new Set(); // went down since the current scan began
    this._scanTaps = new Set(); // taps the current scan shows
    this._scanFrame = undefined;
    this._masks = new Uint8Array(8).fill(0x1f);
    this._dirty = true;
  }

  /** Press `key`: held from now on, and latched for the next scan (a quick tap). */
  add(key) {
    if (!this.has(key)) {
      super.add(key);
      if (this._taps) this._taps.add(key); // (undefined while super() runs)
      this._dirty = true;
    }
    return this;
  }

  /**
   * Hold `key` WITHOUT latching it: for a modifier a host key contributes only as a
   * side effect (the CAPS SHIFT from a host Shift), whose sub-frame pulses are not
   * taps — latching one next to a symbol chord would read as EXTENDED mode.
   */
  hold(key) {
    if (!this.has(key)) {
      super.add(key);
      this._dirty = true;
    }
    return this;
  }

  delete(key) {
    const had = super.delete(key);
    if (had) this._dirty = true;
    return had;
  }

  clear() {
    if (this.size > 0) this._dirty = true;
    super.clear();
  }

  /** Forget everything, latched taps included (a machine reset / snapshot load). */
  reset() {
    this.clear();
    this._taps.clear();
    this._scanTaps.clear();
    this._dirty = true;
  }

  /** The keys the scan of `frame` sees: held now, plus the taps it latched. */
  visible(frame) {
    this._sync(frame);
    return new Set([...this, ...this._scanTaps]);
  }

  /** Key bits (b0..b4) of an IN (0xFE) with port high byte `highByte` during `frame`. */
  keyBits(highByte, frame) {
    this._sync(frame);
    if (this._dirty) {
      this._masks.fill(0x1f);
      for (const set of [this, this._scanTaps]) {
        for (const key of set) {
          const cell = KEY_MATRIX[key];
          if (cell) this._masks[cell[0]] &= ~(1 << cell[1]) & 0x1f;
        }
      }
      this._dirty = false;
    }
    let bits = 0x1f;
    for (let row = 0; row < 8; row += 1) {
      if (((highByte >> row) & 1) === 0) bits &= this._masks[row];
    }
    return bits;
  }

  /** A read in a new frame starts a new scan: its taps become the scan's, the old retire. */
  _sync(frame) {
    if (frame === this._scanFrame) return;
    this._scanFrame = frame;
    const retired = this._scanTaps;
    this._scanTaps = this._taps;
    this._taps = retired;
    this._taps.clear();
    this._dirty = true;
  }
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
// keys map to a Spectrum combo (dna/product/keyboard-input.md KBD-BROWSERMAP-001:
// Backspace/Delete = CAPS SHIFT + 0 = DELETE, Escape = CAPS SHIFT + SPACE = BREAK,
// the arrows = CAPS SHIFT + 5..8). Host Shift maps to CAPS SHIFT and Ctrl to SYMBOL
// SHIFT, so the two Spectrum shifts are reachable (needed for EXTENDED mode =
// CAPS+SYM, e.g. to type BEEP). The CAPS from a host Shift used only to *produce a
// symbol* is dropped in resolveMatrix so it does not corrupt the symbol chord.
const CODE_MAP = {
  Enter: ['ENTER'], NumpadEnter: ['ENTER'], Space: ['SPACE'],
  ShiftLeft: ['CAPS'], ShiftRight: ['CAPS'],
  ControlLeft: ['SYM'], ControlRight: ['SYM'], AltRight: ['SYM'],
  Backspace: ['CAPS', '0'], Delete: ['CAPS', '0'], // DELETE
  Escape: ['CAPS', 'SPACE'], // BREAK
  ArrowLeft: ['CAPS', '5'], ArrowDown: ['CAPS', '6'],
  ArrowUp: ['CAPS', '7'], ArrowRight: ['CAPS', '8'],
};

/** True for the two host Shift keys (by KeyboardEvent.code). */
export function isShiftCode(code) {
  return code === 'ShiftLeft' || code === 'ShiftRight';
}

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
 * dropped — and, via `stickyShiftCodes`, for the rest of a Shift hold that has
 * already produced a symbol: releasing the symbol key a few milliseconds before
 * the Shift (every host does) would otherwise pulse CAPS into the same scan as the
 * latched chord. A Shift held on its own (no symbol involved) still gives CAPS, so
 * Shift+Ctrl still enters EXTENDED mode.
 */
export function resolveMatrix(held, stickyShiftCodes) {
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
      if (k === 'CAPS' && isShiftCode(code) && (symbolActive || stickyShiftCodes?.has(code))) continue;
      set.add(k);
    }
  }
  return set;
}
