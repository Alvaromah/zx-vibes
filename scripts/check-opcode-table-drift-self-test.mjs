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

// 4. A tampered file is detected by the real checker. checkOpcodeTableDrift() takes the
//    file to compare, so each tampered copy is written to a temp dir (the committed
//    artifact is never touched) and must be reported ok:false; an untouched copy in the
//    same place must still pass, so the failures come from the tampering, not the path.
{
  const expected = (await generateOpcodeTableSource()).replace(/\r\n/g, "\n");
  const firstRow = expected.split("\n").find((line) => line.startsWith('  {"id":"Z80-OPC-LD-B-N-001"'));
  assert(firstRow, "expected the generated table to contain the LD B,n row");
  const tampered = {
    "changed opcode byte": expected.replace('{"value":6,"hex":"06"}', '{"value":7,"hex":"07"}'),
    "extra entry": expected.replace(
      firstRow,
      `${firstRow}\n${firstRow.replace("Z80-OPC-LD-B-N-001", "Z80-OPC-LD-B-N-EXTRA")}`,
    ),
  };
  const dir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-opcode-drift-"));
  try {
    const pristine = path.join(dir, "pristine.ts");
    await writeFile(pristine, expected, "utf8");
    const control = await checkOpcodeTableDrift(pristine);
    assert(control.ok, `expected an untouched copy to pass, got: ${control.reason ?? "?"}`);

    for (const [name, text] of Object.entries(tampered)) {
      assert(text !== expected, `tamper sample '${name}' did not change the text`);
      const decoy = path.join(dir, `${name.replace(/\W+/g, "-")}.ts`);
      await writeFile(decoy, text, "utf8");
      const result = await checkOpcodeTableDrift(decoy);
      assert(!result.ok, `expected the drift check to reject a table with a ${name}`);
      assert(/is stale/.test(result.reason ?? ""), `unexpected reason for the ${name}: ${result.reason}`);
    }

    const missing = await checkOpcodeTableDrift(path.join(dir, "does-not-exist.ts"));
    assert(!missing.ok, "expected the drift check to reject a missing generated table");
    assert(/missing generated table/.test(missing.reason ?? ""), `unexpected reason for a missing file: ${missing.reason}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

console.warn("opcode-table drift self-test passed: in-sync passes, tampering and staleness fail.");
