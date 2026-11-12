// Bundled CORE preview player — the D4 in-browser runner (cli.md CLI-PROD-PREVIEW-001,
// toolkit-runtime.md RT-PROD-PREVIEW-001). It runs the RECONSTRUCTED @zx-vibes/machine
// (NOT the legacy @zx-vibes/emulator) in the browser: it boots a clean 48K ROM machine
// (ROM write-protected, MACHINE-ROM-READONLY-001), loads the program the preview server
// serves, targets the exact 48K frame cadence on a visibility-independent clock, renders
// separately, and
//   - renders the 320x240 bordered frame (RT-PROD-PREVIEW-008): the 256x192
//     framebuffer via the EXACT screen-render.md (SCREEN-FRAMEBUFFER-001) decode +
//     palette.yaml (SCREEN-PALETTE-001), inset in the raster-border.md
//     (RASTER-GEOMETRY-001) border whose colour varies per scanline from the frame's
//     port-0xFE border events — so SAVE/LOAD paints its bands (RASTER-SAVE-PP-001), and
//   - maps the host keyboard onto the 48K matrix per keyboard-input.md (KBD-MATRIX-001 /
//     KBD-BROWSERMAP-001/-002 / KBD-LATCH-001), resolving symbol characters as
//     SYMBOL SHIFT chords, and
//   - renders the weighted EAR+MIC speaker mix (BEEPER-PCM-MIX-001) through a
//     continuous Web Audio stream after a browser user gesture — so a MIC-only
//     ROM SAVE is audible, soft, exactly as on hardware, and
//   - autoloads a BASIC-loader tape by typing `LOAD ""` on the real ROM and trapping
//     LD-BYTES (../src/preview/autoload.ts), and shows any decode or `--watch` build
//     error on the page instead of hanging on "loading…".
//
// This file is authored in browser JS and bundled by tsup (tsup.player.config.ts,
// platform:browser, noExternal @zx-vibes/*) into assets/preview/player.js, so the
// reconstructed cores are inlined and run client-side. It imports the public core
// packages and the DOM-free modules under ../src/preview/ — never the toolkit's
// node-only modules and never the legacy emulator.

import {
  FRAME_T_STATES,
  displayByteAddress,
  attributeAddress,
  pixelColorIndex,
  flashPhase,
  kempstonDecodes,
} from '@zx-vibes/ula';
import {
  createPreviewBeeperState,
  renderPreviewBeeperChunk,
  speakerMixLevel,
} from '../src/preview/beeper-model.ts';
import {
  advancePreviewFrameClock,
  createPreviewFrameClock,
} from '../src/preview/frame-clock.ts';
import {
  SYMBOL_CHAR_KEYS,
  claimsBrowserEvent,
  isHostShiftCode,
  resolveHeldMatrix,
} from '../src/preview/host-keys.ts';
import {
  BORDER_X,
  BORDER_Y,
  OUT_WIDTH,
  OUT_HEIGHT,
  borderRowsFromLog,
  fillBorderRows,
} from '../src/preview/border-frame.ts';
import { KEY_NAMES, PreviewKeyLatch } from '../src/preview/key-latch.ts';
import { createLdBytesTrap, scheduledKeys } from '../src/preview/autoload.ts';
import { stepFrame } from '../src/preview/frame-step.ts';
import { bootPreviewProgram } from '../src/preview/player-boot.ts';

// ---------------------------------------------------------------------------
// Palette — palette.yaml / screen-render.md SCREEN-PALETTE-001 (the exact shared
// table: a lit channel is 205 non-bright / 255 bright, an unlit channel 0).
// ---------------------------------------------------------------------------
const PALETTE_RGB = [
  [0, 0, 0], [0, 0, 205], [205, 0, 0], [205, 0, 205],
  [0, 205, 0], [0, 205, 205], [205, 205, 0], [205, 205, 205],
  [0, 0, 0], [0, 0, 255], [255, 0, 0], [255, 0, 255],
  [0, 255, 0], [0, 255, 255], [255, 255, 0], [255, 255, 255],
];

