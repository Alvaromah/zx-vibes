#!/usr/bin/env node
// Reference 48K keyboard model, authored from documented hardware (the standard
// ZX Spectrum 8x5 matrix, docs/reference/keyboard-input.md) + the host input policy
// (dna/product/keyboard-input.md). It is the conformance model for S5 (R-W8-05): the
// default --module of run-keyboard-fixtures.mjs. Three concerns:
//   - KEY_MATRIX        : Spectrum key -> { row (A8..A15 select line), bit (0..4) }.
//   - browserKeyToSpectrum / matrixByte : the IN (0xFE) half-row read (HOST-IO-
//     PORTFE-READ-001/-READ-BITS-001), and the browser-key -> matrix mapping.
//   - createKeyboard()  : the quick-tap latch (a press+release within one 50 Hz scan
//     stays visible for exactly one scan).

// Hardware: the documented 48K matrix. row r is selected by IN (0xFE) when bit r of
// the port HIGH byte is LOW; bit b (0..4) is the key, outermost key = bit 0.
export const KEY_MATRIX = {
  CAPS_SHIFT: { row: 0, bit: 0 }, Z: { row: 0, bit: 1 }, X: { row: 0, bit: 2 }, C: { row: 0, bit: 3 }, V: { row: 0, bit: 4 },
  A: { row: 1, bit: 0 }, S: { row: 1, bit: 1 }, D: { row: 1, bit: 2 }, F: { row: 1, bit: 3 }, G: { row: 1, bit: 4 },
  Q: { row: 2, bit: 0 }, W: { row: 2, bit: 1 }, E: { row: 2, bit: 2 }, R: { row: 2, bit: 3 }, T: { row: 2, bit: 4 },
  "1": { row: 3, bit: 0 }, "2": { row: 3, bit: 1 }, "3": { row: 3, bit: 2 }, "4": { row: 3, bit: 3 }, "5": { row: 3, bit: 4 },
  "0": { row: 4, bit: 0 }, "9": { row: 4, bit: 1 }, "8": { row: 4, bit: 2 }, "7": { row: 4, bit: 3 }, "6": { row: 4, bit: 4 },
  P: { row: 5, bit: 0 }, O: { row: 5, bit: 1 }, I: { row: 5, bit: 2 }, U: { row: 5, bit: 3 }, Y: { row: 5, bit: 4 },
  ENTER: { row: 6, bit: 0 }, L: { row: 6, bit: 1 }, K: { row: 6, bit: 2 }, J: { row: 6, bit: 3 }, H: { row: 6, bit: 4 },
  SPACE: { row: 7, bit: 0 }, SYMBOL_SHIFT: { row: 7, bit: 1 }, M: { row: 7, bit: 2 }, N: { row: 7, bit: 3 }, B: { row: 7, bit: 4 },
};

// Host input policy (decision:ADR-0016, cross-checked vs the oracle PC_KEY_MAP):
// named browser event.key values and combinations. Single letters/digits map
// directly (case-insensitively) via KEY_MATRIX; cursor keys are CAPS SHIFT + digit.
export const BROWSER_KEY_MAP = {
  Enter: ["ENTER"], " ": ["SPACE"], Shift: ["CAPS_SHIFT"], Control: ["SYMBOL_SHIFT"],
  Backspace: ["CAPS_SHIFT", "0"], Delete: ["CAPS_SHIFT", "0"], Escape: ["CAPS_SHIFT", "SPACE"],
  ArrowLeft: ["CAPS_SHIFT", "5"], ArrowDown: ["CAPS_SHIFT", "6"], ArrowUp: ["CAPS_SHIFT", "7"], ArrowRight: ["CAPS_SHIFT", "8"],
};

export function browserKeyToSpectrum(key) {
  if (Object.prototype.hasOwnProperty.call(BROWSER_KEY_MAP, key)) return BROWSER_KEY_MAP[key];
  if (Object.prototype.hasOwnProperty.call(KEY_MATRIX, key)) return [key];
  const up = typeof key === "string" ? key.toUpperCase() : key;
  if (Object.prototype.hasOwnProperty.call(KEY_MATRIX, up)) return [up];
  return [];
}

// IN (0xFE) read for the half-rows selected by `portHigh` (a 0 bit selects row r),
// given the pressed Spectrum keys. ACTIVE-LOW: a pressed key in a selected row
// clears its bit. Bits 5,7 read 1; bit 6 = EAR (default 1).
export function matrixByte(pressedKeys, portHigh, { ear = 1 } = {}) {
  let keyBits = 0x1f; // bits 0..4 high
  for (const key of pressedKeys ?? []) {
    const k = KEY_MATRIX[key];
    if (!k) continue;
    if (((portHigh >> k.row) & 1) === 0) keyBits &= ~(1 << k.bit) & 0x1f;
  }
  return (keyBits & 0x1f) | 0x20 | 0x80 | ((ear & 1) << 6);
}

// The quick-tap latch. The ROM scans the keyboard once per 50 Hz frame; a press +
// release that both fall between two scans would be missed, so a key released
// before any scan has observed it is latched as pressed for exactly the next scan
// (HOST input policy, the consumer-relied behavior). A key held across a scan is
// released immediately on key-up.
export function createKeyboard() {
  const down = new Set();   // physically held keys
  const seen = new Set();   // held keys a scan has already observed
  let tapLatch = new Set(); // keys released before being scanned: visible one scan
  return {
    keyDown(key) { down.add(key); seen.delete(key); },
    keyUp(key) {
      if (down.has(key) && !seen.has(key)) tapLatch.add(key); // never scanned -> latch
      down.delete(key);
    },
    // One 50 Hz scan: the set of keys the matrix reads as pressed this frame.
    scan() {
      const pressed = new Set([...down, ...tapLatch]);
      for (const k of down) seen.add(k);
      tapLatch = new Set(); // the tap latch lasts exactly one scan
      return pressed;
    },
  };
}
