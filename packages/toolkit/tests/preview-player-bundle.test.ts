// Smoke test of the BUNDLED browser player (player/main.js through tsup, as
// `pnpm build` makes assets/preview/player.js) in Node against a minimal fake DOM:
// boot, the BASIC-tape autoload with the keyboard handed back after `LOAD ""`, a
// decode error shown on the page instead of "loading…", the `--watch` SSE events,
// and the render loop painting only when an emulated frame ran. The unit tests cover
// the modules; this covers the wiring in main.js.

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'tsup';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadRom } from '../src/runtime/rom.js';

const FRAME_MS = (69_888 / 3_500_000) * 1000;
// examples/full.html's sample: a BASIC program that autostarts (BORDER 1 : PAPER 1 …).
const SAMPLE_TAP = Uint8Array.from(
  Buffer.from(
    'EwAAAHp4dmliZXMgICCPAAoAjwBDkQD/AAoKAOcgMQ4AAAEAAA0AFAoA2iAxDgAAAQAADQAeCgDZIDYOAAAGAAANACgCAPsNADIgAPUgrCA4DgAACAAALDExDgAACwAAOyJaWCBWSUJFUyINADwoAPUgrCAxMA4AAAoAACw4DgAACAAAOyJsb2FkZWQgZnJvbSB0YXBlIg0ARgsA7CA3MA4AAEYAAA1j',
    'base64',
  ),
);

let workDir = '';
let bundlePath = '';
let copies = 0;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'zxs-player-bundle-'));
  await build({
    entry: { player: 'player/main.js' },
    outDir: workDir,
    format: ['esm'],
    platform: 'browser',
    target: 'es2020',
    noExternal: [/@zx-vibes\//],
    bundle: true,
    clean: false,
    splitting: false,
    sourcemap: false,
    dts: false,
    minify: false,
    silent: true,
    config: false,
  });
  bundlePath = join(workDir, 'player.js');
}, 60_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

const GLOBALS = ['document', 'window', 'fetch', 'EventSource', 'Worker', 'requestAnimationFrame', 'performance'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
afterEach(() => {
  for (const name of GLOBALS) {
    const descriptor = saved.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  saved.clear();
});

type Listener = (event: Record<string, unknown>) => unknown;

/** Load a fresh copy of the bundle into a fake page serving `meta` + `bytes`. */
async function openPlayer(meta: Record<string, unknown>, bytes: Uint8Array) {
  let now = 0;
  let puts = 0;
  let reloads = 0;
  let raf: Array<(t: number) => void> = [];
  const windowListeners = new Map<string, Listener[]>();
  const sseListeners = new Map<string, Listener[]>();
  let worker: { onmessage: (() => void) | null } | null = null;
  const status = { textContent: 'loading…', parentElement: { appendChild: () => undefined } };
  const error = { textContent: '', hidden: true };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {
        puts += 1;
      },
    }),
  };
  const elements: Record<string, unknown> = { status, error, screen: canvas };
  const define = (name: string, value: unknown): void => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  define('document', {
    readyState: 'complete',
    getElementById: (id: string) => elements[id] ?? null,
    createElement: () => ({ style: {}, textContent: '', addEventListener: () => undefined }),
    addEventListener: () => undefined,
  });
  define('window', {
    addEventListener: (type: string, fn: Listener) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]);
    },
    removeEventListener: (type: string, fn: Listener) => {
      windowListeners.set(type, (windowListeners.get(type) ?? []).filter((f) => f !== fn));
    },
    location: { reload: () => (reloads += 1) },
  });
  define('fetch', async (url: string) => {
    if (url === 'program.json') return { json: async () => meta };
    if (url === 'rom') return { arrayBuffer: async () => loadRom().slice().buffer };
    if (url === 'program.bin') return { arrayBuffer: async () => bytes.slice().buffer };
    throw new Error(`unexpected fetch ${url}`);
  });
  define(
    'EventSource',
    class {
      addEventListener(type: string, fn: Listener): void {
        sseListeners.set(type, [...(sseListeners.get(type) ?? []), fn]);
      }
    },
  );
  define(
    'Worker',
    class {
      onmessage: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        worker = this;
      }
      postMessage(): void {}
      terminate(): void {}
    },
  );
  define('requestAnimationFrame', (cb: (t: number) => void) => raf.push(cb));
  define('performance', { now: () => now });

  copies += 1;
  const copy = join(workDir, `player-${copies}.mjs`);
  copyFileSync(bundlePath, copy);
  await import(pathToFileURL(copy).href);
  for (let i = 0; i < 20 && status.textContent === 'loading…'; i += 1) await new Promise((r) => setTimeout(r, 10));

  const dispatch = (type: string, event: Record<string, unknown>): void => {
    for (const fn of [...(windowListeners.get(type) ?? [])]) void fn(event);
  };
  return {
    status,
    error,
    puts: () => puts,
    reloads: () => reloads,
    /** Advance the emulation by `frames` 48K frames (in pulses of at most 8). */
    run(frames: number): void {
      for (let left = frames; left > 0; left -= 8) {
        now += Math.min(8, left) * FRAME_MS + 1e-6;
        worker!.onmessage!();
      }
    },
    /** One animation frame: run the queued rAF callbacks. */
    paint(): void {
      const callbacks = raf;
      raf = [];
      for (const cb of callbacks) cb(now);
    },
    /** A host keydown; returns whether the player claimed it (preventDefault). */
    keydown(code: string, key: string): boolean {
      const event = { code, key, metaKey: false, prevented: false, preventDefault() { this.prevented = true; } };
      dispatch('keydown', event);
      return event.prevented;
    },
    sse(type: string, data: unknown): void {
      for (const fn of sseListeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
    },
  };
}

