import { describe, expect, it } from 'vitest';
import {
  createPreviewBeeperState,
  renderPreviewBeeperChunk,
  speakerMixLevel,
  EAR_MIX_WEIGHT,
  MIC_MIX_WEIGHT,
  type PreviewBeeperEdge,
} from '../src/preview/beeper-model.js';
import {
  advancePreviewFrameClock,
  createPreviewFrameClock,
} from '../src/preview/frame-clock.js';
import {
  SYMBOL_CHAR_KEYS,
  claimsBrowserEvent,
  mapBrowserKey,
  resolveHeldMatrix,
} from '../src/preview/host-keys.js';
import {
  BORDER_X,
  BORDER_Y,
  OUT_HEIGHT,
  OUT_WIDTH,
  borderRowsFromLog,
  fillBorderRows,
  scanlineStartT,
} from '../src/preview/border-frame.js';

const CPU_HZ = 3_500_000;
const FRAME_T_STATES = 69_888;
const FRAME_MS = (FRAME_T_STATES / CPU_HZ) * 1000;

describe('preview beeper streaming model', () => {
  it('uses one continuous fractional sample grid without long-run frame drift', () => {
    let state = createPreviewBeeperState();
    let samples = 0;
    for (let frame = 0; frame < 200; frame += 1) {
      const rendered = renderPreviewBeeperChunk(state, [], FRAME_T_STATES, {
        sampleRate: 44_100,
        cpuHz: CPU_HZ,
      });
      state = rendered.state;
      samples += rendered.samples.length;
    }
    expect(samples).toBe(Math.floor((200 * FRAME_T_STATES * 44_100) / CPU_HZ));
  });

  it('is sample-for-sample continuous when the same edge stream is split', () => {
    const edges: PreviewBeeperEdge[] = [
      { t: 10_000, level: 1 },
      { t: 65_000, level: 0 },
      { t: 75_000, level: 1 },
      { t: 110_000, level: 0 },
    ];
    const options = { sampleRate: 48_000, cpuHz: CPU_HZ };
    const whole = renderPreviewBeeperChunk(
      createPreviewBeeperState(),
      edges,
      FRAME_T_STATES * 2,
      options,
    );

    const first = renderPreviewBeeperChunk(
      createPreviewBeeperState(),
      edges,
      FRAME_T_STATES,
      options,
    );
    const second = renderPreviewBeeperChunk(
      first.state,
      first.carryEdges,
      FRAME_T_STATES,
      options,
    );

    expect([...first.samples, ...second.samples]).toEqual([...whole.samples]);
    expect(second.state).toEqual(whole.state);
  });
});

describe('speaker EAR+MIC mix (BEEPER-PCM-MIX-001)', () => {
  it('weights EAR strongly and MIC weakly, as a sum', () => {
    expect(speakerMixLevel(0x00)).toBe(0);
    expect(speakerMixLevel(0x10)).toBe(EAR_MIX_WEIGHT); // EAR only
    expect(speakerMixLevel(0x08)).toBe(MIC_MIX_WEIGHT); // MIC only — the ROM SAVE
    expect(speakerMixLevel(0x18)).toBe(1);              // both in phase: full swing
    // Border bits and the unused high bits do not leak into the drive.
    expect(speakerMixLevel(0x07)).toBe(0);
    expect(speakerMixLevel(0xe7)).toBe(0);
  });

  it('renders a MIC-only SAVE tone as a soft but non-silent waveform', () => {
    // A ~1 kHz MIC square wave: alternate drive 0 <-> 0.2 every 1750 T-states.
    const edges: PreviewBeeperEdge[] = [];
    for (let t = 0, level = 1; t < 69_888; t += 1750, level ^= 1) {
      edges.push({ t, level: level ? speakerMixLevel(0x08) : 0 });
    }
    const rendered = renderPreviewBeeperChunk(
      createPreviewBeeperState(),
      edges,
      69_888,
      { sampleRate: 44_100, cpuHz: 3_500_000 },
    );
    const min = Math.min(...rendered.samples);
    const max = Math.max(...rendered.samples);
    // Drive 0 -> -1, drive 0.2 -> -0.6: audible motion, one-fifth of full swing.
    // (6-digit tolerance: the samples are float32.)
    expect(min).toBe(-1);
    expect(max).toBeCloseTo(2 * MIC_MIX_WEIGHT - 1, 6);
    expect(max - min).toBeCloseTo(2 * MIC_MIX_WEIGHT, 6);
  });

  it('keeps split-chunk continuity with fractional levels', () => {
    const edges: PreviewBeeperEdge[] = [
      { t: 10_000, level: 0.2 },
      { t: 40_000, level: 1 },
      { t: 90_000, level: 0.8 },
    ];
    const options = { sampleRate: 48_000, cpuHz: 3_500_000 };
    const whole = renderPreviewBeeperChunk(createPreviewBeeperState(), edges, 139_776, options);
    const first = renderPreviewBeeperChunk(createPreviewBeeperState(), edges, 69_888, options);
    const second = renderPreviewBeeperChunk(first.state, first.carryEdges, 69_888, options);
    expect([...first.samples, ...second.samples]).toEqual([...whole.samples]);
    expect(second.state).toEqual(whole.state);
  });
});

