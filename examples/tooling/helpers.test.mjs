// Headless tests for the pure browser-safe helpers: beeper resampling, the border
// raster timing, the keyboard symbol map and the quick-tap latch. (The full boot
// smoke lives in smoke.test.mjs; the bundle-level flows in tape.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CPU_HZ, FRAME_MS, FRAME_T_STATES, createBeeperStream, renderBeeperSpan, samplesPerFrame,
} from './audio.mjs';
import { BORDER_TOP_T, DISPLAY_START_T, borderRowsFromLog, scanlineStartT } from './render.mjs';
import {
  KEY_MATRIX, PressedKeys, charToKeys, keyboardMatrixByte, browserCodeToKeys, resolveMatrix,
} from './keyboard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Render `frames` whole 48K frames of an edge-free stream; return the sample count. */
function countSamples(sampleRate, frames) {
  const stream = createBeeperStream(0);
  const out = new Float32Array(2048);
  let total = 0;
  for (let f = 0; f < frames; f += 1) {
    total += renderBeeperSpan(stream, [], FRAME_T_STATES, CPU_HZ / sampleRate, 1, out);
  }
  return total;
}

// --- audio ------------------------------------------------------------------

test('beeper: one 48K frame is 19.968 ms and a fractional number of samples', () => {
  assert.ok(Math.abs(FRAME_MS - 19.968) < 1e-9, `FRAME_MS ${FRAME_MS}`);
  assert.ok(Math.abs(samplesPerFrame(48000) - 958.464) < 1e-9);
  assert.ok(Math.abs(samplesPerFrame(44100) - 880.5888) < 1e-9);
});

test('beeper: 200 frames give the fractional-exact sample count (BEEPER-PCM-FRACTIONAL-001)', () => {
  // dna/conformance/audio/audio-duration.json: floor(200 * 69888 * R / 3.5 MHz).
  assert.equal(countSamples(44100, 200), 176117);
  assert.equal(countSamples(48000, 200), 191692);
  // The old fixed 882 / 960 samples per frame drifted to 176400 / 192000.
});

test('beeper: a steady level is a flat DC waveform (no sound)', () => {
  const out = new Float32Array(1200);
  const low = renderBeeperSpan(createBeeperStream(0), [], FRAME_T_STATES, CPU_HZ / 48000, 0.18, out);
  assert.ok(out.subarray(0, low).every((s) => Math.abs(s + 0.18) < 1e-6), 'level 0 -> -amp');
  const high = renderBeeperSpan(createBeeperStream(1), [], FRAME_T_STATES, CPU_HZ / 48000, 0.18, out);
  assert.ok(out.subarray(0, high).every((s) => Math.abs(s - 0.18) < 1e-6), 'level 1 -> +amp');
});

test('beeper: a mid-frame edge splits the frame into two levels', () => {
  const out = new Float32Array(1200);
  const n = renderBeeperSpan(createBeeperStream(0), [34944, 1], FRAME_T_STATES, CPU_HZ / 48000, 1, out);
  assert.ok(out[0] < 0, 'starts low (carry 0)');
  assert.ok(out[n - 1] > 0, 'ends high (after the edge)');
  let flips = 0;
  for (let i = 1; i < n; i += 1) if (Math.sign(out[i]) !== Math.sign(out[i - 1])) flips += 1;
  assert.equal(flips, 1, 'exactly one transition');
});

test('beeper: an edge inside a sample window yields a band-limited middle value', () => {
  // Box filter (anti-alias): a window straddling an edge takes the time-weighted
  // average. With 1000-T samples, an edge a quarter into the first window leaves it
  // 75% high -> 2*0.75-1 = +0.5.
  const out = new Float32Array(4);
  const n = renderBeeperSpan(createBeeperStream(0), [250, 1], 2000, 1000, 1, out);
  assert.equal(n, 2);
  assert.ok(Math.abs(out[0] - 0.5) < 1e-12, `first window ${out[0]}`);
  assert.ok(Math.abs(out[1] - 1) < 1e-12, 'second window is fully high');
});

test('beeper: one continuous grid — a split span renders the same samples (BEEPER-PCM-CONTINUITY-001)', () => {
  const sampleT = CPU_HZ / 44100;
  const edges = [];
  for (let t = 37, level = 1; t < 2 * FRAME_T_STATES; t += 1733, level ^= 1) edges.push(t, level);
  const whole = new Float32Array(4000);
  const wholeN = renderBeeperSpan(createBeeperStream(0), edges, 2 * FRAME_T_STATES, sampleT, 1, whole);
  // The same stream as two frames: the second frame's edges rebased to its start.
  const first = [];
  const second = [];
  for (let i = 0; i < edges.length; i += 2) {
    if (edges[i] < FRAME_T_STATES) first.push(edges[i], edges[i + 1]);
    else second.push(edges[i] - FRAME_T_STATES, edges[i + 1]);
  }
  const stream = createBeeperStream(0);
  const a = new Float32Array(2000);
  const b = new Float32Array(2000);
  const aN = renderBeeperSpan(stream, first, FRAME_T_STATES, sampleT, 1, a);
  const bN = renderBeeperSpan(stream, second, FRAME_T_STATES, sampleT, 1, b);
  assert.equal(aN + bN, wholeN);
  const split = [...a.subarray(0, aN), ...b.subarray(0, bN)];
  for (let i = 0; i < wholeN; i += 1) assert.ok(Math.abs(split[i] - whole[i]) < 1e-6, `sample ${i}`);
  assert.ok(aN === 880 || aN === 881, `a frame spans 880.59 samples, got ${aN}`);
});