const FRAME_WIDTH = 256;
const FRAME_HEIGHT = 192;

/** A thrown value's message, for the status line. */
function errorText(err) {
  return (err && err.message) || String(err);
}

// ---------------------------------------------------------------------------
// Keyboard + port 0xFE — the 48K matrix (KBD-MATRIX-001) with the quick-tap latch
// (KBD-LATCH-001) lives in ../src/preview/key-latch.ts; the browser-key → matrix
// mapping (KBD-BROWSERMAP-001/-002) in ../src/preview/host-keys.ts. The latch
// freezes each frame's visible keys once, so the ROM's many IN (0xFE) reads per
// frame allocate nothing.
// ---------------------------------------------------------------------------

/** The machine's port device: keyboard + Kempston reads, border + speaker writes. */
class HostKeyboard {
  constructor(border) {
    this.keys = new PreviewKeyLatch();
    this.border = border & 0x07;
    this.earLevel = 0;          // last b4 written — the IN bit-6 EAR echo (issue-3)
    this.audioLevel = 0;        // weighted EAR+MIC speaker drive (BEEPER-PCM-MIX-001)
  }
  // The machine `io` contract.
  read(port) {
    if ((port & 0x01) === 0) {
      return this.keys.keyBits((port >> 8) & 0xff) | 0x20 | 0x80 | (this.earLevel ? 0x40 : 0);
    }
    // A fitted Kempston answers port low byte 0x1F, as on the machine `zxs run`/`test`
    // and the examples emulate (JOY-KEMPSTON-READ-001). The player maps no host
    // joystick, so it reads idle (0x00: no direction, no fire); reading 0xFF here made
    // a Kempston game that passed its tests move and fire non-stop in preview.
    if (kempstonDecodes(port)) return 0x00;
    return 0xff; // other undriven odd ports float idle high
  }
  write(port, value) {
    if ((port & 0x01) !== 0) return;
    // Border (b0-b2) is an EVENT stream (HOST-IO-PORTFE-BORDER-001): report only a
    // colour that differs from the one in effect, stamped by the caller with the
    // frame clock so the renderer can place it on the right scanline.
    const colour = value & 0x07;
    if (colour !== this.border) {
      this.border = colour;
      if (this.onBorder) this.onBorder(colour);
    }
    this.earLevel = (value >> 4) & 1; // the IN bit-6 EAR echo tracks b4 (issue-3)
    // The audible speaker is the weighted EAR+MIC mix (BEEPER-PCM-MIX-001), so a
    // MIC-only ROM SAVE produces edges too. Report level changes with the frame
    // clock; without a timestamp the pitch would depend on how many OUTs happen
    // to land per frame.
    const level = speakerMixLevel(value);
    if (level !== this.audioLevel) {
      this.audioLevel = level;
      if (this.onSpeaker) this.onSpeaker(level);
    }
  }
}

// ---------------------------------------------------------------------------
// Beeper — the port-0xFE speaker to Web Audio (beeper-output.md). The drive level
// is the weighted EAR+MIC mix (BEEPER-PCM-MIX-001), so both game beepers (b4) and
// the ROM SAVE's MIC-only tone (b3) are audible.
//
// The CLI's `run --wav` renders the b4 edge stream; this is the browser half.
// Every level change is stamped with the frame clock, and at the end of each
// emulated frame the resulting step function is integrated into one sample per output
// sample — area-averaged, not point-sampled, because a 4 kHz square wave point-sampled
// at 48 kHz aliases audibly.
//
// Sample delivery is an AudioWorklet fed by postMessage. No SharedArrayBuffer, so the
// preview server needs no COOP/COEP headers.
// ---------------------------------------------------------------------------
const CPU_HZ = 3_500_000;
const BEEPER_GAIN = 0.22;   // a 1-bit square wave at full scale is harsh

