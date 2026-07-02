// The browser entry point bundled into examples/zxspectrum.js (global `ZXSpectrum`).
//
// A tiny, friendly wrapper around @zx-vibes/machine: boot the real 48K ROM, render
// the screen to a <canvas> at 50 Hz, and drive the keyboard matrix from host key
// events. The ROM is embedded (base64) at build time, so a page using this needs
// no fetch, no server, no install — it works from a double-clicked file.
//
//   const zx = ZXSpectrum.create();
//   zx.attach(document.querySelector('canvas')).start();

import {
  createMachine, RESET_REGISTERS,
  parseTap, tapChecksum, blockToPulses, createTapeDeck,
  kempstonByte, kempstonDecodes, readZ80,
} from '@zx-vibes/machine';
import { ROM_BASE64 } from './rom-data.generated.mjs';
import {
  renderWithBorderRows, borderRowsFromLog, OUT_WIDTH, OUT_HEIGHT,
} from './render.mjs';
import { keyboardMatrixByte, resolveMatrix, browserCodeToKeys, charToKeys } from './keyboard.mjs';
import { beeperSamples, FRAME_T_STATES } from './audio.mjs';

// Tape → EAR pulse stream. A tape is played into port 0xFE bit 6, exactly the line
// the real ROM LD-BYTES samples, so the machine loads a `.tap`/`.tzx` with no traps:
// the user types LOAD "" and the ROM does the rest (with the loading border stripes).
const T_PER_MS = 3500;            // 3.5 MHz → T-states per millisecond (TZX pauses are ms)
const GAP_T = 1_000 * T_PER_MS;   // ~1 s flat gap around/between blocks (also the closing edge)

// Append `count` bit-pulse pairs for each byte (MSB first) using the given 0/1 pulse
// lengths; `usedBits` limits the LAST byte (TZX turbo / pure-data).
function pushBits(out, data, zeroLen, oneLen, usedBits) {
  for (let i = 0; i < data.length; i += 1) {
    const byte = data[i] & 0xff;
    const bits = i === data.length - 1 && usedBits ? usedBits : 8;
    for (let b = 7; b >= 8 - bits; b -= 1) {
      const len = (byte >> b) & 1 ? oneLen : zeroLen;
      out.push(len, len);
    }
  }
}

// A `.tap` (flat block stream) → one playable pulse list: a gap, then every block's
// standard pilot/sync/data pulses (blockToPulses), each followed by a gap. The gap after
// a block is also the closing edge its final bit needs (TAPE-EDGE-TRAILING-001).
function tapToPulses(bytes) {
  const pulses = [GAP_T];
  for (const { flag, data } of parseTap(bytes)) {
    const body = Uint8Array.from([flag, ...data, tapChecksum(flag, data)]);
    for (const p of blockToPulses(body)) pulses.push(p);
    pulses.push(GAP_T);
  }
  return pulses;
}