test('beeper: the drift controller can stretch the grid without a seam', () => {
  // A steady high level stays exactly +amp across a change of sample width.
  const stream = createBeeperStream(1);
  const out = new Float32Array(2000);
  const n1 = renderBeeperSpan(stream, [], FRAME_T_STATES, (CPU_HZ / 48000) * 1.03, 1, out);
  const n2 = renderBeeperSpan(stream, [], FRAME_T_STATES, (CPU_HZ / 48000) / 1.03, 1, out);
  assert.ok(n1 < 958 && n2 > 959, `squeezed ${n1}, stretched ${n2}`);
  assert.ok(out.subarray(0, n2).every((s) => Math.abs(s - 1) < 1e-9));
});

// --- border raster timing ---------------------------------------------------

test('border rows use the DNA raster anchor (RASTER-TSTATE-PIXEL-001), as the toolkit player does', () => {
  assert.equal(DISPLAY_START_T, 14335);
  assert.equal(BORDER_TOP_T, 8943); // 14335 - 16 - 24*224, not the old 8960
  // pixelTState(0, 24) = 14319: the first display row's line starts at its left border.
  assert.equal(scanlineStartT(24), 14319);
  assert.equal(scanlineStartT(25) - scanlineStartT(24), 224);
  // A border write at 8943 is already on row 0; one at 8944 first shows on row 1.
  assert.equal(borderRowsFromLog([8943, 2], 7)[0], 2);
  const late = borderRowsFromLog([8944, 2], 7);
  assert.equal(late[0], 7);
  assert.equal(late[1], 2);
});

// --- keyboard ---------------------------------------------------------------

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

test('Delete is DELETE and Escape is BREAK (KBD-BROWSERMAP-001)', () => {
  assert.deepEqual(browserCodeToKeys('Delete'), ['CAPS', '0']);
  assert.deepEqual(browserCodeToKeys('Escape'), ['CAPS', 'SPACE']);
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

test('resolveMatrix: a Shift that produced a symbol stays CAPS-free until released', () => {
  const sticky = new Set(['ShiftLeft']);
  assert.deepEqual([...resolveMatrix(held(['ShiftLeft', 'Shift']), sticky)], []);
  assert.deepEqual([...resolveMatrix(held(['ShiftLeft', 'Shift']))], ['CAPS']);
  assert.deepEqual([...resolveMatrix(held(['ShiftRight', 'Shift']), sticky)], ['CAPS']);
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

/** The keys an IN (0xFE) sees during `frame`, probed row by row through keyBits. */
function seen(pressed, frame) {
  const keys = [];
  for (const [key, [row, bit]] of Object.entries(KEY_MATRIX)) {
    if ((pressed.keyBits(~(1 << row) & 0xff, frame) & (1 << bit)) === 0) keys.push(key);
  }
  return keys.sort();
}

test('quick-tap latch: replays the DNA KBD-LATCH-001 fixture', () => {
  const fixture = JSON.parse(readFileSync(
    join(HERE, '..', '..', 'dna', 'conformance', 'keyboard', 'keyboard-latch.json'), 'utf8',
  ));
  // The fixture names the canonical keys CAPS_SHIFT/SYMBOL_SHIFT; its cases use Z and X.
  for (const testCase of fixture.input.cases) {
    const expected = fixture.expected.cases.find((c) => c.name === testCase.name).scans;
    const pressed = new PressedKeys();
    let frame = 0;
    const scans = [];
    for (const event of testCase.events) {
      if (event.op === 'down') pressed.add(event.key);
      else if (event.op === 'up') pressed.delete(event.key);
      else {
        frame += 1; // each scan is a new frame's keyboard read
        const visible = seen(pressed, frame);
        assert.deepEqual([...pressed.visible(frame)].sort(), visible, `${testCase.name}: matrix vs set`);
        scans.push(visible);
      }
    }
    assert.deepEqual(scans, expected.map((s) => [...s].sort()), testCase.name);
  }
});

test('quick-tap latch: every half-row read of the frame sees the tap; held keys are not re-latched', () => {
  const pressed = new PressedKeys();
  pressed.add('B'); // row 7, read last by the ROM
  pressed.delete('B');
  for (let row = 0; row < 7; row += 1) pressed.keyBits(~(1 << row) & 0xff, 1);
  assert.equal(pressed.keyBits(0x7f, 1) & 0x10, 0, 'B still down on the last row of frame 1');
  assert.equal(pressed.keyBits(0x7f, 2), 0x1f, 'and gone in frame 2');
  // hold(): present while held, never latched.
  pressed.hold('CAPS');
  pressed.delete('CAPS');
  assert.equal(pressed.keyBits(0xfe, 3), 0x1f);
  // reset() drops pending taps too.
  pressed.add('A');
  pressed.reset();
  assert.equal(pressed.keyBits(0xfd, 4), 0x1f);
});