/**
 * Queued audio the worklet keeps ahead of the speaker, in seconds — the dominant,
 * controllable half of the beeper's delay behind the picture (the rest is the
 * output device's own latency, which the page cannot change).
 *
 * The producer posts one ~20 ms buffer per emulated frame and slightly outpaces
 * the audio hardware clock, so the queue always settles just under whatever
 * ceiling trimming enforces: THE CEILING IS THE LATENCY. 100 ms measured ~70 ms
 * of standing queue. 40 ms keeps two frames of jitter slack — enough to ride out
 * the ordinary one-frame-per-pulse cadence and a missed pulse — while roughly
 * halving the audible lag.
 */
const BEEPER_QUEUE_SECONDS = 0.04;

const BEEPER_WORKLET = `
class ZxsBeeper extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.read = 0;
    this.held = 0;               // last sample emitted: an underrun holds it, never clicks
    this.port.onmessage = (e) => {
      if (e.data === 'flush') { this.queue.length = 0; this.read = 0; return; }
      this.queue.push(e.data);
      // Bound the latency: the queue depth IS the delay behind the picture, and a
      // slow tab (up to 8 frames in one clock pulse) would otherwise let it grow.
      // Shed the EXACT excess by advancing the read cursor rather than dropping
      // whole ~20 ms buffers: same bound, but the discontinuity is a few
      // milliseconds instead of a whole frame, so trimming stays inaudible at a
      // tight target.
      let total = -this.read;
      for (const q of this.queue) total += q.length;
      let excess = total - Math.round(sampleRate * ${BEEPER_QUEUE_SECONDS});
      while (excess > 0 && this.queue.length > 0) {
        const available = this.queue[0].length - this.read;
        if (available > excess) { this.read += excess; break; }
        // Never drop the buffer being played out to empty; leave the tail.
        if (this.queue.length === 1) { this.read += Math.max(0, available - 1); break; }
        excess -= available;
        this.queue.shift();
        this.read = 0;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      const head = this.queue[0];
      if (head === undefined) {
        // Underrun. Slew the held level to zero instead of parking on it: a 1-bit
        // speaker at rest is full-scale DC, and holding that is both a click on the
        // way in and a constant offset for as long as the starvation lasts.
        this.held *= 0.999;
        out[i] = this.held;
        continue;
      }
      this.held = head[this.read++];
      out[i] = this.held;
      if (this.read >= head.length) { this.queue.shift(); this.read = 0; }
    }
    return true;
  }
}
registerProcessor('zxs-beeper', ZxsBeeper);
`;

