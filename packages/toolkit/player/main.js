// Bundled CORE preview player — the D4 in-browser runner (cli.md CLI-PROD-PREVIEW-001,
// toolkit-runtime.md RT-PROD-PREVIEW-001). It runs the RECONSTRUCTED @zx-vibes/machine
// (NOT the legacy @zx-vibes/emulator) in the browser: it boots a clean 48K ROM machine,
// loads the program the preview server serves, targets the exact 48K frame cadence
// on a visibility-independent clock, renders separately, and
//   - renders the 256x192 framebuffer to a <canvas> using the EXACT screen-render.md
//     (SCREEN-FRAMEBUFFER-001) decode + palette.yaml (SCREEN-PALETTE-001) colour table, and
//   - maps the host keyboard onto the 48K matrix per keyboard-input.md (KBD-MATRIX-001 /
//     KBD-BROWSERMAP-001 / KBD-LATCH-001), and
//   - renders port-0xFE bit-4 edges through a continuous Web Audio stream after a
//     browser user gesture.
//
// This file is authored in browser JS and bundled by tsup (tsup.player.config.ts,
// platform:browser, noExternal @zx-vibes/*) into assets/preview/player.js, so the
// reconstructed cores are inlined and run client-side. It imports ONLY the public core
// packages — never the toolkit's node-only modules and never the legacy emulator.

import {
  createMachine,
  RESET_REGISTERS,
  acceptInterrupt,
  INT_DATA_BUS,
  readZ80,
  parseTap,
  parseTzx,
  instantLoad,
  LD_BYTES_ENTRY,
} from '@zx-vibes/machine';
import {
  FRAME_T_STATES,
  interruptActive,
  displayByteAddress,
  attributeAddress,
  DISPLAY_FILE_BASE,
  pixelColorIndex,
  flashPhase,
} from '@zx-vibes/ula';
import {
  createPreviewBeeperState,
  renderPreviewBeeperChunk,
} from '../src/preview/beeper-model.ts';
import {
  advancePreviewFrameClock,
  createPreviewFrameClock,
} from '../src/preview/frame-clock.ts';

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

// ---------------------------------------------------------------------------
// Keyboard — the 48K matrix (KBD-MATRIX-001) + the browser-key map (KBD-BROWSERMAP-001)
// + the quick-tap latch (KBD-LATCH-001). Mirrors the toolkit's schedule.ts so the host
// player and the headless `--keys` model read the same matrix.
// ---------------------------------------------------------------------------
const KEY_MATRIX = {
  CAPS_SHIFT: [0, 0], Z: [0, 1], X: [0, 2], C: [0, 3], V: [0, 4],
  A: [1, 0], S: [1, 1], D: [1, 2], F: [1, 3], G: [1, 4],
  Q: [2, 0], W: [2, 1], E: [2, 2], R: [2, 3], T: [2, 4],
  1: [3, 0], 2: [3, 1], 3: [3, 2], 4: [3, 3], 5: [3, 4],
  0: [4, 0], 9: [4, 1], 8: [4, 2], 7: [4, 3], 6: [4, 4],
  P: [5, 0], O: [5, 1], I: [5, 2], U: [5, 3], Y: [5, 4],
  ENTER: [6, 0], L: [6, 1], K: [6, 2], J: [6, 3], H: [6, 4],
  SPACE: [7, 0], SYMBOL_SHIFT: [7, 1], M: [7, 2], N: [7, 3], B: [7, 4],
};

/** Map a browser KeyboardEvent.key to zero or more Spectrum matrix keys (KBD-BROWSERMAP-001). */
function mapBrowserKey(key) {
  if (key.length === 1) {
    const up = key.toUpperCase();
    if (up >= 'A' && up <= 'Z') return [up];
    if (up >= '0' && up <= '9') return [up];
    if (key === ' ') return ['SPACE'];
  }
  switch (key) {
    case 'Enter': return ['ENTER'];
    case ' ': return ['SPACE'];
    case 'Shift': return ['CAPS_SHIFT'];
    case 'Control': return ['SYMBOL_SHIFT'];
    case 'ArrowLeft': return ['CAPS_SHIFT', '5'];
    case 'ArrowDown': return ['CAPS_SHIFT', '6'];
    case 'ArrowUp': return ['CAPS_SHIFT', '7'];
    case 'ArrowRight': return ['CAPS_SHIFT', '8'];
    case 'Backspace':
    case 'Delete': return ['CAPS_SHIFT', '0'];
    case 'Escape': return ['CAPS_SHIFT', 'SPACE'];
    default: return [];
  }
}

