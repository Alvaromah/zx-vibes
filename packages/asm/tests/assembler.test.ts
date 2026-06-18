import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, assembleFile, writeAssemblyOutputs } from '../src/index.js';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const asmCliPath = join(packageRoot, 'dist', 'cli.js');

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

function hasSjasmplus(): boolean {
  try {
    execFileSync('sjasmplus', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sjasmplusBytes(entry: string, extraArgs: string[] = []): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
  const sjBin = join(dir, 'sj.bin');
  execFileSync('sjasmplus', ['--nologo', ...extraArgs, `--raw=${sjBin}`, entry.replace(/\\/g, '/')], {
    stdio: 'ignore',
  });
  return new Uint8Array(readFileSync(sjBin));
}

function sjasmplusBuildInSourceDir(entry: string, rawName = 'sj.bin'): { raw: Uint8Array } {
  const dir = dirname(entry);
  const sjBin = join(dir, rawName);
  execFileSync('sjasmplus', ['--nologo', `--raw=${sjBin}`, entry.replace(/\\/g, '/')], {
    cwd: dir,
    stdio: 'ignore',
  });
  return { raw: new Uint8Array(readFileSync(sjBin)) };
}

function asmCli(...args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('node', [asmCliPath, ...args], { encoding: 'utf8' });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

describe('assemble', () => {
  it('assembles a Spectral-style hello program with symbols', () => {
    const result = assemble(
      [
        '    DEVICE ZXSPECTRUM48',
        '    ORG 0x8000',
        'start:',
        '    ld a, 2',
        '    call 0x1601',
        '    ld hl, msg',
        'print_loop:',
        '    ld a, (hl)',
        '    or a',
        '    jr z, done',
        '    rst 0x10',
        '    inc hl',
        '    jr print_loop',
        'done:',
        '    jr done',
        'msg:',
        '    db "HELLO ZX", 0',
        '',
      ].join('\n'),
      { entryPath: 'hello.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('3E02CD01162112807EB72804D72318F818FE48454C4C4F205A5800');
    expect(result.sld).toContain('|32768|F|start');
    expect(result.sld).toContain('|32776|F|print_loop');
    expect(result.sld).toContain('|32768|T|');
  });

  it('reports unresolved labels with a did-you-mean hint', () => {
    const result = assemble(
      ['    ORG 0x8000', 'start:', '    call draw_sprtie', 'draw_sprite:', '    ret', ''].join('\n'),
      { entryPath: 'bad-label.asm' }
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toBe('Label not found: draw_sprtie');
    expect(result.errors[0]?.hint).toBe("Did you mean 'draw_sprite'?");
  });

  it('fails clearly for unsupported snapshot output instead of ignoring it', () => {
    const result = assemble(
      ['    ORG 0x8000', 'start:', '    ret', '    SAVESNA "hello.sna", start', ''].join('\n'),
      { entryPath: 'snapshot.asm' }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes('SAVESNA is not supported'))).toBe(true);
  });

  it('rejects malformed expressions instead of silently truncating them', () => {
    const result = assemble(['    ORG 0x8000', '    ld a, 1+', ''].join('\n'), {
      entryPath: 'bad-expr.asm',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Missing right operand after '+'"))).toBe(true);
  });

  it('supports common game-authoring expression and data forms', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        'main',
        '    ld a, -1',
        '    ld b, 0Fh',
        "    db 'ZX'",
        '    ALIGN 8',
        'next',
        '    ret',
        '',
      ].join('\n'),
      { entryPath: 'forms.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('3EFF060F5A580000C9');
    expect(result.symbols.find((s) => s.name === 'main')?.value).toBe(0x8000);
    expect(result.symbols.find((s) => s.name === 'next')?.value).toBe(0x8008);
  });

  it('supports sjasmplus data directive aliases and equals assignments', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        'CONST = 0x42',
        'start:',
        '    DEFM "ABC",0x21',
        "    DM 'ZX'",
        '    DZ "OK"',
        '    DC "END"',
        '    D24 0x123456',
        '    DEFD 0x12345678',
        '    DD 0x01020304',
        '    DWORD 0xAABBCCDD',
        '    DB CONST',
        '',
      ].join('\n'),
      { entryPath: 'data-aliases.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('414243215A584F4B00454EC45634127856341204030201DDCCBBAA42');
    expect(result.symbols.find((s) => s.name === 'CONST')?.value).toBe(0x42);
  });

  it('supports sjasmplus expression helpers and boolean operators', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        'addr = 0x9123',
        '    DB LOW addr, HIGH addr',
        '    DB low(0x1234), high(0x1234)',
        '    DB 1 && 0, 1 && 2, 0 || 0, 0 || 2, !0, !2',
        '    DB 1 == 1, 1 == 2',
        '    DB 10101010b, 0b01010101',
        '    DB "A" + 1',
        '    DB 1 shl 3, 8 shr 1, 7 mod 4',
        '',
      ].join('\n'),
      { entryPath: 'expr-helpers.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('2391341200FF00FFFF00FF00AA5542080403');
  });

  it('reports empty data directives instead of silently emitting nothing', () => {
    const emptyDb = assemble(['    ORG 0x8000', '    DEFB', ''].join('\n'), {
      entryPath: 'empty-defb.asm',
    });
    expect(emptyDb.ok).toBe(false);
    expect(emptyDb.errors.some((e) => e.message === 'DEFB expects at least one value')).toBe(true);

    const emptyWord = assemble(['    ORG 0x8000', '    DEFW', ''].join('\n'), {
      entryPath: 'empty-defw.asm',
    });
    expect(emptyWord.ok).toBe(false);
    expect(emptyWord.errors.some((e) => e.message === 'DEFW expects at least one value')).toBe(true);
  });

  it('supports sjasmplus fill operands for block and align directives', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        '    DB 1',
        '    DS 3,0xAA',
        '    DEFS 2,-1',
        '    BLOCK 2,0x100',
        '    DB 2',
        '    ALIGN 16,0x55',
        '    DB 3',
        '',
      ].join('\n'),
      { entryPath: 'fill-directives.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('01AAAAAAFFFF0000025555555555555503');
  });

  it('reports malformed block and align directives', () => {
    const missingLength = assemble(['    ORG 0x8000', '    DS', ''].join('\n'), {
      entryPath: 'bad-ds-missing.asm',
    });
    expect(missingLength.ok).toBe(false);
    expect(missingLength.errors.some((e) => e.message === 'DS expects a length')).toBe(true);

    const tooManyBlockArgs = assemble(['    ORG 0x8000', '    BLOCK 1,2,3', ''].join('\n'), {
      entryPath: 'bad-block-args.asm',
    });
    expect(tooManyBlockArgs.ok).toBe(false);
    expect(tooManyBlockArgs.errors.some((e) => e.message === 'BLOCK expects 1 or 2 argument(s), got 3')).toBe(true);

    const badAlign = assemble(['    ORG 0x8000', '    ALIGN 0', ''].join('\n'), {
      entryPath: 'bad-align-zero.asm',
    });
    expect(badAlign.ok).toBe(false);
    expect(badAlign.errors.some((e) => e.message === 'ALIGN boundary must be positive: 0')).toBe(true);

    const tooManyAlignArgs = assemble(['    ORG 0x8000', '    ALIGN 4,1,2', ''].join('\n'), {
      entryPath: 'bad-align-args.asm',
    });
    expect(tooManyAlignArgs.ok).toBe(false);
    expect(tooManyAlignArgs.errors.some((e) => e.message === 'ALIGN expects 0, 1, or 2 argument(s), got 3')).toBe(true);

    const nonPowerOfTwo = assemble(['    ORG 0x8000', '    ALIGN 3', ''].join('\n'), {
      entryPath: 'bad-align-non-power.asm',
    });
    expect(nonPowerOfTwo.ok).toBe(false);
    expect(nonPowerOfTwo.errors.some((e) => e.message.includes('ALIGN boundary must be a power of two'))).toBe(true);

    const tooLarge = assemble(['    ORG 0x8000', '    ALIGN 65536', ''].join('\n'), {
      entryPath: 'bad-align-large.asm',
    });
    expect(tooLarge.ok).toBe(false);
    expect(tooLarge.errors.some((e) => e.message.includes('ALIGN boundary must be a power of two'))).toBe(true);
  });

  it('reports data and immediate values that would otherwise truncate', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        '    DB 0x100',
        '    DEFW 0x10000',
        '    D24 0x1000000',
        '    DEFD 0x100000000',
        '    LD HL,0x10000',
        '    ALIGN 4,0x100',
        '',
      ].join('\n'),
      { entryPath: 'range-errors.asm' }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message === '8-bit value out of range: 0x100')).toBe(true);
    expect(result.errors.some((e) => e.message === '16-bit value out of range: 0x10000')).toBe(true);
    expect(result.errors.some((e) => e.message === '24-bit value out of range: 0x1000000')).toBe(true);
    expect(result.errors.some((e) => e.message === '32-bit value out of range: 0x100000000')).toBe(true);
  });

  it('reports unsupported string escapes instead of silently dropping the backslash', () => {
    const result = assemble(['    ORG 0x8000', '    DB "A\\q"', ''].join('\n'), {
      entryPath: 'bad-string-escape.asm',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message === 'Unsupported string escape: \\q')).toBe(true);
  });

  it('reports layout non-convergence across assembler passes', () => {
    const result = assemble(['    ORG 0x8000', 'value EQU value + 1', '    DB value', ''].join('\n'), {
      entryPath: 'non-converging.asm',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message === 'Layout did not converge after 5 passes')).toBe(true);
  });

  it('warns for negative block lengths without moving PC', () => {
    const result = assemble(['    ORG 0x8000', 'start:', '    DS -1,0xAA', 'end:', '    DB end-start', ''].join('\n'), {
      entryPath: 'negative-block.asm',
    });

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('00');
    expect(result.warnings.map((w) => w.message)).toContain('DS length is negative; emitting no bytes');
  });

  it('supports ASSERT, DISPLAY, and comparison expressions', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        'start:',
        '    DISPLAY "start=", start',
        '    ASSERT start == 0x8000, "origin mismatch"',
        '    db 1',
        '    ASSERT $ > start, "pc did not advance"',
        '    ASSERT $ <= start + 1, "pc advanced too far"',
        '',
      ].join('\n'),
      { entryPath: 'assert-display.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('01');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toBe('DISPLAY: start=0x8000');
  });

  it('reports failed ASSERT directives as assembly errors', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        'start:',
        '    db 0',
        'end:',
        '    ASSERT end < start, "range is backwards"',
        '',
      ].join('\n'),
      { entryPath: 'bad-assert.asm' }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message === 'ASSERT failed: range is backwards')).toBe(true);
  });

  it('assembles indexed CB copy-register forms for RES and SET', () => {
    const result = assemble(
      ['    ORG 0x8000', '    SET 3,(IX+4),A', '    RES 2,(IY-1),B', ''].join('\n'),
      { entryPath: 'indexed-cb.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('DDCB04DFFDCBFF90');
  });

  it('supports common sjasmplus instruction aliases and ED flag input forms', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        '    IN (C)',
        '    IN F,(C)',
        '    ADD 1',
        '    ADC 2',
        '    SBC 3',
        '    JP HL',
        '    JP IX',
        '    JP IY',
        '    EXA',
        '    EXD',
        '    EX AF',
        '    EX AF,AF',
        '',
      ].join('\n'),
      { entryPath: 'instruction-aliases.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('ED70ED70C601CE02DE03E9DDE9FDE908EB0808');
  });

  it('supports LD with I and R special registers', () => {
    const result = assemble(
      ['    ORG 0x8000', '    LD I,A', '    LD R,A', '    LD A,I', '    LD A,R', ''].join('\n'),
      { entryPath: 'ld-special-registers.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('ED47ED4FED57ED5F');
  });

  it('supports sjasmplus LD rr,rr pseudo-copy forms', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        '    LD BC,DE',
        '    LD DE,HL',
        '    LD HL,BC',
        '    LD IX,DE',
        '    LD DE,IX',
        '    LD HL,IX',
        '    LD IX,HL',
        '    LD IX,IY',
        '    LD IY,IX',
        '    LD IY,IY',
        '',
      ].join('\n'),
      { entryPath: 'ld-rr-copy.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('424B545D6069DD62DD6BDD54DD5DDDE5E1E5DDE1FDE5DDE1DDE5FDE1FD64FD6D');
  });

  it('supports sjasmplus index-half register aliases', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        '    LD XH,1',
        '    LD XL,2',
        '    LD YH,3',
        '    LD YL,4',
        '    LD HX,5',
        '    LD LX,6',
        '    LD HY,7',
        '    LD LY,8',
        '    LD A,XH',
        '    LD B,XL',
        '    LD C,HX',
        '    LD D,LX',
        '    LD E,YH',
        '    LD A,YL',
        '    INC XH',
        '    DEC LY',
        '    ADD A,YH',
        '',
      ].join('\n'),
      { entryPath: 'index-half-aliases.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe(
      'DD2601DD2E02FD2603FD2E04DD2605DD2E06FD2607FD2E08DD7CDD45DD4CDD55FD5CFD7DDD24FD2DFD84'
    );
  });

  it('rejects illegal LD combinations involving index-half and memory operands', () => {
    for (const form of ['LD H,IXH', 'LD XH,H', 'LD IXH,(HL)', 'LD (IX+1),XH', 'LD (HL),(HL)']) {
      const result = assemble(['    ORG 0x8000', `    ${form}`, ''].join('\n'), {
        entryPath: 'bad-index-half-ld.asm',
      });

      expect(result.ok, form).toBe(false);
      expect(result.errors.some((e) => e.message === `Unsupported LD form: ${form.slice(3).replace(',', ', ')}`)).toBe(true);
    }
  });

  it('supports sjasmplus square-bracket memory operands', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        '    LD A,[HL]',
        '    LD [HL],A',
        '    LD A,[BC]',
        '    LD [DE],A',
        '    LD A,[0x9000]',
        '    LD [0x9000],A',
        '    LD HL,[0x9000]',
        '    LD [0x9000],HL',
        '    LD IX,[0x9000]',
        '    LD [0x9000],IY',
        '    LD A,[IX+1]',
        '    LD [IY-2],B',
        '    INC [HL]',
        '    DEC [IX+3]',
        '    ADD A,[HL]',
        '    CP [IY-4]',
        '    JP [HL]',
        '    JP [IX]',
        '    EX [SP],HL',
        '    BIT 3,[HL]',
        '    SET 4,[IX+5],A',
        '    RLC [IY-1],B',
        '',
      ].join('\n'),
      { entryPath: 'bracket-memory.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe(
      '7E770A123A00903200902A0090220090DD2A0090FD220090DD7E01FD70FE34DD350386FDBEFCE9DDE9E3CB5EDDCB05E7FDCBFF00'
    );
  });

  it('keeps square-bracket I/O port syntax rejected like sjasmplus', () => {
    const input = assemble(['    ORG 0x8000', '    IN A,[0xFE]', ''].join('\n'), {
      entryPath: 'bad-bracket-in.asm',
    });
    expect(input.ok).toBe(false);
    expect(input.errors.some((e) => e.message === 'Unsupported IN form: A, [0xFE]')).toBe(true);

    const output = assemble(['    ORG 0x8000', '    OUT [0xFE],A', ''].join('\n'), {
      entryPath: 'bad-bracket-out.asm',
    });
    expect(output.ok).toBe(false);
    expect(output.errors.some((e) => e.message === 'Unsupported OUT form: [0xFE], A')).toBe(true);
  });

  it('supports include search paths, command-line defines, and INCBIN/INSERT data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-includes-'));
    const incDir = join(dir, 'inc');
    mkdirSync(incDir);
    writeFileSync(join(incDir, 'defs.asm'), ['VALUE EQU CLI_VALUE + 1', ''].join('\n'));
    writeFileSync(join(dir, 'local.asm'), ['LOCAL_VALUE EQU 0x22', ''].join('\n'));
    writeFileSync(join(dir, 'main.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      '    INCLUDE <defs.asm>',
      '    INCLUDE "local.asm"',
      'start:',
      '    ld a, VALUE',
      '    ld b, LOCAL_VALUE',
      '    INCBIN "data.bin", 1, 3',
      '    INSERT <more.bin>',
      'end:',
      '    ASSERT end == start + 9, "size mismatch"',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'data.bin'), Buffer.from([0x10, 0x11, 0x12, 0x13, 0x14]));
    writeFileSync(join(incDir, 'more.bin'), Buffer.from([0x20, 0x21]));

    const result = assembleFile(join(dir, 'main.asm'), {
      includePaths: [incDir],
      defines: { CLI_VALUE: '0x44' },
    });

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('3E4506221112132021');
    expect(result.symbols.find((s) => s.name === 'VALUE')?.value).toBe(0x45);
    expect(result.symbols.find((s) => s.name === 'LOCAL_VALUE')?.value).toBe(0x22);
  });

  it('supports SLI and BINARY sjasmplus aliases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-binary-'));
    const incDir = join(dir, 'inc');
    mkdirSync(incDir);
    writeFileSync(join(dir, 'data.bin'), Buffer.from([0x10, 0x11, 0x12, 0x13]));
    writeFileSync(join(incDir, 'more.bin'), Buffer.from([0x20, 0x21, 0x22, 0x23]));
    writeFileSync(join(dir, 'main.asm'), [
      '    ORG 0x8000',
      '    SLI A',
      '    SLI (IX+1),B',
      '    BINARY "data.bin", 1, 2',
      '    BINARY <more.bin>, 2',
      '',
    ].join('\n'));

    const result = assembleFile(join(dir, 'main.asm'), { includePaths: [incDir] });

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('CB37DDCB013011122223');
  });

  it('reports malformed BINARY directives with precise diagnostics', () => {
    const result = assemble(['    ORG 0x8000', '    BINARY missing.bin', ''].join('\n'), {
      entryPath: 'bad-binary.asm',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message === 'BINARY expects a quoted file path')).toBe(true);
  });

  it('supports SAVEBIN artifacts without advancing PC', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-savebin-'));
    const result = assemble(
      [
        '    DEVICE ZXSPECTRUM48',
        '    ORG 0x8000',
        'start:',
        '    db 1,2',
        '    SAVEBIN "early.bin", start, 4',
        '    db 3,4',
        'end:',
        '    SAVEBIN "nested/all.bin", start, end-start',
        '',
      ].join('\n'),
      { entryPath: join(dir, 'main.asm') }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('01020304');
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0]).toEqual(
      expect.objectContaining({ kind: 'bin', path: 'early.bin', start: 0x8000, length: 4 })
    );
    expect(hex(result.artifacts[0]!.bytes)).toBe('01020000');
    expect(result.artifacts[1]).toEqual(
      expect.objectContaining({ kind: 'bin', path: 'nested/all.bin', start: 0x8000, length: 4 })
    );
    expect(hex(result.artifacts[1]!.bytes)).toBe('01020304');

    const outputs = writeAssemblyOutputs(result, { entry: join(dir, 'main.asm'), outDir: join(dir, 'build') });
    expect(outputs.artifacts).toHaveLength(2);
    expect(hex(new Uint8Array(readFileSync(join(dir, 'build', 'early.bin'))))).toBe('01020000');
    expect(hex(new Uint8Array(readFileSync(join(dir, 'build', 'nested', 'all.bin'))))).toBe('01020304');
  });

  it('rejects SAVEBIN paths that escape the output directory', () => {
    for (const path of ['../evil.bin', '/tmp/evil.bin', 'nested/../../evil.bin']) {
      const result = assemble(
        ['    DEVICE ZXSPECTRUM48', '    ORG 0x8000', 'start: db 1', `    SAVEBIN "${path}", start, 1`, ''].join('\n'),
        { entryPath: 'main.asm' }
      );
      expect(result.ok, `expected '${path}' to be rejected`).toBe(false);
      expect(result.errors.some((e) => /SAVEBIN path must stay within/.test(e.message))).toBe(true);
    }
  });

  it('evaluates compound and shifted command-line defines (not just the first token)', () => {
    const result = assemble(['    ORG 0x8000', '    db SUM, SHIFTED', ''].join('\n'), {
      entryPath: 'main.asm',
      defines: { SUM: '1+2', SHIFTED: '1<<4' },
    });
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    // SUM = 1+2 = 0x03, SHIFTED = 1<<4 = 0x10 (previously both collapsed to 0x01).
    expect(hex(result.bytes)).toBe('0310');
  });

  it('sandbox mode blocks INCLUDE reads outside the project (and is off by default)', () => {
    const root = mkdtempSync(join(tmpdir(), 'spectral-asm-sandbox-'));
    const project = join(root, 'project');
    mkdirSync(project);
    writeFileSync(join(root, 'secret.asm'), 'SECRET EQU 0x42\n'); // outside the project
    writeFileSync(join(project, 'main.asm'), ['    ORG 0x8000', '    INCLUDE "../secret.asm"', ''].join('\n'));

    const blocked = assembleFile(join(project, 'main.asm'), { cwd: project, sandbox: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.errors.some((e) => /outside the sandbox roots/.test(e.message))).toBe(true);

    // Same source assembles fine with sandbox off (default) — backward compatible.
    const allowed = assembleFile(join(project, 'main.asm'), { cwd: project });
    expect(allowed.ok, JSON.stringify(allowed.errors)).toBe(true);
  });

  it('sandbox mode blocks INCBIN reads outside the project', () => {
    const root = mkdtempSync(join(tmpdir(), 'spectral-asm-sandbox-bin-'));
    const project = join(root, 'project');
    mkdirSync(project);
    writeFileSync(join(root, 'secret.bin'), Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    writeFileSync(join(project, 'main.asm'), ['    ORG 0x8000', '    INCBIN "../secret.bin"', ''].join('\n'));

    const blocked = assembleFile(join(project, 'main.asm'), { cwd: project, sandbox: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.errors.some((e) => /outside the sandbox roots/.test(e.message))).toBe(true);
  });

  it('sandbox mode still allows includes within the project and its include paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'spectral-asm-sandbox-ok-'));
    const project = join(root, 'project');
    const lib = join(project, 'lib');
    mkdirSync(lib, { recursive: true });
    writeFileSync(join(project, 'local.asm'), 'LOCAL EQU 0x11\n');
    writeFileSync(join(lib, 'shared.asm'), 'SHARED EQU 0x22\n');
    writeFileSync(
      join(project, 'main.asm'),
      ['    ORG 0x8000', '    INCLUDE "local.asm"', '    INCLUDE <shared.asm>', '    db LOCAL, SHARED', ''].join('\n')
    );

    const result = assembleFile(join(project, 'main.asm'), { cwd: project, includePaths: [lib], sandbox: true });
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('1122');
  });

  it('reports malformed SAVEBIN directives', () => {
    const noDevice = assemble(['    ORG 0x8000', 'start: db 1', '    SAVEBIN "part.bin", start, 1', ''].join('\n'), {
      entryPath: 'savebin-no-device.asm',
    });
    expect(noDevice.ok).toBe(false);
    expect(noDevice.errors.some((e) => e.message === 'SAVEBIN requires DEVICE emulation mode')).toBe(true);

    const tooFewArgs = assemble(['    DEVICE ZXSPECTRUM48', '    ORG 0x8000', '    SAVEBIN "part.bin"', ''].join('\n'), {
      entryPath: 'savebin-too-few.asm',
    });
    expect(tooFewArgs.ok).toBe(false);
    expect(tooFewArgs.errors.some((e) => e.message === 'SAVEBIN expects 2 or 3 argument(s), got 1')).toBe(true);

    const badPath = assemble(['    DEVICE ZXSPECTRUM48', '    ORG 0x8000', '    SAVEBIN <part.bin>, 0x8000, 1', ''].join('\n'), {
      entryPath: 'savebin-bad-path.asm',
    });
    expect(badPath.ok).toBe(false);
    expect(badPath.errors.some((e) => e.message === 'SAVEBIN expects a quoted file path')).toBe(true);

    const badRange = assemble(
      ['    DEVICE ZXSPECTRUM48', '    ORG 0x8000', '    SAVEBIN "part.bin", 0xFFFE, 3', ''].join('\n'),
      { entryPath: 'savebin-bad-range.asm' }
    );
    expect(badRange.ok).toBe(false);
    expect(badRange.errors.some((e) => e.message === 'SAVEBIN length out of range: 3')).toBe(true);
  });

  it('supports conditional assembly and skips inactive source', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        'FLAG EQU 1',
        '    IFDEF DEBUG',
        '    db 1',
        '    ELSE',
        '    db 2',
        '    ENDIF',
        '    IFNDEF MISSING',
        '    db 3',
        '    ENDIF',
        '    IF FLAG == 1',
        '    db 4',
        '    ELSEIF DEBUG == 2',
        '    db 5',
        '    ELSE',
        '    db 6',
        '    ENDIF',
        '    IF 0',
        '    INCLUDE "missing.asm"',
        '    db unknown_symbol',
        '    ENDIF',
        '',
      ].join('\n'),
      { entryPath: 'conditionals.asm', defines: { DEBUG: true } }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('010304');
  });

  it('reports malformed conditional blocks', () => {
    const elseWithoutIf = assemble(['    ORG 0x8000', '    ELSE', '    db 1', ''].join('\n'), {
      entryPath: 'else-without-if.asm',
    });
    expect(elseWithoutIf.ok).toBe(false);
    expect(elseWithoutIf.errors.some((e) => e.message === 'ELSE without IF')).toBe(true);

    const unclosed = assemble(['    ORG 0x8000', '    IF 1', '    db 1', ''].join('\n'), {
      entryPath: 'unclosed-if.asm',
    });
    expect(unclosed.ok).toBe(false);
    expect(unclosed.errors.some((e) => e.message === 'Unclosed conditional block')).toBe(true);
  });

  it('supports source DEFINE and UNDEFINE in conditionals and expressions', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        'BASE EQU 0x40',
        '    DEFINE FOO BASE + 2',
        '    IFDEF FOO',
        '    db FOO',
        '    ELSE',
        '    db 0',
        '    ENDIF',
        '    UNDEFINE FOO',
        '    IFNDEF FOO',
        '    db 0x11',
        '    ELSE',
        '    db 0',
        '    ENDIF',
        '    DEFINE FLAG',
        '    IFDEF FLAG',
        '    db 0x22',
        '    ENDIF',
        '',
      ].join('\n'),
      { entryPath: 'source-defines.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('421122');
  });

  it('reports malformed source DEFINE directives', () => {
    const missingName = assemble(['    ORG 0x8000', '    DEFINE', ''].join('\n'), {
      entryPath: 'define-missing-name.asm',
    });
    expect(missingName.ok).toBe(false);
    expect(missingName.errors.some((e) => e.message === 'DEFINE expects a name')).toBe(true);

    const invalidSyntax = assemble(['    ORG 0x8000', '    DEFINE FOO=1', ''].join('\n'), {
      entryPath: 'define-invalid-syntax.asm',
    });
    expect(invalidSyntax.ok).toBe(false);
    expect(invalidSyntax.errors.some((e) => e.message === 'Invalid DEFINE syntax: FOO=1')).toBe(true);

    const duplicate = assemble(['    ORG 0x8000', '    DEFINE FOO 1', '    DEFINE FOO 2', ''].join('\n'), {
      entryPath: 'define-duplicate.asm',
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors.some((e) => e.message === 'Duplicate DEFINE: FOO')).toBe(true);

    const invalidUndefine = assemble(['    ORG 0x8000', '    UNDEFINE BAD NAME', ''].join('\n'), {
      entryPath: 'undefine-invalid-name.asm',
    });
    expect(invalidUndefine.ok).toBe(false);
    expect(invalidUndefine.errors.some((e) => e.message === 'Invalid UNDEFINE name: BAD NAME')).toBe(true);
  });

  it('keeps source DEFINE expression values order-sensitive', () => {
    const result = assemble(['    ORG 0x8000', '    db FOO', '    DEFINE FOO 1', ''].join('\n'), {
      entryPath: 'define-order-sensitive.asm',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message === 'Label not found: FOO')).toBe(true);
  });

  it('keeps IFDEF scoped to defines instead of EQU labels', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        'FOO EQU 1',
        '    IFDEF FOO',
        '    db 0',
        '    ELSE',
        '    db FOO',
        '    ENDIF',
        '',
      ].join('\n'),
      { entryPath: 'ifdef-equ.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('01');
  });

  it('supports sjasmplus END source termination', () => {
    const indented = assemble(
      ['    ORG 0x8000', 'start:', '    db 1', '    END start', '    db 2', ''].join('\n'),
      { entryPath: 'end-indented.asm' }
    );
    expect(indented.ok, JSON.stringify(indented.errors)).toBe(true);
    expect(hex(indented.bytes)).toBe('01');

    const labelled = assemble(['    ORG 0x8000', '    db 1', 'stop: END', '    db 2', ''].join('\n'), {
      entryPath: 'end-labelled.asm',
    });
    expect(labelled.ok, JSON.stringify(labelled.errors)).toBe(true);
    expect(hex(labelled.bytes)).toBe('01');
    expect(labelled.symbols.some((symbol) => symbol.name === 'stop' && symbol.value === 0x8001)).toBe(true);
  });

  it('keeps unindented END as a label like sjasmplus', () => {
    const result = assemble(['    ORG 0x8000', 'END', '    db 1', ''].join('\n'), {
      entryPath: 'end-as-label.asm',
    });

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('01');
    expect(result.symbols.some((symbol) => symbol.name === 'END' && symbol.value === 0x8000)).toBe(true);
  });

  it('terminates all source loading when END appears inside an include', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-end-'));
    writeFileSync(join(dir, 'part.asm'), ['    db 1', '    END', '    db 2', ''].join('\n'));
    writeFileSync(
      join(dir, 'main.asm'),
      ['    DEVICE ZXSPECTRUM48', '    ORG 0x8000', '    INCLUDE "part.asm"', '    db 3', ''].join('\n')
    );

    const result = assembleFile(join(dir, 'main.asm'));
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('01');
  });

  it('reports unresolved END entry expressions', () => {
    const result = assemble(['    ORG 0x8000', '    db 1', '    END missing', '    db 2', ''].join('\n'), {
      entryPath: 'end-missing-entry.asm',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message === 'Label not found: missing')).toBe(true);
  });

  it('CLI disasm validates numeric flags and wraps reads across 0xFFFF', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-cli-'));
    const bin = join(dir, 'wrap.bin');
    writeFileSync(bin, Buffer.from([0x01, 0x34, 0x12]));

    const wrapped = asmCli('disasm', bin, '--org', '0xFFFF', '--count', '1');
    expect(wrapped.status, wrapped.stderr).toBe(0);
    expect(wrapped.stdout).toContain('LD BC,0x1234');

    const badOrg = asmCli('disasm', bin, '--org', 'NaN');
    expect(badOrg.status).toBe(1);
    expect(badOrg.stderr).toContain("Invalid origin: 'NaN'");

    const badCount = asmCli('disasm', bin, '--count', '0');
    expect(badCount.status).toBe(1);
    expect(badCount.stderr).toContain("Invalid instruction count: '0'");
  });

  it('CLI version and doctor output follow package metadata', () => {
    const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string };

    const version = asmCli('--version');
    expect(version.status, version.stdout + version.stderr).toBe(0);
    expect(version.stdout.trim()).toBe(metadata.version);

    const doctor = asmCli('doctor', '--json');
    expect(doctor.status, doctor.stdout + doctor.stderr).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      ok: true,
      assembler: '@zx-vibes/asm',
      version: metadata.version,
    });
  });

  it('supports DUP/REPT source repetition with counters and nesting', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        'COUNT EQU 2',
        '    DUP COUNT + 1, idx',
        '    db idx',
        '      REPT 2',
        '      db idx + 4',
        '      ENDR',
        '    EDUP',
        '    DUP 0',
        '    INCLUDE "missing.asm"',
        '    db unknown_symbol',
        '    EDUP',
        '    db 9',
        '',
      ].join('\n'),
      { entryPath: 'repeats.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('00040401050502060609');
  });

  it('reports malformed repeat blocks', () => {
    const endWithoutRepeat = assemble(['    ORG 0x8000', '    EDUP', ''].join('\n'), {
      entryPath: 'edup-without-dup.asm',
    });
    expect(endWithoutRepeat.ok).toBe(false);
    expect(endWithoutRepeat.errors.some((e) => e.message === 'EDUP without DUP/REPT')).toBe(true);

    const unclosed = assemble(['    ORG 0x8000', '    DUP 2', '    db 1', ''].join('\n'), {
      entryPath: 'unclosed-dup.asm',
    });
    expect(unclosed.ok).toBe(false);
    expect(unclosed.errors.some((e) => e.message === 'Unclosed repeat block')).toBe(true);

    const negative = assemble(['    ORG 0x8000', '    DUP -1', '    db 1', '    EDUP', ''].join('\n'), {
      entryPath: 'negative-dup.asm',
    });
    expect(negative.ok).toBe(false);
    expect(negative.errors.some((e) => e.message === 'DUP repeat count must be positive or zero: -1')).toBe(true);
  });

  it('supports MACRO/ENDM expansion with parameters and macro-local labels', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        'Pair MACRO left,right',
        '    db left,right',
        'ENDM',
        'LoopByte MACRO value',
        '.loop:',
        '    db value',
        '    jr .loop',
        'ENDM',
        'Table MACRO base',
        '    DUP 2, idx',
        '    db base + idx',
        '    EDUP',
        'ENDM',
        'start:',
        '    LoopByte 1',
        '    LoopByte 2',
        '    Pair 3,4',
        '    Table 5',
        '',
      ].join('\n'),
      { entryPath: 'macros.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('0118FD0218FD03040506');
  });

  it('supports sjasmplus directive-style MACRO definitions', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        '    MACRO Pair left,right',
        '    db left,right',
        '    ENDM',
        '    MACRO Emit',
        '    db 3',
        '    ENDM',
        '    MACRO LoopByte value',
        '.loop:',
        '    db value',
        '    jr .loop',
        '    ENDM',
        '    Pair 1,2',
        '    Emit',
        '    LoopByte 4',
        '    LoopByte 5',
        '',
      ].join('\n'),
      { entryPath: 'directive-macros.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('0102030418FD0518FD');
  });

  it('reports malformed macro blocks and calls', () => {
    const endm = assemble(['    ORG 0x8000', '    ENDM', ''].join('\n'), {
      entryPath: 'endm-without-macro.asm',
    });
    expect(endm.ok).toBe(false);
    expect(endm.errors.some((e) => e.message === 'ENDM without MACRO')).toBe(true);

    const unclosed = assemble(['    ORG 0x8000', 'M MACRO value', '    db value', ''].join('\n'), {
      entryPath: 'unclosed-macro.asm',
    });
    expect(unclosed.ok).toBe(false);
    expect(unclosed.errors.some((e) => e.message === 'Unclosed MACRO block')).toBe(true);

    const extra = assemble(
      ['    ORG 0x8000', 'M MACRO value', '    db value', 'ENDM', '    M 1,2', ''].join('\n'),
      { entryPath: 'extra-macro-arg.asm' }
    );
    expect(extra.ok).toBe(false);
    expect(extra.errors.some((e) => e.message === 'Macro M expects 1 argument(s), got 2')).toBe(true);

    const missingName = assemble(['    ORG 0x8000', '    MACRO', '    db 1', '    ENDM', ''].join('\n'), {
      entryPath: 'macro-missing-name.asm',
    });
    expect(missingName.ok).toBe(false);
    expect(missingName.errors.some((e) => e.message === 'MACRO expects a name')).toBe(true);
  });

  it('supports MODULE/ENDMODULE scoping for labels and references', () => {
    const result = assemble(
      [
        '    ORG 0x8000',
        'outside:',
        '    db 0xAA',
        '    MODULE Foo',
        'start:',
        '    dw outside',
        'local:',
        '    dw start',
        'main:',
        '.loop:',
        '    jr .loop',
        '    MODULE Bar',
        'hit:',
        '    dw Foo.start',
        '    ENDMODULE',
        '    dw Bar.hit',
        '    ENDMODULE',
        '    dw Foo.start, Foo.local, Foo.main.loop, Foo.Bar.hit',
        '',
      ].join('\n'),
      { entryPath: 'modules.asm' }
    );

    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('AA0080018018FE018007800180038005800780');
    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'outside', value: 0x8000 }),
        expect.objectContaining({ name: 'Foo.start', value: 0x8001 }),
        expect.objectContaining({ name: 'Foo.local', value: 0x8003 }),
        expect.objectContaining({ name: 'Foo.main.loop', value: 0x8005 }),
        expect.objectContaining({ name: 'Foo.Bar.hit', value: 0x8007 }),
      ])
    );
  });

  it('reports malformed module directives', () => {
    const endmodule = assemble(['    ORG 0x8000', '    ENDMODULE', ''].join('\n'), {
      entryPath: 'endmodule-without-module.asm',
    });
    expect(endmodule.ok).toBe(false);
    expect(endmodule.errors.some((e) => e.message === 'ENDMODULE without MODULE')).toBe(true);

    const missingName = assemble(['    ORG 0x8000', '    MODULE', ''].join('\n'), {
      entryPath: 'module-missing-name.asm',
    });
    expect(missingName.ok).toBe(false);
    expect(missingName.errors.some((e) => e.message === 'MODULE expects a name')).toBe(true);

    const dotted = assemble(['    ORG 0x8000', '    MODULE Foo.Bar', ''].join('\n'), {
      entryPath: 'module-dotted-name.asm',
    });
    expect(dotted.ok).toBe(false);
    expect(dotted.errors.some((e) => e.message === 'Dots are not allowed in MODULE names: Foo.Bar')).toBe(true);

    const namedEnd = assemble(['    ORG 0x8000', '    MODULE Foo', '    ENDMODULE Foo', ''].join('\n'), {
      entryPath: 'endmodule-argument.asm',
    });
    expect(namedEnd.ok).toBe(false);
    expect(namedEnd.errors.some((e) => e.message === 'ENDMODULE does not accept arguments: Foo')).toBe(true);
  });

  it('rejects invalid IX/IY 16-bit add forms instead of remapping HL', () => {
    const result = assemble(['    ORG 0x8000', '    add ix, hl', ''].join('\n'), {
      entryPath: 'bad-add.asm',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message === 'Cannot ADD IX,HL')).toBe(true);
  });
});