describe('browser-key host mapping (KBD-BROWSERMAP-001/-002)', () => {
  it('maps punctuation characters to their SYMBOL SHIFT chords', () => {
    expect(mapBrowserKey(',')).toEqual(['SYMBOL_SHIFT', 'N']);
    expect(mapBrowserKey('.')).toEqual(['SYMBOL_SHIFT', 'M']);
    expect(mapBrowserKey('"')).toEqual(['SYMBOL_SHIFT', 'P']);
    expect(mapBrowserKey('-')).toEqual(['SYMBOL_SHIFT', 'J']);
    expect(mapBrowserKey('?')).toEqual(['SYMBOL_SHIFT', 'C']);
    // Letters/digits stay direct; EXTENDED-mode characters stay unmapped.
    expect(mapBrowserKey('z')).toEqual(['Z']);
    expect(mapBrowserKey('5')).toEqual(['5']);
    expect(mapBrowserKey('[')).toEqual([]);
    // Every table entry is a SYMBOL SHIFT chord onto a real direct key.
    for (const [char, chord] of Object.entries(SYMBOL_CHAR_KEYS)) {
      expect(chord[0], char).toBe('SYMBOL_SHIFT');
      expect(chord[1]).toMatch(/^[A-Z0-9]$/);
    }
  });

  it('suppresses CAPS from a host Shift held only to produce a symbol', () => {
    // UK layout: '"' arrives as Shift+2 — the chord must be SYM+P, NOT CAPS+SYM+P
    // (CAPS+SYM would drop the machine into EXTENDED mode mid-chord).
    const held = new Map([
      ['ShiftLeft', 'Shift'],
      ['Digit2', '"'],
    ]);
    expect(resolveHeldMatrix(held)).toEqual(new Set(['SYMBOL_SHIFT', 'P']));
  });

  it('keeps a lone Shift as CAPS, and Shift+Ctrl reaches EXTENDED mode', () => {
    expect(resolveHeldMatrix(new Map([['ShiftLeft', 'Shift']]))).toEqual(
      new Set(['CAPS_SHIFT']),
    );
    expect(
      resolveHeldMatrix(new Map([
        ['ShiftLeft', 'Shift'],
        ['ControlLeft', 'Control'],
      ])),
    ).toEqual(new Set(['CAPS_SHIFT', 'SYMBOL_SHIFT']));
  });

  it('keeps suppressing CAPS for the rest of a Shift hold that produced a symbol', () => {
    // '"' released a few ms BEFORE the Shift (every host staggers this): the
    // Shift is briefly alone in the held map. Without the sticky memory CAPS
    // would pulse back in that gap, land in the same scan as the latched
    // SYM+P chord, and read as EXTENDED mode.
    const held = new Map([['ShiftLeft', 'Shift']]); // symbol key already gone
    const sticky = new Set(['ShiftLeft']);          // marked while '"' was held
    expect(resolveHeldMatrix(held, sticky)).toEqual(new Set());
    // Without the sticky memory the CAPS pulse appears — the failure mode.
    expect(resolveHeldMatrix(held)).toEqual(new Set(['CAPS_SHIFT']));
    // A different, unmarked Shift still maps to CAPS.
    expect(
      resolveHeldMatrix(new Map([['ShiftRight', 'Shift']]), sticky),
    ).toEqual(new Set(['CAPS_SHIFT']));
  });

  it('releases a symbol chord cleanly when the host Shift goes up first', () => {
    // keydown Shift, keydown '"' (Digit2), keyup Shift, keyup Digit2. The held map
    // keys entries by event.code with the key captured AT KEYDOWN, so the '"'
    // entry releases by its code even though a later event.key would read "2" —
    // per-event keyup mapping would leave SYMBOL_SHIFT+P stuck.
    const held = new Map([
      ['ShiftLeft', 'Shift'],
      ['Digit2', '"'],
    ]);
    held.delete('ShiftLeft');
    expect(resolveHeldMatrix(held)).toEqual(new Set(['SYMBOL_SHIFT', 'P']));
    held.delete('Digit2');
    expect(resolveHeldMatrix(held)).toEqual(new Set());
  });

  it('claims only keys the Spectrum can type', () => {
    expect(claimsBrowserEvent({ key: ',' })).toBe(true);
    expect(claimsBrowserEvent({ key: 'a' })).toBe(true);
    expect(claimsBrowserEvent({ key: 'F5' })).toBe(false); // browser reload stays alive
    expect(claimsBrowserEvent({ key: 'F12' })).toBe(false); // DevTools stays alive
    expect(claimsBrowserEvent({ key: 'a', metaKey: true })).toBe(false); // OS chords
    expect(claimsBrowserEvent({ key: '~' })).toBe(false); // EXTENDED-mode char, unmapped
  });
});