/** IN (0xFE) byte for a pressed-key set + a port high byte (KBD-MATRIX-001). */
function keyboardByte(pressed, highByte, earLevel) {
  let keyBits = 0x1f;
  for (let row = 0; row < 8; row += 1) {
    if ((highByte & (1 << row)) !== 0) continue;
    let rowMask = 0x1f;
    for (const k of pressed) {
      const cell = KEY_MATRIX[k];
      if (cell && cell[0] === row) rowMask &= ~(1 << cell[1]) & 0x1f;
    }
    keyBits &= rowMask;
  }
  return (keyBits & 0x1f) | 0x20 | 0x80 | (earLevel ? 0x40 : 0);
}

/**
 * Host keyboard state with the quick-tap latch (KBD-LATCH-001): a key released before
 * any matrix scan observed it stays visible for exactly one subsequent scan; a key held
 * across a scan releases immediately on key-up; a key-up with no matching live key-down
 * registers no phantom press.
 */
class HostKeyboard {
  constructor() {
    this.live = new Set();      // physically down now
    this.latched = new Set();   // released-but-not-yet-scanned (one scan)
    this.unseen = new Set();    // live keys a scan has not observed yet
    this.border = 7;
    this.earLevel = 0;
  }
  down(spectrumKey) {
    if (!(spectrumKey in KEY_MATRIX)) return;
    if (!this.live.has(spectrumKey)) {
      this.live.add(spectrumKey);
      this.unseen.add(spectrumKey);
    }
  }
  up(spectrumKey) {
    if (!this.live.has(spectrumKey)) return; // no phantom press
    this.live.delete(spectrumKey);
    if (this.unseen.has(spectrumKey)) {
      // Released before a scan saw it → latch for one scan.
      this.unseen.delete(spectrumKey);
      this.latched.add(spectrumKey);
    }
  }
  pressedSet() {
    const s = new Set(this.live);
    for (const k of this.latched) s.add(k);
    return s;
  }
  // The machine `io` contract.
  read(port) {
    if ((port & 0x01) === 0) {
      const pressed = this.pressedSet();
      const byte = keyboardByte(pressed, (port >> 8) & 0xff, this.earLevel);
      // A read IS a scan: live keys are now seen; latched keys release after this scan.
      for (const k of pressed) this.unseen.delete(k);
      this.latched.clear();
      return byte;
    }
    return 0xff; // undriven odd ports float idle high (no Kempston bound to the host here)
  }
  write(port, value) {
    if ((port & 0x01) !== 0) return;
    this.border = value & 0x07;
    const level = (value >> 4) & 1;
    if (level !== this.earLevel) {
      this.earLevel = level;
      // Bit 4 is the speaker (host-io-port-fe.md HOST-IO-PORTFE-BEEPER-001). Report the
      // transition with the frame clock so the beeper can place it in time; without a
      // timestamp the pitch would depend on how many OUTs happen to land per frame.
      if (this.onSpeaker) this.onSpeaker(level);
    }
  }
}

