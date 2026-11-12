// `preview --watch` — toolkit-runtime.md RT-PROD-PREVIEW-005: the watched set is the
// build's dependency set (INCLUDEs wherever they live, INCBIN data, refreshed after
// every rebuild), and a failed rebuild pushes a `build-error` event (logged, replayed
// to pages that connect while it lasts) instead of silently serving the old program.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewServer, type PreviewServer } from '../src/preview/server.js';
import { resolvePreviewProgram } from '../src/preview/program.js';
import { newToken } from '../src/preview/lifecycle.js';
import { projectWatchPaths, scanAsmDependencies, sldSourceFiles } from '../src/preview/deps.js';
import { SourceWatcher } from '../src/preview/watch.js';
import { userError } from '../src/output/envelope.js';

const openServers: PreviewServer[] = [];
const aborters: AbortController[] = [];
const tmpDirs: string[] = [];

afterEach(async () => {
  for (const c of aborters.splice(0)) c.abort();
  await Promise.all(openServers.splice(0).map((s) => s.close().catch(() => undefined)));
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

function write(path: string, text: string | Uint8Array): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** The scaffold layout: src/main.asm INCLUDEs ../lib/*.asm (starters/game). */
function scaffoldProject(): string {
  const dir = tmp('zxs-preview-deps-');
  write(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'src/main.asm', org: '0x8000', outDir: 'build' }));
  write(
    join(dir, 'src', 'main.asm'),
    [
      '    ORG 0x8000',
      'start:',
      '    call clear',
      '    jr start',
      '    INCLUDE "../lib/screen.asm"',
      '; INCLUDE "../lib/commented-out.asm"',
      '',
    ].join('\n'),
  );
  write(join(dir, 'lib', 'screen.asm'), ['clear:', '    xor a', '    ret', ''].join('\n'));
  return dir;
}