describe('the bundled preview player', () => {
  it('autoloads a BASIC tape, owning the keyboard only while it types LOAD ""', async () => {
    const page = await openPlayer({ mode: 'file', kind: 'tap', org: 0, label: 'sample.tap (tap)' }, SAMPLE_TAP);
    expect(page.status.textContent).toBe('.tap — LOAD "" (autoloading)');
    expect(page.error.hidden).toBe(true);

    page.run(120);
    expect(page.keydown('KeyA', 'a')).toBe(false); // typing LOAD "": host keys are not taken
    page.run(100); // the schedule ends at frame 160; LOAD "" runs and the tape loads
    expect(page.status.textContent).toBe('.tap loaded — running');
    expect(page.keydown('KeyA', 'a')).toBe(true); // the keyboard is the host's again
    expect(page.keydown('F12', 'F12')).toBe(false); // browser keys stay the browser's
  });

  it('paints only when an emulated frame has run', async () => {
    const page = await openPlayer({ mode: 'blank', kind: 'blank', org: 0, label: 'blank 48K' }, new Uint8Array(0));
    expect(page.status.textContent).toBe('blank 48K');
    page.paint();
    expect(page.puts()).toBe(1); // the initial frame
    page.paint();
    page.paint();
    expect(page.puts()).toBe(1); // nothing new to show
    page.run(1);
    page.paint();
    expect(page.puts()).toBe(2);
  });

  it('shows a decode error instead of hanging on "loading…"', async () => {
    const page = await openPlayer(
      { mode: 'file', kind: 'tzx', org: 0, label: 'broken.tzx (tzx)' },
      Uint8Array.from(Buffer.from('not a tzx file at all', 'latin1')),
    );
    expect(page.status.textContent).toBe('preview: cannot load broken.tzx (tzx)');
    expect(page.error.hidden).toBe(false);
    expect(page.error.textContent).toMatch(/parseTzx|ZXTape|signature/i);
  });

  it('shows a --watch build error, and reloads on the next good build', async () => {
    const page = await openPlayer({ mode: 'blank', kind: 'blank', org: 0, label: 'blank 48K' }, new Uint8Array(0));
    page.sse('build-error', { message: 'Cannot preview: build failed with 1 error(s) in src/main.asm:\n  src/main.asm:3: boom' });
    expect(page.status.textContent).toMatch(/^build failed/);
    expect(page.error.hidden).toBe(false);
    expect(page.error.textContent).toContain('src/main.asm:3: boom');
    page.sse('reload', { at: 1 });
    expect(page.reloads()).toBe(1);
  });
});
