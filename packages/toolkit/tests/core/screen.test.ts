import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/core/machine.js';
import { screenshotPNG } from '../../src/core/screen.js';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'golden');
const goldenBootPath = join(goldenDir, 'boot-copyright.png');

describe('screenshotPNG', () => {
  it('produces a 2x PNG of the boot screen matching the golden image', () => {
    const m = Machine.boot();
    m.run({ frames: 250 });
    const png = screenshotPNG(m);

    const decoded = PNG.sync.read(png);
    expect(decoded.width).toBe(704); // 352 * 2
    expect(decoded.height).toBe(592); // 296 * 2

    if (!existsSync(goldenBootPath) || process.env['UPDATE_GOLDEN']) {
      mkdirSync(goldenDir, { recursive: true });
      writeFileSync(goldenBootPath, png);
    }
    const golden = readFileSync(goldenBootPath);
    expect(png.equals(golden)).toBe(true);
  });

  it('renders the border color', () => {
    const m = Machine.boot();
    m.run({ frames: 250 });
    // Set border to red (2) via the ULA port, as OUT (0xFE) would.
    m.ula.writePort(0xfe, 0x02);
    m.run({ frames: 2 }); // let scanline border colors latch the new value
    const decoded = PNG.sync.read(screenshotPNG(m, { scale: 1 }));
    // Top-left border pixel should be red-ish (Spectrum red = #D70000).
    expect(decoded.data[0]).toBeGreaterThan(0xa0);
    expect(decoded.data[1]).toBe(0);
    expect(decoded.data[2]).toBe(0);
  });
});
