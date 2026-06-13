import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

/** Resolves the 48K ROM bundled inside the zx-generation npm package. */
export function romPath(): string {
  const pkgJson = require.resolve('@zx-vibes/emulator/package.json');
  return join(dirname(pkgJson), 'rom', '48k.rom');
}

export function loadRom(): Uint8Array {
  const data = readFileSync(romPath());
  if (data.length !== 16384) {
    throw new Error(`Unexpected ROM size: ${data.length} bytes (expected 16384) at ${romPath()}`);
  }
  return new Uint8Array(data);
}