// A `.tzx` (versioned block stream) → a playable pulse list. This walks the raw block
// stream itself rather than going through the strict parseTzx codec: real-world tapes
// nearly always carry metadata/control blocks beyond the core audio set — archive info
// (0x32), hardware type (0x33), loops (0x24/0x25), stop-in-48K (0x2A) — and the strict
// codec rejects any of them outright, so no real game .tzx would ever load. The walker
// turns every audio-bearing block into pulses, honours loops, and skips the rest;
// unknown IDs are skipped via the spec's forward-compat rule (a DWORD body length).
function tzxToPulses(bytes) {
  const u8 = (o) => bytes[o] & 0xff;
  const u16 = (o) => (bytes[o] | (bytes[o + 1] << 8)) & 0xffff;
  const u24 = (o) => bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
  const u32 = (o) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
  const pulses = [GAP_T];
  const pausePulse = (ms) => pulses.push(Math.max(ms, 1) * T_PER_MS);
  let i = 10; // past the "ZXTape!" header
  let loopStart = -1;
  let loopLeft = 0;
  while (i < bytes.length) {
    const id = u8(i);
    i += 1;
    switch (id) {
      case 0x10: { // standard-speed data (ROM timings via blockToPulses)
        const pause = u16(i);
        const len = u16(i + 2);
        for (const p of blockToPulses(bytes.subarray(i + 4, i + 4 + len))) pulses.push(p);
        i += 4 + len;
        pausePulse(pause);
        break;
      }
      case 0x11: { // turbo data (timings from the block itself)
        const pilot = u16(i), sync1 = u16(i + 2), sync2 = u16(i + 4);
        const zero = u16(i + 6), one = u16(i + 8), pilotPulses = u16(i + 10);
        const usedBits = u8(i + 12), pause = u16(i + 13), len = u24(i + 15);
        for (let p = 0; p < pilotPulses; p += 1) pulses.push(pilot);
        pulses.push(sync1, sync2);
        pushBits(pulses, bytes.subarray(i + 18, i + 18 + len), zero, one, usedBits);
        i += 18 + len;
        pausePulse(pause);
        break;
      }
      case 0x12: { // pure tone
        const len = u16(i), count = u16(i + 2);
        for (let p = 0; p < count; p += 1) pulses.push(len);
        i += 4;
        break;
      }
      case 0x13: { // pulse sequence
        const count = u8(i);
        for (let p = 0; p < count; p += 1) pulses.push(u16(i + 1 + 2 * p));
        i += 1 + 2 * count;
        break;
      }
      case 0x14: { // pure data (no pilot/sync)
        const zero = u16(i), one = u16(i + 2), usedBits = u8(i + 4);
        const pause = u16(i + 5), len = u24(i + 7);
        pushBits(pulses, bytes.subarray(i + 10, i + 10 + len), zero, one, usedBits);
        i += 10 + len;
        pausePulse(pause);
        break;
      }
      case 0x15: { // direct recording: runs of equal sample bits become pulses
        const tps = u16(i), pause = u16(i + 2), usedBits = u8(i + 4), len = u24(i + 5);
        const data = bytes.subarray(i + 8, i + 8 + len);
        i += 8 + len;
        const bits = len > 0 ? (len - 1) * 8 + (usedBits || 8) : 0;
        let run = 0, prev = -1;
        for (let b = 0; b < bits; b += 1) {
          const bit = (data[b >> 3] >> (7 - (b & 7))) & 1;
          if (bit === prev) run += 1;
          else { if (run) pulses.push(run * tps); prev = bit; run = 1; }
        }
        if (run) pulses.push(run * tps);
        pausePulse(pause);
        break;
      }
      case 0x20: { // pause; 0 = "stop the tape" (modelled as a long gap)
        const pause = u16(i);
        i += 2;
        pulses.push(pause > 0 ? pause * T_PER_MS : GAP_T);
        break;
      }
      case 0x21: i += 1 + u8(i); break;        // group start (name) — metadata
      case 0x22: break;                        // group end
      case 0x23: i += 2; break;                // jump — control flow not modelled
      case 0x24: loopLeft = u16(i); i += 2; loopStart = i; break; // loop start
      case 0x25:                               // loop end: replay from loop start
        if (loopLeft > 1) { loopLeft -= 1; i = loopStart; }
        else { loopLeft = 0; loopStart = -1; }
        break;
      case 0x26: i += 2 + 2 * u16(i); break;   // call sequence — not modelled
      case 0x27: break;                        // return from sequence
      case 0x28: i += 2 + u16(i); break;       // select — interactive metadata
      case 0x30: i += 1 + u8(i); break;        // text description
      case 0x31: i += 2 + u8(i + 1); break;    // message (display time + text)
      case 0x32: i += 2 + u16(i); break;       // archive info
      case 0x33: i += 1 + 3 * u8(i); break;    // hardware type (3 bytes per entry)
      case 0x34: i += 8; break;                // emulation info (deprecated, fixed 8)
      case 0x35: i += 20 + u32(i + 16); break; // custom info (16-char id + DWORD len)
      case 0x40: i += 4 + u24(i + 1); break;   // snapshot (deprecated: type + 3-byte len)
      case 0x5a: i += 9; break;                // glue (a concatenated TZX header)
      default: i += 4 + u32(i); break;         // spec rule: unknown IDs carry a DWORD length
    }
  }
  return pulses;
}

// Detect the container by signature ("ZXTape!" = TZX) and build its pulse stream.
function tapeFileToPulses(bytes) {
  const isTzx = bytes.length >= 7 &&
    bytes[0] === 0x5a && bytes[1] === 0x58 && bytes[2] === 0x54 && bytes[3] === 0x61 &&
    bytes[4] === 0x70 && bytes[5] === 0x65 && bytes[6] === 0x21;
  return isTzx ? tzxToPulses(bytes) : tapToPulses(bytes);
}

const SCREEN_BASE = 0x4000;
const SCREEN_SIZE = 6912;

// Display beam timing for the floating bus (48K ULA): the maskable interrupt is
// T-state 0 of the frame, the first pixel line starts 64 border lines later, and
// every line is 224 T of which the first 128 carry the ULA's screen fetches.
const LINE_T_STATES = 224;
const DISPLAY_START_T = 64 * LINE_T_STATES;

// Audio ring buffer capacity (power of two, so wrap is a bitmask). ~16k samples
// is ~340 ms at 48 kHz — plenty of slack to absorb render-loop jitter without
// adding much latency. The producer (emulation) drops samples when it is full and
// the consumer (audio callback) holds the last sample when it is empty, so drift
// between the two clocks never turns into clicks.
const RING_SIZE = 1 << 14;

// Beeper amplitude: beeperSamples maps level 0/1 to -AMP/+AMP. Ring priming uses
// the same values so starting, resetting, or re-enabling audio never steps the
// output level (a step is an audible click).
const AMP = 0.18;

// Loading-sound amplitude: while a tape plays, its EAR pulse level is mixed into the
// output so you hear the pilot tone and data screech, as on real hardware. A touch
// below AMP so it sits under the beeper rather than dominating.
const TAPE_AMP = 0.14;

