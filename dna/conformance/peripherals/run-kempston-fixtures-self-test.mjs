#!/usr/bin/env node
// Self-test for the Kempston fixture runner (JOY-KEMPSTON-001).
//
// Layers:
//   1. The REAL fixtures pass against an INDEPENDENT reference model authored here
//      straight from dna/domain/peripherals.md "Kempston joystick" (NOT the
//      @zx-vibes/ula package under test, NOT the legacy emulator) — proving the
//      hand-authored expected values are consistent with the documented rule.
//   2. Four ADVERSARIAL broken models are each rejected by the real fixtures:
//      active-low (idle reads 0x1F instead of 0x00), ud-swap (Up/Down bits swapped),
//      dirty-top-bits (leaks the unused top three bits), and decode-shift (decodes the
//      even neighbour 0x1E instead of 0x1F).
//   3. BREADTH: the SHIPPED module is swept against the reference across all 32 button
//      combinations and the full 16-bit port range — agreement beyond the pinned points.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-kempston-fixtures.mjs");
const realFixtures = path.join(thisDir, "kempston.json");
const shippedModule = path.resolve(thisDir, "..", "..", "..", "packages", "ula", "src", "index.mjs");

// Independent reference, authored from the documented rule: active-high 000FUDLR
// (idle 0x00, R/L/D/U/F = bits 0..4, top three bits 0); the port decodes on low byte
// 0x1F with the high byte don't-care.
const REFERENCE_MODEL = `
export const KEMPSTON_PORT = 0x1f;
export function kempstonDecodes(port) { return (port & 0xff) === 0x1f; }
export function kempstonByte(state = {}) {
  let b = 0;
  if (state.right) b |= 0x01;
  if (state.left) b |= 0x02;
  if (state.down) b |= 0x04;
  if (state.up) b |= 0x08;
  if (state.fire) b |= 0x10;
  return b;
}
`;

const BROKEN = {
  "active-low": REFERENCE_MODEL.replace("  return b;\n", "  return 0x1f ^ b;\n"),
  "ud-swap": REFERENCE_MODEL.replace(
    "  if (state.down) b |= 0x04;\n  if (state.up) b |= 0x08;",
    "  if (state.down) b |= 0x08;\n  if (state.up) b |= 0x04;",
  ),
  "dirty-top-bits": REFERENCE_MODEL.replace("  return b;\n", "  return b | 0xe0;\n"),
  "decode-shift": REFERENCE_MODEL.replace("(port & 0xff) === 0x1f", "(port & 0xff) === 0x1e"),
};

function run(args) {
  return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kempston-self-test-"));
  try {
    const refModule = path.join(dir, "reference-kempston.mjs");
    await writeFile(refModule, REFERENCE_MODEL, "utf8");

    // 1. The real fixtures pass against the independent reference model.
    const real = run(["--module", refModule, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected real Kempston fixtures to pass against the reference model\n${real.stdout}\n${real.stderr}`);

    // 2. Each adversarial broken model is rejected by the real fixtures.
    for (const [name, source] of Object.entries(BROKEN)) {
      assert(source !== REFERENCE_MODEL, `broken model '${name}' did not actually differ from the reference`);
      const brokenModule = path.join(dir, `broken-${name}.mjs`);
      await writeFile(brokenModule, source, "utf8");
      const broken = run(["--module", brokenModule, "--fixtures", realFixtures, "--quiet"]);
      assert(broken.status !== 0, `expected broken model '${name}' to be rejected by the real fixtures`);
    }

    // 3. Breadth: the shipped module agrees with the reference.
    const shipped = await import(pathToFileURL(shippedModule).href);
    const reference = await import(pathToFileURL(refModule).href);

    assert(shipped.KEMPSTON_PORT === 0x1f, `expected KEMPSTON_PORT 0x1F, got ${shipped.KEMPSTON_PORT}`);

    // All 32 button combinations: by construction the byte equals the combination
    // index (R=bit0, L=bit1, D=bit2, U=bit3, F=bit4), and the top three bits stay 0.
    for (let i = 0; i < 32; i += 1) {
      const state = {
        right: Boolean(i & 0x01),
        left: Boolean(i & 0x02),
        down: Boolean(i & 0x04),
        up: Boolean(i & 0x08),
        fire: Boolean(i & 0x10),
      };
      const s = shipped.kempstonByte(state);
      const r = reference.kempstonByte(state);
      assert(s === r, `kempstonByte divergence for combo ${i}: shipped ${s} vs reference ${r}`);
      assert(s === i, `kempstonByte combo ${i} expected ${i}, got ${s}`);
      assert((s & 0xe0) === 0, `kempstonByte combo ${i} leaked top bits: ${s.toString(2)}`);
    }
    assert(shipped.kempstonByte({}) === 0, "idle read must be 0x00");
    assert(
      shipped.kempstonByte({ right: true, left: true, down: true, up: true, fire: true }) === 0x1f,
      "all-pressed read must be 0x1F",
    );

    // Full 16-bit port range: decode agrees with the reference, and exactly the 256
    // ports whose low byte is 0x1F decode true.
    let decoded = 0;
    for (let port = 0; port <= 0xffff; port += 1) {
      const s = shipped.kempstonDecodes(port);
      assert(s === reference.kempstonDecodes(port), `kempstonDecodes divergence at port ${port}`);
      if (s) decoded += 1;
    }
    assert(decoded === 256, `expected 256 decoding ports (low byte 0x1F), got ${decoded}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Kempston self-test passed: real fixtures validate against an independent reference; four broken models (active-low, ud-swap, dirty-top-bits, decode-shift) are rejected; the shipped @zx-vibes/ula agrees with the reference across all 32 button combinations and the full 16-bit port range (256 decoding ports, low byte 0x1F).",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
