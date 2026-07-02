// Headless proof that the browser bundle's tape + joystick wiring works end-to-end:
// type LOAD "" on the real ROM, play the sample tape embedded in full.html, and assert
// the program actually loaded and ran (blue PAPER, printed text, border set). Also checks
// the Kempston port decode. No browser, no canvas — it drives create() directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZ80 } from '@zx-vibes/machine';
import { create } from './browser-entry.mjs';
import { beeperSamples } from './audio.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// The sample tape lives base64-embedded in full.html — decode it there so the test guards
// the very bytes the demo ships.
function sampleTapeBytes() {
  const html = readFileSync(join(HERE, '..', 'full.html'), 'utf8');
  const b64 = /SAMPLE_B64 = '([^']+)'/.exec(html)[1];
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

// The sample program's screen: BORDER 1 (blue), PAPER 1 + CLS (blue paper everywhere),
// and two PRINT lines (ink pixels). Asserts the machine actually loaded and ran it.
function assertSampleRan(zx) {
  assert.equal(zx.border, 1, 'border should be blue (BORDER 1)');
  const attrs = zx.machine.memory.subarray(0x5800, 0x5b00); // 768 cells
  let bluePaper = 0;
  for (const b of attrs) if (((b >> 3) & 0x07) === 1) bluePaper += 1;
  assert.ok(bluePaper > 700, `expected a blue-paper screen, got ${bluePaper}/768 cells`);
  const display = zx.machine.memory.subarray(0x4000, 0x5800);
  let setPixels = 0;
  for (const b of display) { let v = b; while (v) { setPixels += v & 1; v >>= 1; } }
  assert.ok(setPixels > 100, `expected printed text (>100 set pixels), got ${setPixels}`);
}

// Mirrors full.html's loadAndRun: reset, idle, a priming CAPS tap (the ROM swallows the
// first keystroke after a reboot), then LOAD "" and play. Guards that exact flow.
function bootTypeLoadPlay(bytes) {
  const zx = create();
  const run = (n) => { for (let i = 0; i < n; i += 1) zx.machine.runFrame(); };
  const type = (steps) => {
    for (const keys of steps) {
      zx.pressed.clear(); for (const k of keys) zx.pressed.add(k); run(4);
      zx.pressed.clear(); run(8);
    }
  };
  run(120);
  zx.reset();
  run(100);                                              // ~2 s idle after the reboot
  type([['CAPS']]);                                      // prime: absorb the first-key drop
  type([['J'], ['SYM', 'P'], ['SYM', 'P'], ['ENTER']]); // LOAD ""
  zx.insertTape(bytes);
  zx.playTape();
  run(600);                                              // ~12 s: pilot + data + run
  return zx;
}

test('LOAD "" loads and runs the embedded sample tape through the real ROM', () => {
  const zx = bootTypeLoadPlay(sampleTapeBytes());
  assertSampleRan(zx);
  assert.equal(zx.isTapePlaying(), false, 'tape should have finished');
});

test('fastLoadTape loads the sample without a real-time wait', async () => {
  const zx = create();
  await zx.fastLoadTape(sampleTapeBytes(), { name: 'zx vibes' });
  assertSampleRan(zx);
  assert.equal(zx.isTapePlaying(), false, 'the fast load ran the tape to its end');
});

test('a .z80 snapshot round-trips: writeZ80 of a loaded state, then loadSnapshot', async () => {
  // Produce a real running state by fast-loading the sample, freeze it to .z80…
  const src = create();
  await src.fastLoadTape(sampleTapeBytes(), { name: 'zx vibes' });
  const z80 = writeZ80({ registers: src.machine.registers, memory: src.machine.memory, border: src.border });

  // …then restore it into a fresh machine and let it resume.
  const zx = create();
  const run = (n) => { for (let i = 0; i < n; i += 1) zx.machine.runFrame(); };
  run(60);
  zx.loadSnapshot(z80);
  run(60);
  assertSampleRan(zx);            // same screen the snapshot froze
  // The ROM must be kept in place (loadSnapshot only overlays RAM), else nothing runs.
  assert.equal(zx.machine.memory[0x0000], src.machine.memory[0x0000], 'ROM preserved');
});

