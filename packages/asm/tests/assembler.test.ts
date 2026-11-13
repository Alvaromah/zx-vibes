import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkAssemblerRuntime } from '../src/doctor.js';
import {
  assemble,
  assembleFile,
  disassemble,
  disassembleOne,
  writeAssemblyOutputs,
  type AssembleOptions,
} from '../src/index.js';

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

  it('CLI disasm stops at the end of the file instead of inventing bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectral-asm-cli-'));
    const lines = (res: { stdout: string }): string[] => res.stdout.split('\n').filter((l) => l !== '');

    // LD A,1 / RET: two instructions, not thirty-two (the rest used to be `NOP`s).
    const whole = join(dir, 'whole.bin');
    writeFileSync(whole, Buffer.from([0x3e, 0x01, 0xc9]));
    const listed = asmCli('disasm', whole, '--org', '0x8000');
    expect(listed.status, listed.stderr).toBe(0);
    expect(lines(listed).map((l) => l.replace(/\s+/g, ' '))).toEqual(['0x8000 3e 01 LD A,0x01', '0x8002 c9 RET']);

    // A file that ends inside CALL nn: the lone opcode byte is data, not `CALL 0x0000`.
    const cut = join(dir, 'cut.bin');
    writeFileSync(cut, Buffer.from([0x3e, 0x01, 0xcd]));
    const truncated = asmCli('disasm', cut, '--org', '0x8000', '--count', '8');
    expect(lines(truncated).map((l) => l.replace(/\s+/g, ' '))).toEqual(['0x8000 3e 01 LD A,0x01', '0x8002 cd DB 0xCD']);

    // --count still limits a longer file, and an empty file lists nothing.
    expect(lines(asmCli('disasm', whole, '--count', '1'))).toHaveLength(1);
    const empty = join(dir, 'empty.bin');
    writeFileSync(empty, Buffer.alloc(0));
    const nothing = asmCli('disasm', empty);
    expect(nothing.status).toBe(0);
    expect(nothing.stdout).toBe('');
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

describe('regressions: silent misassembly and crashes', () => {
  const bytesOf = (source: string): string => {
    const result = assemble(source);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    return hex(result.bytes);
  };

  it('an instruction or directive whose operand is a label named `end` does not end the source', () => {
    // `call end` / `dw end` used to be read as "label `call`, then END", dropping the rest.
    expect(bytesOf('    ORG 0x8000\nend:\n    ret\nmain:\n    call end\n    ld a,1\n    ret\n')).toBe('C9CD00803E01C9');
    expect(bytesOf('    ORG 0x8000\nend:\n    ret\n    dw end\n    ld a,1\n')).toBe('C900803E01');
    // An indented label named `end:` is a label too; a column-0 `stop END` still ends.
    expect(bytesOf('    ORG 0x8000\n    end: ret\n    jp end\n')).toBe('C9C30080');
    expect(bytesOf('    ORG 0x8000\n    nop\nstop END\n    halt\n')).toBe('00');
  });

  it('`FOO: EQU 5` defines a constant like `FOO EQU 5`, not a label at the PC', () => {
    expect(bytesOf('    ORG 0x8000\nFOO: EQU 5\n    db FOO\n')).toBe('05');
    expect(bytesOf('    ORG 0x8000\nBAR: DEFL 7\n    db BAR\n')).toBe('07');
    expect(bytesOf('    ORG 0x8000\nBAZ: = 9\n    db BAZ\n')).toBe('09');
  });

  it('a DB argument is a string only when it is ONE literal', () => {
    expect(bytesOf("    db 'a'-'A'\n")).toBe('20');
    expect(bytesOf('    db "ab", \'c\'\n')).toBe('616263');
    expect(bytesOf('    db "say \\"hi\\""\n')).toBe('7361792022686922');
  });

  it('a label starting with ix/iy is an absolute address, not an index register', () => {
    expect(bytesOf('    ORG 0x8000\nixcount: db 0\n    ld a,(ixcount)\n')).toBe('003A0080');
    expect(bytesOf('    ld a,(ix+3)\n    ld a,(iy - 2)\n    ld a,(ix)\n')).toBe('DD7E03FD7EFEDD7E00');
  });

  it("`ex af,af'` accepts a trailing comment", () => {
    expect(bytesOf("    ex af,af'   ; save A\n    db 'x' ; quoted\n")).toBe('0878');
  });

  it('a large DS assembles instead of overflowing the call stack', () => {
    const result = assemble('    ORG 0x4000\n    DS 200000\n');
    expect(result.bytes.length).toBe(200000);
  });

  it('INCLUDE/INCBIN of a directory is a diagnostic, not an EISDIR crash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zxasm-dir-include-'));
    mkdirSync(join(dir, 'lib'));
    for (const directive of ['INCLUDE "lib"', 'INCBIN "lib"']) {
      writeFileSync(join(dir, 'main.asm'), `    ${directive}\n`);
      const result = assembleFile(join(dir, 'main.asm'));
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /file not found: lib/.test(e.message))).toBe(true);
    }
  });

  it('assemble() resolves includes from in-memory source against opts.cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zxasm-cwd-'));
    writeFileSync(join(dir, 'inc.asm'), '    db 7\n');
    const result = assemble('    INCLUDE "inc.asm"\n', { cwd: dir });
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(hex(result.bytes)).toBe('07');
  });

  it('`zxasm` with no command prints the help instead of "(outputHelp)"', () => {
    const res = spawnSync('node', [asmCliPath], { encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Usage: zxasm');
    expect(res.stderr).not.toContain('(outputHelp)');
  });
});

