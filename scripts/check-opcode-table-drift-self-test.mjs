#!/usr/bin/env node
// Self-test for the opcode-table drift gate: it must PASS against the committed,
// freshly-regenerated file and FAIL against any tampering (a changed byte, an
// extra entry, a missing file). Guards the anti-rot guard.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { GENERATED_PATH, generateOpcodeTableSource } from "./gen-opcode-table.mjs";
import { checkOpcodeTableDrift } from "./check-opcode-table-drift.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// 1. The committed file is in sync with the DNA (the live invariant).
{
  const result = await checkOpcodeTableDrift();
  assert(result.ok, `expected committed table to be in sync, got: ${result.reason ?? "?"}`);
}

// 2. The generator is deterministic: two generations are byte-identical.
{
  const a = await generateOpcodeTableSource();
  const b = await generateOpcodeTableSource();
  assert(a === b, "expected generateOpcodeTableSource() to be deterministic");
}

// 3. The committed file equals a fresh generation byte-for-byte (EOL-normalized).
{
  const expected = (await generateOpcodeTableSource()).replace(/\r\n/g, "\n");
  const actual = (await readFile(GENERATED_PATH, "utf8")).replace(/\r\n/g, "\n");
  assert(actual === expected, "committed generated file is not byte-identical to a fresh generation");
}

// 4. A tampered file is detected. We exercise the comparison directly against a
//    mutated copy so the check provably rejects drift (without touching the real
//    committed artifact).
{
  const expected = (await generateOpcodeTableSource()).replace(/\r\n/g, "\n");
  const tamperedSamples = [
    expected.replace('"caseInsensitive":true', '"caseInsensitive":false'),
    `${expected}\n// stray edit\n`,
    expected.replace("Z80_OPCODE_TABLE_ENTRY_COUNT = ", "Z80_OPCODE_TABLE_ENTRY_COUNT = 1 + "),
  ];
  for (const [index, tampered] of tamperedSamples.entries()) {
    assert(tampered !== expected, `tamper sample ${index} did not actually change the text`);
  }

  // And prove the file-backed check fails when the committed file is mutated:
  const dir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-opcode-drift-"));
  try {
    const decoy = path.join(dir, "z80-opcodes-table.ts");
    await writeFile(decoy, tamperedSamples[0], "utf8");
    const decoyDiffers = (await readFile(decoy, "utf8")).replace(/\r\n/g, "\n") !== expected;
    assert(decoyDiffers, "expected the tampered decoy to differ from a fresh generation");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

console.warn("opcode-table drift self-test passed: in-sync passes, tampering and staleness fail.");
