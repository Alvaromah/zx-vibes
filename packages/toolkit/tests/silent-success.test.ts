// Commands that reported success without doing what was asked (ERR-PROD-NOSILENT-001):
// each case here used to exit 0 with `ok: true`.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import { runCli } from '../src/cli.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-silent-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function cli(argv: string[]): Promise<{ code: number; env: Record<string, unknown> }> {
  const out: string[] = [];
  const prev = process.cwd();
  process.chdir(dir);
  let code: number;
  try {
    code = await runCli([...argv, '--json'], { streams: { out: (t) => out.push(t), err: () => {} } });
  } finally {
    process.chdir(prev);
  }
  return { code, env: JSON.parse(out.join('')) as Record<string, unknown> };
}

const message = (env: Record<string, unknown>): string => (env.error as { message: string }).message;

function program(): void {
  const result = assemble('    ORG 0x8000\n    ei\nidle:\n    halt\n    jr idle\n');
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  writeFileSync(join(dir, 'p.bin'), result.bytes);
}

const STATE = '.zxs/state.zxstate';

describe('mem write / mem load cannot target the ROM', () => {
  // A session keeps RAM only, so a poke below 0x4000 was reported `persisted: true`
  // and was gone on the next command.
  it('mem write below 0x4000 is a user error, and RAM stays writable', async () => {
    program();
    await cli(['state', 'save', '--bin', 'p.bin']);

    const rom = await cli(['mem', 'write', '0x0000', '00', '--state', STATE]);
    expect(rom.code).toBe(1);
    expect(message(rom.env)).toMatch(/ROM/);

    // A write that starts in ROM is refused whole, not half applied.
    const straddle = await cli(['mem', 'write', '0x3FFF', 'AA BB', '--state', STATE]);
    expect(straddle.code).toBe(1);
    expect((await cli(['mem', 'read', '0x4000', '--len', '1', '--state', STATE])).env.bytes).toEqual([0]);

    const ram = await cli(['mem', 'write', '0x4000', 'AA', '--state', STATE]);
    expect(ram.env.persisted).toBe(true);
    expect((await cli(['mem', 'read', '0x4000', '--len', '1', '--state', STATE])).env.bytes).toEqual([0xaa]);
  });

  it('mem load below 0x4000 is a user error', async () => {
    program();
    await cli(['state', 'save', '--bin', 'p.bin']);
    writeFileSync(join(dir, 'blob.bin'), Uint8Array.from([1, 2, 3]));
    const rom = await cli(['mem', 'load', '0x1000', '--bin', 'blob.bin', '--state', STATE]);
    expect(rom.code).toBe(1);
    expect(message(rom.env)).toMatch(/ROM/);
  });
});

describe('state export needs the session it was pointed at', () => {
  it('a --state that names no session is an error, not an export of a fresh boot', async () => {
    program();
    const typo = await cli(['state', 'export', '--z80', 'out.z80', '--state', 'typo.zxstate', '--bin', 'p.bin']);
    expect(typo.code).toBe(1);
    expect(message(typo.env)).toMatch(/No session at "typo\.zxstate"/);
    expect(existsSync(join(dir, 'out.z80'))).toBe(false);
  });

  it('with an existing session, and with no --state at all, it still exports', async () => {
    program();
    await cli(['state', 'save', '--bin', 'p.bin']);
    expect((await cli(['state', 'export', '--z80', 'a.z80', '--state', STATE])).code).toBe(0);
    expect((await cli(['state', 'export', '--z80', 'b.z80', '--bin', 'p.bin'])).code).toBe(0);
  });
});

describe('regs set rejects what is not a register', () => {
  it('object-prototype names are unknown registers', async () => {
    for (const name of ['constructor', '__proto__', 'toString']) {
      const result = await cli(['regs', 'set', name, '5']);
      expect(result.code).toBe(1);
      expect(message(result.env)).toMatch(/Unknown register/);
    }
  });

  it('the interrupt mode is 0, 1 or 2', async () => {
    expect((await cli(['regs', 'set', 'im', '3'])).code).toBe(1);
    const two = await cli(['regs', 'set', 'im', '2']);
    expect((two.env.registers as { im: number }).im).toBe(2);
  });

  it("an 8-bit alternate register can be named a' as well as a2", async () => {
    const result = await cli(['regs', 'set', "a'", '0x12']);
    expect(result.code).toBe(0);
    expect(((result.env.registers as { alt: { af: number } }).alt.af >> 8) & 0xff).toBe(0x12);
  });
});

describe('screen --max-diff is validated', () => {
  it('a non-numeric value is a user error instead of a diff that can never pass', async () => {
    program();
    const result = await cli(['screen', '--bin', 'p.bin', '--diff', 'base.png', '--max-diff', 'ten']);
    expect(result.code).toBe(1);
    expect(message(result.env)).toMatch(/Invalid --max-diff/);
  });
});

describe('the reverse-engineering gate is re-read on every runCli', () => {
  it('gfx find is not served once ZXS_REVENG is off again in the same process', async () => {
    program();
    const previous = process.env.ZXS_REVENG;
    try {
      process.env.ZXS_REVENG = 'on';
      await cli(['gfx', 'find', '--bin', 'p.bin']); // mounts the add-on
      process.env.ZXS_REVENG = 'off';
      const off = await cli(['gfx', 'find', '--bin', 'p.bin']);
      expect(off.code).not.toBe(0);
      expect(message(off.env)).toMatch(/not installed/i);
    } finally {
      if (previous === undefined) delete process.env.ZXS_REVENG;
      else process.env.ZXS_REVENG = previous;
    }
  });
});
