// Assertion-engine self-tests (REC-PROD-AC-VOCAB-001): a PASS and a FAIL case for
// each of the 16 assertion types, driving `evaluateAssertion` against constructed
// snapshots, plus the `--list-assertions` reference (exactly 16, ASSERT-PROD-LIST-001).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { displayByteAddress } from '@zx-vibes/machine';
import {
  evaluateAssertion,
  ASSERTION_REFERENCE,
  type RawAssertion,
  type RunContext,
  type Snapshot,
} from '../src/test/assertions.js';
import {
  hashBytes,
  romFontGlyphs,
  renderRgbaImage,
  SCREEN_BASE,
  SCREEN_IMAGE_SIZE,
} from '../src/observe/screen.js';
import { decodeFlags, type RegisterSnapshot } from '../src/observe/registers.js';
import { runCli } from '../src/cli.js';
import { ExitCode, type OutputStreams } from '../src/output/envelope.js';

const ATTR_BASE = 0x5800;

function regs(over: Partial<RegisterSnapshot> = {}): RegisterSnapshot {
  return {
    pc: 0, sp: 0, af: 0, bc: 0, de: 0, hl: 0,
    alt: { af: 0, bc: 0, de: 0, hl: 0 },
    ix: 0, iy: 0, i: 0, r: 0, im: 0,
    iff1: false, iff2: false, halted: false, flags: decodeFlags(0),
    ...over,
  };
}

interface SnapOver {
  border?: number;
  registers?: RegisterSnapshot;
  beeperEdges?: number;
  portFEWrites?: number;
  frame?: number;
}

/** Build a snapshot from a 64 KB memory builder + scalar overrides. */
function snap(build: (mem: Uint8Array) => void = () => {}, over: SnapOver = {}): Snapshot {
  const memory = new Uint8Array(0x10000);
  build(memory);
  const screen = memory.subarray(SCREEN_BASE, SCREEN_BASE + SCREEN_IMAGE_SIZE);
  return {
    frame: over.frame ?? 0,
    memory,
    screen,
    screenHash: hashBytes(screen),
    border: over.border ?? 7,
    registers: over.registers ?? regs(),
    beeperEdges: over.beeperEdges ?? 0,
    portFEWrites: over.portFEWrites ?? 0,
  };
}

function ctx(over: Partial<RunContext> = {}): RunContext {
  return {
    start: over.start ?? snap(),
    status: over.status ?? 'ok',
    haltSynced: over.haltSynced ?? false,
    framesRun: over.framesRun ?? 120,
    checkpoints: over.checkpoints ?? new Map(),
    symbols: over.symbols ?? new Map(),
    specDir: over.specDir ?? '',
  };
}

const ev = (a: RawAssertion, target: Snapshot, c: RunContext = ctx()): string | null =>
  evaluateAssertion(a, target, c);

// --- screen builders -------------------------------------------------------

function putText(mem: Uint8Array, col: number, row: number, text: string): void {
  const font = romFontGlyphs();
  for (let i = 0; i < text.length; i += 1) {
    const glyph = font[text.charCodeAt(i) - 0x20];
    if (!glyph) continue;
    for (let line = 0; line < 8; line += 1) {
      mem[displayByteAddress((col + i) * 8, row * 8 + line)] = glyph[line]!;
    }
  }
}
function setPixel(mem: Uint8Array, x: number, y: number): void {
  mem[displayByteAddress(x, y)]! |= 1 << (7 - (x & 7));
}
function fillAttr(mem: Uint8Array, byte: number): void {
  for (let i = ATTR_BASE; i <= 0x5aff; i += 1) mem[i] = byte;
}

// ===========================================================================

describe('status (ASSERT-PROD-STATUS-001) — source: run outcome', () => {
  it('passes / fails', () => {
    expect(ev({ type: 'status', equals: 'ok' }, snap(), ctx({ status: 'ok' }))).toBeNull();
    expect(ev({ type: 'status', equals: 'hang' }, snap(), ctx({ status: 'ok' }))).toMatch(/status/);
  });
});

describe('haltSynced (ASSERT-PROD-HALT-001) — source: HALT/interrupt cadence', () => {
  it('passes / fails', () => {
    expect(ev({ type: 'haltSynced', equals: true }, snap(), ctx({ haltSynced: true }))).toBeNull();
    expect(ev({ type: 'haltSynced', equals: true }, snap(), ctx({ haltSynced: false }))).toMatch(/haltSynced/);
  });
});

describe('screenIncludes (ASSERT-PROD-SCREENINC-001) — source: ROM-font OCR', () => {
  it('passes / fails', () => {
    const s = snap((m) => putText(m, 4, 2, 'SCORE 000010'));
    expect(ev({ type: 'screenIncludes', text: 'SCORE 000010' }, s)).toBeNull();
    expect(ev({ type: 'screenIncludes', text: 'GAME OVER' }, s)).toMatch(/not found/);
  });
});

