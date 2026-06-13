import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build } from '../../src/build/sjasmplus.js';
import { Machine } from '../../src/core/machine.js';
import { screenText } from '../../src/core/screen-text.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

describe('SNA snapshot path', () => {
  it('builds with SAVESNA and the snapshot runs to HELLO ZX', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zxs-sna-'));
    const result = await build(join(fixtures, 'hello-sna.asm'), { outDir: dir, cwd: dir });
    expect(result.ok).toBe(true);

    const snaPath = join(dir, 'hello.sna');
    const sna = new Uint8Array(readFileSync(snaPath));
    expect(sna.length).toBe(49179); // 27-byte header + 48K

    const m = Machine.boot();
    m.run({ frames: 250 }); // boot so the ROM channel state is sane
    m.loadSna(sna);
    expect(m.cpu.registers.getPC()).toBe(0x8000); // popped from the SNA stack
    m.run({ frames: 20 });

    const text = screenText(m);
    expect(text.rows.some((r) => r.includes('HELLO ZX'))).toBe(true);
  });
});
