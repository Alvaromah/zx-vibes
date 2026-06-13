import { mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build, checkToolchain, parseDiagnostics } from '../../src/build/sjasmplus.js';
import { Machine } from '../../src/core/machine.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const outDir = () => mkdtempSync(join(tmpdir(), 'zxs-build-'));

function hasSjasmplus(): boolean {
  try {
    execFileSync('sjasmplus', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const itIfSjasmplus = hasSjasmplus() ? it : it.skip;

describe('checkToolchain', () => {
  itIfSjasmplus('reports the installed version when sjasmplus is available', async () => {
    const status = await checkToolchain();
    expect(status.found).toBe(true);
    expect(status.version).toMatch(/^\d+\.\d+/);
  });

  it('reports a missing assembler with install instructions', async () => {
    const status = await checkToolchain('definitely-not-sjasmplus');
    expect(status.found).toBe(false);
    expect(status.installHint).toContain('github.com/z00m128/sjasmplus');
  });
});

describe('build', () => {
  it('assembles hello.asm with the default embedded backend into a binary plus SLD', async () => {
    const result = await build(join(fixtures, 'hello.asm'), { outDir: outDir() });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.outputs.bin).toBeDefined();
    expect(result.outputs.sld).toBeDefined();

    const bin = readFileSync(result.outputs.bin!);
    expect(bin.length).toBe(27);
    expect(bin[0]).toBe(0x3e); // ld a,2

    const sld = readFileSync(result.outputs.sld!, 'utf8');
    expect(sld).toContain('|start');
  });

  it('parses diagnostics with source line and did-you-mean hint', async () => {
    const result = await build(join(fixtures, 'bad-label.asm'), { outDir: outDir() });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    const err = result.errors[0]!;
    expect(err.file).toContain('bad-label.asm');
    expect(err.line).toBe(5);
    expect(err.severity).toBe('error');
    expect(err.message).toContain('draw_sprtie');
    expect(err.sourceLine).toContain('call draw_sprtie');
    expect(err.hint).toBe("Did you mean 'draw_sprite'?");
  });
});

describe('parseDiagnostics', () => {
  it('parses sjasmplus diagnostics from Windows CRLF output', () => {
    const file = join(fixtures, 'bad-label.asm');
    const output = [
      'Pass 1 complete (0 errors)',
      'Pass 2 complete (0 errors)',
      `warning[backslash]: File name contains \\, use / instead (\\ fails on most of the supported platforms): ${file}`,
      `${file}(5): error: Label not found: draw_sprtie`,
      'Pass 3 complete',
      'Errors: 1, warnings: 1, compiled: 8 lines, work time: 0.000 seconds',
      '',
    ].join('\r\n');

    const diagnostics = parseDiagnostics(output);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      file,
      line: 5,
      severity: 'error',
      message: 'Label not found: draw_sprtie',
      sourceLine: '    call draw_sprtie',
      hint: "Did you mean 'draw_sprite'?",
    });
  });
});

describe('assemble + execute end-to-end', () => {
  it('runs hello.asm assembled by the default embedded backend', async () => {
    const result = await build(join(fixtures, 'hello.asm'), { outDir: outDir() });
    expect(result.ok).toBe(true);

    const m = Machine.boot();
    m.run({ frames: 250 }); // boot to BASIC so ROM channels are initialized
    const bin = new Uint8Array(readFileSync(result.outputs.bin!));
    m.loadBinary(bin, 0x8000);
    m.run({ frames: 10 });

    // The top screen row's first character cells must now contain pixels
    // (HELLO ZX rendered by the ROM font at line 0).
    const screen = m.memory.getScreenMemory();
    let setBytes = 0;
    for (let charRow = 0; charRow < 8; charRow++) {
      for (let col = 0; col < 8; col++) {
        if (screen[charRow * 256 + col] !== 0) setBytes++;
      }
    }
    expect(setBytes).toBeGreaterThan(8);
  });
});