describe('cellsNonBlank (ASSERT-PROD-CELLS-001) — source: screen bitmap', () => {
  it('passes / fails', () => {
    const s = snap((m) => setPixel(m, 0, 0)); // one non-blank cell
    expect(ev({ type: 'cellsNonBlank', min: 1, max: 1 }, s)).toBeNull();
    expect(ev({ type: 'cellsNonBlank', min: 2 }, s)).toMatch(/below min/);
  });
});

describe('attrNonBlank (ASSERT-PROD-ATTR-001) — source: attribute file', () => {
  it('passes / fails', () => {
    const s = snap((m) => {
      fillAttr(m, 0x38); // default → 0 non-blank
      m[ATTR_BASE] = 0x07;
      m[ATTR_BASE + 1] = 0x46;
    });
    expect(ev({ type: 'attrNonBlank', min: 2, max: 2 }, s)).toBeNull();
    expect(ev({ type: 'attrNonBlank', max: 1 }, s)).toMatch(/above max/);
  });
});

describe('screenChanged (ASSERT-PROD-SCRCHG-001) — source: pre/post hash', () => {
  it('passes / fails', () => {
    const start = snap();
    const changed = snap((m) => setPixel(m, 5, 5));
    expect(ev({ type: 'screenChanged', equals: true }, changed, ctx({ start }))).toBeNull();
    expect(ev({ type: 'screenChanged', equals: true }, start, ctx({ start }))).toMatch(/screenChanged/);
  });
});

describe('memEquals (ASSERT-PROD-MEM-001) — source: memory', () => {
  it('passes / fails', () => {
    const s = snap((m) => {
      m[0x9000] = 0x28;
      m[0x9001] = 0xff;
    });
    expect(ev({ type: 'memEquals', addr: '0x9000', hex: '28 ff' }, s)).toBeNull();
    expect(ev({ type: 'memEquals', addr: '0x9000', hex: '29' }, s)).toMatch(/memEquals/);
  });
});

describe('regEquals (ASSERT-PROD-REG-001) — source: registers', () => {
  it('passes / fails (8-bit, 16-bit, address-form value)', () => {
    const s = snap(() => {}, { registers: regs({ af: 0x4200, hl: 0x1234 }) });
    expect(ev({ type: 'regEquals', reg: 'a', value: 0x42 }, s)).toBeNull();
    expect(ev({ type: 'regEquals', reg: 'HL', value: '0x1234' }, s)).toBeNull();
    expect(ev({ type: 'regEquals', reg: 'a', value: 0x43 }, s)).toMatch(/regEquals/);
  });
});

describe('pixelAt (ASSERT-PROD-PIXEL-001) — source: screen bitmap bit', () => {
  it('passes / fails', () => {
    const s = snap((m) => setPixel(m, 10, 10));
    expect(ev({ type: 'pixelAt', x: 10, y: 10, set: true }, s)).toBeNull();
    expect(ev({ type: 'pixelAt', x: 11, y: 10, set: true }, s)).toMatch(/pixelAt/);
  });
});

describe('borderColor (ASSERT-PROD-BORDER-001) — source: ULA border', () => {
  it('passes / fails', () => {
    const s = snap(() => {}, { border: 2 });
    expect(ev({ type: 'borderColor', equals: 2 }, s)).toBeNull();
    expect(ev({ type: 'borderColor', equals: 3 }, s)).toMatch(/borderColor/);
  });
});

describe('beeperEdges (ASSERT-PROD-BEEPER-001) — source: HostIo edge count', () => {
  it('passes / fails', () => {
    const s = snap(() => {}, { beeperEdges: 5 });
    expect(ev({ type: 'beeperEdges', min: 1 }, s)).toBeNull();
    expect(ev({ type: 'beeperEdges', min: 6 }, s)).toMatch(/below min/);
  });
});

describe('portFEWrites (ASSERT-PROD-PORTFE-001) — source: HostIo write count', () => {
  it('passes / fails', () => {
    const s = snap(() => {}, { portFEWrites: 10 });
    expect(ev({ type: 'portFEWrites', max: 20 }, s)).toBeNull();
    expect(ev({ type: 'portFEWrites', max: 5 }, s)).toMatch(/above max/);
  });
});

describe('memInRange (ASSERT-PROD-MEMRANGE-001) — source: unsigned mem value', () => {
  it('passes / fails (2-byte LE)', () => {
    const s = snap((m) => {
      m[0x6000] = 50; // LE low
      m[0x6001] = 0;
    });
    expect(ev({ type: 'memInRange', addr: '0x6000', size: 2, min: 10, max: 99 }, s)).toBeNull();
    expect(ev({ type: 'memInRange', addr: '0x6000', size: 2, min: 60 }, s)).toMatch(/below min/);
  });
});

