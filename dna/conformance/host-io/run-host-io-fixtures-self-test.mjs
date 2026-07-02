#!/usr/bin/env node
// Self-test for the host-I/O port-0xFE fixture runner.
//
// Decisive checks:
//   1. All REAL fixtures (events + chrono + iotime) pass through the runner with an
//      INDEPENDENT event reference authored here straight from
//      dna/domain/host-io-port-fe.md (NOT the shipped port-fe-event-model.mjs) and
//      the real @zx-vibes/machine — proving the hand-authored expected values are
//      consistent with the documented rules and the conformed machine.
//   2. (S1) A collapse-to-final-colour extractor fails the event fixtures (the bug
//      the core CPU/ULA/machine gate does not catch).
//   3. (S2, C7) A model that timestamps events by the ULA-frame MODULO fails the
//      chronological-order check across the frame wrap.
//   4. (S2 base) A tampered iotime expectation (wrong contention) is caught, proving
//      the runner enforces the contended-machine time base / I/O-port-out scope.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-host-io-fixtures.mjs");
const realFixtures = thisDir; // port-fe-events.json + port-fe-event-time.json + port-fe-iotime.json

// Independent reference (border = b0-2 span emitted on change, no power-on default;
// beeper = b4 edge, rest level 0; border before beeper; chronological offset =
// clock - frameStart). Deliberately different bit arithmetic than the shipped model.
const REFERENCE_MODEL = `
function derive(writes, opts) {
  const events = [];
  let border = opts.initialBorder === undefined ? null : opts.initialBorder;
  let beeper = opts.initialBeeper === undefined ? 0 : opts.initialBeeper;
  for (const w of writes ?? []) {
    const byte = w.value & 0xff;
    const colour = byte % 8;
    const level = Math.floor(byte / 16) % 2;
    if (colour !== border) { events.push({ tFrame: w.tFrame, kind: "border", value: colour }); border = colour; }
    if (level !== beeper) { events.push({ tFrame: w.tFrame, kind: "beeper", level }); beeper = level; }
  }
  return events;
}
export function extractPortFeEvents(writes, opts = {}) { return derive(writes, opts); }
export function extractFrameEvents(writes, opts = {}) {
  const frameStart = opts.frameStart ?? 0;
  return derive((writes ?? []).map((w) => ({ tFrame: w.clock - frameStart, value: w.value })), opts);
}
`;

// Broken event model: collapse a frame's writes to one final border colour, drop
// the beeper.
const COLLAPSE_MODEL = `
export function extractPortFeEvents(writes) {
  const all = writes ?? [];
  if (all.length === 0) return [];
  const last = all[all.length - 1];
  return [{ tFrame: last.tFrame, kind: "border", value: (last.value & 0xff) & 7 }];
}
`;

// Broken chrono model: timestamp by the ULA-frame MODULO (not the chronological
// offset), input order preserved -> events are NOT monotonic across the frame wrap.
const MODULO_MODEL = `
const FRAME = 69888;
export function extractFrameEvents(writes, opts = {}) {
  const events = [];
  let border = opts.initialBorder === undefined ? null : opts.initialBorder;
  let beeper = opts.initialBeeper === undefined ? 0 : opts.initialBeeper;
  for (const w of writes ?? []) {
    const tFrame = ((w.clock % FRAME) + FRAME) % FRAME;
    const byte = w.value & 0xff;
    const colour = byte & 7;
    const level = (byte >> 4) & 1;
    if (colour !== border) { events.push({ tFrame, kind: "border", value: colour }); border = colour; }
    if (level !== beeper) { events.push({ tFrame, kind: "beeper", level }); beeper = level; }
  }
  return events;
}
`;

const SMALL_EVENTS_FIXTURE = {
  id: "HOST-IO-SELF-TEST-EVENTS",
  area: "emulator", tier: "fidelity", provenance: "hardware",
  input: { kind: "host-io-events", cases: [{ name: "two-colours", writes: [{ tFrame: 1, value: "0x02" }, { tFrame: 2, value: "0x05" }] }] },
  expected: { cases: [{ name: "two-colours", events: [{ tFrame: 1, kind: "border", value: 2 }, { tFrame: 2, kind: "border", value: 5 }] }] },
  normalization: { profile: "custom" },
};

