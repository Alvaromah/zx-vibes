#!/usr/bin/env node
// Self-test for the `.scr` fixture runner (FORMAT-SCR-001, file-formats.md FMT-SCR-*).
//
// Decisive checks:
//   1. The REAL fixture (scr-format.json) passes against an INDEPENDENT reference
//      authored here from dna/domain/file-formats.md "`.scr` — raw screen dump"
//      (literal constants 0x4000 / 6912, a plain offset copy) — NOT the shipped
//      @zx-vibes/ula module.
//   2. A HEADER-OFFSET model (load/save assume a 128-byte header) fails — the loaded
//      image lands 128 bytes high: caught by the boundary load/save cases.
//   3. An ATTRIBUTE-DROPPING save (returns only the 6144-byte display file) fails —
//      a "display-only" .scr: caught by save-length and the attribute save case.
//   4. A DEINTERLEAVING copy (display file walked in linear scanline order via the
//      thirds address) fails — the famous reorder corruption: caught by the
//      interleave-sensitive offset 256 (raw 0x4100 vs deinterleaved 0x4020).
//   5. An OUT-OF-REGION load (also writes one byte below 0x4000) fails — clobbers
//      memory outside the screen: caught by the untouched-below sentinel case.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-scr-fixtures.mjs");
const realFixtures = path.join(thisDir, "scr-format.json");

// Independent reference: literal constants and a plain offset copy, re-derived from
// the spec rather than importing @zx-vibes/ula. displayByteAddress is present only so
// the deinterleave variant has something to break against; the correct copy ignores it.
const REFERENCE_MODEL = `
export const SCR_SIZE = 6912;
export const SCR_BASE = 0x4000;
function displayByteAddress(x, y) {
  return 0x4000 + ((y & 0xc0) << 5) + ((y & 0x07) << 8) + ((y & 0x38) << 2) + (x >> 3);
}
export function saveScr(memory) {
  const scr = new Uint8Array(SCR_SIZE);
  for (let o = 0; o < SCR_SIZE; o++) scr[o] = memory[SCR_BASE + o] & 0xff; /*SAVE_BODY*/
  return scr;
}
export function loadScr(memory, scr) {
  if (scr.length !== SCR_SIZE) throw new Error("bad .scr length " + scr.length);
  for (let o = 0; o < SCR_SIZE; o++) memory[SCR_BASE + o] = scr[o] & 0xff; /*LOAD_BODY*/
}
`;

// Broken: load/save assume a 128-byte header -> the image lands 128 bytes high.
const HEADER_MODEL = REFERENCE_MODEL.split("SCR_BASE + o").join("SCR_BASE + 128 + o");

// Broken: save returns only the 6144-byte display file (drops the attribute file).
const DROP_ATTR_MODEL = REFERENCE_MODEL.replace("return scr;", "return scr.slice(0, 6144);");

// Broken: deinterleave the display file into linear scanline order on both save and
// load (the classic .scr-vs-deinterleaved confusion).
const DEINTERLEAVE_SAVE = "{ let p = 0; for (let y = 0; y < 192; y++) for (let c = 0; c < 32; c++) scr[p++] = memory[displayByteAddress(c * 8, y)] & 0xff; for (let a = 0; a < 768; a++) scr[6144 + a] = memory[SCR_BASE + 6144 + a] & 0xff; }";
const DEINTERLEAVE_LOAD = "{ let p = 0; for (let y = 0; y < 192; y++) for (let c = 0; c < 32; c++) memory[displayByteAddress(c * 8, y)] = scr[p++] & 0xff; for (let a = 0; a < 768; a++) memory[SCR_BASE + 6144 + a] = scr[6144 + a] & 0xff; }";
const DEINTERLEAVE_MODEL = REFERENCE_MODEL
  .replace("for (let o = 0; o < SCR_SIZE; o++) scr[o] = memory[SCR_BASE + o] & 0xff; /*SAVE_BODY*/", DEINTERLEAVE_SAVE)
  .replace("for (let o = 0; o < SCR_SIZE; o++) memory[SCR_BASE + o] = scr[o] & 0xff; /*LOAD_BODY*/", DEINTERLEAVE_LOAD);

// Broken: load also writes one byte below the region (clobbers 0x3FFF).
const OOB_MODEL = REFERENCE_MODEL.replace(
  "for (let o = 0; o < SCR_SIZE; o++) memory[SCR_BASE + o] = scr[o] & 0xff; /*LOAD_BODY*/",
  "for (let o = 0; o < SCR_SIZE; o++) memory[SCR_BASE + o] = scr[o] & 0xff; memory[SCR_BASE - 1] = scr[0] & 0xff;",
);

function run(args) { return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scr-self-test-"));
  try {
    const write = async (name, source) => {
      const file = path.join(dir, name);
      await writeFile(file, source, "utf8");
      return file;
    };
    const ref = await write("reference.mjs", REFERENCE_MODEL);
    const header = await write("header.mjs", HEADER_MODEL);
    const dropAttr = await write("drop-attr.mjs", DROP_ATTR_MODEL);
    const deinterleave = await write("deinterleave.mjs", DEINTERLEAVE_MODEL);
    const oob = await write("oob.mjs", OOB_MODEL);

    // Guard: each broken variant must actually differ from the reference (a renamed
    // anchor would silently no-op the replace and weaken the test).
    for (const [src, label] of [
      [HEADER_MODEL, "header"],
      [DROP_ATTR_MODEL, "drop-attr"],
      [DEINTERLEAVE_MODEL, "deinterleave"],
      [OOB_MODEL, "oob"],
    ]) {
      assert(src !== REFERENCE_MODEL, `${label} variant did not change the reference (stale anchor)`);
    }

    const real = run(["--module", ref, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected the real .scr fixture to pass against the independent reference\n${real.stdout}\n${real.stderr}`);

    const broken = [
      [header, "header-offset loader"],
      [dropAttr, "attribute-dropping save"],
      [deinterleave, "deinterleaving copy"],
      [oob, "out-of-region load"],
    ];
    for (const [module, label] of broken) {
      const result = run(["--module", module, "--fixtures", realFixtures, "--quiet"]);
      assert(result.status !== 0, `expected the ${label} to fail the .scr fixture`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "SCR fixture self-test passed: the real FORMAT-SCR fixture validates against an independent reference; a header-offset loader, an attribute-dropping save, a deinterleaving copy, and an out-of-region load are all rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