// ---------------------------------------------------------------------------
// Beeper — port 0xFE bit 4 to Web Audio (beeper-output.md).
//
// The CLI already turns the same signal into a WAV (`run --wav`); this is the browser
// half. Every level change is stamped with the frame clock, and at the end of each
// emulated frame the resulting step function is integrated into one sample per output
// sample — area-averaged, not point-sampled, because a 4 kHz square wave point-sampled
// at 48 kHz aliases audibly.
//
// Sample delivery is an AudioWorklet fed by postMessage. No SharedArrayBuffer, so the
// preview server needs no COOP/COEP headers.
// ---------------------------------------------------------------------------
const CPU_HZ = 3_500_000;
const BEEPER_GAIN = 0.22;   // a 1-bit square wave at full scale is harsh

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
      // Bound the latency. The run loop can emit up to 8 frames in one clock pulse, so a
      // slow tab would otherwise build a queue that plays seconds behind the picture.
      let total = -this.read;
      for (const q of this.queue) total += q.length;
      while (this.queue.length > 1 && total > sampleRate * 0.1) {
        total -= this.queue[0].length - this.read;
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
// Frame stepper — mirrors Machine.runFrame (machine-execution.md MACHINE-FRAME-LOOP-001):
// the once-per-frame INT sampled at instruction boundaries with the post-EI delay, but
// with an optional per-instruction trap (used by the tape autoloader). For the normal
// running path the trap is null and this is byte-equivalent to machine.runFrame().
// ---------------------------------------------------------------------------
const EI_OPCODE = 0xfb;

function stepFrame(m, trap) {
  // Run to the frame boundary (not a fixed quantum): any overrun carried in from
  // the previous frame's final instruction shortens this frame, mirroring
  // Machine.runFrame. This pins the render point (renderInto samples memory
  // between stepFrame calls) at the top of the frame — a drifting sample point
  // catches HALT-synced games mid-erase and sprites visibly dissolve.
  const budget = FRAME_T_STATES - m.clock;
  let elapsed = 0;
  let intTaken = false;
  while (elapsed < budget) {
    if (!intTaken && Boolean(m.registers.iff1) && m.eiDelay === 0 && interruptActive(m.clock)) {
      const before = m.tStatesTotal;
      const r = acceptInterrupt({
        registers: m.registers, memory: m.memory, halted: m.halted, dataBus: INT_DATA_BUS,
      });
      m.registers = r.registers;
      m.halted = false;
      m.eiDelay = 0;
      m.clock = (m.clock + r.tStates) % FRAME_T_STATES;
      m.tStatesTotal += r.tStates;
      elapsed += m.tStatesTotal - before;
      intTaken = true;
      continue;
    }
    if (trap) trap(m);
    const wasEi = m.memory[m.registers.pc & 0xffff] === EI_OPCODE;
    if (m.eiDelay > 0) m.eiDelay -= 1;
    const before = m.tStatesTotal;
    m.stepInstruction();
    elapsed += m.tStatesTotal - before;
    if (wasEi) m.eiDelay = 1;
  }
  m.frames += 1;
}

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
// phase, map the index through the palette, write RGBA. Reads the live machine memory.
// ---------------------------------------------------------------------------
function renderInto(imageData, memory, frame) {
  const data = imageData.data;
  let cursor = 0;
  const phase = flashPhase(frame);
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
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
// displayByteAddress/attributeAddress return absolute 0x4000+ addresses; index memory
// directly (DISPLAY_FILE_BASE is exported for reference / parity with screen.ts).
void DISPLAY_FILE_BASE;

// ---------------------------------------------------------------------------
// Program loading — boots the reconstructed machine and applies the served program
// (blank / built .bin at org / .z80 snapshot / .tap or .tzx tape image).
// ---------------------------------------------------------------------------

/** A clean 64 KB power-on image: ROM at 0x0000-0x3FFF, RAM zeroed. */
function bootMemory(rom) {
  const mem = new Uint8Array(0x10000);
  mem.set(rom.subarray(0, 0x4000), 0x0000);
  return mem;
}

/** Tape blocks (tap/tzx) as a list of raw bodies [flag, ...data, checksum] (instantLoad input). */
function tapeBlocks(kind, bytes) {
  if (kind === 'tap') {
    return parseTap(bytes).map((b) => Uint8Array.of(b.flag & 0xff, ...b.data, b.checksum & 0xff));
  }
  // tzx: the standard-speed / turbo / pure-data blocks carry a `.data` body
  // [flag, ...data, checksum]; the pure-tone/pause/text blocks have none.
  return parseTzx(bytes).blocks
    .filter((b) => b.data && b.data.length >= 2)
    .map((b) => (b.data instanceof Uint8Array ? b.data : Uint8Array.from(b.data)));
}

/** A standard 17-byte tape header → { type, length, param1 } (file-formats FMT-TAP / tapeCodeHeader). */
function parseStandardHeader(body) {
  // body = [flag(0x00)][type][name x10][len LE][p1 LE][p2 LE][checksum] = 19 bytes.
  if (body.length < 19 || (body[0] & 0xff) !== 0x00) return null;
  const d = body.subarray(1); // the 17 header data bytes
  return {
    type: d[0] & 0xff,
    length: (d[11] & 0xff) | ((d[12] & 0xff) << 8),
    param1: (d[13] & 0xff) | ((d[14] & 0xff) << 8),
  };
}

/**
 * Restore the LD-BYTES caller contract after an instant-loaded block: advance IX by the
 * bytes loaded, set DE to the remainder, set CARRY = ok, then execute the routine's RET
 * (pop the return address). This reproduces the OBSERVABLE result of the real ROM LD-BYTES
 * (0x0556) for the block, using the documented `instantLoad` seam (whose correctness is
 * `instant == edge`) — no ROM bytes are fabricated.
 */
function ldBytesReturn(m, res, ix, de) {
  const loaded = res.bytesLoaded | 0;
  const newIx = (ix + loaded) & 0xffff;
  m.registers.ixh = (newIx >> 8) & 0xff;
  m.registers.ixl = newIx & 0xff;
  const newDe = (de - loaded) & 0xffff;
  m.registers.d = (newDe >> 8) & 0xff;
  m.registers.e = newDe & 0xff;
  m.registers.f = (m.registers.f & ~0x01) | (res.ok ? 0x01 : 0x00);
  const sp = m.registers.sp & 0xffff;
  const lo = m.memory[sp] & 0xff;
  const hi = m.memory[(sp + 1) & 0xffff] & 0xff;
  m.registers.pc = (hi << 8) | lo;
  m.registers.sp = (sp + 2) & 0xffff;
}

/** The autotype schedule that drives the ROM `LOAD ""` for a BASIC-loader tape (KBD-LATCH-001-paced). */
function loadTypeSchedule() {
  // K-cursor: J -> "LOAD ", then " (SYMBOL SHIFT+P) twice, then ENTER. Each key is held
  // several frames (so a 50 Hz scan always sees it) with gaps so repeats are distinct.
  return [
    { from: 40, to: 48, keys: ['J'] },
    { from: 60, to: 68, keys: ['SYMBOL_SHIFT', 'P'] },
    { from: 80, to: 88, keys: ['SYMBOL_SHIFT', 'P'] },
    { from: 100, to: 108, keys: ['ENTER'] },
  ];
}

// ---------------------------------------------------------------------------
// Boot the player against the served program.
// ---------------------------------------------------------------------------
async function boot() {
  const status = document.getElementById('status');
  const setStatus = (t) => { if (status) status.textContent = t; };

  let meta, programBytes, rom;
  try {
    const [metaRes, romRes] = await Promise.all([fetch('program.json'), fetch('rom')]);
    meta = await metaRes.json();
    rom = new Uint8Array(await romRes.arrayBuffer());
    if (meta.kind !== 'blank') {
      programBytes = new Uint8Array(await (await fetch('program.bin')).arrayBuffer());
    }
  } catch (err) {
    setStatus('preview: failed to load program from server: ' + (err && err.message));
    return;
  }

  const keyboard = new HostKeyboard();
  let machine;
  let autoload = null; // { blocks, next } when a ROM LOAD"" autoload is in progress

  if (meta.kind === 'blank') {
    machine = createMachine({ memory: bootMemory(rom), registers: { ...RESET_REGISTERS } });
    setStatus('blank 48K');
  } else if (meta.kind === 'bin') {
    const mem = bootMemory(rom);
    mem.set(programBytes, meta.org & 0xffff);
    machine = createMachine({ memory: mem, registers: { ...RESET_REGISTERS } });
    machine.registers.pc = meta.org & 0xffff;
    setStatus('program @ 0x' + (meta.org & 0xffff).toString(16).toUpperCase());
  } else if (meta.kind === 'z80') {
    const snap = readZ80(programBytes);
    const mem = snap.memory;
    mem.set(rom.subarray(0, 0x4000), 0x0000); // overlay the ROM the snapshot omits
    machine = createMachine({ memory: mem, registers: snap.registers });
    keyboard.border = snap.border & 0x07;
    setStatus('.z80 snapshot (v' + snap.version + ')');
  } else if (meta.kind === 'tap' || meta.kind === 'tzx') {
    const blocks = tapeBlocks(meta.kind, programBytes);
    const header = blocks.length > 0 ? parseStandardHeader(blocks[0]) : null;
    machine = createMachine({ memory: bootMemory(rom), registers: { ...RESET_REGISTERS } });
    if (header && header.type === 3 && blocks.length >= 2) {
      // CODE tape (e.g. the toolkit's own `build --tap`): instant-load the data block to
      // its declared address and enter it — the same convention as `run --bin`/preview bin.
      const data = blocks[1];
      const dest = header.param1 & 0xffff;
      instantLoad(machine, data, { ix: dest, de: header.length & 0xffff, flag: 0xff, load: true });
      machine.registers.pc = dest;
      setStatus('.' + meta.kind + ' CODE @ 0x' + dest.toString(16).toUpperCase());
    } else {
      // A BASIC-loader / multi-block tape: drive the REAL ROM `LOAD ""` (autotype) and trap
      // LD-BYTES (0x0556) to instant-load each block in tape order — the faithful general path.
      autoload = { blocks, next: 0 };
      setStatus('.' + meta.kind + ' — LOAD "" (autoloading)');
    }
  } else {
    setStatus('preview: unsupported program kind "' + meta.kind + '"');
    return;
  }

  machine.io = keyboard;

  // ---- beeper ---------------------------------------------------------------
  const beeper = new Beeper();
  let emulatedFrameStartTStates = machine.tStatesTotal;
  keyboard.onSpeaker = (level) =>
    beeper.edge(machine.tStatesTotal - emulatedFrameStartTStates, level);

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

  // The LD-BYTES trap for the ROM-autoload path.
  const schedule = loadTypeSchedule();
  let autoFrame = 0;
  const trap = autoload
    ? (m) => {
        if ((m.registers.pc & 0xffff) !== LD_BYTES_ENTRY) return;
        const ix = ((m.registers.ixh & 0xff) << 8) | (m.registers.ixl & 0xff);
        const de = ((m.registers.d & 0xff) << 8) | (m.registers.e & 0xff);
        const expectFlag = m.registers.a & 0xff;
        const load = (m.registers.f & 0x01) === 0x01;
        if (autoload.next >= autoload.blocks.length) {
          ldBytesReturn(m, { ok: false, bytesLoaded: 0 }, ix, de); // no more tape → load error
          return;
        }
        const body = autoload.blocks[autoload.next];
        // Serve the next block only if its flag matches what the ROM expects; otherwise
        // report a flag mismatch (nothing written) and keep it for the next request.
        if ((body[0] & 0xff) !== expectFlag) {
          ldBytesReturn(m, { ok: false, bytesLoaded: 0 }, ix, de);
          return;
        }
        autoload.next += 1;
        const res = instantLoad(m, body, { ix, de, flag: expectFlag, load });
        ldBytesReturn(m, res, ix, de);
        if (autoload.next >= autoload.blocks.length) setStatus('.' + meta.kind + ' loaded — running');
      }
    : null;

  // ---- the 50.08 Hz emulation clock + independently throttled renderer -----
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(FRAME_WIDTH, FRAME_HEIGHT);
  let frameCounter = 0;

  function applyAutotype() {
    // Inject the LOAD"" keystrokes (host policy) while the autoload is active.
    if (!autoload) return;
    const held = new Set();
    for (const ev of schedule) {
      if (autoFrame >= ev.from && autoFrame < ev.to) for (const k of ev.keys) held.add(k);
    }
    // Drive the host keyboard: press the scheduled keys, release the rest.
    for (const k of Object.keys(KEY_MATRIX)) {
      if (held.has(k)) keyboard.down(k);
      else keyboard.up(k);
    }
    autoFrame += 1;
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
      emulatedFrameStartTStates = machine.tStatesTotal;
      stepFrame(machine, trap);
      beeper.endFrame();   // one frame of speaker edges -> one buffer of samples
      frameCounter += 1;
    }
  }
  const stopEmulationClock = startEmulationClock(advanceEmulation);
  window.addEventListener('pagehide', (event) => {
    // A page kept in the back/forward cache can resume; let its Worker survive.
    if (!event.persisted) stopEmulationClock();
  }, { once: true });

  function render() {
    renderInto(image, machine.memory, frameCounter);
    ctx.putImageData(image, 0, 0);
    const wrap = document.getElementById('frame');
    if (wrap) {
      const b = PALETTE_RGB[keyboard.border & 0x07];
      wrap.style.background = 'rgb(' + b[0] + ',' + b[1] + ',' + b[2] + ')';
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // ---- host keyboard wiring (real interactive input) -----------------------
  window.addEventListener('keydown', (e) => {
    if (autoload && autoload.next < autoload.blocks.length) return; // autoload owns the keyboard
    const keys = mapBrowserKey(e.key);
    if (keys.length === 0) return;
    e.preventDefault();
    for (const k of keys) keyboard.down(k);
  });
  window.addEventListener('keyup', (e) => {
    const keys = mapBrowserKey(e.key);
    if (keys.length === 0) return;
    e.preventDefault();
    for (const k of keys) keyboard.up(k);
  });

  // ---- live-reload over SSE (preview --watch, RT-PROD-PREVIEW-005) ----------
  try {
    const es = new EventSource('events');
    es.addEventListener('reload', () => window.location.reload());
  } catch {
    /* SSE unavailable — the player still runs, just without live reload. */
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
