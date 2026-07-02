// Headless tests for the pure browser-safe helpers: beeper resampling and the
// keyboard symbol map. (The full boot smoke lives in smoke.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beeperSamples } from './audio.mjs';
import { charToKeys, keyboardMatrixByte, browserCodeToKeys, resolveMatrix } from './keyboard.mjs';

test('beeper: a steady level is a flat DC waveform (no sound)', () => {
  const low = beeperSamples([], 0, 100);
  const high = beeperSamples([], 1, 100);
  assert.ok(low.every((s) => s < 0), 'level 0 -> all negative');
  assert.ok(high.every((s) => s > 0), 'level 1 -> all positive');
});

test('beeper: a mid-frame edge splits the frame into two levels', () => {
  // One edge to high at ~half the frame (69888 / 2 = 34944 T-states).
  const s = beeperSamples([34944, 1], 0, 100);
  assert.ok(s[0] < 0, 'starts low (carry 0)');
  assert.ok(s[99] > 0, 'ends high (after the edge)');
  const flips = s.reduce((n, v, i) => n + (i > 0 && Math.sign(v) !== Math.sign(s[i - 1]) ? 1 : 0), 0);
  assert.equal(flips, 1, 'exactly one transition');
});

test('beeper: an edge inside a sample window yields a band-limited middle value', () => {
  // Box-filter (anti-alias): a window straddling an edge must not snap to a full
  // step — it takes the time-weighted average of the two levels. With count=2 the
  // frame splits into two 34944-T windows; put the low->high edge a quarter of the
  // way into the first window, so the remaining 75% of that window is high ->
  // amp*(2*0.75-1) = +amp/2.
  const s = beeperSamples([34944 / 4, 1], 0, 2, 1);
  assert.ok(Math.abs(s[0] - 0.5) < 1e-9, 'first window is 75% high -> +0.5');
  assert.ok(Math.abs(s[1] - 1) < 1e-9, 'second window is fully high -> +1');
});

test('symbols: punctuation maps to SYMBOL SHIFT chords', () => {
  assert.deepEqual(charToKeys('='), ['SYM', 'L']);
  assert.deepEqual(charToKeys('+'), ['SYM', 'K']);
  assert.deepEqual(charToKeys('"'), ['SYM', 'P']);
  assert.deepEqual(charToKeys('?'), ['SYM', 'C']);
  assert.deepEqual(charToKeys('('), ['SYM', '8']);
  assert.equal(charToKeys('a'), null, 'letters are direct keys, not symbols');
  assert.equal(charToKeys('1'), null, 'digits are direct keys, not symbols');
});

test('symbols: "=" reads as SYM+L across both half-rows', () => {
  const pressed = new Set(charToKeys('=')); // SYM (row7,bit1) + L (row6,bit1)
  // Half-row 6 selected (bit6 low): L should pull bit1 low -> 0x1d.
  assert.equal(keyboardMatrixByte(pressed, 0xbf) & 0x1f, 0x1d);
  // Half-row 7 selected (bit7 low): SYM should pull bit1 low -> 0x1d.
  assert.equal(keyboardMatrixByte(pressed, 0x7f) & 0x1f, 0x1d);
});

test('the two Spectrum shifts are reachable (Shift=CAPS, Ctrl=SYM)', () => {
  assert.deepEqual(browserCodeToKeys('ShiftLeft'), ['CAPS']);
  assert.deepEqual(browserCodeToKeys('ControlLeft'), ['SYM']);
  assert.deepEqual(browserCodeToKeys('Backspace'), ['CAPS', '0']);
});

const held = (...pairs) => new Map(pairs); // [code, key] pairs

test('resolveMatrix: a bare symbol key is a clean SYM chord', () => {
  assert.deepEqual([...resolveMatrix(held(['Equal', '=']))].sort(), ['L', 'SYM']);
});

test('resolveMatrix: a Shifted symbol drops the incidental CAPS', () => {
  // "+" on a US layout is Shift+Equal; the CAPS from Shift must not leak in, or
  // CAPS+SYM would be EXTENDED mode.
  const keys = resolveMatrix(held(['ShiftLeft', 'Shift'], ['Equal', '+']));
  assert.deepEqual([...keys].sort(), ['K', 'SYM']);
  assert.ok(!keys.has('CAPS'), 'no CAPS while typing a symbol');
});

test('resolveMatrix: Shift+Ctrl still enters EXTENDED mode (CAPS+SYM)', () => {
  const keys = resolveMatrix(held(['ShiftLeft', 'Shift'], ['ControlLeft', 'Control']));
  assert.deepEqual([...keys].sort(), ['CAPS', 'SYM']);
});

test('resolveMatrix: EXTENDED + SYM + Z is the BEEP entry chord', () => {
  // How a user types BEEP: enter E-mode (CAPS+SYM), then SYMBOL SHIFT + Z.
  const emode = resolveMatrix(held(['ShiftLeft', 'Shift'], ['ControlLeft', 'Control']));
  assert.deepEqual([...emode].sort(), ['CAPS', 'SYM']);
  const beep = resolveMatrix(held(['ControlLeft', 'Control'], ['KeyZ', 'z']));
  assert.deepEqual([...beep].sort(), ['SYM', 'Z']);
});
