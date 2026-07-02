#!/usr/bin/env node
// Self-test for the floating-bus fixture runner (BUS-FLOATING-001 / -DEFER-001).
//
// Layers:
//   1. The REAL fixtures pass against an INDEPENDENT reference model authored here
//      straight from dna/domain/ula-timing.md "Floating bus" (NOT the @zx-vibes/ula
//      package under test, NOT the legacy emulator) — proving the hand-authored
//      expected values are consistent with the documented rule.
//   2. Four ADVERSARIAL broken models are each rejected by the real fixtures:
//      always-idle (fabricates an in-window 0xFF instead of deferring), even-floats
//      (wrong A0 decode), legacy-anchor (the rejected 14384 display geometry), and
//      whole-line-window (no 128-T contended cutoff).
//   3. BREADTH: the SHIPPED module is swept against the reference across every frame
//      T-state (0..69887) and a port range — agreement beyond the pinned points.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-floating-bus-fixtures.mjs");
const realFixtures = path.join(thisDir, "floating-bus.json");
const shippedModule = path.resolve(thisDir, "..", "..", "..", "packages", "ula", "src", "index.mjs");

// Independent reference, authored from the documented rule: the ULA drives even
// ports (A0=0), an odd port floats; the active display-fetch window is the contended
// window of ULA-TIME-CONTENTION-WINDOW-001 (192 lines, 224 T apart, from frame T
// 14335, first 128 T/line); outside it the idle bus reads 0xFF (modeled), inside it
// the byte is deferred (modeled=false), never fabricated.
const REFERENCE_MODEL = `
const FRAME = 312 * 224;
const START = 14335;
const LINES = 192;
const CONT = 128;
const PERLINE = 224;
const wrap = (t) => ((t % FRAME) + FRAME) % FRAME;
export function portFloats(port) { return (port & 1) === 1; }
export function activeDisplayFetch(t) {
  const offset = wrap(t) - START;
  if (offset < 0) return false;
  const line = Math.floor(offset / PERLINE);
  if (line >= LINES) return false;
  return (offset % PERLINE) < CONT;
}
export function floatingBusByte(t) {
  return activeDisplayFetch(t) ? { value: null, modeled: false } : { value: 0xff, modeled: true };
}
`;

const BROKEN = {
  "always-idle": REFERENCE_MODEL.replace(
    "return activeDisplayFetch(t) ? { value: null, modeled: false } : { value: 0xff, modeled: true };",
    "return { value: 0xff, modeled: true };",
  ),
  "even-floats": REFERENCE_MODEL.replace("return (port & 1) === 1;", "return (port & 1) === 0;"),
  "legacy-anchor": REFERENCE_MODEL.replace("const START = 14335;", "const START = 14384;"),
  "whole-line-window": REFERENCE_MODEL.replace("const CONT = 128;", "const CONT = 224;"),
};

function run(args) {
  return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "floating-bus-self-test-"));
  try {
    const refModule = path.join(dir, "reference-floating-bus.mjs");
    await writeFile(refModule, REFERENCE_MODEL, "utf8");

    // 1. The real fixtures pass against the independent reference model.
    const real = run(["--module", refModule, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected real floating-bus fixtures to pass against the reference model\n${real.stdout}\n${real.stderr}`);

    // 2. Each adversarial broken model is rejected by the real fixtures.
    for (const [name, source] of Object.entries(BROKEN)) {
      const brokenModule = path.join(dir, `broken-${name}.mjs`);
      await writeFile(brokenModule, source, "utf8");
      const broken = run(["--module", brokenModule, "--fixtures", realFixtures, "--quiet"]);
      assert(broken.status !== 0, `expected broken model '${name}' to be rejected by the real fixtures`);
    }

    // 3. Breadth: the shipped module agrees with the reference across the frame.
    const shipped = await import(pathToFileURL(shippedModule).href);
    const reference = await import(pathToFileURL(refModule).href);

    for (let port = 0; port < 0x200; port += 1) {
      assert(
        shipped.portFloats(port) === reference.portFloats(port),
        `portFloats divergence at port ${port}: shipped ${shipped.portFloats(port)} vs reference ${reference.portFloats(port)}`,
      );
    }

    let inWindow = 0;
    let idle = 0;
    for (let t = 0; t < 312 * 224; t += 1) {
      const s = shipped.floatingBusByte(t);
      const r = reference.floatingBusByte(t);
      assert(
        s.value === r.value && s.modeled === r.modeled && shipped.activeDisplayFetch(t) === reference.activeDisplayFetch(t),
        `floating-bus divergence at frame T ${t}: shipped ${JSON.stringify(s)} vs reference ${JSON.stringify(r)}`,
      );
      if (r.modeled) idle += 1;
      else inWindow += 1;
    }
    // Sanity: both regimes are actually exercised (192*128 = 24576 in-window T-states).
    assert(inWindow === 192 * 128, `expected 24576 in-window T-states, got ${inWindow}`);
    assert(idle === 312 * 224 - 192 * 128, `expected ${312 * 224 - 192 * 128} idle T-states, got ${idle}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Floating-bus self-test passed: real fixtures validate against an independent reference; four broken models (always-idle, even-floats, legacy-14384-anchor, whole-line-window) are rejected; the shipped @zx-vibes/ula agrees with the reference across all 69888 frame T-states (24576 in-window deferred, the rest idle 0xFF) and the port range.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