describe('regressions: silent misassembly, layout and diagnostics (second review)', () => {
  const bytesOf = (source: string, opts: AssembleOptions = {}): string => {
    const result = assemble(source, opts);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    return hex(result.bytes);
  };
  const errorsOf = (source: string, opts: AssembleOptions = {}): string[] => {
    const result = assemble(source, opts);
    expect(result.ok, `expected a failure for:\n${source}`).toBe(false);
    return result.errors.map((e) => e.message);
  };
  const beforeLayout = (directive: string, uses: string) =>
    `${directive} is evaluated before layout and can only use constants already known above it, not $ or code labels (${uses})`;

  it('IF/ELSEIF and DUP/REPT reject $ and code labels instead of reading them as 0', () => {
    // Each used to assemble silently with the wrong branch / count, or fail as "Label not found".
    expect(errorsOf('    ORG 0x8000\n    IF $ >= 0x8000\n    db 1\n    ELSE\n    db 2\n    ENDIF\n')).toEqual([
      beforeLayout('IF', '$'),
    ]);
    expect(errorsOf('    ORG 0x8000\n    IF 0\n    ELSEIF $ > 0\n    db 1\n    ENDIF\n')).toEqual([beforeLayout('ELSEIF', '$')]);
    expect(errorsOf('    ORG 0x8000\n    db 0xAA\n    DUP 4-($&3)\n    db 0\n    EDUP\n')).toEqual([beforeLayout('DUP', '$')]);
    expect(errorsOf('    ORG 0x8000\nstart:\n    nop\n    IF start == 0x8000\n    db 1\n    ENDIF\n')).toEqual([
      beforeLayout('IF', 'start'),
    ]);
    expect(errorsOf('    ORG 0x8000\nstart:\n    REPT start & 3\n    nop\n    ENDR\n')).toEqual([beforeLayout('REPT', 'start')]);
    // A constant computed from $ or a label is just as unknown before layout.
    expect(errorsOf('    ORG 0x8000\nhere EQU $\n    IF here == 0x8000\n    db 1\n    ENDIF\n')).toEqual([
      beforeLayout('IF', 'here'),
    ]);
    expect(errorsOf('    ORG 0x8000\n    nop\n    DEFINE AT $\n    IF AT\n    ENDIF\n')).toEqual([beforeLayout('IF', 'AT')]);
    // A constant that only resolves later is unknown, not seeded with a partial value
    // (B+1 read as 1, so the IF below silently took the wrong branch).
    expect(errorsOf('A EQU B+1\nB EQU 5\n    IF A == 1\n    db 1\n    ENDIF\n')).toEqual([beforeLayout('IF', 'A')]);
    // A symbol that is simply not defined (yet) is still "Label not found".
    expect(errorsOf('    IF LATER\n    ENDIF\nLATER EQU 1\n')).toEqual(['Label not found: LATER']);
    // EQU/DEFL constants, DEFINE values and API defines still work, and a DEFINE of $ or a
    // label still works in code (it is evaluated at its address during layout).
    expect(
      bytesOf('K EQU 2\nM = K*2\n    DEFINE D 3\n    IF K == 2 && M == 4 && D == 3\n    db 1\n    ENDIF\n    DUP K\n    db 2\n    EDUP\n')
    ).toBe('010202');
    expect(bytesOf('    IF MODE == 2\n    db 1\n    ENDIF\n', { defines: { MODE: '2' } })).toBe('01');
    expect(bytesOf('    ORG 0x8000\n    nop\n    DEFINE HERE $\n    dw HERE\n')).toBe('000180');
    expect(bytesOf('    ORG 0x8000\nstart:\n    nop\n    DEFINE AT start\n    dw AT\n')).toBe('000080');
  });

  it('ORG: a forward-referenced first ORG sets the origin, and bytes never land below emitted output', () => {
    // `ORG BASE` with BASE defined later froze origin 0 and emitted 32 KB of zeros.
    const forward = assemble('    ORG BASE\nstart:\n    nop\n    jp start\nBASE EQU 0x8000\n');
    expect(forward.ok, JSON.stringify(forward.errors)).toBe(true);
    expect(forward.origin).toBe(0x8000);
    expect(hex(forward.bytes)).toBe('00C30080');

    // A backwards ORG appended its bytes at the end, so `mid` (0x8002) and its byte disagreed.
    const back = assemble('    ORG 0x8000\n    db 1\n    ORG 0x8004\n    db 2\n    ORG 0x8002\nmid:\n    db 3\n');
    expect(back.ok).toBe(false);
    expect(back.errors.map((e) => [e.line, e.message])).toEqual([
      [5, 'ORG 0x8002 moves backwards into code or data already emitted (the output ends at 0x8005)'],
    ]);

    // Code before the first ORG is laid out at the origin, so the ORG put later bytes over it.
    const before = assemble('    db 1\n    ORG 0x8000\nstart:\n    db 2\n    dw start\n');
    expect(before.ok).toBe(false);
    expect(before.errors.map((e) => [e.line, e.message])).toEqual([
      [2, 'ORG 0x8000 follows code or data emitted before the first ORG; put the ORG before any instruction or data'],
    ]);

    expect(errorsOf('    ORG 0x10000\n    nop\n')).toEqual(['ORG address out of range: 0x10000']);
    // Unchanged: a forward ORG pads, an ORG back to define labels only is fine, and labels,
    // EQUs and DEVICE before the first ORG take the origin's address.
    expect(bytesOf('    ORG 0x8000\n    db 1\n    ORG 0x8004\n    db 2\n')).toBe('0100000002');
    expect(bytesOf('    ORG 0x8000\n    db 1\n    ORG 0x5000\nbuf:\n    ORG 0x8001\n    dw buf\n')).toBe('010050');
    expect(bytesOf('start:\n    DEVICE ZXSPECTRUM48\nK EQU 3\n    ORG 0x8000\n    db K\n    dw start\n')).toBe('030080');
  });

  it('a code label cannot share its name with an EQU/DEFL, and an EQU cannot change value', () => {
    // The label reference used to take the EQU value silently.
    expect(errorsOf('    ORG 0x8000\nFOO:\n    db FOO & 0xFF\nFOO EQU 5\n    db FOO\n')).toEqual([
      'Duplicate symbol: FOO is both a code label and an EQU constant',
    ]);
    expect(errorsOf('    ORG 0x8000\nFOO DEFL 1\nFOO:\n    nop\n')).toEqual([
      'Duplicate symbol: FOO is both a code label and a DEFL/= variable',
    ]);
    const redefined = 'EQU FOO redefined with a different value (0x0001, then 0x0002); use DEFL or = for a symbol that changes';
    expect(errorsOf('FOO EQU 1\n    db FOO\nFOO EQU 2\n    db FOO\n')).toEqual([redefined]);
    expect(errorsOf('FOO EQU 1\nFOO DEFL 2\n')).toEqual([redefined]);
    // The same value twice (a header included twice) is fine; DEFL and = stay reassignable.
    expect(bytesOf('FOO EQU 1\nFOO EQU 1\n    db FOO\n')).toBe('01');
    expect(bytesOf('X DEFL 1\n    db X\nX DEFL 2\n    db X\nY = 3\n    db Y\nY = 4\n    db Y\n')).toBe('01020304');
  });

  it('a literal 0xFFFF does not fit an 8-bit slot, while true and negative constants do', () => {
    expect(errorsOf('    db 0xFFFF\n')).toEqual(['8-bit value out of range: 0xFFFF']);
    expect(errorsOf('    ld a,65535\n')).toEqual(['8-bit value out of range: 65535']);
    expect(errorsOf('X EQU 0xFFFF\n    cp X\n')).toEqual(['8-bit value out of range: X']);
    // Unchanged: true is 0xFF in a byte and 0xFFFF in wider data; IF truthiness.
    expect(bytesOf('    db 1==1, 1==2, !0, 0||2\n    dw 1==1\n    d24 1==1\n')).toBe('FF00FFFF' + 'FFFF' + 'FFFF00');
    expect(bytesOf('T EQU 1==1\nN EQU -1\n    ld a,T\n    ld b,N\n    db T, N\n')).toBe('3EFF06FFFFFF');
    expect(bytesOf('    IF 1==1\n    db 1\n    ENDIF\n    IF 1==2\n    db 2\n    ENDIF\n')).toBe('01');
    expect(bytesOf('    ld a,X\n', { defines: { X: '-1' } })).toBe('3EFF');
    for (const value of ['1==1', '!0', -1]) {
      expect(bytesOf('    db X\n    ld a,X\n    dw X\n', { defines: { X: value } }), String(value)).toBe('FF' + '3EFF' + 'FFFF');
    }
    expect(errorsOf('    db X\n', { defines: { X: '0xFFFF' } })).toEqual(['8-bit value out of range: X']);
    expect(bytesOf('    DEFINE NEG -1\n    ld a,NEG\n    DEFINE T 1==1\n    db T\n')).toBe('3EFF' + 'FF');
    // Any negative byte constant fits (X EQU -2 was a false "out of range"), also as a displacement.
    expect(bytesOf('M EQU -2\n    ld a,M\n    ld b,(ix+M)\n')).toBe('3EFE' + 'DD46FE');
    expect(errorsOf('M EQU -129\n    ld a,M\n')).toEqual(['8-bit value out of range: M']);
  });

  it('macro arity, empty list elements, invalid define values and other devices are errors', () => {
    expect(errorsOf('Pair MACRO left,right\n    db left,right\nENDM\n    Pair 1\n')).toEqual([
      'Macro Pair expects 2 argument(s), got 1',
    ]);
    expect(errorsOf('    db 1,\n')).toEqual(['DB has an empty argument: 1,']);
    expect(errorsOf('    dw 1,,2\n')).toEqual(['DW has an empty argument: 1,,2']);
    expect(errorsOf('    ret z,\n')).toEqual(['RET has an empty operand: z,']);

    const text = assemble('    db MODE\n', { defines: { MODE: 'fast' } });
    expect(text.ok).toBe(false);
    expect(text.errors.map((e) => [e.file, e.message])).toEqual([
      ['<define>', "Invalid value for define MODE: 'fast' (Label not found: fast)"],
    ]);
    expect(errorsOf('    db X\n', { defines: { X: '0x' } })).toEqual([
      "Invalid value for define X: '0x' (Unexpected token 'x' in expression: 0x)",
    ]);
    expect(bytesOf('    db A, B, C, D\n', { defines: { A: '', B: true, C: 2, D: '0x10+1' } })).toBe('01010211');

    expect(errorsOf('    DEVICE ZXSPECTRUM128\n')).toEqual([
      'Unsupported DEVICE: ZXSPECTRUM128 (only ZXSPECTRUM48 is supported; use sjasmplus for other devices)',
    ]);
    expect(errorsOf('    DEVICE NONE\n')).toEqual([
      'Unsupported DEVICE: NONE (only ZXSPECTRUM48 is supported; use sjasmplus for other devices)',
    ]);
    expect(bytesOf('    device zxspectrum48\n    ORG 0x8000\n    nop\n')).toBe('00');
  });

  it('disassembles a run of four or more DD/FD prefixes as a one-byte DB, not as CALL nn', () => {
    const reader = (bytes: number[]) => (addr: number) => bytes[addr] ?? 0;
    expect(disassembleOne(reader([0xdd, 0xdd, 0xdd, 0xdd, 0x00, 0x00]), 0)).toEqual({ addr: 0, bytes: [0xdd], text: 'DB 0xDD' });
    expect(disassembleOne(reader([0xfd, 0xfd, 0xfd, 0xfd, 0x34, 0x12]), 0).text).toBe('DB 0xFD');
    // One to three prefixes decode as before: the last prefix applies.
    expect(disassembleOne(reader([0xdd, 0x21, 0x34, 0x12]), 0)).toMatchObject({ bytes: [0xdd, 0x21, 0x34, 0x12], text: 'LD IX,0x1234' });
    expect(disassembleOne(reader([0xdd, 0xdd, 0xdd, 0x21, 0x34, 0x12]), 0)).toMatchObject({ text: 'LD IX,0x1234' });
    expect(disassembleOne(reader([0xdd, 0xfd, 0x21, 0x34, 0x12]), 0).text).toBe('LD IY,0x1234');
    // Decoding resumes after the DB.
    const lines = disassemble(reader([0xdd, 0xdd, 0xdd, 0xdd, 0x21, 0x34, 0x12]), 0, 2);
    expect(lines.map((line) => [line.addr, line.text])).toEqual([
      [0, 'DB 0xDD'],
      [1, 'LD IX,0x1234'],
    ]);
  });

  it('a missing or extra operand reports one arity error, and a bare RST is not RST 0', () => {
    const cases: Array<[string, string]> = [
      ['ld a', 'LD expects 2 operand(s), got 1'],
      ['push', 'PUSH expects 1 operand(s), got 0'],
      ['inc', 'INC expects 1 operand(s), got 0'],
      ['ex de', 'EX expects 2 operand(s), got 1'],
      ['in', 'IN expects 2 operand(s), got 0'],
      ['out (c)', 'OUT expects 2 operand(s), got 1'],
      ['im', 'IM expects 1 operand(s), got 0'],
      ['add', 'ADD expects 2 operand(s), got 0'],
      ['sub', 'SUB expects 1 operand(s), got 0'],
      ['ld a,b,c', 'LD expects 2 operand(s), got 3'],
      ['rst', 'RST expects 1 operand(s), got 0'],
      ['rst 8,1', 'RST expects 1 operand(s), got 2'],
      ['djnz l,1', 'DJNZ expects 1 operand(s), got 2'],
    ];
    for (const [line, message] of cases) {
      expect(errorsOf(`l:\n    ${line}\n`), line).toEqual([message]);
    }
  });

  it('sandbox containment ignores drive-letter case and does not follow links out of the project', () => {
    const root = mkdtempSync(join(tmpdir(), 'zxasm-sandbox-real-'));
    const project = join(root, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'inc.asm'), 'V EQU 0x42\n');
    writeFileSync(join(project, 'main.asm'), '    INCLUDE "inc.asm"\n    db V\n');
    if (process.platform === 'win32') {
      // A lowercase drive letter in cwd made every sibling INCLUDE "outside the sandbox".
      const flip = (path: string) => (path[0] === path[0]!.toUpperCase() ? path[0]!.toLowerCase() : path[0]!.toUpperCase()) + path.slice(1);
      const result = assembleFile(join(project, 'main.asm'), { cwd: flip(project), sandbox: true });
      expect(result.ok, JSON.stringify(result.errors)).toBe(true);
      expect(hex(result.bytes)).toBe('42');
    }
    // A directory link (a junction on Windows, which needs no privileges) inside the project
    // pointing outside it used to be followed.
    writeFileSync(join(root, 'secret.asm'), 'SECRET EQU 0x99\n');
    symlinkSync(root, join(project, 'up'), 'junction');
    writeFileSync(join(project, 'linked.asm'), '    INCLUDE "up/secret.asm"\n    db SECRET\n');
    const linked = assembleFile(join(project, 'linked.asm'), { cwd: project, sandbox: true });
    expect(linked.ok).toBe(false);
    expect(linked.errors.map((e) => e.message)).toEqual(['INCLUDE path is outside the sandbox roots: up/secret.asm']);
    expect(assembleFile(join(project, 'linked.asm'), { cwd: project }).ok).toBe(true);
  });

  it('h-suffix hex beats the 0b prefix, % after an operand is MOD, and ( hl ) means (HL)', () => {
    expect(bytesOf('    ld a,0B0h\n    dw 0B1Fh\n    db 0b101, 101b, 0bh\n')).toBe('3EB0' + '1F0B' + '05050B');
    expect(bytesOf('K EQU 7\n    db 7%10, K%4, (9)%5, %101, 1+%10, LOW %1\n')).toBe('070304050301');
    expect(
      bytesOf('    ld a,( hl )\n    ld (hl ),a\n    inc ( hl )\n    ld ( hl ),5\n    add a,( hl )\n    bit 1,( hl )\n    ld a,( ix + 5 )\n')
    ).toBe('7E' + '77' + '34' + '3605' + '86' + 'CB4E' + 'DD7E05');
  });

  it('an unresolved operand is reported once', () => {
    // JR/DJNZ added "Relative branch out of range"; a binary operator added "Missing right operand".
    expect(errorsOf('    ORG 0x8000\n    jr nowhere\n')).toEqual(['Label not found: nowhere']);
    expect(errorsOf('    ORG 0x8000\n    djnz nowhere\n')).toEqual(['Label not found: nowhere']);
    expect(errorsOf('    db 1+nowhere\n')).toEqual(['Label not found: nowhere']);
    expect(errorsOf('    db 4/nowhere\n')).toEqual(['Label not found: nowhere']);
    // A really missing operand is still a syntax error.
    expect(errorsOf('    db 1+\n')).toEqual(["Missing right operand after '+'"]);
  });

  it('a diagnostic inside a macro expansion names the call site', () => {
    const single = assemble('Pair MACRO left,right\n    db left,right\nENDM\n    nop\n    Pair 1,2\n    Pair 3,missing_sym\n', {
      entryPath: 'macro-site.asm',
    });
    expect(single.errors.map((e) => [e.line, e.message])).toEqual([
      [2, 'Label not found: missing_sym (in macro Pair called at line 6)'],
    ]);
    const nested = assemble('Inner MACRO v\n    db v\nENDM\nOuter MACRO w\n    Inner w\nENDM\n    Outer nothere\n');
    expect(nested.errors.map((e) => [e.line, e.message])).toEqual([
      [2, 'Label not found: nothere (in macro Inner called at line 5, in macro Outer called at line 7)'],
    ]);
  });

  it('INCBIN rejects ranges past the end of the file; a label may precede a macro call or INCLUDE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zxasm-incbin-range-'));
    writeFileSync(join(dir, 'f.bin'), Buffer.from([1, 2, 3, 4]));
    writeFileSync(join(dir, 'part.asm'), '    db 9\n');
    const at = (source: string) => assemble(source, { cwd: dir });
    expect(at('    INCBIN "f.bin", 1, 10\n').errors.map((e) => e.message)).toEqual([
      'INCBIN length out of range: 10 (3 byte(s) available from offset 1)',
    ]);
    expect(at('    INCBIN "f.bin", 5\n').errors.map((e) => e.message)).toEqual(['INCBIN offset out of range: 5 (the file has 4 byte(s))']);
    expect(hex(at('    INCBIN "f.bin", 1, 3\n').bytes)).toBe('020304');
    expect(at('    INCBIN "f.bin", 4\n').ok).toBe(true);

    // `here: M 7` used to fail as "Unsupported instruction: M 7"; `here: INCLUDE` skipped the file.
    expect(bytesOf('    ORG 0x8000\nM MACRO v\n    db v\nENDM\nhere: M 7\nthere M 8\n    dw here, there\n')).toBe('0708' + '0080' + '0180');
    expect(bytesOf('    ORG 0x8000\n    nop\nhere: INCLUDE "part.asm"\n    dw here\n', { cwd: dir })).toBe('00' + '09' + '0180');
  });

  it('SLD source-line records cover data directives as well as instructions', () => {
    const result = assemble(
      '    DEVICE ZXSPECTRUM48\n    ORG 0x6000\ncode: ld a,1\ndata: db 1,2,3\n    dw 0x1234\n    ds 2\n    ds 0\n    nop\n',
      { entryPath: 'sld-data.asm' }
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.sourceMap.map((m) => [m.line, m.addr])).toEqual([
      [3, 0x6000],
      [4, 0x6002],
      [5, 0x6005],
      [6, 0x6007],
      [8, 0x6009],
    ]);
    expect(result.sld).toContain('|4||0|2|24578|T|');
    expect(result.sld).toContain('pages.size:16384,pages.count:4');
    // DEVICE followed by a tab still records the 48K page metadata.
    expect(assemble('    DEVICE\tZXSPECTRUM48\n    ORG 0x8000\n    nop\n').sld).toContain('pages.size:16384,pages.count:4');
  });

  it('zxasm assemble prints hints and warnings when it fails, and doctor runs a real probe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zxasm-cli-fail-'));
    writeFileSync(
      join(dir, 'bad.asm'),
      '    ORG 0x8000\n    DISPLAY "probe"\n    call draw_sprtie\ndraw_sprite:\n    ret\n'
    );
    const res = asmCli('assemble', join(dir, 'bad.asm'), '--out-dir', join(dir, 'build'));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('warning: DISPLAY: probe');
    expect(res.stderr).toContain('error: Label not found: draw_sprtie');
    expect(res.stderr).toContain("  hint: Did you mean 'draw_sprite'?");

    expect(checkAssemblerRuntime()).toEqual({ ok: true });
    const wrongBytes = { ...assemble('    nop\n'), bytes: Uint8Array.from([0x00]) };
    expect(checkAssemblerRuntime(() => wrongBytes)).toEqual({ ok: false, message: 'the probe assembled to 00 instead of 3E2A' });
    const failed = assemble('    jp nowhere\n');
    expect(checkAssemblerRuntime(() => failed)).toEqual({ ok: false, message: 'the probe failed to assemble: Label not found: nowhere' });
    expect(
      checkAssemblerRuntime(() => {
        throw new Error('boom');
      })
    ).toEqual({ ok: false, message: 'assembling the probe threw: boom' });
  });
});