describe('bordered raster frame (RT-PROD-PREVIEW-008 / RASTER-GEOMETRY-001)', () => {
  it('uses the pinned 320x240 geometry anchored to the display T-states', () => {
    expect(OUT_WIDTH).toBe(320);
    expect(OUT_HEIGHT).toBe(240);
    expect(BORDER_X).toBe(32);
    expect(BORDER_Y).toBe(24);
    // First display row's visible line starts at its left border: the DNA
    // raster-geometry sample pixelTState(0, 24) = 14319.
    expect(scanlineStartT(BORDER_Y)).toBe(14_319);
    expect(scanlineStartT(BORDER_Y + 1) - scanlineStartT(BORDER_Y)).toBe(224);
  });

  it('collapses a SAVE-like border log into striped scanline colours', () => {
    // Alternate red(2)/cyan(5) every ~8 lines' worth of T-states, like tape output.
    const log: number[] = [];
    for (let t = 0, colour = 2; t < 69_888; t += 224 * 8, colour = colour === 2 ? 5 : 2) {
      log.push(t, colour);
    }
    const rows = borderRowsFromLog(log, 7);
    const distinct = new Set(rows);
    expect(distinct.has(2)).toBe(true);
    expect(distinct.has(5)).toBe(true);
    // Stripes, not a collapse to the final colour: both colours appear many times.
    const reds = [...rows].filter((c) => c === 2).length;
    const cyans = [...rows].filter((c) => c === 5).length;
    expect(reds).toBeGreaterThan(20);
    expect(cyans).toBeGreaterThan(20);
  });

  it('carries the previous frame colour and honours event ordering', () => {
    // No events: every row shows the carry.
    expect([...borderRowsFromLog([], 3)]).toEqual(new Array(OUT_HEIGHT).fill(3));
    // One mid-frame change: rows before it keep the carry, rows after take it.
    const midRowStart = scanlineStartT(120);
    const rows = borderRowsFromLog([midRowStart, 1], 6);
    expect(rows[119]).toBe(6);
    expect(rows[120]).toBe(1); // an event AT the row start is visible on that row
    expect(rows[OUT_HEIGHT - 1]).toBe(1);
  });

  it('paints border rows as RGBA pixels the display content then insets', () => {
    const palette: ReadonlyArray<readonly number[]> = [
      [0, 0, 0], [0, 0, 205], [205, 0, 0], [205, 0, 205],
      [0, 205, 0], [0, 205, 205], [205, 205, 0], [205, 205, 205],
    ];
    const rows = new Uint8Array(OUT_HEIGHT).fill(2);
    rows[0] = 5;
    const data = new Uint8ClampedArray(OUT_WIDTH * OUT_HEIGHT * 4);
    fillBorderRows(data, rows, palette);
    // Row 0 is cyan across the full width; row 1 red; alpha opaque.
    expect([data[0], data[1], data[2], data[3]]).toEqual([0, 205, 205, 255]);
    const last = (OUT_WIDTH - 1) * 4;
    expect([data[last], data[last + 1], data[last + 2]]).toEqual([0, 205, 205]);
    const row1 = OUT_WIDTH * 4;
    expect([data[row1], data[row1 + 1], data[row1 + 2]]).toEqual([205, 0, 0]);
  });
});

describe('preview emulation clock', () => {
  it('uses the exact 48K frame duration instead of a rounded 20 ms interval', () => {
    let state = createPreviewFrameClock(0);
    let frames = 0;
    for (let tick = 1; tick <= 200; tick += 1) {
      const advanced = advancePreviewFrameClock(state, tick * FRAME_MS, {
        frameDurationMs: FRAME_MS,
        maxCatchUpFrames: 8,
      });
      state = advanced.state;
      frames += advanced.frames;
    }
    expect(frames).toBe(200);
    expect(state.remainderMs).toBeLessThan(1e-8);
  });

  it('bounds catch-up and drops a hidden/suspended backlog without fast-forward', () => {
    const advanced = advancePreviewFrameClock(
      createPreviewFrameClock(0),
      1000,
      { frameDurationMs: FRAME_MS, maxCatchUpFrames: 8 },
    );
    expect(advanced.frames).toBe(8);
    expect(advanced.droppedFrames).toBeGreaterThan(40);
    expect(advanced.state.remainderMs).toBeLessThan(FRAME_MS);
  });
});
