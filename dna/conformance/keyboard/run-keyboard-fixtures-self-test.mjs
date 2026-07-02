#!/usr/bin/env node
// Self-test for the keyboard input-contract fixture runner.
//
// Decisive checks:
//   1. All REAL fixtures (matrix + browsermap + latch) pass against an INDEPENDENT
//      reference authored here from the documented matrix + host policy (NOT the
//      shipped keyboard-model.mjs).
//   2. A matrix read that ignores the half-row select fails the matrix fixture.
//   3. A keyboard without the quick-tap latch fails the latch fixture (a tap is lost).
//   4. A browser map that drops key combinations fails the browsermap fixture.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-keyboard-fixtures.mjs");
const realFixtures = thisDir;

// Independent reference: a list-of-rows matrix (different shape than the shipped
// object map), active-low read, the same browser policy, and the same one-scan latch.
const REFERENCE_MODEL = `
const ROWS = [
  ["CAPS_SHIFT","Z","X","C","V"], ["A","S","D","F","G"], ["Q","W","E","R","T"],
  ["1","2","3","4","5"], ["0","9","8","7","6"], ["P","O","I","U","Y"],
  ["ENTER","L","K","J","H"], ["SPACE","SYMBOL_SHIFT","M","N","B"],
];
export const KEY_MATRIX = (() => {
  const m = {};
  ROWS.forEach((row, r) => row.forEach((k, b) => { m[k] = { row: r, bit: b }; }));
  return m;
})();
const NAMED = { Enter:["ENTER"], " ":["SPACE"], Shift:["CAPS_SHIFT"], Control:["SYMBOL_SHIFT"],
  Backspace:["CAPS_SHIFT","0"], Delete:["CAPS_SHIFT","0"], Escape:["CAPS_SHIFT","SPACE"],
  ArrowLeft:["CAPS_SHIFT","5"], ArrowDown:["CAPS_SHIFT","6"], ArrowUp:["CAPS_SHIFT","7"], ArrowRight:["CAPS_SHIFT","8"] };
export function browserKeyToSpectrum(key) {
  if (NAMED[key]) return NAMED[key];
  if (KEY_MATRIX[key]) return [key];
  const up = typeof key === "string" ? key.toUpperCase() : key;
  return KEY_MATRIX[up] ? [up] : [];
}
export function matrixByte(pressed, portHigh, opts = {}) {
  const ear = opts.ear ?? 1;
  let bits = 0x1f;
  for (const k of pressed ?? []) {
    const pos = KEY_MATRIX[k]; if (!pos) continue;
    if ((portHigh & (1 << pos.row)) === 0) bits = bits & ~(1 << pos.bit);
  }
  return (bits & 0x1f) | 0xa0 | ((ear & 1) << 6);
}
export function createKeyboard() {
  const down = new Set(), seen = new Set(); let tap = new Set();
  return {
    keyDown(k){ down.add(k); seen.delete(k); },
    keyUp(k){ if (down.has(k) && !seen.has(k)) tap.add(k); down.delete(k); },
    scan(){ const p = new Set([...down, ...tap]); for (const k of down) seen.add(k); tap = new Set(); return p; },
  };
}
`;

// Broken: ignores the half-row select (clears the bit regardless of which row).
const NO_ROW_SELECT = REFERENCE_MODEL.replace(
  "if ((portHigh & (1 << pos.row)) === 0) bits = bits & ~(1 << pos.bit);",
  "bits = bits & ~(1 << pos.bit);",
);

// Broken: no quick-tap latch (key-up is always immediate).
const NO_LATCH = REFERENCE_MODEL.replace(
  "keyUp(k){ if (down.has(k) && !seen.has(k)) tap.add(k); down.delete(k); },",
  "keyUp(k){ down.delete(k); },",
);

// Broken: drops key combinations (returns only the first Spectrum key).
const DROP_COMBO = REFERENCE_MODEL.replace(
  "if (NAMED[key]) return NAMED[key];",
  "if (NAMED[key]) return NAMED[key].slice(0, 1);",
);

const SMALL_MATRIX = {
  id: "KBD-SELF-TEST-MATRIX", area: "emulator", tier: "fidelity", provenance: "hardware",
  input: { kind: "keyboard-matrix", cases: [{ name: "z-wrong-row", pressed: ["Z"], portHigh: "0xFD" }] },
  expected: { cases: [{ name: "z-wrong-row", byte: "0xFF" }] },
  normalization: { profile: "custom" },
};
const SMALL_LATCH = {
  id: "KBD-SELF-TEST-LATCH", area: "gallery", tier: "contract", provenance: "decision:ADR-0016",
  input: { kind: "keyboard-latch", cases: [{ name: "tap", events: [{ op: "down", key: "Z" }, { op: "up", key: "Z" }, { op: "scan" }] }] },
  expected: { cases: [{ name: "tap", scans: [["Z"]] }] },
  normalization: { profile: "custom" },
};
const SMALL_BROWSERMAP = {
  id: "KBD-SELF-TEST-MAP", area: "gallery", tier: "contract", provenance: "decision:ADR-0016",
  input: { kind: "keyboard-browsermap", cases: [{ name: "cursor-up", key: "ArrowUp" }] },
  expected: { cases: [{ name: "cursor-up", keys: ["CAPS_SHIFT", "7"], positions: [{ row: 0, bit: 0 }, { row: 4, bit: 3 }] }] },
  normalization: { profile: "custom" },
};

function run(args) { return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "keyboard-self-test-"));
  try {
    const ref = path.join(dir, "reference.mjs");
    const noRow = path.join(dir, "no-row.mjs");
    const noLatch = path.join(dir, "no-latch.mjs");
    const dropCombo = path.join(dir, "drop-combo.mjs");
    const fMatrix = path.join(dir, "matrix.json");
    const fLatch = path.join(dir, "latch.json");
    const fMap = path.join(dir, "map.json");
    await writeFile(ref, REFERENCE_MODEL, "utf8");
    await writeFile(noRow, NO_ROW_SELECT, "utf8");
    await writeFile(noLatch, NO_LATCH, "utf8");
    await writeFile(dropCombo, DROP_COMBO, "utf8");
    await writeFile(fMatrix, JSON.stringify(SMALL_MATRIX), "utf8");
    await writeFile(fLatch, JSON.stringify(SMALL_LATCH), "utf8");
    await writeFile(fMap, JSON.stringify(SMALL_BROWSERMAP), "utf8");

    const real = run(["--module", ref, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected real keyboard fixtures to pass against the independent reference\n${real.stdout}\n${real.stderr}`);

    const noRowRun = run(["--module", noRow, "--fixtures", fMatrix, "--quiet"]);
    assert(noRowRun.status !== 0, "expected the no-half-row-select matrix to fail the matrix fixture");

    const noLatchRun = run(["--module", noLatch, "--fixtures", fLatch, "--quiet"]);
    assert(noLatchRun.status !== 0, "expected the latch-less keyboard to fail the quick-tap fixture");

    const dropRun = run(["--module", dropCombo, "--fixtures", fMap, "--quiet"]);
    assert(dropRun.status !== 0, "expected the combo-dropping browser map to fail the browsermap fixture");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Keyboard fixture self-test passed: real matrix + browsermap + latch fixtures validate against an independent reference; ignoring the half-row select, dropping the quick-tap latch, and dropping key combos are rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