describe('Spectral corpus compatibility', () => {
  const sjasmplusAvailable = hasSjasmplus();
  const maybeIt = sjasmplusAvailable ? it : it.skip;
  const entries = [
    'starters/game/src/main.asm',
    'starters/platformer/src/main.asm',
    'packages/toolkit/templates/game/src/main.asm',
    'packages/toolkit/templates/platformer/src/main.asm',
    'packages/toolkit/examples/bounce.asm',
    'packages/toolkit/examples/pong-by-agent/main.asm',
    'packages/toolkit/examples/arkanoid-quickstart/src/main.asm',
    'packages/toolkit/recipes/01-clear-screen/demo.asm',
    'packages/toolkit/recipes/02-print-rom/demo.asm',
    'packages/toolkit/recipes/03-pixel-address/demo.asm',
    'packages/toolkit/recipes/04-sprite-xor-8x8/demo.asm',
    'packages/toolkit/recipes/05-sprite-masked-16x16/demo.asm',
    'packages/toolkit/recipes/06-keyboard-qaop/demo.asm',
    'packages/toolkit/recipes/07-game-loop/demo.asm',
    'packages/toolkit/recipes/08-im2-isr/demo.asm',
    'packages/toolkit/recipes/09-beeper-fx/demo.asm',
    'packages/toolkit/recipes/10-score-bcd/demo.asm',
    'packages/toolkit/recipes/11-prng/demo.asm',
    'packages/toolkit/recipes/12-attr-effects/demo.asm',
  ];

  it('assembles the current templates, examples, recipes, and root starters', () => {
    for (const rel of entries) {
      const entry = resolve(workspace, rel);
      expect(existsSync(entry), `${rel} should exist`).toBe(true);
      const ours = assembleFile(entry);
      expect(ours.ok, `${rel}: ${JSON.stringify(ours.errors)}`).toBe(true);
    }
  });

  maybeIt('matches sjasmplus bytes for current templates, examples, and recipes', () => {
    for (const rel of entries) {
      const entry = resolve(workspace, rel);
      expect(existsSync(entry), `${rel} should exist`).toBe(true);
      const ours = assembleFile(entry);
      expect(ours.ok, `${rel}: ${JSON.stringify(ours.errors)}`).toBe(true);

      const sj = sjasmplusBytes(entry);
      expect(hex(ours.bytes), rel).toBe(hex(sj));
    }
  });

  maybeIt('matches sjasmplus bytes for ASSERT, DISPLAY, and indexed CB copy-register forms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'feature.asm');
    writeFileSync(
      entry,
      [
        '    DEVICE ZXSPECTRUM48',
        '    ORG 0x8000',
        'start:',
        '    DISPLAY "start=", start',
        '    ASSERT start == 0x8000, "origin mismatch"',
        '    SET 3,(IX+4),A',
        '    RES 2,(IY-1),B',
        'end:',
        '    ASSERT end >= start + 8, "short output"',
        '',
      ].join('\n')
    );

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for common instruction aliases and ED flag input forms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'feature.asm');
    writeFileSync(join(dir, 'feature.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      '    IN (C)',
      '    IN F,(C)',
      '    ADD 1',
      '    ADC 2',
      '    SBC 3',
      '    JP HL',
      '    JP IX',
      '    JP IY',
      '    EXA',
      '    EXD',
      '    EX AF',
      '    EX AF,AF',
      '    LD BC,DE',
      '    LD DE,HL',
      '    LD HL,BC',
      '    LD IX,DE',
      '    LD DE,IX',
      '    LD HL,IX',
      '    LD IX,HL',
      '    LD IX,IY',
      '    LD IY,IX',
      '    LD IY,IY',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for index-half register aliases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'feature.asm');
    writeFileSync(join(dir, 'feature.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      '    LD XH,1',
      '    LD XL,2',
      '    LD YH,3',
      '    LD YL,4',
      '    LD HX,5',
      '    LD LX,6',
      '    LD HY,7',
      '    LD LY,8',
      '    LD A,XH',
      '    LD B,XL',
      '    LD C,HX',
      '    LD D,LX',
      '    LD E,YH',
      '    LD A,YL',
      '    INC XH',
      '    DEC LY',
      '    ADD A,YH',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for data directive aliases and equals assignments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'feature.asm');
    writeFileSync(join(dir, 'feature.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      'CONST = 0x42',
      'start:',
      '    DEFM "ABC",0x21',
      "    DM 'ZX'",
      '    DZ "OK"',
      '    DC "END"',
      '    D24 0x123456',
      '    DEFD 0x12345678',
      '    DD 0x01020304',
      '    DWORD 0xAABBCCDD',
      '    DB CONST',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for block and align fill operands', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'feature.asm');
    writeFileSync(join(dir, 'feature.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      '    DB 1',
      '    DS 3,0xAA',
      '    DEFS 2,-1',
      '    BLOCK 2,0x100',
      '    DB 2',
      '    ALIGN 16,0x55',
      '    DB 3',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for expression helpers and boolean operators', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'feature.asm');
    writeFileSync(join(dir, 'feature.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      'addr = 0x9123',
      '    DB LOW addr, HIGH addr',
      '    DB low(0x1234), high(0x1234)',
      '    DB 1 && 0, 1 && 2, 0 || 0, 0 || 2, !0, !2',
      '    DB 1 == 1, 1 == 2',
      '    DB 10101010b, 0b01010101',
      '    DB "A" + 1',
      '    DB 1 shl 3, 8 shr 1, 7 mod 4',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus precedence for mixed bitwise and comparison expressions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'precedence.asm');
    writeFileSync(join(dir, 'precedence.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      '    DB 1 | 2 == 3',
      '    DB 1 | 2 == 2',
      '    DB 1 & 3 == 1',
      '    DB 1 & 2 == 0',
      '    DB 4 >> 1 == 2',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for square-bracket memory operands', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'feature.asm');
    writeFileSync(join(dir, 'feature.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      '    LD A,[HL]',
      '    LD [HL],A',
      '    LD A,[BC]',
      '    LD [DE],A',
      '    LD A,[0x9000]',
      '    LD [0x9000],A',
      '    LD HL,[0x9000]',
      '    LD [0x9000],HL',
      '    LD IX,[0x9000]',
      '    LD [0x9000],IY',
      '    LD A,[IX+1]',
      '    LD [IY-2],B',
      '    INC [HL]',
      '    DEC [IX+3]',
      '    ADD A,[HL]',
      '    CP [IY-4]',
      '    JP [HL]',
      '    JP [IX]',
      '    EX [SP],HL',
      '    BIT 3,[HL]',
      '    SET 4,[IX+5],A',
      '    RLC [IY-1],B',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for include paths, defines, and INCBIN/INSERT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const incDir = join(dir, 'inc');
    mkdirSync(incDir);
    writeFileSync(join(incDir, 'defs.asm'), ['VALUE EQU CLI_VALUE + 1', ''].join('\n'));
    writeFileSync(join(dir, 'local.asm'), ['LOCAL_VALUE EQU 0x22', ''].join('\n'));
    writeFileSync(join(dir, 'main.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      '    INCLUDE <defs.asm>',
      '    INCLUDE "local.asm"',
      '    ld a, VALUE',
      '    ld b, LOCAL_VALUE',
      '    INCBIN "data.bin", 1, 3',
      '    INSERT <more.bin>',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'data.bin'), Buffer.from([0x10, 0x11, 0x12, 0x13, 0x14]));
    writeFileSync(join(incDir, 'more.bin'), Buffer.from([0x20, 0x21]));

    const entry = join(dir, 'main.asm');
    const ours = assembleFile(entry, {
      includePaths: [incDir],
      defines: { CLI_VALUE: '0x44' },
    });
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry, ['-I', incDir.replace(/\\/g, '/'), '-DCLI_VALUE=0x44']);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for SLI and BINARY aliases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const incDir = join(dir, 'inc');
    mkdirSync(incDir);
    writeFileSync(join(dir, 'data.bin'), Buffer.from([0x10, 0x11, 0x12, 0x13]));
    writeFileSync(join(incDir, 'more.bin'), Buffer.from([0x20, 0x21, 0x22, 0x23]));
    const entry = join(dir, 'main.asm');
    writeFileSync(join(dir, 'main.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      '    SLI A',
      '    SLI (IX+1),B',
      '    BINARY "data.bin", 1, 2',
      '    BINARY <more.bin>, 2',
      '',
    ].join('\n'));

    const ours = assembleFile(entry, { includePaths: [incDir] });
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry, ['-I', incDir.replace(/\\/g, '/')]);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for conditional assembly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'main.asm');
    writeFileSync(join(dir, 'main.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      'FLAG EQU 1',
      '    IFDEF DEBUG',
      '    db 1',
      '    ELSE',
      '    db 2',
      '    ENDIF',
      '    IFNDEF MISSING',
      '    db 3',
      '    ENDIF',
      '    IF FLAG == 1',
      '    db 4',
      '    ELSEIF DEBUG == 2',
      '    db 5',
      '    ELSE',
      '    db 6',
      '    ENDIF',
      '    IF 0',
      '    INCLUDE "missing.asm"',
      '    db unknown_symbol',
      '    ENDIF',
      '',
    ].join('\n'));

    const ours = assembleFile(entry, { defines: { DEBUG: true } });
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry, ['-DDEBUG=1']);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for source DEFINE and UNDEFINE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'main.asm');
    writeFileSync(join(dir, 'main.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      'BASE EQU 0x40',
      'EQU_ONLY EQU 0x33',
      '    DEFINE FOO BASE + 2',
      '    IFDEF FOO',
      '    db FOO',
      '    ELSE',
      '    db 0',
      '    ENDIF',
      '    UNDEFINE FOO',
      '    IFNDEF FOO',
      '    db 0x11',
      '    ELSE',
      '    db 0',
      '    ENDIF',
      '    DEFINE FLAG',
      '    IFDEF FLAG',
      '    db 0x22',
      '    ENDIF',
      '    IFDEF EQU_ONLY',
      '    db 0',
      '    ELSE',
      '    db EQU_ONLY',
      '    ENDIF',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for END source termination', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'main.asm');
    writeFileSync(join(dir, 'part.asm'), ['    db 2', '    END', '    db 3', ''].join('\n'));
    writeFileSync(join(dir, 'main.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      'END',
      '    db 1',
      '    INCLUDE "part.asm"',
      '    db 4',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for DUP/REPT source repetition', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'main.asm');
    writeFileSync(join(dir, 'main.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      'COUNT EQU 2',
      '    DUP COUNT + 1, idx',
      '    db idx',
      '      REPT 2',
      '      db idx + 4',
      '      ENDR',
      '    EDUP',
      '    DUP 0',
      '    INCLUDE "missing.asm"',
      '    db unknown_symbol',
      '    EDUP',
      '    db 9',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for MACRO expansion', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'main.asm');
    writeFileSync(join(dir, 'main.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      'Pair MACRO left,right',
      '    db left,right',
      'ENDM',
      'LoopByte MACRO value',
      '.loop:',
      '    db value',
      '    jr .loop',
      'ENDM',
      'Table MACRO base',
      '    DUP 2, idx',
      '    db base + idx',
      '    EDUP',
      'ENDM',
      'start:',
      '    LoopByte 1',
      '    LoopByte 2',
      '    Pair 3,4',
      '    Table 5',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for directive-style MACRO definitions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'main.asm');
    writeFileSync(join(dir, 'main.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      '    MACRO Pair left,right',
      '    db left,right',
      '    ENDM',
      '    MACRO Emit',
      '    db 3',
      '    ENDM',
      '    MACRO LoopByte value',
      '.loop:',
      '    db value',
      '    jr .loop',
      '    ENDM',
      '    Pair 1,2',
      '    Emit',
      '    LoopByte 4',
      '    LoopByte 5',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for MODULE scoping', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'main.asm');
    writeFileSync(join(dir, 'main.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      'outside:',
      '    db 0xAA',
      '    MODULE Foo',
      'start:',
      '    dw outside',
      'local:',
      '    dw start',
      'main:',
      '.loop:',
      '    jr .loop',
      '    MODULE Bar',
      'hit:',
      '    dw Foo.start',
      '    ENDMODULE',
      '    dw Bar.hit',
      '    ENDMODULE',
      '    dw Foo.start, Foo.local, Foo.main.loop, Foo.Bar.hit',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBytes(entry);
    expect(hex(ours.bytes)).toBe(hex(sj));
  });

  maybeIt('matches sjasmplus bytes for SAVEBIN artifacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-sjasmplus-'));
    const entry = join(dir, 'main.asm');
    writeFileSync(join(dir, 'main.asm'), [
      '    DEVICE ZXSPECTRUM48',
      '    ORG 0x8000',
      'start:',
      '    db 1,2',
      '    SAVEBIN "early.bin", start, 4',
      '    db 3,4',
      'end:',
      '    SAVEBIN "all.bin", start, end-start',
      '',
    ].join('\n'));

    const ours = assembleFile(entry);
    expect(ours.ok, JSON.stringify(ours.errors)).toBe(true);
    const sj = sjasmplusBuildInSourceDir(entry);
    expect(hex(ours.bytes)).toBe(hex(sj.raw));
    expect(hex(ours.artifacts[0]!.bytes)).toBe(hex(new Uint8Array(readFileSync(join(dir, 'early.bin')))));
    expect(hex(ours.artifacts[1]!.bytes)).toBe(hex(new Uint8Array(readFileSync(join(dir, 'all.bin')))));
  });
});
