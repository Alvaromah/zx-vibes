// 48K ROM loader — backs the fresh-boot machine source (toolkit-runtime.md
// RT-PROD-SESSION-002) and the deterministic clean-ROM boot cache
// (RT-PROD-RULE-ROMCACHE-001).
//
// The 16384-byte ROM ships as a package asset (`assets/48k.rom`); its bytes are
// read once and cached, so each fresh boot clones cheaply and deterministically.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The 48K ROM image size (cli.md CLI-PROD-DOCTOR-001 / errors.md ERR-PROD-ENV-001). */
export const ROM_SIZE = 16384;

const ROM_ASSET = join('assets', '48k.rom');

let cachedRom: Uint8Array | undefined;

/**
 * Locate `assets/48k.rom` by walking up from this module. Works both from the
 * built `dist/` and from `src/` under test, since the asset sits at the package
 * root above either. Exported so `doctor` can stat the asset (size/presence check,
 * cli.md CLI-PROD-DOCTOR-001 / errors.md ERR-PROD-ENV-001) without booting a machine.
 */
export function findRomPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  // Bounded walk up to the filesystem root.
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, ROM_ASSET);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate the 48K ROM asset (${ROM_ASSET})`);
}

/**
 * Load the 48K ROM bytes (cached after the first read). The returned array is the
 * shared cached copy — callers MUST NOT mutate it; {@link romBootMemory} clones it
 * into a fresh 64 KB address space.
 */
export function loadRom(): Uint8Array {
  if (cachedRom) return cachedRom;
  const bytes = readFileSync(findRomPath());
  if (bytes.length !== ROM_SIZE) {
    throw new Error(`48K ROM must be ${ROM_SIZE} bytes, got ${bytes.length}`);
  }
  cachedRom = new Uint8Array(bytes);
  return cachedRom;
}

/**
 * Build a fresh 64 KB address space with the ROM mapped at 0x0000-0x3FFF and RAM
 * (0x4000-0xFFFF) zeroed — the clean 48K power-on memory image. Each call returns
 * an independent buffer so fresh boots never share state (the stateless default,
 * RT-PROD-SESSION-001).
 */
export function romBootMemory(): Uint8Array {
  const memory = new Uint8Array(0x10000);
  memory.set(loadRom(), 0x0000);
  return memory;
}