// The AudioWorklet processor: the ring buffer consumer, running on the audio
// thread. Kept as source text and loaded from a blob: URL so the bundle stays a
// single classic script (no module file to fetch — required for file:// pages).
// Protocol — in: a Float32Array queues samples; {flush, level?} empties the
// queue (and optionally sets the held level). Out (every 8 render quanta ≈
// 21 ms): {fill, starved} so the page-side controller can rate-match and detect
// starvation. On a dry read it holds the last sample, so an underrun is a flat
// stretch, never a click.
const WORKLET_SRC = `
class ZXBeeperProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(${RING_SIZE});
    this.read = 0;
    this.write = 0;
    this.last = 0;
    this.starved = false;
    this.quanta = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d instanceof Float32Array) {
        const mask = this.ring.length - 1;
        for (let i = 0; i < d.length; i += 1) {
          const next = (this.write + 1) & mask;
          if (next === this.read) break; // full -> drop the rest (bound latency)
          this.ring[this.write] = d[i];
          this.write = next;
        }
      } else if (d && d.flush) {
        this.read = this.write;
        if (d.level !== undefined) this.last = d.level;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    const mask = this.ring.length - 1;
    for (let i = 0; i < out.length; i += 1) {
      if (this.read !== this.write) {
        this.last = this.ring[this.read];
        this.read = (this.read + 1) & mask;
      } else {
        this.starved = true;
      }
      out[i] = this.last;
    }
    this.quanta += 1;
    if (this.quanta >= 8) {
      this.quanta = 0;
      this.port.postMessage({ fill: (this.write - this.read) & mask, starved: this.starved });
      this.starved = false;
    }
    return true;
  }
}
registerProcessor('zx-beeper', ZXBeeperProcessor);
`;

function romBootMemory() {
  const bin = atob(ROM_BASE64);
  const memory = new Uint8Array(0x10000);
  for (let i = 0; i < bin.length; i += 1) memory[i] = bin.charCodeAt(i);
  return memory;
}

class Spectrum {
  constructor() {
    /** Currently-held canonical matrix keys (also settable programmatically). */
    this.pressed = new Set();
    this.border = 7;
    this.earLevel = 0;
    this.frames = 0;
    this._raf = 0;
    // tStatesTotal at the start of the current frame. Border and beeper edges are
    // timestamped as (tStatesTotal - _frameT0): a monotonic 0..~69888 offset into
    // the frame. We can't use machine.clock for this — clock is tStatesTotal mod
    // 69888, and because a frame runs a few T-states past 69888 (the last
    // instruction overshoots), clock wraps *inside* the frame, so an edge logged
    // after the wrap gets a smaller value than one before it. That non-monotonic
    // log breaks the ascending-time assumption in borderRowsFromLog / beeperSamples
    // (it scrambles the waveform), and since the wrap point drifts ~6 T-states per
    // frame, more and more edges land past it as time goes on — the sound decays
    // the longer it plays. tStatesTotal never wraps, so the offset is always clean.
    this._frameT0 = 0;
    // Beam-timed border: every OUT (0xFE) that changes the border colour is
    // logged as a flat (frameTState, colour) pair during the frame, then
    // collapsed to a per-scanline colour array at render time. `_borderRows` is
    // a reused buffer so the render loop allocates nothing per frame.
    this._borderLog = [];
    this._borderRows = new Uint8Array(OUT_HEIGHT);
    // Beeper audio: the ULA mixes BOTH output lines into the speaker — EAR (bit 4)
    // strongly and MIC (bit 3) weakly (the measured output levels are roughly 4:1).
    // The audible level is therefore a weighted SUM, not an XOR: a very common game
    // beeper routine toggles both bits together (OUT 0x18 / OUT 0x00), which an XOR
    // model cancels to constant silence. Changes are logged (frameTState, level 0..1)
    // like the border and resampled each frame (see _pumpAudio).
    this._beeperLog = [];
    this._audioLevel = 0;
    // Currently-held host keys: event.code -> event.key. The full matrix is
    // recomputed from this on every key event (see keyboard.resolveMatrix), which
    // keeps symbol chords and the two shift keys consistent regardless of the
    // order modifiers are pressed or released.
    this._held = new Map();
    // Web Audio is created lazily on the first user gesture (browser autoplay
    // policy); until then these stay null and the beeper is silent. Samples flow
    // through a ring buffer drained at the audio hardware rate: inside an
    // AudioWorklet on the audio thread when available (immune to main-thread
    // stalls), else a main-thread ScriptProcessorNode (see _enableAudio).
    this._audioCtx = null;
    this._node = null;
    this._sound = true;
    this._ring = null;      // Float32Array(RING_SIZE) — ScriptProcessor path only
    this._ringRead = 0;
    this._ringWrite = 0;
    this._ringLast = 0;     // last sample played (held on underrun)
    this._worklet = null;   // AudioWorkletNode when the worklet path is active
    this._workletFill = 0;  // audio-thread ring fill (last report + pushes since)
    this._chunk = 4096;     // consumer chunk size (worklet quantum or SPN buffer)
    this._audioTarget = 0;  // ring fill the controller steers toward (samples)
    this._scratch = null;   // reused per-frame sample buffer
    this._fillAvg = 0;      // EMA of the ring fill — the controller input (see _pumpAudio)
    this._starved = false;  // consumer ran the ring dry (reported by the consumer)

    // Kempston joystick (port 0x1F, active-high 000FUDLR) and cassette deck. Both are
    // read through io below: the joystick answers its port, the tape drives bit 6 of an
    // ordinary keyboard read while it is playing (see insertTape/playTape).
    this._joy = { up: false, down: false, left: false, right: false, fire: false };
    this._tapeDeck = null;   // createTapeDeck over the inserted file's pulse stream
    this._tapeTotal = 0;     // total T-states of that stream
    this._tapePlaying = false;
    this._tapeStartT = 0;    // machine.tStatesTotal when playback started
    this._tapeName = '';

    const io = {
      read: (port) => {
        // The Kempston decodes on any port whose low byte is 0x1F (an odd port, so it
        // never clashes with the even-port ULA keyboard read).
        if (kempstonDecodes(port)) return kempstonByte(this._joy);
        if ((port & 1) === 0) {
          const keys = keyboardMatrixByte(this.pressed, (port >> 8) & 0xff);
          let earBit = this.earLevel ? 0x40 : 0;
          if (this._tapePlaying && this._tapeDeck) {
            const t = this.machine.tStatesTotal - this._tapeStartT;
            if (t >= 0 && t < this._tapeTotal) earBit = this._tapeDeck.levelAt(t) ? 0x40 : 0;
            else if (t >= this._tapeTotal) this._tapePlaying = false; // reached the end
          }
          return (keys & 0x1f) | 0xa0 | earBit;
        }
        return this._floatingBus();
      },
      write: (port, value) => {
        if ((port & 1) === 0) {
          // Monotonic T-state offset into the current frame (see _frameT0).
          const frameT = this.machine.tStatesTotal - this._frameT0;
          const colour = value & 0x07;
          if (colour !== this.border) {
            this._borderLog.push(frameT, colour);
            this.border = colour;
          }
          this.earLevel = (value >> 4) & 1; // for the IN bit-6 EAR echo
          // Weighted EAR+MIC mix (see the field comment above): games that flip both
          // bits in phase get a full-swing tone; SAVE's MIC-only tone stays soft.
          const audio = 0.8 * this.earLevel + 0.2 * ((value >> 3) & 1);
          if (audio !== this._audioLevel) {
            this._beeperLog.push(frameT, audio);
            this._audioLevel = audio;
          }
        }
      },
    };
    this.machine = createMachine({
      memory: romBootMemory(),
      registers: { ...RESET_REGISTERS },
      io,
    });
  }

