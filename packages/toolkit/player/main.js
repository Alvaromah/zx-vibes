// Bundled CORE preview player — the D4 in-browser runner (cli.md CLI-PROD-PREVIEW-001,
// toolkit-runtime.md RT-PROD-PREVIEW-001). It runs the RECONSTRUCTED @zx-vibes/machine
// (NOT the legacy @zx-vibes/emulator) in the browser: it boots a clean 48K ROM machine,
// loads the program the preview server serves, executes ~50 emulated frames/second, and
//   - renders the 256x192 framebuffer to a <canvas> using the EXACT screen-render.md
//     (SCREEN-FRAMEBUFFER-001) decode + palette.yaml (SCREEN-PALETTE-001) colour table, and
//   - maps the host keyboard onto the 48K matrix per keyboard-input.md (KBD-MATRIX-001 /
//     KBD-BROWSERMAP-001 / KBD-LATCH-001).
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
    this.earLevel = (value >> 4) & 1;
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

  // ---- the ~50 Hz run + render loop ----------------------------------------
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(FRAME_WIDTH, FRAME_HEIGHT);
  const FRAME_MS = 20; // 50 emulated frames per second
  let acc = 0;
  let last = performance.now();
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

  function tick(now) {
    acc += now - last;
    last = now;
    let steps = 0;
    while (acc >= FRAME_MS && steps < 8) {
      applyAutotype();
      stepFrame(machine, trap);
      frameCounter += 1;
      acc -= FRAME_MS;
      steps += 1;
    }
    if (steps === 0) { /* keep cadence without over-running */ }
    renderInto(image, machine.memory, frameCounter);
    ctx.putImageData(image, 0, 0);
    const wrap = document.getElementById('frame');
    if (wrap) {
      const b = PALETTE_RGB[keyboard.border & 0x07];
      wrap.style.background = 'rgb(' + b[0] + ',' + b[1] + ',' + b[2] + ')';
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

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