// ADR-0033: source that used to assemble to the wrong bytes with no diagnostic. The
// fixture cases in dna/conformance/assembler/syntax-surface.json pin one example of
// each; these cover the sibling forms.
describe('no silent misassembly (ADR-0033)', () => {
  const at = (...lines: string[]) => assemble(['    ORG 0x8000', ...lines, ''].join('\n'));
  const oneError = (lines: string[], message: string) => {
    const r = at(...lines);
    expect(r.ok, hex(r.bytes)).toBe(false);
    expect(r.errors.map((e) => e.message)).toEqual([message]);
  };

  it('rejects index halves and junk operands where no such instruction exists', () => {
    oneError(['    rlc ixh'], 'Unsupported RLC target: ixh');
    oneError(['    set 1,iyl'], 'Unsupported SET target: iyl');
    oneError(['    out (c),iyl'], 'Unsupported OUT form: (c), iyl');
    oneError(['    in (hl),(c)'], 'Unsupported IN form: (hl), (c)');
    oneError(['    out (c),(hl)'], 'Unsupported OUT form: (c), (hl)');
    oneError(['    rlc (ix+1),zzz'], 'Unsupported RLC copy-register: zzz');
    oneError(['    set 3,(ix+4),ixh'], 'Unsupported SET copy-register: ixh');
    // The legal forms next to them are unchanged.
    expect(hex(at('    bit 0,h', '    rlc (ix+1),b', '    set 3,(ix+4),a', '    in h,(c)', '    out (c),l').bytes)).toBe(
      'CB44DDCB0100DDCB04DFED60ED69'
    );
  });

  it('reports malformed expressions instead of reading a default', () => {
    oneError(['    db ~'], "Missing operand after '~'");
    oneError(['    db !'], "Missing operand after '!'");
    oneError(['    ld a,LOW'], "Missing operand after 'LOW'");
    oneError(['    ld a,(2+(3)'], "Missing ')' in expression: (2+(3)");
    oneError(["    cp '\\q'"], 'Unsupported string escape: \\q');
    // An unresolved operand still reads as "Label not found" only (ASM-PROD-ERR-012).
    oneError(['    db -missing'], 'Label not found: missing');
    expect(hex(at('    ld a,((1+2))', '    ld a,(1+2)', '    ld a,-(1+2)*2', "    ld a,'\\n'").bytes)).toBe('3A03003A03003EFA3E0A');
  });

  it('reads a column-0 macro call with an END argument as a call, and keeps label END', () => {
    const r = assemble(['Jump MACRO target', '    jp target', 'ENDM', '    ORG 0x8000', 'Jump end', 'end: nop', 'stop END', '    db 9', ''].join('\n'));
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(hex(r.bytes)).toBe('C30380' + '00');
  });

  it('keeps a colon after a label and after directive-named labels', () => {
    oneError(['ei : ret'], "ei is an instruction, not a label: put one instruction per line (':' does not separate statements here)");
    oneError(['loop: ei : ret'], 'Unsupported instruction: EI : ret');
    const r = at('loop: nop', 'end: nop', 'org: jr loop');
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(hex(r.bytes)).toBe('000018FC');
  });

  it('makes DEFINE order-sensitive and a value-less DEFINE true, like -D', () => {
    oneError(['    db FOO', '    DEFINE FOO 1'], 'Label not found: FOO');
    const r = at('    DEFINE FLAG', '    db FLAG', '    IF FLAG', '    db 2', '    ENDIF', '    UNDEFINE FLAG', '    IFNDEF FLAG', '    db 3', '    ENDIF');
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(hex(r.bytes)).toBe('010203');
    expect(hex(assemble('    ORG 0x8000\n    db FLAG\n', { defines: { FLAG: '' } }).bytes)).toBe('01');
  });

  it('substitutes macro parameters and repeat counters once, outside numbers', () => {
    const r = assemble(
      ['    ORG 0x8000', 'Swap MACRO a1,b1', '    db b1,a1', 'ENDM', '    Swap b1,a1', 'a1 EQU 1', 'b1 EQU 2', '    DUP 2, x', '    db 0x1b + x', '    EDUP', ''].join('\n')
    );
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(hex(r.bytes)).toBe('01021B1C');
  });

  it('keeps constants at full width in expressions and 16 bits in exported symbols', () => {
    const r = at(
      'HZ EQU 3500000',
      'N EQU -3',
      'NEG2 EQU -2',
      'T EQU 1==1',
      '    dw HZ/1000, HZ >> 8 & 0xFFFF',
      '    IF N < 0',
      '    db 1',
      '    ENDIF',
      '    db NEG2, T, N/2 & 0xFF',
      '    ld (ix+NEG2),a',
      '    DEFINE BIG 0x12345',
      '    dw BIG - 0x10000'
    );
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(hex(r.bytes)).toBe('AC0D' + '6735' + '01' + 'FEFFFF' + 'DD77FE' + '4523');
    // ASM-PROD-EXPR-004 still holds: a literal 0xFFFF does not fit a byte.
    oneError(['    db 0xFFFF'], '8-bit value out of range: 0xFFFF');
    oneError(['HZ EQU 3500000', '    dw HZ'], '16-bit value out of range: HZ');
    // The exported symbol and the SLD keep 16 bits, as before.
    expect(r.symbols.find((s) => s.name === 'HZ')?.value).toBe(3500000 & 0xffff);
    expect(r.symbols.find((s) => s.name === 'N')?.value).toBe(0xfffd);
    const api = assemble('    ORG 0x8000\n    dw BIG/16\n', { defines: { BIG: '0x10000' } });
    expect(api.ok, JSON.stringify(api.errors)).toBe(true);
    expect(hex(api.bytes)).toBe('0010');
  });

  it('warns when parentheses around an immediate look like a memory read', () => {
    const r = at('    cp (5)', '    ld (ix+1),(7)', '    ld b,5', '    ld a,(5)');
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(hex(r.bytes)).toBe('FE05DD3601070605' + '3A0500');
    expect(r.warnings.map((w) => w.message.split(':')[0])).toEqual(['CP (5)', 'LD (ix+1),(7)']);
  });
});