  // What an IN from a port nobody decodes actually reads: the data bus is left
  // floating, so the Z80 sees whatever byte the ULA is fetching for the display
  // at that instant (0xFF in border/idle slots, when the ULA isn't fetching).
  // Ocean/Imagine games (Cobra, Arkanoid, Short Circuit...) spin on IN A,(0xFF)
  // until a known attribute byte drifts past to sync with the beam — with a hard
  // 0xFF here they hang at the start of play. Fetch pattern within each 8 T of
  // the visible 128 T of a line: bitmap N, attr N, bitmap N+1, attr N+1, 4 idle.
  _floatingBus() {
    const t = this.machine.tStatesTotal - this._frameT0 - DISPLAY_START_T;
    if (t < 0) return 0xff;
    const line = (t / LINE_T_STATES) | 0;
    const lineT = t % LINE_T_STATES;
    if (line >= 192 || lineT >= 128) return 0xff;
    const phase = lineT & 7;
    if (phase > 3) return 0xff;
    const col = ((lineT >> 3) << 1) | (phase >> 1);
    const mem = this.machine.memory;
    if (phase & 1) return mem[0x5800 | ((line >> 3) << 5) | col]; // attribute
    return mem[SCREEN_BASE | ((line & 0xc0) << 5) | ((line & 7) << 8) | ((line & 0x38) << 2) | col];
  }

  /** Restart from a clean power-on. */
  reset() {
    this.stop();
    this.pressed.clear();
    this._held.clear();
    this.frames = 0;
    this.border = 7;
    this.earLevel = 0;
    this._audioLevel = 0;
    this._borderLog.length = 0;
    this._beeperLog.length = 0;
    this._tapePlaying = false; // the tape stays inserted; playback rewinds
    this._joy = { up: false, down: false, left: false, right: false, fire: false };
    if (this._node) this._primeRing(0); // flush audio, re-prime at the post-reset level
    this.machine.memory = romBootMemory();
    this.machine.registers = { ...RESET_REGISTERS };
    this.machine.clock = 0;
    this.machine.halted = false;
    return this;
  }

