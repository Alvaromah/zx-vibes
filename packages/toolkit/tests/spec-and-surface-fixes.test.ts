// More cases that used to pass, print nothing or report the wrong thing (2026-11-13 review):
//   - a test spec with a mistyped optional field (`"frames": "ten"` ran zero frames);
//   - assertion numbers that were masked to fit instead of rejected;
//   - `zxs --verison` (an unknown flag and no command) printing the help with exit 0;
//   - human-mode `build` never showing assembler warnings (`DISPLAY` output);
//   - reveng `xref` blind to `RST n`, and `scan --imm` reading an index displacement and
//     the following opcode as a 16-bit immediate.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { runScanImm } from '../src/reveng/scan.js';
import { runXref } from '../src/reveng/xref.js';
import { runSpec } from '../src/test/runner.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-surface-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function cli(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const code = await runCli(argv, { streams: { out: (t) => out.push(t), err: (t) => err.push(t) } });
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    process.chdir(prev);
  }
}

// Sets A = 0xFF, then idles on HALT.
const PROGRAM = '    ORG 0x8000\n    ld a,0xFF\n    ei\nidle:\n    halt\n    jr idle\n';

function spec(fields: Record<string, unknown>): string {
  writeFileSync(join(dir, 'p.asm'), PROGRAM);
  const file = join(dir, 'case.test.json');
  writeFileSync(file, JSON.stringify({ build: 'p.asm', assert: [{ type: 'status', equals: 'ok' }], ...fields }));
  return file;
}

describe('a test spec with a mistyped optional field fails instead of passing', () => {
  for (const [field, value, message] of [
    ['frames', 'ten', /"frames" must be a whole number/],
    ['frames', -5, /"frames" must be a whole number/],
    ['frames', 1.5, /"frames" must be a whole number/],
    ['detectHangs', 'false', /"detectHangs" must be true or false/],
    ['keys', 5, /"keys" must be a schedule string/],
    ['joy', ['0:F'], /"joy" must be a schedule string/],
    ['org', true, /"org" must be an address/],
  ] as const) {
    it(`${field}: ${JSON.stringify(value)}`, () => {
      const result = runSpec(spec({ [field]: value }), dir);
      expect(result.ok).toBe(false);
      expect(result.failures.join('\n')).toMatch(message);
    });
  }

  it('well-typed fields still run (frames: 0 included)', () => {
    expect(runSpec(spec({ frames: 5, detectHangs: true, keys: '0:P*2' }), dir).ok).toBe(true);
    expect(runSpec(spec({ frames: 0 }), dir).ok).toBe(true);
  });
});

describe('assertion numbers are validated, not masked', () => {
  const assert = (assertion: Record<string, unknown>): ReturnType<typeof runSpec> =>
    runSpec(spec({ frames: 5, assert: [assertion] }), dir);

  it('regEquals: a value the register cannot hold is a spec error', () => {
    const result = assert({ type: 'regEquals', reg: 'a', value: 256 + 0xff });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/does not fit a 8-bit register/);
  });

  it('regEquals: in-range and negative (two-complement) values still compare', () => {
    expect(assert({ type: 'regEquals', reg: 'a', value: 255 }).ok).toBe(true);
    expect(assert({ type: 'regEquals', reg: 'a', value: -1 }).ok).toBe(true);
    expect(assert({ type: 'regEquals', reg: 'a', value: '0xFF' }).ok).toBe(true);
    expect(assert({ type: 'regEquals', reg: 'a', value: 1 }).ok).toBe(false);
  });

  it('memEquals / memInRange: an address past 0xFFFF is a spec error', () => {
    // 0x18000 used to be read as 0x8000, where the program really has 3E.
    for (const assertion of [
      { type: 'memEquals', addr: 0x18000, hex: '3E' },
      { type: 'memInRange', addr: 0x18000, min: 0, max: 255 },
    ]) {
      const result = assert(assertion);
      expect(result.ok).toBe(false);
      expect(result.failures.join('\n')).toMatch(/not a 16-bit address/);
    }
    expect(assert({ type: 'memEquals', addr: 0x8000, hex: '3E' }).ok).toBe(true);
  });
});

describe('zxs with only flags', () => {
  it('an unknown flag is a usage error (exit 1), not the help with exit 0', async () => {
    const human = await cli(['--verison']);
    expect(human.code).toBe(1);
    expect(human.err).toMatch(/unknown option '--verison'/);
    expect(human.out).toBe('');

    const json = await cli(['--verison', '--json']);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out)).toMatchObject({ ok: false, stage: 'cli' });
  });

  it('a bare invocation, --help and --version are unchanged', async () => {
    expect((await cli([])).code).toBe(0);
    const help = await cli(['--help']);
    expect(help.code).toBe(0);
    expect(help.out).toMatch(/Usage: zxs/);
    expect((await cli(['--version'])).code).toBe(0);
  });
});

describe('human-mode build shows the assembler warnings', () => {
  it('a DISPLAY line is printed, not only counted', async () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.asm'), '    ORG 0x8000\n    DISPLAY "hello from display"\n    ret\n');
    const result = await cli(['build', 'src/main.asm']);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/warnings=1/);
    expect(result.out).toMatch(/DISPLAY: hello from display/);
  });
});

describe('reveng static analysis reads the instruction, not its trailing bytes', () => {
  // 8000 RST 0x10 / 8001 LD A,(IX+5) / 8004 LD HL,0x9000 / 8007 BIT 0,(IY+0) / 800B RET
  const IMAGE = [0xd7, 0xdd, 0x7e, 0x05, 0x21, 0x00, 0x90, 0xfd, 0xcb, 0x00, 0x46, 0xc9];
  const source = (): { cwd: string; bin: string; org: string; range: string } => {
    writeFileSync(join(dir, 'p.bin'), Uint8Array.from(IMAGE));
    return { cwd: dir, bin: 'p.bin', org: '0x8000', range: '0x8000-0x800B' };
  };

  it('xref finds an RST to its restart address, as a call', () => {
    const env = runXref({ ...source(), target: '0x0010' });
    expect(env.refs).toEqual([{ addr: 0x8000, text: 'RST 0x10', kind: 'call' }]);
    expect(runXref({ ...source(), target: '0x0038' }).count).toBe(0);
  });

  it('scan --imm matches the 16-bit operand and nothing made of other bytes', () => {
    const hl = runScanImm({ ...source(), imm: '0x9000-0x9000' });
    expect(hl.matches).toEqual([{ addr: 0x8004, text: 'LD HL,0x9000', value: 0x9000 }]);
    // `DD 7E 05` is not the immediate 0x057E, `FD CB 00 46` is not 0x4600.
    expect(runScanImm({ ...source(), imm: '0x057E-0x057E' }).count).toBe(0);
    expect(runScanImm({ ...source(), imm: '0x4600-0x4600' }).count).toBe(0);
  });
});