class Beeper {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.gain = null;
    this.edges = [];        // chronological { t, level } edges for the current frame
    this.hardwareLevel = 0;
    this.pcmState = createPreviewBeeperState();
    this.muted = false;
    this.ready = false;
    this.failed = null;
  }

  /** Must be called from a user gesture: audio contexts start suspended otherwise. */
  async enable() {
    if (this.ctx) { await this.ctx.resume(); return this.ready; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.failed = 'no Web Audio in this browser'; return false; }
    try {
      this.failed = null;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const url = URL.createObjectURL(new Blob([BEEPER_WORKLET], { type: 'text/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.node = new AudioWorkletNode(this.ctx, 'zxs-beeper', { numberOfInputs: 0 });
      // A 1-bit speaker resting at one level is a DC offset, which clicks on start and
      // stop; block it rather than shipping DC to the output device.
      const dcBlock = this.ctx.createBiquadFilter();
      dcBlock.type = 'highpass';
      dcBlock.frequency.value = 30;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = BEEPER_GAIN;
      this.node.connect(dcBlock).connect(this.gain).connect(this.ctx.destination);
      await this.ctx.resume();
      // Audio may be enabled after emulation has already run. Start a fresh global
      // PCM grid at the hardware level in effect at the user gesture.
      this.pcmState = createPreviewBeeperState(this.hardwareLevel);
      this.edges.length = 0;
      this.ready = true;
      return true;
    } catch (err) {
      this.failed = (err && err.message) || String(err);
      if (this.ctx) void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.node = null;
      this.gain = null;
      return false;
    }
  }

  /** A speaker transition at frame-relative T-state `t`. */
  edge(t, level) {
    this.hardwareLevel = level;
    if (!this.ready) return;
    this.edges.push({ t, level });
  }

  /** Turn one frame of edges into samples and hand them to the worklet. */
  endFrame() {
    if (!this.ready) { this.edges.length = 0; return; }
    const rendered = renderPreviewBeeperChunk(
      this.pcmState,
      this.edges,
      FRAME_T_STATES,
      { sampleRate: this.ctx.sampleRate, cpuHz: CPU_HZ },
    );
    this.pcmState = rendered.state;
    this.edges = rendered.carryEdges;
    if (rendered.samples.length > 0) this.node.port.postMessage(rendered.samples);
  }

  /** Mute at the gain stage and keep the stream flowing — starving the worklet instead
   *  would leave it holding its last sample, which is DC, not silence. */
  setMuted(m) {
    this.muted = m;
    if (!this.gain) return;
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(m ? 0 : BEEPER_GAIN, now + 0.02);
  }
}

// ---------------------------------------------------------------------------
// The emulation clock. The frame stepper itself (Machine.runFrame plus an
// optional per-instruction trap for the tape autoloader) is stepFrame in
// ../src/preview/frame-step.ts.
// ---------------------------------------------------------------------------

// A Worker pulse keeps emulation advancing while rAF is suspended in a hidden
// tab. Rendering remains on rAF and can pause independently.
const FRAME_MS = (FRAME_T_STATES / CPU_HZ) * 1000;
const CLOCK_PULSE_MS = Math.max(4, FRAME_MS / 2);
const MAX_CATCH_UP_FRAMES = 8;
const EMULATION_CLOCK_WORKER = `
let timer = null;
self.onmessage = (event) => {
  if (event.data === 'stop') {
    if (timer !== null) clearInterval(timer);
    timer = null;
    return;
  }
  if (timer !== null) return;
  self.postMessage(0);
  timer = setInterval(() => self.postMessage(0), ${CLOCK_PULSE_MS});
};
`;

/** Start a visibility-independent pulse source, with a timer fallback for old browsers. */
function startEmulationClock(onPulse) {
  let fallback = null;
  const startFallback = () => {
    if (fallback !== null) return;
    fallback = setInterval(() => onPulse(performance.now()), CLOCK_PULSE_MS);
  };

  if (typeof Worker === 'undefined') {
    startFallback();
    return () => { if (fallback !== null) clearInterval(fallback); };
  }

  let worker;
  let workerUrl;
  try {
    workerUrl = URL.createObjectURL(
      new Blob([EMULATION_CLOCK_WORKER], { type: 'text/javascript' }),
    );
    worker = new Worker(workerUrl);
    worker.onmessage = () => onPulse(performance.now());
    worker.onerror = () => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      startFallback();
    };
    worker.postMessage('start');
  } catch {
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    startFallback();
  }

  return () => {
    if (worker) {
      worker.postMessage('stop');
      worker.terminate();
    }
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    if (fallback !== null) clearInterval(fallback);
  };
}

// ---------------------------------------------------------------------------
// Renderer — screen-render.md SCREEN-FRAMEBUFFER-001: extract the bitmap bit (MSB
// leftmost), decode the attribute through @zx-vibes/ula pixelColorIndex with the FLASH
// phase, map the index through the palette, write RGBA. Reads the live machine memory
// (displayByteAddress/attributeAddress return absolute 0x4000+ addresses). The 256x192
// display content is written inset by the visible border margins into the 320x240
// bordered frame (RASTER-GEOMETRY-001); the caller paints the border rows first.
// ---------------------------------------------------------------------------
function renderInto(imageData, memory, frame) {
  const data = imageData.data;
  const phase = flashPhase(frame);
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    let cursor = ((y + BORDER_Y) * OUT_WIDTH + BORDER_X) * 4;
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const displayByte = memory[displayByteAddress(x, y)] & 0xff;
      const pixelOn = (displayByte >> (7 - (x & 7))) & 1;
      const attr = memory[attributeAddress(x, y)] & 0xff;
      const index = pixelColorIndex(attr, pixelOn, phase) & 0x0f;
      const rgb = PALETTE_RGB[index];
      data[cursor] = rgb[0];
      data[cursor + 1] = rgb[1];
      data[cursor + 2] = rgb[2];
      data[cursor + 3] = 255;
      cursor += 4;
    }
  }
}