  /**
   * Insert a `.tap` or `.tzx` image (container auto-detected). Builds its EAR pulse
   * stream; call `playTape()` to start it, then LOAD "" on the machine.
   */
  insertTape(bytes, { name = '' } = {}) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const pulses = tapeFileToPulses(arr);
    this._tapeDeck = createTapeDeck(pulses, { clock: () => 0 });
    this._tapeTotal = this._tapeDeck.total;
    this._tapePlaying = false;
    this._tapeName = name;
    return this;
  }

  /** Start (or rewind and start) tape playback from the current machine time. */
  playTape() {
    if (!this._tapeDeck) return this;
    this._tapeStartT = this.machine.tStatesTotal;
    this._tapePlaying = true;
    return this;
  }

  /** Pause playback (bit 6 falls back to the idle EAR level). */
  stopTape() { this._tapePlaying = false; return this; }

  /** Remove the tape entirely. */
  ejectTape() { this._tapeDeck = null; this._tapePlaying = false; this._tapeName = ''; return this; }

  /** True while the tape is streaming (auto-clears when it reaches the end). */
  isTapePlaying() { return this._tapePlaying; }

  /** Playback position as 0..1 (0 with no tape or when stopped). */
  tapeProgress() {
    if (!this._tapeDeck || !this._tapePlaying || this._tapeTotal === 0) return 0;
    const t = this.machine.tStatesTotal - this._tapeStartT;
    return Math.max(0, Math.min(1, t / this._tapeTotal));
  }

  /** Set the Kempston joystick state: any of { up, down, left, right, fire }. */
  setJoystick(state = {}) {
    this._joy = {
      up: Boolean(state.up), down: Boolean(state.down), left: Boolean(state.left),
      right: Boolean(state.right), fire: Boolean(state.fire),
    };
    return this;
  }

  /**
   * Load a `.z80` snapshot: restore the register file, the 48K RAM and the border in one
   * shot (the ROM is kept in place). Unlike a tape, a snapshot is instant — the machine
   * resumes exactly where the snapshot was frozen, so the program is already running.
   */
  loadSnapshot(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const snap = readZ80(arr);
    const memory = romBootMemory();                       // keep the ROM in low 16K
    memory.set(snap.memory.subarray(0x4000), 0x4000);     // overlay the snapshot RAM
    this.stop();
    this.machine.memory = memory;
    this.machine.registers = { ...snap.registers };
    this.machine.clock = 0;
    this.machine.halted = false;
    this.border = snap.border;
    this.earLevel = 0;
    this._audioLevel = 0;
    this._borderLog.length = 0;
    this._beeperLog.length = 0;
    this._borderRows.fill(snap.border);
    this._tapePlaying = false;
    this.pressed.clear();
    this._held.clear();
    if (this._node) this._primeRing(0);
    return this;
  }

  /**
   * Fast (flash) tape load: reboot, type LOAD "", then run the emulation as fast as the
   * CPU allows until the tape stream ends — same real ROM load, no real-time wait. Async:
   * it fast-forwards in chunks, yielding between them so the page keeps painting (screen,
   * progress bar) and stays responsive even for a full multi-minute game tape. Resolves
   * when the load is done. Use for `.tap`/`.tzx`.
   */
  async fastLoadTape(bytes, { name = '' } = {}) {
    const wasRunning = Boolean(this._raf);
    this.stop();
    this.reset();
    // Fast-forward with _advanceQuiet — NOT _advance — so no audio is produced. These
    // frames run hundreds of times faster than real time; pumping their audio would push
    // minutes of loading tone the audio thread can never drain, and a saturated ring
    // drops everything pushed after it — including the loaded program's beeper, so the
    // game would play silently. We stay quiet here and re-prime the ring at the end.
    const step = (n) => { for (let i = 0; i < n; i += 1) this._advanceQuiet(); };
    const tap = (keys) => {
      this.pressed.clear();
      for (const k of keys) this.pressed.add(k);
      step(4);
      this.pressed.clear();
      step(8);
    };
    step(100);                                       // boot to the © prompt
    tap(['CAPS']);                                   // prime the key debounce
    for (const k of [['J'], ['SYM', 'P'], ['SYM', 'P'], ['ENTER']]) tap(k); // LOAD ""
    this.insertTape(bytes, { name });
    this.playTape();
    // Frame budget from the tape itself: its pulse stream length is known exactly, plus
    // slack for the ROM's between-block processing. (A fixed guard is a trap: 6000 frames
    // is only ~2 min of tape, and cutting a longer game off mid-stream makes the ROM
    // print "R Tape loading error".)
    const budget = Math.ceil(this._tapeTotal / FRAME_T_STATES) + 500;
    let done = 0;
    while (this._tapePlaying && done < budget) {
      for (let i = 0; i < 100 && this._tapePlaying && done < budget; i += 1) {
        this._advanceQuiet();
        done += 1;
      }
      if (this.ctx) this._present();                 // show the fast-forwarding stripes
      await new Promise((r) => setTimeout(r, 0));    // yield: UI paints, audio breathes
    }
    this._tapePlaying = false;
    step(50);                                        // let the loaded program start
    this.pressed.clear();
    // Hand the program a clean, on-target ring at the current level, so its beeper is
    // heard from the first note. No-op until audio is enabled.
    if (this._node) this._primeRing(this._audioLevel);
    if (this.ctx) this._present();                   // blit the final frame (if attached)
    if (wasRunning) this.start();
    return this;
  }

  /** Bind a <canvas> for rendering and (unless opted out) host-keyboard input. */
  attach(canvas, { keyboard = true, sound = true, target = window } = {}) {
    this.canvas = canvas;
    canvas.width = OUT_WIDTH;
    canvas.height = OUT_HEIGHT;
    this.ctx = canvas.getContext('2d');
    this.image = this.ctx.createImageData(OUT_WIDTH, OUT_HEIGHT);
    this._sound = sound;
    if (keyboard) {
      this._onDown = (e) => this._keyDown(e);
      this._onUp = (e) => this._keyUp(e);
      target.addEventListener('keydown', this._onDown);
      target.addEventListener('keyup', this._onUp);
      this._keyTarget = target;
    }
    return this;
  }

  // Rebuild the pressed-key set from all currently-held host keys. Doing this on
  // every event (rather than add/remove per key) keeps symbol chords and the two
  // shift keys correct no matter what order modifiers go up and down.
  _recompute() {
    const next = resolveMatrix(this._held);
    this.pressed.clear();
    for (const k of next) this.pressed.add(k);
  }

  // Does this host key reach the Spectrum's matrix at all? Only claimed keys are
  // preventDefault'ed: function keys (F12 = DevTools, F5 = reload), OS chords, and
  // anything else the machine has no key for must keep working — an embedded demo
  // must not disable the browser.
  _claims(event) {
    if (/^F\d{1,2}$/.test(event.key)) return false; // F1..F24 belong to the browser/OS
    if (event.metaKey) return false;                // OS-level chords
    if (event.key && event.key.length === 1 && charToKeys(event.key)) return true;
    return Boolean(browserCodeToKeys(event.code));
  }

  _keyDown(event) {
    if (!this._claims(event)) return; // not ours — let the browser have it
    // A real user gesture — safe to start audio (browser autoplay policy).
    if (this._sound) this._enableAudio();
    this._held.set(event.code, event.key);
    this._recompute();
    event.preventDefault();
  }

  _keyUp(event) {
    if (!this._held.delete(event.code)) return; // we never claimed its keydown
    this._recompute();
    event.preventDefault();
  }

  // Run exactly one 50 Hz ZX frame: emulate it, collapse this frame's border log
  // to scanline colours, and push its beeper edges to the audio timeline.
  _advance() {
    // The border colour / beeper level in force at the top of this frame is
    // whatever the last frame left behind. runFrame appends any changes (with
    // T-states) to the logs and updates this.border / this.earLevel along the way.
    const borderCarry = this.border;
    const beeperCarry = this._audioLevel;
    this._borderLog.length = 0;
    this._beeperLog.length = 0;
    this._frameT0 = this.machine.tStatesTotal; // baseline for this frame's edge times
    this.machine.runFrame();
    this.frames += 1;
    borderRowsFromLog(this._borderLog, borderCarry, this._borderRows);
    this._pumpAudio(beeperCarry);
  }

  // Run one frame without touching audio. Used by fastLoadTape's fast-forward, whose
  // frames arrive far faster than the audio clock can consume — feeding them to the ring
  // would swamp it and mute whatever plays next (see fastLoadTape). Still clears the logs
  // each frame so the next real _advance starts clean and nothing accumulates unbounded.
  _advanceQuiet() {
    const borderCarry = this.border;
    this._borderLog.length = 0;
    this._beeperLog.length = 0;
    this._frameT0 = this.machine.tStatesTotal;
    this.machine.runFrame();
    this.frames += 1;
    borderRowsFromLog(this._borderLog, borderCarry, this._borderRows);
  }

  // Blit the current screen + border to the canvas.
  _present() {
    const screen = this.machine.memory.subarray(SCREEN_BASE, SCREEN_BASE + SCREEN_SIZE);
    renderWithBorderRows(screen, this._borderRows, this.frames, this.image.data);
    this.ctx.putImageData(this.image, 0, 0);
  }

  // Drive the machine at a true 50 Hz off wall-clock time (rAF fires at the
  // display rate, usually 60 Hz), catching up whole frames as real time elapses.
  // This keeps emulation speed — and therefore beeper pitch — correct.
  _frameStep(now) {
    if (!this._lastTime) this._lastTime = now;
    let dt = now - this._lastTime;
    this._lastTime = now;
    if (dt > 100) dt = 100; // clamp after a stall (e.g. backgrounded tab)
    this._acc += dt;
    const FRAME_MS = 1000 / 50;
    // A stall drained the ring dry (flagged by onaudioprocess). Top it back up
    // *before* this tick's frames produce audio, sized so the fill lands exactly
    // on target after they run. Padding with the held sample is DC — it only
    // extends the silence the stall already caused — so recovery is instant and
    // pitch-neutral, rather than the controller resampling its way back over
    // seconds of audibly bent tone.
    if (this._starved && this._sound) {
      this._topUpRing(Math.min(Math.floor(this._acc / FRAME_MS), 6));
    }
    let ran = 0;
    while (this._acc >= FRAME_MS) {
      this._advance();
      this._acc -= FRAME_MS;
      ran += 1;
      if (ran >= 6) { this._acc = 0; break; } // don't spiral if we fall behind
    }
    if (ran > 0) this._present();
    this._raf = requestAnimationFrame((t) => this._frameStep(t));
  }

  // Create the AudioContext on demand (first user gesture) and resume it if the
  // browser suspended it. No-op when sound is off or Web Audio is unavailable
  // (the beeper then stays silent, nothing else breaks).
  //
  // Two delivery paths with identical ring-buffer semantics:
  //  - AudioWorklet (preferred): the ring lives on the audio thread, so a busy
  //    main thread (emulation + canvas blit + GC) can only delay *production*
  //    — which the ~130 ms of queued audio rides out — never *delivery*. A
  //    late ScriptProcessor callback, by contrast, makes the browser drop
  //    render quanta: brief waveform splices heard as crackle.
  //  - ScriptProcessorNode (fallback): main-thread callback draining this._ring,
  //    for browsers that reject the blob: worklet module (e.g. some file://
  //    contexts). Universally supported, glitchier under load.
  _enableAudio() {
    if (!this._sound) return;
    if (this._audioCtx) { if (this._audioCtx.state === 'suspended') this._audioCtx.resume(); return; }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    this._audioCtx = ctx;
    // Target queued-audio level (~130 ms at 48 kHz): it must exceed one consumer
    // chunk so a single drain can never hit dry, plus slack for producer/consumer
    // phase; _pumpAudio steers the fill back to it, keeping the producer (system
    // clock) and consumer (audio clock) rate-locked.
    this._audioTarget = Math.round(ctx.sampleRate * 0.13);
    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined' && typeof Blob !== 'undefined') {
      // Try a blob: module first, then the same module as a data: URL, then the
      // ScriptProcessor path. The deadline below is load-bearing: on file:// pages
      // Chrome doesn't merely reject the worklet module — addModule NEVER SETTLES
      // (the blob is "not allowed to load" but no rejection fires, for blob: and
      // data: alike), so without it the fallback never runs and the machine is
      // permanently, silently mute. 500 ms is generous for a same-page module.
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      const finish = (worklet) => {
        URL.revokeObjectURL(url);
        if (this._node) return; // whoever settles first wins; the rest are no-ops
        if (worklet) this._useWorklet();
        else this._useScriptProcessor();
      };
      ctx.audioWorklet.addModule(url)
        .catch(() => ctx.audioWorklet.addModule(`data:text/javascript;base64,${btoa(WORKLET_SRC)}`))
        .then(() => finish(true), () => finish(false));
      setTimeout(() => finish(false), 500); // deadline: addModule hung (file://)
    } else {
      this._useScriptProcessor();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  // Preferred consumer: the worklet owns the ring on the audio thread; we push
  // sample chunks and it reports {fill, starved} back for the controller.
  _useWorklet() {
    if (this._node) return; // a consumer is already wired (e.g. the deadline fallback)
    try {
      const node = new AudioWorkletNode(this._audioCtx, 'zx-beeper', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      });
      node.port.onmessage = (e) => {
        this._workletFill = e.data.fill;
        if (e.data.starved) this._starved = true; // the render loop re-primes (see _topUpRing)
      };
      this._worklet = node;
      this._chunk = 128; // worklet render quantum
      this._primeRing(this._audioLevel);
      this._connectGraph(node);
      this._node = node;
    } catch {
      this._worklet = null;
      this._useScriptProcessor();
    }
  }

  // Fallback consumer. ScriptProcessorNode is deprecated but needs no module
  // load. Its callback runs on the main thread, so a stall longer than its
  // buffer (4096 ≈ 85 ms) is the one thing the ring can't hide; 4096 balances
  // that risk against latency for a 50 Hz render.
  _useScriptProcessor() {
    if (this._node) return; // a consumer is already wired
    const ctx = this._audioCtx;
    this._ring = new Float32Array(RING_SIZE);
    this._chunk = 4096;
    this._primeRing(this._audioLevel);
    const node = ctx.createScriptProcessor(this._chunk, 1, 1);
    node.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      const ring = this._ring;
      const mask = ring.length - 1;
      for (let i = 0; i < out.length; i += 1) {
        if (this._ringRead !== this._ringWrite) {
          this._ringLast = ring[this._ringRead];
          this._ringRead = (this._ringRead + 1) & mask;
        } else {
          this._starved = true; // ran dry — the render loop re-primes (see _topUpRing)
        }
        out[i] = this._ringLast;
      }
    };
    this._connectGraph(node);
    this._node = node;
  }

  _connectGraph(node) {
    const ctx = this._audioCtx;
    // Gently roll off the square wave's harsh high harmonics (aliasing).
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    // Block DC: the beeper idles at -AMP (a constant offset), and any flush or
    // underrun-hold discontinuity is a DC step — audible as a thump. 25 Hz is
    // below every audible beeper tone, so this only turns those steps into
    // brief inaudible settles.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 25;
    node.connect(lp);
    lp.connect(hp);
    hp.connect(ctx.destination);
  }

  // Samples queued but not yet played. SPN path: exact pointer math; worklet
  // path: the audio thread's last report, advanced by what we pushed since.
  _fillNow() {
    if (this._worklet) return this._workletFill;
    if (!this._ring) return 0;
    return (this._ringWrite - this._ringRead) & (this._ring.length - 1);
  }

  // Queue `count` samples for playback. Both paths drop when full (bound latency).
  _push(samples, count) {
    if (this._worklet) {
      const chunk = samples.slice(0, count);
      this._worklet.port.postMessage(chunk, [chunk.buffer]);
      this._workletFill += count;
      return;
    }
    const ring = this._ring;
    const mask = ring.length - 1;
    for (let i = 0; i < count; i += 1) {
      const next = (this._ringWrite + 1) & mask;
      if (next === this._ringRead) break; // full -> drop the rest (bound latency)
      ring[this._ringWrite] = samples[i];
      this._ringWrite = next;
    }
  }

  // Replace anything queued with `_audioTarget` samples of the given beeper
  // level's value. Priming at the real level matters: level 0 plays as -AMP, so
  // a 0.0 "silence" prefill would step to -AMP when it drained — a click at
  // every audio start.
  _primeRing(level) {
    const value = AMP * (2 * level - 1);
    if (this._worklet) {
      this._worklet.port.postMessage({ flush: true, level: value });
      const pad = new Float32Array(this._audioTarget).fill(value);
      this._worklet.port.postMessage(pad, [pad.buffer]);
      this._workletFill = this._audioTarget;
    } else if (this._ring) {
      this._ring.fill(value);
      this._ringRead = 0;
      this._ringWrite = this._audioTarget;
      this._ringLast = value;
    }
    this._fillAvg = this._audioTarget;
    this._starved = false;
  }

  // Refill after the consumer ran dry: pad with the current level up to the
  // target minus what the `pending` about-to-run frames will add, so the fill
  // comes out exactly on target once they have been pumped (see _frameStep).
  _topUpRing(pending) {
    this._starved = false;
    const ctx = this._audioCtx;
    if (!this._node || !ctx) return;
    const padTo = this._audioTarget - Math.round(pending * (ctx.sampleRate / 50));
    const missing = padTo - this._fillNow();
    if (missing > 0) {
      const pad = new Float32Array(missing).fill(AMP * (2 * this._audioLevel - 1));
      this._push(pad, missing);
    }
    this._fillAvg = this._audioTarget;
  }

  // Resample this frame's beeper edges into the ring buffer, rate-matched to the
  // audio clock. The producer here runs on the system clock (rAF), the consumer
  // (onaudioprocess) on the audio hardware clock; the two are never exactly equal,
  // so a fixed samples-per-frame would let the ring fill drift to an edge and
  // glitch over minutes. A deadband controller corrects that — but it must watch
  // a *smoothed* fill, not the raw one: the consumer drains a whole
  // ScriptProcessor buffer (4096 samples) at a time, so the instantaneous fill
  // sawtooths with drain phase, and reacting to it would resample — i.e.
  // pitch-shift — frames constantly. The ~1 s EMA erases that sawtooth, so the
  // controller sees only the mean: while the mean sits inside the deadband we
  // emit exactly the nominal count (no resampling, clean tone), and only genuine
  // long-run clock drift walks it past the band, where a gentle trim/pad clamped
  // to ±3 % steers it back.
  _pumpAudio(carryLevel) {
    const ctx = this._audioCtx;
    if (!this._node || !ctx || ctx.state !== 'running') return;
    const nominal = ctx.sampleRate / 50; // audio samples in one 50 Hz ZX frame
    const maxDev = Math.round(nominal * 0.03);
    let count = Math.round(nominal);
    // The deadband must swallow the whole no-fault fill variation, which is set
    // by the consumer's chunk size: the fill band sits anywhere within ±half a
    // chunk of the target depending on drain phase (and that phase re-randomizes
    // every stall). Any tighter and the controller rides the band edge after a
    // stall, correcting — pitch-bending — forever.
    const deadband = Math.round(this._chunk / 2 + nominal);
    const err = this._fillAvg - this._audioTarget;
    if (err > deadband) count -= Math.round(Math.min((err - deadband) * 0.05, maxDev));
    else if (err < -deadband) count -= Math.round(Math.max((err + deadband) * 0.05, -maxDev));
    if (count < 1) count = 1;
    if (!this._scratch || this._scratch.length < count) {
      this._scratch = new Float32Array(Math.ceil(nominal) + maxDev + 2);
    }
    const samples = beeperSamples(this._beeperLog, carryLevel, count, AMP, this._scratch);
    if (this._tapePlaying && this._tapeDeck) this._mixTapeAudio(samples, count);
    this._push(samples, count);
    // Measure the fill *after* pushing: post-push it sits at the top of the
    // producer's own per-frame sawtooth, which is also where priming and stall
    // top-ups place it — so the EMA compares like with like and idles on the
    // target, instead of reading a trough that sits ~a frame below it and
    // pinning the controller against the deadband edge.
    this._fillAvg += (this._fillNow() - this._fillAvg) * 0.02; // ~1 s time constant at 50 Hz
  }

  // The loading sound: add this frame's tape EAR level, sampled at the audio rate, on
  // top of the beeper. The frame spans T-states [_frameT0 .. tStatesTotal); the tape
  // clock is (that - _tapeStartT), so a square wave following levelAt() reproduces the
  // pilot tone and data screech. The DC blocker downstream turns its offset into silence.
  _mixTapeAudio(samples, count) {
    const base = this._frameT0 - this._tapeStartT;          // tape T at the frame's start
    const span = this.machine.tStatesTotal - this._frameT0; // this frame's T-states
    if (span <= 0) return;
    const step = span / count;
    for (let i = 0; i < count; i += 1) {
      const t = base + i * step;
      if (t < 0 || t >= this._tapeTotal) continue;
      samples[i] += this._tapeDeck.levelAt(t) ? TAPE_AMP : -TAPE_AMP;
    }
  }

  /** Turn beeper sound on/off. */
  setSound(on) {
    this._sound = Boolean(on);
    if (this._sound) this._enableAudio();
    // Flush queued audio but keep holding the last level: the DC blocker turns a
    // held level into silence, whereas snapping to 0 would be a step (a click).
    else if (this._worklet) this._worklet.port.postMessage({ flush: true });
    else if (this._ring) this._ringRead = this._ringWrite;
    return this;
  }

  /** Begin the 50 Hz emulation + render loop. */
  start() {
    if (this._raf) return this;
    this._lastTime = 0;
    this._acc = 0;
    this._frameStep(0);
    return this;
  }

  /** Pause the render loop (keyboard bindings stay attached). */
  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    return this;
  }
}

/** Boot a fresh Spectrum with the real 48K ROM. */
export function create() {
  return new Spectrum();
}

export { Spectrum };