test('the loading sound mixes the tape tone into the audio buffer', () => {
  // _mixTapeAudio is what makes a load audible: it samples the tape EAR level across a
  // frame. During the pilot tone the level toggles, so the buffer must swing both ways.
  const zx = create();
  const run = (n) => { for (let i = 0; i < n; i += 1) zx.machine.runFrame(); };
  run(50);
  zx.insertTape(sampleTapeBytes());
  zx.playTape();
  run(60);            // skip the ~1 s leading gap — land inside the pilot tone
  zx._advance();      // establishes _frameT0 for the frame we sample (audio pump is a no-op headless)
  const buf = new Float32Array(960);
  zx._mixTapeAudio(buf, 960);
  let pos = 0, neg = 0;
  for (const s of buf) { if (s > 0.05) pos += 1; else if (s < -0.05) neg += 1; }
  assert.ok(pos > 0 && neg > 0, `pilot tone should swing both ways (pos=${pos}, neg=${neg})`);
});

test('fastLoadTape stays audio-quiet, then leaves a clean state for the game beeper', async () => {
  // Regression for the "no game sound after a fast load" bug: the fast-forward must NOT
  // pump audio (it would flood the ring the audio thread can't drain, muting the game),
  // and it must hand back a clean, non-playing state so the loaded program's beeper runs.
  const zx = create();
  await zx.fastLoadTape(sampleTapeBytes(), { name: 'zx vibes' });
  assertSampleRan(zx);
  assert.equal(zx.isTapePlaying(), false, 'tape must be stopped so it stops mixing audio');
  assert.equal(zx._beeperLog.length, 0, 'beeper log cleared — the next frame starts fresh');
});

test('fastLoadTape survives a tape longer than any fixed guard (budget from tape length)', async () => {
  // Regression for the "R Tape loading error" on real games: the old fixed 6000-frame
  // guard (~2 min of tape) stopped a longer stream mid-load. Pad the sample with leading
  // pure tone until the stream is ~4 min long; the load must still complete.
  const zx = create();
  const tap = sampleTapeBytes();
  // A TZX with a long pure-tone block (id 0x12) before the standard-speed sample blocks.
  const header = [...'ZXTape!'].map((c) => c.charCodeAt(0)).concat([0x1a, 1, 20]);
  const tone = [0x12, 0x28, 0x08, 0xff, 0xff]; // 2168-T pulses × 65535 ≈ 40 s of pilot
  const blocks = [];
  let off = 0;
  while (off < tap.length) {                    // wrap each .tap block as TZX id 0x10
    const len = tap[off] | (tap[off + 1] << 8);
    blocks.push(0x10, 0xe8, 0x03, tap[off], tap[off + 1], ...tap.subarray(off + 2, off + 2 + len));
    off += 2 + len;
  }
  const long = Uint8Array.from([...header, ...tone, ...tone, ...tone, ...tone, ...tone, ...blocks]);
  await zx.fastLoadTape(long, { name: 'long' });
  assertSampleRan(zx);                          // loaded despite ~3.5 min of leader tone
});

test('OUTs toggling EAR and MIC together still reach the speaker (weighted mix, not XOR)', () => {
  // Regression for silent in-game sound: a common game beeper routine flips bits 4 and 3
  // in phase (OUT 0x18 / OUT 0x00). An XOR model cancels that to constant 0 — silence.
  // The weighted EAR+MIC sum must log two distinct levels instead.
  const zx = create();
  zx.machine.io.write(0x00fe, 0x18);
  zx.machine.io.write(0x00fe, 0x00);
  assert.equal(zx._beeperLog.length, 4, 'both OUTs must log a level change');
  assert.equal(zx._beeperLog[1], 1, 'EAR+MIC high = full level');
  assert.equal(zx._beeperLog[3], 0, 'both low = zero level');
});