// ---------------------------------------------------------------------------
// Live reload over SSE (preview --watch, RT-PROD-PREVIEW-005): `reload` after a
// clean rebuild; `build-error` (replayed on connect) while the source is broken —
// the server keeps serving the last good program and the page says why.
// ---------------------------------------------------------------------------
function connectLiveReload(onBuildError) {
  if (typeof EventSource === 'undefined') return;
  try {
    const es = new EventSource('events');
    es.addEventListener('reload', () => window.location.reload());
    es.addEventListener('build-error', (event) => {
      let message = '';
      try {
        message = JSON.parse(event.data).message || '';
      } catch {
        message = String(event.data || '');
      }
      onBuildError(message);
    });
  } catch {
    /* SSE unavailable — the player still runs, just without live reload. */
  }
}

// ---------------------------------------------------------------------------
// Boot the player against the served program.
// ---------------------------------------------------------------------------
async function boot() {
  const status = document.getElementById('status');
  const errorBox = document.getElementById('error');
  const setStatus = (t) => { if (status) status.textContent = t; };
  const showError = (text) => {
    if (!errorBox) return;
    errorBox.textContent = text || '';
    errorBox.hidden = !text;
  };

  // Listen before decoding: a program that fails to load still reloads once fixed.
  connectLiveReload((message) => {
    setStatus('build failed — still running the previous build (fix the source to reload)');
    showError(message || 'the rebuild failed');
  });

  let meta, programBytes, rom;
  try {
    const [metaRes, romRes] = await Promise.all([fetch('program.json'), fetch('rom')]);
    meta = await metaRes.json();
    rom = new Uint8Array(await romRes.arrayBuffer());
    programBytes = meta.kind === 'blank'
      ? new Uint8Array(0)
      : new Uint8Array(await (await fetch('program.bin')).arrayBuffer());
  } catch (err) {
    setStatus('preview: failed to load program from server: ' + errorText(err));
    return;
  }

  // Decode exactly as the server validated it (../src/preview/player-boot.ts). A file
  // the codecs reject says so here instead of leaving the page on "loading…".
  let booted;
  try {
    booted = bootPreviewProgram(meta.kind, programBytes, meta.org ?? 0, rom);
  } catch (err) {
    setStatus('preview: cannot load ' + (meta.label || 'the program'));
    showError(errorText(err));
    return;
  }
  const machine = booted.machine;
  setStatus(booted.status);

  const keyboard = new HostKeyboard(booted.border);
  machine.io = keyboard;

  // ---- beeper + border event capture ---------------------------------------
  // Both stamped as (tStatesTotal - frame start): a monotonic 0..~69888 offset.
  // machine.clock (tStatesTotal mod 69888) would wrap MID-frame — the final
  // instruction overshoots the boundary — scrambling the ascending-time logs.
  const beeper = new Beeper();
  let emulatedFrameStartTStates = machine.tStatesTotal;
  keyboard.onSpeaker = (level) =>
    beeper.edge(machine.tStatesTotal - emulatedFrameStartTStates, level);
  // This frame's border-changing writes, flat [t, colour, ...] (RT-PROD-PREVIEW-008);
  // collapsed to per-scanline colours at each frame end, reusing one row buffer.
  const borderLog = [];
  const borderRows = new Uint8Array(OUT_HEIGHT).fill(keyboard.border & 0x07);
  keyboard.onBorder = (colour) =>
    borderLog.push(machine.tStatesTotal - emulatedFrameStartTStates, colour);

  const soundBtn = document.createElement('button');
  soundBtn.type = 'button';
  soundBtn.style.cssText =
    'font:inherit;color:inherit;background:#222;border:1px solid #444;border-radius:3px;' +
    'padding:1px 7px;margin-left:8px;cursor:pointer';
  const paintSound = () => {
    if (beeper.failed) { soundBtn.textContent = '🔇 no audio: ' + beeper.failed; return; }
    if (!beeper.ready) { soundBtn.textContent = '🔈 click for sound'; return; }
    soundBtn.textContent = beeper.muted ? '🔇 sound off' : '🔊 sound on';
  };
  paintSound();
  soundBtn.addEventListener('click', async () => {
    // The click is the gesture an autoplay-suspended context needs; after that the
    // button just toggles mute.
    if (!beeper.ready) await beeper.enable();
    else beeper.setMuted(!beeper.muted);
    paintSound();
  });
  if (status && status.parentElement) status.parentElement.appendChild(soundBtn);
  // Playing straight away needs a gesture too, so take the first keypress as one.
  window.addEventListener('keydown', async function armAudio() {
    window.removeEventListener('keydown', armAudio);
    await beeper.enable();
    paintSound();
  }, { once: true });

  // ---- tape: the LD-BYTES trap + the `LOAD ""` typing -----------------------
  // Two separate lifetimes (../src/preview/autoload.ts): the trap serves blocks for as
  // long as the tape has any — a loader asks for its later blocks long after the
  // typing — while the typing owns the keyboard only until `LOAD ""` + ENTER have been
  // typed and released (~3 s after power-on), then hands it back to the host.
  const tape = booted.tape;
  const trap = tape
    ? createLdBytesTrap(tape, ({ ok, remaining }) => {
        const done = tape.blocks.length - remaining;
        if (remaining > 0) {
          setStatus('.' + meta.kind + ' — loading block ' + done + ' of ' + tape.blocks.length);
        } else {
          // The last block: a failure here is the program's/ROM's to report (e.g. "R Tape
          // loading error"), so the status says the tape ran out rather than "running".
          setStatus(ok
            ? '.' + meta.kind + ' loaded — running'
            : '.' + meta.kind + ' — tape ended; its last block did not load');
        }
      })
    : null;
  let autotype = booted.autotype; // the `LOAD ""` schedule; null once it has been typed

  // ---- host keyboard wiring (real interactive input) -----------------------
  // Held host keys, event.code -> event.key AT KEYDOWN. The full matrix set is
  // recomputed from this on every event (host-keys.ts resolveHeldMatrix): a
  // symbol chord's identity is the key captured at keydown, so releasing the
  // host Shift before the symbol key still releases SYMBOL_SHIFT+P cleanly —
  // per-event keyup mapping would see "2" where the keydown saw '"' and leave
  // the chord stuck.
  //
  // Two pieces of per-hold state:
  //   - stickyShift: a Shift code that produced a symbol keeps its CAPS
  //     suppressed until it is physically released (host-keys.ts), so the
  //     few-millisecond gap where the Shift outlives its symbol key cannot
  //     pulse CAPS into the same scan as the latched chord (= EXTENDED mode).
  //   - keyboard.keys.tap(): every key that APPEARS in the resolved set is
  //     buffered for the next frame's scan (KBD-LATCH-001, scan = frame) — except
  //     a CAPS that exists only because a host Shift is held, whose sub-frame
  //     pulses are resolution artifacts, not user taps (a bare-CAPS tap types
  //     nothing on the machine; combo CAPS — arrows, DELETE — arrives with its
  //     partner from the same named mapping and is buffered with it).
  const held = new Map();
  const stickyShift = new Set();
  let resolvedKeys = new Set();
  const syncHeldKeys = () => {
    let symbolNow = false;
    for (const [, key] of held) {
      if (key.length === 1 && key in SYMBOL_CHAR_KEYS) { symbolNow = true; break; }
    }
    if (symbolNow) {
      for (const [code] of held) if (isHostShiftCode(code)) stickyShift.add(code);
    }
    const next = resolveHeldMatrix(held, stickyShift);
    const withoutShifts = new Map([...held].filter(([code]) => !isHostShiftCode(code)));
    const nextSansShift = resolveHeldMatrix(withoutShifts, stickyShift);
    for (const k of next) {
      if (!resolvedKeys.has(k)) {
        const shiftOnlyCaps = k === 'CAPS_SHIFT' && !nextSansShift.has('CAPS_SHIFT');
        if (!shiftOnlyCaps) keyboard.keys.tap(k);
      }
    }
    resolvedKeys = next;
    for (const k of KEY_NAMES) {
      if (next.has(k)) keyboard.keys.down(k);
      else keyboard.keys.up(k);
    }
  };
  window.addEventListener('keydown', (e) => {
    if (autotype) return; // typing `LOAD ""`: the autoload owns the keyboard until then
    if (!claimsBrowserEvent(e)) return; // F-keys / OS chords stay with the browser
    held.set(e.code, e.key);
    syncHeldKeys();
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (isHostShiftCode(e.code)) stickyShift.delete(e.code);
    if (!held.delete(e.code)) return; // we never claimed its keydown
    syncHeldKeys();
    e.preventDefault();
  });

  // ---- the 50.08 Hz emulation clock + independently throttled renderer -----
  const canvas = document.getElementById('screen');
  canvas.width = OUT_WIDTH;
  canvas.height = OUT_HEIGHT;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(OUT_WIDTH, OUT_HEIGHT);
  let frameCounter = 0; // emulated frames since power-on (FLASH phase, typing schedule)

  /** Press the scheduled `LOAD ""` keys for the frame about to run; hand back at the end. */
  function applyAutotype() {
    if (!autotype) return;
    if (frameCounter >= autotype.end) {
      // Typed and released: the host keyboard is live again (the tape trap stays).
      autotype = null;
      syncHeldKeys();
      return;
    }
    const keys = scheduledKeys(autotype, frameCounter);
    for (const k of KEY_NAMES) {
      if (keys.includes(k)) keyboard.keys.down(k);
      else keyboard.keys.up(k);
    }
  }

  let clockState = createPreviewFrameClock(performance.now());
  function advanceEmulation(now) {
    const advanced = advancePreviewFrameClock(clockState, now, {
      frameDurationMs: FRAME_MS,
      maxCatchUpFrames: MAX_CATCH_UP_FRAMES,
    });
    clockState = advanced.state;
    for (let step = 0; step < advanced.frames; step += 1) {
      applyAutotype();
      keyboard.keys.beginScan(); // freeze this frame's visible key set (KBD-LATCH-001)
      emulatedFrameStartTStates = machine.tStatesTotal;
      // The colour in force at the top of this frame is whatever the previous
      // frame left behind; the log then collects this frame's changes.
      const borderCarry = keyboard.border;
      borderLog.length = 0;
      stepFrame(machine, trap);
      beeper.endFrame();   // one frame of speaker edges -> one buffer of samples
      borderRowsFromLog(borderLog, borderCarry, borderRows); // -> scanline colours
      frameCounter += 1;
    }
  }
  const stopEmulationClock = startEmulationClock(advanceEmulation);
  window.addEventListener('pagehide', (event) => {
    // A page kept in the back/forward cache can resume; let its Worker survive.
    if (!event.persisted) stopEmulationClock();
  }, { once: true });

  // Paint only when an emulated frame has run since the last paint: rAF fires at the
  // display rate (60-144 Hz) while the machine makes 50.08 frames a second.
  let paintedFrame = -1;
  function render() {
    if (paintedFrame !== frameCounter) {
      paintedFrame = frameCounter;
      // Border rows first (the in-canvas raster border), then the display content
      // inset over it — the border is real pixels, not page CSS.
      fillBorderRows(image.data, borderRows, PALETTE_RGB);
      renderInto(image, machine.memory, frameCounter);
      ctx.putImageData(image, 0, 0);
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

function start() {
  boot().catch((err) => {
    const status = document.getElementById('status');
    if (status) status.textContent = 'preview: player failed: ' + errorText(err);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
