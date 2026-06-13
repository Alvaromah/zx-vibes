import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from '../../src/build/sjasmplus.js';
import { SymbolTable } from '../../src/core/symbols.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

let table: SymbolTable;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zxs-sld-'));
  const result = await build(join(fixtures, 'hello.asm'), { outDir: dir });
  expect(result.ok).toBe(true);
  table = SymbolTable.parse(readFileSync(result.outputs.sld!, 'utf8'));
});

describe('SymbolTable', () => {
  it('parses label definitions from SLD', () => {
    expect(table.labels.get('start')).toBe(0x8000);
    expect(table.labels.get('print_loop')).toBe(0x8008);
    expect(table.labels.get('done')).toBe(0x8010);
    expect(table.labels.get('msg')).toBe(0x8012);
  });

  it('resolves specs: hex, label, case-insensitive label, file:line', () => {
    expect(table.resolve('0x8008')).toBe(0x8008);
    expect(table.resolve('print_loop')).toBe(0x8008);
    expect(table.resolve('PRINT_LOOP')).toBe(0x8008);
    expect(table.resolve('hello.asm:6')).toBe(0x8000); // ld a, 2
    expect(table.resolve('no_such_label')).toBeUndefined();
  });

  it('snaps file:line breakpoints forward to the next code line', () => {
    // Line 5 is the bare `start:` label line — code starts at line 6.
    expect(table.resolve('hello.asm:5')).toBe(0x8000);
  });

  it('maps addresses back to source', () => {
    const loc = table.addrToSource(0x8000);
    expect(loc?.file).toContain('hello.asm');
    expect(loc?.line).toBe(6);
  });

  it('symbolicates with nearest label and offset', () => {
    expect(table.symbolicate(0x8008)).toBe('0x8008 (print_loop)');
    expect(table.symbolicate(0x800a)).toBe('0x800A (print_loop+0x2)');
    expect(table.symbolicate(0x0038)).toBe('0x0038'); // ROM: no labels in range
  });
});