/** A tiny SSE client: collects named events, waits for the next one of a kind. */
async function openEvents(url: string) {
  const ac = new AbortController();
  aborters.push(ac);
  const res = await fetch(`${url}/events`, { signal: ac.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ event: string; data: string }> = [];
  let buffer = '';
  let consumed = 0;
  const pump = async (): Promise<void> => {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('SSE stream closed');
    buffer += decoder.decode(chunk.value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? '';
      if (event) events.push({ event, data });
    }
  };
  /** The next not-yet-consumed event (of any kind), within `timeoutMs`. */
  const next = async (timeoutMs = 4000): Promise<{ event: string; data: string }> => {
    const deadline = Date.now() + timeoutMs;
    while (events.length <= consumed) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('timed out waiting for an SSE event');
      await Promise.race([
        pump(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for an SSE event')), left)),
      ]);
    }
    return events[consumed++]!;
  };
  return { next };
}

async function startWatchedServer(
  overrides: Partial<Parameters<typeof createPreviewServer>[0]>,
): Promise<PreviewServer> {
  const server = await createPreviewServer({
    program: resolvePreviewProgram({ blank: true }),
    port: 0,
    token: newToken(),
    watchIntervalMs: 40,
    log: () => undefined,
    ...overrides,
  });
  openServers.push(server);
  return server;
}

// ===========================================================================

describe('the watched set is the build dependency set', () => {
  it('follows INCLUDE (nested, outside src/) and INCBIN, ignores comments, keeps missing targets', () => {
    const dir = scaffoldProject();
    write(join(dir, 'lib', 'screen.asm'), ['clear:', '    INCLUDE "util.asm"', '    ret', ''].join('\n'));
    write(join(dir, 'lib', 'util.asm'), ['sprite: INCBIN "../assets/sprite.bin", 0, 8', ''].join('\n'));
    write(join(dir, 'assets', 'sprite.bin'), new Uint8Array(8));
    const main = join(dir, 'src', 'main.asm');
    write(main, `    ORG 0x8000\n    INCLUDE "../lib/screen.asm"\n    INCLUDE 'not-yet.asm'\n; INCLUDE "gone.asm"\n`);

    const deps = scanAsmDependencies(main);
    expect(deps).toEqual(
      expect.arrayContaining([
        main,
        join(dir, 'lib', 'screen.asm'),
        join(dir, 'lib', 'util.asm'),
        join(dir, 'assets', 'sprite.bin'),
        join(dir, 'src', 'not-yet.asm'), // watched so creating it rebuilds
      ]),
    );
    expect(deps).not.toContain(join(dir, 'src', 'gone.asm'));
  });

  it('adds the config and the last build\'s SLD sources, never anything under outDir', () => {
    const dir = scaffoldProject();
    const elsewhere = join(dir, 'gen', 'tables.asm');
    write(
      join(dir, 'build', 'main.sld'),
      [
        '|SLD.data.version|1',
        `${elsewhere}|1||0|2|32768|T|`,
        `${join(dir, 'build', 'generated.asm')}|1||0|2|32770|T|`,
        '',
      ].join('\n'),
    );
    const paths = projectWatchPaths(dir);
    expect(paths).toEqual(
      expect.arrayContaining([
        join(dir, 'zx.config.json'),
        join(dir, 'src', 'main.asm'),
        join(dir, 'lib', 'screen.asm'),
        elsewhere,
      ]),
    );
    expect(paths.some((p) => p.startsWith(join(dir, 'build')))).toBe(false);
    expect(sldSourceFiles('|SLD.data.version|1\n<memory>|1||0|2|0|T|\n')).toEqual([]);
  });

  it('SourceWatcher.setPaths baselines new paths and keeps pending changes on old ones', () => {
    const dir = tmp('zxs-preview-setpaths-');
    const a = join(dir, 'a.asm');
    const b = join(dir, 'b.asm');
    write(a, '1');
    write(b, '1');
    let changes = 0;
    const watcher = new SourceWatcher([a], () => (changes += 1), 60_000).start();
    try {
      write(a, '22'); // changed, not yet polled
      watcher.setPaths([a, b]); // b is new: baselined, not a change
      watcher.poll();
      expect(changes).toBe(1); // a's change survived the swap
      watcher.poll();
      expect(changes).toBe(1);
      write(b, '333');
      watcher.poll();
      expect(changes).toBe(2);
      expect([...watcher.watchedPaths()]).toEqual([a, b]);
    } finally {
      watcher.stop();
    }
  });
});

describe('a failed --watch rebuild is reported, not swallowed', () => {
  it('broadcasts build-error (no reload), logs it, replays it to new pages, then reloads once fixed', async () => {
    const dir = tmp('zxs-preview-builderr-');
    const src = join(dir, 'main.asm');
    write(src, 'v1');
    let broken = true;
    const logs: string[] = [];
    const program = resolvePreviewProgram({ blank: true });
    const server = await startWatchedServer({
      watchPaths: [src],
      rebuild: () => {
        if (broken) throw userError('Cannot preview: build failed with 1 error(s) in main.asm:\n  main.asm:3: boom', 'preview');
        return program;
      },
      log: (line) => logs.push(line),
    });
    const page = await openEvents(server.url);

    write(src, 'v2 broken');
    const failed = await page.next();
    expect(failed.event).toBe('build-error');
    expect(JSON.parse(failed.data).message).toContain('main.asm:3: boom');
    expect(server.buildError()).toContain('main.asm:3: boom');
    expect(logs.join('')).toContain('rebuild failed');
    expect(logs.join('')).toContain('main.asm:3: boom');

    // A page opened (or reloaded) meanwhile is told at once.
    const late = await openEvents(server.url);
    const replayed = await late.next();
    expect(replayed.event).toBe('build-error');
    expect(JSON.parse(replayed.data).message).toContain('boom');

    broken = false;
    write(src, 'v3 fixed');
    expect((await page.next()).event).toBe('reload');
    expect((await late.next()).event).toBe('reload');
    expect(server.buildError()).toBeUndefined();
  });

  it('end to end on the scaffold layout: break ../lib, see the assembler error, fix it, reload; a new INCLUDE is watched', async () => {
    const dir = scaffoldProject();
    const server = await startWatchedServer({
      program: resolvePreviewProgram({ cwd: dir }),
      watchPaths: projectWatchPaths(dir),
      refreshWatchPaths: () => projectWatchPaths(dir),
      rebuild: () => resolvePreviewProgram({ cwd: dir }),
    });
    const page = await openEvents(server.url);
    const lib = join(dir, 'lib', 'screen.asm');

    // Break the INCLUDEd library file (outside the entry's directory).
    write(lib, ['clear:', '    frobnicate a', '    ret', ''].join('\n'));
    const failed = await page.next();
    expect(failed.event).toBe('build-error');
    const message = JSON.parse(failed.data).message as string;
    expect(message).toContain('Cannot preview: build failed with');
    expect(message).toMatch(/lib\/screen\.asm:2:/);

    // Fix it: a clean rebuild reloads the page.
    write(lib, ['clear:', '    xor a', '    ret', ''].join('\n'));
    expect((await page.next()).event).toBe('reload');

    // A new INCLUDE joins the watched set after the rebuild that introduced it.
    const extra = join(dir, 'lib', 'extra.asm');
    write(extra, ['extra:', '    ret', ''].join('\n'));
    write(
      join(dir, 'src', 'main.asm'),
      ['    ORG 0x8000', 'start:', '    call clear', '    jr start', '    INCLUDE "../lib/screen.asm"', '    INCLUDE "../lib/extra.asm"', ''].join('\n'),
    );
    expect((await page.next()).event).toBe('reload');
    write(extra, ['extra:', '    nop', '    ret', ''].join('\n'));
    expect((await page.next()).event).toBe('reload');
  });
});
