// Headless CI proof that the real ROM boots — the deterministic core behind the
// browser demos. No browser, no bundle: it drives @zx-vibes/machine directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMachine, RESET_REGISTERS } from '@zx-vibes/machine';

const HERE = dirname(fileURLToPath(import.meta.url));

function bootBasic(frames = 200) {
  const rom = new Uint8Array(readFileSync(join(HERE, '48k.rom')));
  assert.equal(rom.length, 16384);
  const memory = new Uint8Array(0x10000);
  memory.set(rom, 0);
  const machine = createMachine({ memory, registers: { ...RESET_REGISTERS } });
  for (let i = 0; i < frames; i += 1) machine.runFrame();
  return machine.memory.slice(0x4000, 0x4000 + 6912);
}

function setPixelCount(image) {
  let n = 0;
  for (let i = 0; i < 6144; i += 1) {
    let b = image[i];
    while (b) {
      n += b & 1;
      b >>= 1;
    }
  }
  return n;
}

test('the real 48K ROM boots to a non-blank BASIC screen', () => {
  const pixels = setPixelCount(bootBasic(200));
  assert.ok(pixels > 100, `expected the boot/copyright text (>100 set pixels), got ${pixels}`);
});

test('booting is deterministic', () => {
  assert.deepEqual(bootBasic(200), bootBasic(200));
});