test('beeperSamples turns bit-4 toggles into an audible swing (the in-game beeper path)', () => {
  // The game's sound reaches the speaker through beeperSamples, a separate path from the
  // tape loading sound. Guard it directly: a square wave of OUT (0xFE) bit-4 edges across
  // one 50 Hz frame must resample to a buffer that swings both above and below zero.
  const log = [];
  let level = 0;
  for (let t = 0; t < 69888; t += 1400) { log.push(t, level); level ^= 1; } // ~1 kHz square
  const buf = beeperSamples(log, 0, 960, 0.18);
  let pos = 0, neg = 0;
  for (const s of buf) { if (s > 0.05) pos += 1; else if (s < -0.05) neg += 1; }
  assert.ok(pos > 0 && neg > 0, `in-game beeper should swing both ways (pos=${pos}, neg=${neg})`);
});

test('a real-world .tzx (metadata, loops, stop-in-48K blocks) still loads', async () => {
  // Regression for ".tzx files don't work": real tapes carry blocks beyond the audio
  // set — archive info 0x32, text 0x30, hardware 0x33, loops 0x24/0x25, stop-in-48K
  // 0x2A — and the strict parseTzx codec rejects them all, so nothing ever loaded.
  // Build a TZX dressed like a real release around the sample's data blocks.
  const tap = sampleTapeBytes();
  const bytes = [...'ZXTape!'].map((c) => c.charCodeAt(0)).concat([0x1a, 1, 20]);
  bytes.push(0x32, 8, 0, 1, 0x00, 5, ...'title'.split('').map((c) => c.charCodeAt(0))); // archive info
  bytes.push(0x30, 4, ...'demo'.split('').map((c) => c.charCodeAt(0)));                 // text description
  bytes.push(0x21, 3, ...'grp'.split('').map((c) => c.charCodeAt(0)));                  // group start
  bytes.push(0x24, 2, 0);                                     // loop ×2 around a short tone
  bytes.push(0x12, 0x78, 0x08, 100, 0);                       // pure tone, 100 pilot pulses
  bytes.push(0x25);                                           // loop end
  let off = 0;
  while (off < tap.length) {                                  // the sample as 0x10 blocks
    const len = tap[off] | (tap[off + 1] << 8);
    bytes.push(0x10, 0xe8, 0x03, tap[off], tap[off + 1], ...tap.subarray(off + 2, off + 2 + len));
    off += 2 + len;
  }
  bytes.push(0x22);                                           // group end
  bytes.push(0x2a, 0, 0, 0, 0);                               // stop the tape in 48K mode
  bytes.push(0x33, 1, 0, 0, 0);                               // hardware type
  const zx = create();
  await zx.fastLoadTape(Uint8Array.from(bytes), { name: 'dressed' });
  assertSampleRan(zx);
});

test('host keys the Spectrum has no key for (F12, F5) are not claimed', () => {
  // Regression for "F12 and other keys are disabled": _keyDown preventDefault'ed every
  // key, so DevTools/reload were dead. Only keys that reach the matrix may be claimed.
  const zx = create();
  const ev = (code, key) => ({ code, key, prevented: false, preventDefault() { this.prevented = true; } });
  const f12 = ev('F12', 'F12');
  zx._keyDown(f12);
  assert.equal(f12.prevented, false, 'F12 must pass through to the browser');
  assert.equal(zx.pressed.size, 0, 'and must not touch the matrix');
  const f12up = ev('F12', 'F12');
  zx._keyUp(f12up);
  assert.equal(f12up.prevented, false, 'nor its keyup');
  const a = ev('KeyA', 'a');
  zx._keyDown(a);
  assert.equal(a.prevented, true, 'a mapped key is claimed');
  assert.ok(zx.pressed.has('A'), 'and pressed on the matrix');
});

