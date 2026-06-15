import { writeFileSync } from 'node:fs';
import {
  attrMapPng,
  blitLinearToScreen,
  findGraphicsCandidates,
  linearBitmapPng,
  spectrumScreenPng,
} from '../../core/gfx.js';
import { loadMachineFromSource, type MachineSourceOptions } from '../machine-source.js';
import { EXIT, emit, ensureParentDir, hex, parseAddress, parseCount, parseInteger } from '../output.js';

interface GfxSourceOptions extends MachineSourceOptions {
  json: boolean;
}

export function gfxScreenCommand(opts: GfxSourceOptions & { out: string; scale: string }): number {
  const loaded = loadMachineFromSource(opts, 'gfx');
  const png = spectrumScreenPng(
    loaded.machine.memory.getScreenMemory(),
    loaded.machine.memory.getAttributeMemory(),
    parseScale(opts.scale)
  );
  ensureParentDir(opts.out);
  writeFileSync(opts.out, png);
  emit(
    { ok: true, stage: 'gfx', kind: 'screen', png: opts.out, source: loaded.source },
    opts.json,
    () => `rendered screen PNG to ${opts.out}`
  );
  return EXIT.OK;
}

export function gfxAttrsCommand(opts: GfxSourceOptions & { out: string; scale: string }): number {
  const loaded = loadMachineFromSource(opts, 'gfx');
  const png = attrMapPng(loaded.machine.memory.getAttributeMemory(), parseScale(opts.scale));
  ensureParentDir(opts.out);
  writeFileSync(opts.out, png);
  emit(
    { ok: true, stage: 'gfx', kind: 'attrs', png: opts.out, source: loaded.source },
    opts.json,
    () => `rendered attribute map PNG to ${opts.out}`
  );
  return EXIT.OK;
}

export function gfxLinearCommand(
  addr: string,
  opts: GfxSourceOptions & {
    out: string;
    widthBytes: string;
    height: string;
    stride?: string;
    count: string;
    columns?: string;
    scale: string;
    ink?: string;
    paper?: string;
    invert?: boolean;
  }
): number {
  const loaded = loadMachineFromSource(opts, 'gfx');
  const start = parseAddress(addr);
  const widthBytes = parseCount(opts.widthBytes, 'width-bytes', 64);
  const height = parseCount(opts.height, 'height', 512);
  const stride = opts.stride ? parseCount(opts.stride, 'stride', 1024) : widthBytes;
  const count = parseCount(opts.count, 'count', 1024);
  const len = stride * height * count;
  const data = loaded.machine.readMemory(start, len);
  const renderOpts: Parameters<typeof linearBitmapPng>[1] = {
    widthBytes,
    height,
    stride,
    count,
    scale: parseScale(opts.scale),
  };
  if (opts.columns) renderOpts.columns = parseCount(opts.columns, 'columns', count);
  if (opts.ink) renderOpts.ink = parseInteger(opts.ink, 'ink', { min: 0, max: 7 });
  if (opts.paper) renderOpts.paper = parseInteger(opts.paper, 'paper', { min: 0, max: 7 });
  if (opts.invert !== undefined) renderOpts.invert = opts.invert;
  const png = linearBitmapPng(data, renderOpts);
  ensureParentDir(opts.out);
  writeFileSync(opts.out, png);
  emit(
    {
      ok: true,
      stage: 'gfx',
      kind: 'linear',
      addr: hex(start),
      bytes: len,
      png: opts.out,
      source: loaded.source,
    },
    opts.json,
    () => `rendered ${count} linear bitmap item(s) from ${hex(start)} to ${opts.out}`
  );
  return EXIT.OK;
}

export function gfxFontCommand(
  addr: string,
  opts: GfxSourceOptions & { out: string; glyphs: string; columns: string; scale: string; invert?: boolean }
): number {
  return gfxLinearCommand(addr, {
    ...opts,
    widthBytes: '1',
    height: '8',
    stride: '8',
    count: opts.glyphs,
    columns: opts.columns,
  });
}

export function gfxFindCommand(opts: GfxSourceOptions): number {
  const loaded = loadMachineFromSource(opts, 'gfx');
  const candidates = findGraphicsCandidates(loaded.machine.memory.ram).map((c) => ({
    ...c,
    start: hex(c.start),
    end: hex(c.end),
  }));
  emit(
    { ok: true, stage: 'gfx', kind: 'find', candidates, source: loaded.source },
    opts.json,
    () =>
      candidates
        .map((c) => `${String(c.score).padStart(5)} ${c.kind.padEnd(14)} ${c.start}-${c.end} entropy=${c.entropy}`)
        .join('\n')
  );
  return EXIT.OK;
}

export function gfxBlitLinearCommand(
  addr: string,
  opts: GfxSourceOptions & {
    out: string;
    x: string;
    y: string;
    widthBytes: string;
    height: string;
    stride?: string;
    xor?: boolean;
    scale: string;
  }
): number {
  const loaded = loadMachineFromSource(opts, 'gfx');
  const start = parseAddress(addr);
  const widthBytes = parseCount(opts.widthBytes, 'width-bytes', 64);
  const height = parseCount(opts.height, 'height', 512);
  const stride = opts.stride ? parseCount(opts.stride, 'stride', 1024) : widthBytes;
  const data = loaded.machine.readMemory(start, stride * height);
  const blitOpts: Parameters<typeof blitLinearToScreen>[2] = {
    x: parseInteger(opts.x, 'x', { min: 0, max: 255 }),
    y: parseInteger(opts.y, 'y', { min: 0, max: 191 }),
    widthBytes,
    height,
    stride,
  };
  if (opts.xor !== undefined) blitOpts.xor = opts.xor;
  const screen = blitLinearToScreen(loaded.machine.memory.getScreenMemory(), data, blitOpts);
  const png = spectrumScreenPng(screen, loaded.machine.memory.getAttributeMemory(), parseScale(opts.scale));
  ensureParentDir(opts.out);
  writeFileSync(opts.out, png);
  emit(
    { ok: true, stage: 'gfx', kind: 'blit-linear', addr: hex(start), png: opts.out, source: loaded.source },
    opts.json,
    () => `rendered simulated linear blit from ${hex(start)} to ${opts.out}`
  );
  return EXIT.OK;
}

function parseScale(value: string): number {
  return parseInteger(value, 'scale', { min: 1, max: 16 });
}