describe('memDelta (ASSERT-PROD-MEMDELTA-001) — source: signed start→end change', () => {
  it('passes (increase) / fails / signed decrease', () => {
    const start = snap((m) => {
      m[0x6000] = 10;
    });
    const up = snap((m) => {
      m[0x6000] = 15;
    });
    expect(ev({ type: 'memDelta', addr: '0x6000', min: 1 }, up, ctx({ start }))).toBeNull();
    expect(ev({ type: 'memDelta', addr: '0x6000', min: 6 }, up, ctx({ start }))).toMatch(/below min/);

    const startHi = snap((m) => {
      m[0x6000] = 20;
    });
    const down = snap((m) => {
      m[0x6000] = 15;
    });
    // signed −5 is within [,-1]
    expect(ev({ type: 'memDelta', addr: '0x6000', max: -1 }, down, ctx({ start: startHi }))).toBeNull();
  });
});

describe('at (ASSERT-PROD-AT-001) — source: checkpoint snapshot', () => {
  it('passes against a captured checkpoint / fails when frame past run length / rejects nested', () => {
    const cp = snap((m) => setPixel(m, 200, 96));
    const checkpoints = new Map([[100, cp]]);
    const c = ctx({ checkpoints, framesRun: 200 });

    expect(
      ev({ type: 'at', frame: 100, assert: [{ type: 'pixelAt', x: 200, y: 96, set: true }] }, snap(), c),
    ).toBeNull();
    // Frame past the run length → no snapshot → fail.
    expect(
      ev({ type: 'at', frame: 300, assert: [{ type: 'pixelAt', x: 200, y: 96, set: true }] }, snap(), c),
    ).toMatch(/no checkpoint/);
    // Nested at is rejected (one level only).
    expect(
      ev({ type: 'at', frame: 100, assert: [{ type: 'at', frame: 50, assert: [] }] }, snap(), c),
    ).toMatch(/nested "at"/);
  });
});

describe('screenDiff (ASSERT-PROD-SCREENDIFF-001) — source: framebuffer vs golden PNG', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zxs-diff-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeBaseline(name: string, screen: Uint8Array): void {
    const rgba = renderRgbaImage(screen, 0);
    const png = new PNG({ width: rgba.width, height: rgba.height });
    png.data = Buffer.from(rgba.data);
    writeFileSync(join(dir, name), PNG.sync.write(png));
  }

  it('exact-match passes; a divergent frame exceeds maxDiff and fails; missing baseline fails', () => {
    const s = snap((m) => {
      fillAttr(m, 0x38);
      putText(m, 4, 4, 'HELLO');
    });
    writeBaseline('golden.png', s.screen); // deterministic baseline from the renderer
    const c = ctx({ specDir: dir });

    // Same screen → 0 differing pixels → pass at maxDiff 0.
    expect(ev({ type: 'screenDiff', baseline: 'golden.png', maxDiff: 0 }, s, c)).toBeNull();

    // A changed screen diverges by > 0 pixels → fail.
    const changed = snap((m) => {
      fillAttr(m, 0x38);
      putText(m, 4, 4, 'WORLD');
    });
    expect(ev({ type: 'screenDiff', baseline: 'golden.png', maxDiff: 0 }, changed, c)).toMatch(
      /differing pixel/,
    );

    // Missing baseline → fail (regenerate hint).
    expect(ev({ type: 'screenDiff', baseline: 'absent.png' }, s, c)).toMatch(/baseline not found/);
  });
});

// --- the assertion reference (ASSERT-PROD-LIST-001) -------------------------

describe('--list-assertions (ASSERT-PROD-LIST-001 / REC-PROD-AC-VOCAB-001)', () => {
  it('the reference lists exactly the 16 types (coloredCells dropped)', () => {
    const types = ASSERTION_REFERENCE.map((d) => d.type);
    expect(types).toHaveLength(16);
    expect(new Set(types).size).toBe(16);
    expect(types).toEqual(
      expect.arrayContaining([
        'status', 'haltSynced', 'screenIncludes', 'cellsNonBlank', 'attrNonBlank',
        'screenChanged', 'memEquals', 'regEquals', 'pixelAt', 'borderColor',
        'beeperEdges', 'portFEWrites', 'at', 'memInRange', 'memDelta', 'screenDiff',
      ]),
    );
    expect(types).not.toContain('coloredCells');
  });

  it('zxs test --list-assertions --json prints exactly 16 reference entries', async () => {
    const out: string[] = [];
    const streams: OutputStreams = { out: (t) => out.push(t), err: () => {} };
    const code = await runCli(['test', '--list-assertions', '--json'], { streams });
    expect(code).toBe(ExitCode.OK);
    const env = JSON.parse(out.join('').trim());
    expect(env.ok).toBe(true);
    expect(env.stage).toBe('test');
    expect(env.assertions).toHaveLength(16);
    for (const entry of env.assertions) {
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('fields');
      expect(entry).toHaveProperty('description');
    }
  });
});