test('audio falls back to ScriptProcessor when the worklet module never settles', async () => {
  // Regression for total silence on file:// pages: Chrome's audioWorklet.addModule
  // doesn't reject there — it NEVER SETTLES — so without the 500 ms deadline no
  // consumer is ever wired and _pumpAudio discards everything forever.
  class FakeCtx {
    constructor() {
      this.sampleRate = 48000;
      this.state = 'running';
      this.destination = {};
      this.audioWorklet = { addModule: () => new Promise(() => {}) }; // hangs, like file://
    }
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, connect() {} }; }
    createScriptProcessor(size) { return { bufferSize: size, onaudioprocess: null, connect() {} }; }
    resume() {}
  }
  globalThis.window = { AudioContext: FakeCtx };
  globalThis.AudioWorkletNode = class {}; // make the worklet branch get attempted
  try {
    const zx = create();
    zx._sound = true;
    zx._enableAudio();
    assert.equal(zx._node, null, 'no consumer yet — the worklet load is pending');
    await new Promise((r) => setTimeout(r, 650)); // past the 500 ms deadline
    assert.ok(zx._node, 'the deadline must wire a consumer despite the hung addModule');
    assert.ok(zx._ring, 'and it must be the ScriptProcessor ring');
  } finally {
    delete globalThis.window;
    delete globalThis.AudioWorkletNode;
  }
});

test('the Kempston joystick reads active-high 000FUDLR on port 0x1F', () => {
  const zx = create();
  zx.setJoystick({ fire: true, right: true });
  assert.equal(zx.machine.io.read(0x001f), 0x11, 'FIRE|RIGHT');
  zx.setJoystick({ up: true, left: true });
  assert.equal(zx.machine.io.read(0x7f1f), 0x0a, 'UP|LEFT, high byte ignored');
  zx.setJoystick({});
  assert.equal(zx.machine.io.read(0x001f), 0x00, 'idle');
});

test('unmapped port INs read the floating bus, following the ULA beam', () => {
  const zx = create();
  const mem = zx.machine.memory;
  mem[0x4000] = 0x55; mem[0x4001] = 0x66;         // bitmap, line 0, cols 0-1
  mem[0x5800] = 0x47; mem[0x5801] = 0x38;         // attrs, row 0, cols 0-1
  const DISPLAY_START_T = 64 * 224;
  // Simulate a beam position by back-dating the frame origin, then IN from an
  // odd port nobody decodes (0x00FF — what Cobra and Arkanoid actually poll).
  const busAt = (t) => {
    zx._frameT0 = zx.machine.tStatesTotal - t;
    return zx.machine.io.read(0x00ff);
  };
  assert.equal(busAt(100), 0xff, 'top border: bus idle');
  assert.equal(busAt(DISPLAY_START_T + 0), 0x55, 'fetch slot 0: bitmap col 0');
  assert.equal(busAt(DISPLAY_START_T + 1), 0x47, 'fetch slot 1: attr col 0');
  assert.equal(busAt(DISPLAY_START_T + 2), 0x66, 'fetch slot 2: bitmap col 1');
  assert.equal(busAt(DISPLAY_START_T + 3), 0x38, 'fetch slot 3: attr col 1');
  assert.equal(busAt(DISPLAY_START_T + 5), 0xff, 'idle half of the 8 T pattern');
  assert.equal(busAt(DISPLAY_START_T + 150), 0xff, 'right border of the line');
  assert.equal(busAt(DISPLAY_START_T + 224 * 192), 0xff, 'bottom border');
});

test('a Cobra-style beam-sync spin on IN A,(0xFF) terminates (the in-game hang)', () => {
  // Cobra freezes seconds into play spinning on IN A,(0xFF) until a known
  // attribute byte drifts past on the floating bus; a hard 0xFF answer spins it
  // forever. Same loop shape, distilled:
  //   DI / loop: LD A,0 / IN A,(0xFF) / CP 0x47 / JR NZ,loop / LD (0xC000),A / JR $
  const zx = create();
  const mem = zx.machine.memory;
  mem.fill(0x00, 0x4000, 0x5800);   // bitmap can never match the marker
  mem.fill(0x47, 0x5800, 0x5b00);   // every attribute is the marker the loop waits for
  mem.set([0xf3, 0x3e, 0x00, 0xdb, 0xff, 0xfe, 0x47, 0x20, 0xf8, 0x32, 0x00, 0xc0, 0x18, 0xfe], 0x8000);
  mem[0xc000] = 0;
  zx.machine.registers.pc = 0x8000;
  zx.machine.registers.iff1 = 0;
  for (let i = 0; i < 5 && mem[0xc000] === 0; i += 1) zx.machine.runFrame();
  assert.equal(mem[0xc000], 0x47, 'the spin loop should see the attribute byte and exit');
});
