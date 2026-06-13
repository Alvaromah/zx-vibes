import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(root, 'dist', 'cli', 'index.js');
const bouncePath = join(root, 'examples', 'bounce.asm');

function zxs(cwd: string, ...args: string[]) {
  const res = spawnSync('node', [cliPath, ...args], { cwd, encoding: 'utf8' });
  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(res.stdout) as Record<string, unknown>;
  } catch {
    json = undefined;
  }
  return { status: res.status ?? -1, json, stdout: res.stdout, stderr: res.stderr };
}

let cwd: string;
beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'zxs-debug-'));
  // Build records the SLD symbols path into the session meta.
  const build = zxs(cwd, 'build', bouncePath, '--out-dir', cwd, '--json');
  expect(build.status).toBe(0);
  const outputs = build.json!['outputs'] as { bin: string };
  const run = zxs(cwd, 'run', '--bin', outputs.bin, '--org', '0x8000', '--frames', '10', '--json');
  expect(run.status).toBe(0);
});

describe('source-level debugging from a shell (Phase 2 demo)', () => {
  it('break add by label resolves through SLD symbols', () => {
    const res = zxs(cwd, 'break', 'add', 'move_ball', '--json');
    expect(res.status).toBe(0);
    const added = res.json!['added'] as Record<string, unknown>;
    expect(added['spec']).toBe('move_ball');
    expect(String(added['addr'])).toMatch(/^0x80/);
  });

  it('run --until-break stops at the breakpoint with symbolication and source', () => {
    const res = zxs(cwd, 'run', '--until-break', '--json');
    expect(res.status).toBe(0);
    expect(res.json!['status']).toBe('breakpoint');
    const bp = res.json!['breakpoint'] as { addr: string; source?: { file: string; line: number } };
    expect(bp.addr).toContain('move_ball');
    expect(bp.source?.file).toContain('bounce.asm');
  });

  it('step advances and reports symbolicated disassembly', () => {
    const res = zxs(cwd, 'step', '3', '--json');
    expect(res.status).toBe(0);
    expect(res.json!['stepped']).toBe(3);
    const disasm = res.json!['disasm'] as { addr: string; text: string }[];
    expect(disasm.length).toBeGreaterThan(0);
    expect(String(res.json!['pc'])).toContain('move_ball');
  });

  it('disasm by label shows move_ball code', () => {
    const res = zxs(cwd, 'disasm', 'move_ball', '--count', '4', '--json');
    expect(res.status).toBe(0);
    const lines = res.json!['lines'] as { addr: string; text: string }[];
    expect(lines[0]!.addr).toContain('move_ball');
    expect(lines[0]!.text).toMatch(/^LD A,\(0x/); // ld a,(DX)
  });

  it('break add by file:line works', () => {
    const src = readFileSync(bouncePath, 'utf8').split('\n');
    const labelLine = src.findIndex((l) => l.startsWith('draw_ball:')) + 1; // 1-based
    const res = zxs(cwd, 'break', 'add', `bounce.asm:${labelLine}`, '--json');
    expect(res.status).toBe(0);
    const added = res.json!['added'] as { addr: string };
    const disasm = zxs(cwd, 'disasm', 'draw_ball', '--count', '1', '--json');
    const firstLine = (disasm.json!['lines'] as { addr: string }[])[0]!;
    expect(firstLine.addr.startsWith(added.addr.slice(0, 6))).toBe(true);
  });

  it('resuming from a breakpoint does not instantly re-trigger it', () => {
    zxs(cwd, 'break', 'rm', 'all', '--json');
    zxs(cwd, 'break', 'add', 'move_ball', '--json');
    const first = zxs(cwd, 'run', '--until-break', '--json');
    expect(first.json!['status']).toBe('breakpoint');
    const second = zxs(cwd, 'run', '--until-break', '--json');
    expect(second.json!['status']).toBe('breakpoint');
    // Two distinct hits: the second run made real progress (frames or tstates).
    expect(second.json!['tstatesRun']).toBeGreaterThan(0);
  });

  it('watchpoint on screen writes fires and names the writer', () => {
    zxs(cwd, 'break', 'rm', 'all', '--json');
    const add = zxs(cwd, 'watch', 'add', '--write', '0x4000-0x57FF', '--json');
    expect(add.status).toBe(0);
    const res = zxs(cwd, 'run', '--until-break', '--json');
    expect(res.status).toBe(0);
    expect(res.json!['status']).toBe('watchpoint');
    const hit = res.json!['watchpoint'] as { type: string; addr: string; pc: string };
    expect(hit.type).toBe('write');
    expect(hit.pc).toContain('fill_lines'); // the shared draw/erase fill loop
    zxs(cwd, 'watch', 'rm', 'all', '--json');
  });

  it('trace identifies the hot loop with symbols', () => {
    const res = zxs(cwd, 'trace', '--frames', '5', '--json');
    expect(res.status).toBe(0);
    expect(res.json!['instructions']).toBeGreaterThan(1000);
    const hot = res.json!['hot'] as { pc: string; count: number }[];
    expect(hot.length).toBeGreaterThan(0);
    expect(hot[0]!.count).toBeGreaterThan(500);
    expect(hot.some((h) => h.pc.includes('main_loop'))).toBe(true);
  });

  it('step --over runs CALLs to completion', () => {
    const over = join(cwd, 'over.bin');
    // CALL 0x8006 ; JR $ ; NOP ; sub: LD A,5 ; RET
    writeFileSync(over, Buffer.from([0xcd, 0x06, 0x80, 0x18, 0xfe, 0x00, 0x3e, 0x05, 0xc9]));
    const setup = zxs(cwd, 'run', '--bin', over, '--org', '0x8000', '--until-pc', '0x8000', '--frames', '5', '--json');
    expect(setup.status).toBe(0);

    const res = zxs(cwd, 'step', '1', '--over', '--json');
    expect(res.status).toBe(0);
    expect(String(res.json!['pc'])).toContain('0x8003'); // landed after the CALL
    const regs = res.json!['registers'] as { af: string };
    expect(regs.af.startsWith('0x05')).toBe(true); // the subroutine ran (A=5)
  });
});
