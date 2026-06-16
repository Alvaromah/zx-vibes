import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build } from '../../src/build/sjasmplus.js';
import { SymbolTable } from '../../src/core/symbols.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const outDir = () => mkdtempSync(join(tmpdir(), 'zxs-spectral-asm-'));
const spectralAsmAvailable =
  existsSync(join(root, '..', 'asm', 'dist', 'index.js')) ||
  existsSync(join(root, 'node_modules', '@zx-vibes', 'asm', 'dist', 'index.js'));

const describeIfSpectralAsm = spectralAsmAvailable ? describe : describe.skip;

describeIfSpectralAsm('@zx-vibes/asm backend', () => {
  it('assembles hello.asm with SLD symbols through the Spectral build wrapper', async () => {
    const result = await build(join(fixtures, 'hello.asm'), {
      outDir: outDir(),
      assembler: 'spectral',
    });

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.outputs.bin).toBeDefined();
    expect(result.outputs.sld).toBeDefined();
    expect(readFileSync(result.outputs.bin!).length).toBe(27);

    const symbols = SymbolTable.parse(readFileSync(result.outputs.sld!, 'utf8'));
    expect(symbols.resolve('start')).toBe(0x8000);
    expect(symbols.resolve('hello.asm:6')).toBe(0x8000);
  });

  it('builds the starter game template with the embedded assembler', async () => {
    const result = await build(join(root, 'templates/game/src/main.asm'), {
      outDir: outDir(),
      assembler: 'spectral',
    });

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(readFileSync(result.outputs.bin!).length).toBeGreaterThan(200);
  });

  it('propagates SAVEBIN artifact outputs from the embedded assembler', async () => {
    const dir = outDir();
    const entry = join(dir, 'main.asm');
    writeFileSync(
      entry,
      [
        '    DEVICE ZXSPECTRUM48',
        '    ORG 0x8000',
        'start:',
        '    db 1,2,3,4',
        '    SAVEBIN "part.bin", start, 4',
        '',
      ].join('\n')
    );

    const result = await build(entry, {
      outDir: join(dir, 'build'),
      assembler: 'spectral',
    });

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.outputs.artifacts).toHaveLength(1);
    expect(readFileSync(result.outputs.artifacts![0]!)).toEqual(Buffer.from([1, 2, 3, 4]));
  });
});