const SMALL_CHRONO_FIXTURE = {
  id: "HOST-IO-SELF-TEST-CHRONO",
  area: "emulator", tier: "fidelity", provenance: "hardware",
  input: { kind: "host-io-chrono", cases: [{ name: "wrap", frameStart: 69800, writes: [{ clock: 69850, value: "0x02" }, { clock: 69930, value: "0x05" }] }] },
  expected: { cases: [{ name: "wrap", events: [{ tFrame: 50, kind: "border", value: 2 }, { tFrame: 130, kind: "border", value: 5 }] }] },
  normalization: { profile: "custom" },
};

const TAMPERED_IOTIME_FIXTURE = {
  id: "HOST-IO-SELF-TEST-IOTIME",
  area: "emulator", tier: "fidelity", provenance: "decision:ADR-0016",
  input: { kind: "host-io-iotime", cases: [{ name: "tamper", exact: true, clock: 14335, registers: { pc: "0x4000", a: "0x02" }, memory: { "0x4000": "D3FE" } }] },
  expected: { cases: [{ name: "tamper", contention: 99, tStates: 21, writes: [{ portLow: "0xFE", value: 2 }] }] },
  normalization: { profile: "custom" },
};

function run(args) {
  return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-io-self-test-"));
  try {
    const referenceModule = path.join(dir, "reference-host-io.mjs");
    const collapseModule = path.join(dir, "collapse-host-io.mjs");
    const moduloModule = path.join(dir, "modulo-host-io.mjs");
    const smallEvents = path.join(dir, "small-events.json");
    const smallChrono = path.join(dir, "small-chrono.json");
    const tamperIotime = path.join(dir, "tamper-iotime.json");
    await writeFile(referenceModule, REFERENCE_MODEL, "utf8");
    await writeFile(collapseModule, COLLAPSE_MODEL, "utf8");
    await writeFile(moduloModule, MODULO_MODEL, "utf8");
    await writeFile(smallEvents, JSON.stringify(SMALL_EVENTS_FIXTURE), "utf8");
    await writeFile(smallChrono, JSON.stringify(SMALL_CHRONO_FIXTURE), "utf8");
    await writeFile(tamperIotime, JSON.stringify(TAMPERED_IOTIME_FIXTURE), "utf8");

    // 1. All real fixtures (events + chrono + iotime) pass against the independent
    //    reference and the real @zx-vibes/machine.
    const real = run(["--module", referenceModule, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected real host-io fixtures to pass against the independent reference + machine\n${real.stdout}\n${real.stderr}`);

    // 2. (S1) A collapse-to-final-colour renderer is caught on the event fixture.
    const collapse = run(["--module", collapseModule, "--fixtures", smallEvents, "--quiet"]);
    assert(collapse.status !== 0, "expected the collapse-to-final-colour model to fail the event fixture");
    assert(`${collapse.stdout}${collapse.stderr}`.includes("event(s)"), "expected the collapse failure to name the event-count mismatch");

    // 3. (S2, C7) A ULA-frame-modulo timestamp reorders edges across the wrap.
    const modulo = run(["--module", moduloModule, "--fixtures", smallChrono, "--quiet"]);
    assert(modulo.status !== 0, "expected the modulo-timestamp model to fail the chronological-order check");
    assert(`${modulo.stdout}${modulo.stderr}`.includes("chronological"), "expected the modulo failure to name the chronological-order violation");

    // 4. (S2 base) A wrong contended-time expectation is caught (enforces the base /
    //    I/O-port-out scope against the real machine).
    const tamper = run(["--fixtures", tamperIotime, "--quiet"]);
    assert(tamper.status !== 0, "expected the tampered iotime expectation to fail against the real machine");
    assert(`${tamper.stdout}${tamper.stderr}`.includes("contention"), "expected the iotime failure to name the contention mismatch");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Host-I/O fixture self-test passed: real port-0xFE event + chronological + contended-time fixtures validate against an independent reference and @zx-vibes/machine; collapse-to-final-colour, ULA-frame-modulo ordering, and wrong contended-time models are rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
