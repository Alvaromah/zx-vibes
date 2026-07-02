#!/usr/bin/env node
// Self-test for the `.tap` fixture runner (FORMAT-TAP-001, file-formats.md FMT-TAP-*).
// Fidelity-tier: the `.tap` byte layout has genuine ambiguity (endianness, what the
// length counts, the checksum scope), so beyond an independent reference we run the
// full adversarial battery.
//
// Decisive checks:
//   1. The REAL fixtures (tap-format.json: a well-formed file + 3 malformed-rejection
//      files) pass against an INDEPENDENT reference authored here from
//      dna/domain/file-formats.md "`.tap` — tape image" — NOT the shipped
//      @zx-vibes/machine module.
//   2. A BIG-ENDIAN length model (reads/writes the 2-byte length high-byte-first)
//      fails — caught by the little-endian serialize-len bytes + the mis-framed parse.
//   3. A LENGTH-OMITS-CHECKSUM model (writes L = flag + data, not counting the
//      checksum) fails — caught by the serialize-length / serialize-len bytes.
//   4. A CHECKSUM-DATA-ONLY model (XOR over the data bytes only, dropping the flag)
//      fails — caught by the flag-0xFF data block + the empty-data (checksum = flag)
//      block, in both checksumOf and the parse checksum validation.
//   5. A NO-CHECKSUM-VALIDATION parser (never rejects a bad checksum) fails — caught
//      by the FORMAT-TAP-REJECT-BAD-CHECKSUM fixture (parseThrows must be true).
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-tap-fixtures.mjs");
const realFixtures = path.join(thisDir, "tap-format.json");

// Independent reference: re-derived from the spec, not importing @zx-vibes/machine.
// The /*ANCHOR*/ markers below are the seams the broken variants edit.
const REFERENCE_MODEL = `
function toBytes(d) { return d instanceof Uint8Array ? d : Uint8Array.from(d || []); }
export function tapChecksum(flag, data) {
  const d = toBytes(data);
  let cs = flag & 0xff; /*CKSUM_INIT*/
  for (let i = 0; i < d.length; i++) cs ^= d[i] & 0xff;
  return cs & 0xff;
}
export function parseTap(bytes) {
  const file = toBytes(bytes);
  const blocks = [];
  let o = 0;
  while (o < file.length) {
    if (o + 2 > file.length) throw new Error("truncated length prefix");
    const L = file[o] + (file[o + 1] << 8); /*LEN_READ*/
    const bodyStart = o + 2;
    const bodyEnd = bodyStart + L;
    if (L < 2) throw new Error("block too small");
    if (bodyEnd > file.length) throw new Error("truncated block");
    const flag = file[bodyStart];
    const data = file.slice(bodyStart + 1, bodyEnd - 1);
    const checksum = file[bodyEnd - 1];
    if (tapChecksum(flag, data) !== checksum) throw new Error("checksum mismatch"); /*CKSUM_CHECK*/
    blocks.push({ flag, data, checksum });
    o = bodyEnd;
  }
  return blocks;
}
export function serializeTap(blocks) {
  let total = 0;
  for (const b of blocks) total += 4 + toBytes(b.data).length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of blocks) {
    const flag = b.flag & 0xff;
    const data = toBytes(b.data);
    const L = data.length + 2; /*LEN_CALC*/
    out[o++] = L & 0xff; out[o++] = (L >> 8) & 0xff; /*LEN_WRITE*/
    out[o++] = flag;
    for (let i = 0; i < data.length; i++) out[o++] = data[i] & 0xff;
    out[o++] = tapChecksum(flag, data);
  }
  return out;
}
`;

// Broken: 2-byte length is big-endian on both read and write.
const BIG_ENDIAN_MODEL = REFERENCE_MODEL
  .replace("const L = file[o] + (file[o + 1] << 8); /*LEN_READ*/", "const L = (file[o] << 8) + file[o + 1]; /*LEN_READ*/")
  .replace("out[o++] = L & 0xff; out[o++] = (L >> 8) & 0xff; /*LEN_WRITE*/", "out[o++] = (L >> 8) & 0xff; out[o++] = L & 0xff; /*LEN_WRITE*/");

// Broken: length counts flag + data only (omits the checksum) -> off by one.
const LENGTH_OMITS_CHECKSUM_MODEL = REFERENCE_MODEL
  .replace("const L = data.length + 2; /*LEN_CALC*/", "const L = data.length + 1; /*LEN_CALC*/");

// Broken: checksum is the XOR of the data bytes only (the flag is not included).
const CHECKSUM_DATA_ONLY_MODEL = REFERENCE_MODEL
  .replace("let cs = flag & 0xff; /*CKSUM_INIT*/", "let cs = 0; /*CKSUM_INIT*/");

// Broken: the parser never validates the checksum (accepts a corrupt block).
const NO_CHECKSUM_VALIDATION_MODEL = REFERENCE_MODEL
  .replace('if (tapChecksum(flag, data) !== checksum) throw new Error("checksum mismatch"); /*CKSUM_CHECK*/', "/* checksum validation removed */");

function run(args) { return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tap-self-test-"));
  try {
    const write = async (name, source) => {
      const file = path.join(dir, name);
      await writeFile(file, source, "utf8");
      return file;
    };
    const ref = await write("reference.mjs", REFERENCE_MODEL);
    const bigEndian = await write("big-endian.mjs", BIG_ENDIAN_MODEL);
    const lenOmits = await write("len-omits-checksum.mjs", LENGTH_OMITS_CHECKSUM_MODEL);
    const cksumDataOnly = await write("checksum-data-only.mjs", CHECKSUM_DATA_ONLY_MODEL);
    const noValidate = await write("no-checksum-validation.mjs", NO_CHECKSUM_VALIDATION_MODEL);

    // Guard: each broken variant must actually differ from the reference (a renamed
    // anchor would silently no-op the replace and weaken the test).
    for (const [src, label] of [
      [BIG_ENDIAN_MODEL, "big-endian"],
      [LENGTH_OMITS_CHECKSUM_MODEL, "length-omits-checksum"],
      [CHECKSUM_DATA_ONLY_MODEL, "checksum-data-only"],
      [NO_CHECKSUM_VALIDATION_MODEL, "no-checksum-validation"],
    ]) {
      assert(src !== REFERENCE_MODEL, `${label} variant did not change the reference (stale anchor)`);
    }

    const real = run(["--module", ref, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected the real .tap fixtures to pass against the independent reference\n${real.stdout}\n${real.stderr}`);

    const broken = [
      [bigEndian, "big-endian length model"],
      [lenOmits, "length-omits-checksum model"],
      [cksumDataOnly, "checksum-data-only model"],
      [noValidate, "no-checksum-validation parser"],
    ];
    for (const [module, label] of broken) {
      const result = run(["--module", module, "--fixtures", realFixtures, "--quiet"]);
      assert(result.status !== 0, `expected the ${label} to fail the .tap fixtures`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "TAP fixture self-test passed: the real FORMAT-TAP fixtures validate against an independent reference; a big-endian length, a length that omits the checksum, a checksum over data only, and a parser that skips checksum validation are all rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
