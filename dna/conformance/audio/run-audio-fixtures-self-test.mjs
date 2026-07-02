#!/usr/bin/env node
// Self-test for the gallery audio (beeper -> PCM) fixture runner.
//
// Decisive checks:
//   1. All REAL fixtures pass through the runner against an INDEPENDENT reference
//      renderer authored here straight from dna/product/beeper-output.md (NOT the
//      shipped beeper-pcm-model.mjs) — proving the hand-authored expected values
//      (sample counts, sample arrays, jitter bound) are consistent with the rules.
//   2. (C6) A per-frame-rounded resampler drifts and fails the duration fixture.
//   3. (C8) A per-chunk grid-reset renderer breaks frame-boundary continuity.
//   4. An edge-dropping renderer fails the edge-order fixture.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-audio-fixtures.mjs");
const realFixtures = thisDir;

// Independent reference (different arithmetic than the shipped model): same global
// sample grid, fractional-exact count, level-hold lookup, square-wave generator,
// jitter metric.
const REFERENCE_MODEL = `
const CLOCK = 3500000;
export function samplesForDuration(tStates, sampleRate) { return Math.trunc((tStates / CLOCK) * sampleRate); }
export function sampleTime(k, sampleRate) { return Math.trunc((k / sampleRate) * CLOCK); }
export function levelAt(t, edges, initialLevel = 0) {
  let lvl = initialLevel;
  for (const e of edges ?? []) { if (e.t <= t) lvl = e.level; else break; }
  return lvl;
}
export function renderRange(edges, o) {
  const out = [];
  for (let k = o.startSample; k < o.endSample; k++) {
    const lvl = levelAt(sampleTime(k, o.sampleRate), edges, o.initialLevel ?? 0);
    out.push(lvl ? (o.level1 ?? 1) : (o.level0 ?? -1));
  }
  return out;
}
export function capture(edges, o) {
  const n = samplesForDuration(o.tStatesTotal, o.sampleRate);
  return renderRange(edges, { ...o, startSample: 0, endSample: n });
}
export function squareWaveEdges(halfPeriodT, tStatesTotal) {
  const edges = []; let lvl = 1;
  for (let t = 0; t < tStatesTotal; t += halfPeriodT) { edges.push({ t, level: lvl }); lvl = lvl ? 0 : 1; }
  return edges;
}
export function risingEdgeJitter(samples, o = {}) {
  const one = o.level1 ?? 1; const r = [];
  for (let i = 1; i < samples.length; i++) if (samples[i] === one && samples[i-1] !== one) r.push(i);
  if (r.length < 3) return 0;
  const sp = []; for (let i = 1; i < r.length; i++) sp.push(r[i]-r[i-1]);
  const mean = sp.reduce((a,b)=>a+b,0)/sp.length;
  return Math.max(...sp.map(s=>Math.abs(s-mean)));
}
`;

// Broken: per-frame-rounded samples/frame (drifts).
const ROUNDED_MODEL = `
const CLOCK = 3500000, FRAME = 69888;
export function samplesForDuration(tStates, sampleRate) {
  const frames = Math.round(tStates / FRAME);
  return frames * Math.round((FRAME / CLOCK) * sampleRate);
}
`;

// Broken: per-chunk grid reset (realigns the sample grid to each chunk start).
const RESET_MODEL = `
const CLOCK = 3500000;
export function samplesForDuration(tStates, sampleRate) { return Math.trunc((tStates / CLOCK) * sampleRate); }
function sampleTime(k, sampleRate) { return Math.trunc((k / sampleRate) * CLOCK); }
function levelAt(t, edges, initialLevel = 0) { let lvl = initialLevel; for (const e of edges ?? []) { if (e.t <= t) lvl = e.level; else break; } return lvl; }
export function renderRange(edges, o) {
  const out = []; const n = o.endSample - o.startSample;
  for (let k = 0; k < n; k++) { // BUG: grid restarts at 0 each chunk instead of using the global index
    const lvl = levelAt(sampleTime(k, o.sampleRate), edges, o.initialLevel ?? 0);
    out.push(lvl ? (o.level1 ?? 1) : (o.level0 ?? -1));
  }
  return out;
}
export function capture(edges, o) { const n = samplesForDuration(o.tStatesTotal, o.sampleRate); return renderRange(edges, { ...o, startSample: 0, endSample: n }); }
`;

// Broken: ignores the edge stream entirely (always the initial level).
const DROP_MODEL = `
const CLOCK = 3500000;
export function samplesForDuration(tStates, sampleRate) { return Math.trunc((tStates / CLOCK) * sampleRate); }
export function renderRange(edges, o) {
  const out = [];
  for (let k = o.startSample; k < o.endSample; k++) out.push((o.initialLevel ?? 0) ? (o.level1 ?? 1) : (o.level0 ?? -1));
  return out;
}
export function capture(edges, o) { const n = samplesForDuration(o.tStatesTotal, o.sampleRate); return renderRange(edges, { ...o, startSample: 0, endSample: n }); }
`;

const SMALL_DURATION = {
  id: "AUDIO-SELF-TEST-DURATION", area: "gallery", tier: "contract", provenance: "decision:ADR-0016",
  input: { kind: "audio-duration", cases: [{ name: "d", tStates: 13977600, sampleRate: 44100 }] },
  expected: { cases: [{ name: "d", samples: 176117 }] },
  normalization: { profile: "custom" },
};
const SMALL_CONTINUITY = {
  id: "AUDIO-SELF-TEST-CONT", area: "gallery", tier: "contract", provenance: "decision:ADR-0016",
  input: { kind: "audio-continuity", cases: [{ name: "c", sampleRate: 44100, tStatesTotal: 800, splitTStates: 400, initialLevel: 0, edges: [{ t: 100, level: 1 }, { t: 300, level: 0 }, { t: 500, level: 1 }] }] },
  expected: { cases: [{ name: "c", continuous: true }] },
  normalization: { profile: "custom" },
};
const SMALL_EDGE_ORDER = {
  id: "AUDIO-SELF-TEST-EDGE", area: "gallery", tier: "contract", provenance: "decision:ADR-0016",
  input: { kind: "audio-edge-order", cases: [{ name: "e", sampleRate: 44100, tStatesTotal: 800, initialLevel: 0, edges: [{ t: 100, level: 1 }, { t: 300, level: 0 }, { t: 500, level: 1 }] }] },
  expected: { cases: [{ name: "e", samples: [-1, -1, 1, 1, -1, -1, -1, 1, 1, 1] }] },
  normalization: { profile: "custom" },
};

function run(args) {
  return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "audio-self-test-"));
  try {
    const files = {};
    for (const [name, content] of [
      ["reference.mjs", REFERENCE_MODEL], ["rounded.mjs", ROUNDED_MODEL],
      ["reset.mjs", RESET_MODEL], ["drop.mjs", DROP_MODEL],
    ]) { files[name] = path.join(dir, name); await writeFile(files[name], content, "utf8"); }
    const smallDuration = path.join(dir, "small-duration.json");
    const smallContinuity = path.join(dir, "small-continuity.json");
    const smallEdge = path.join(dir, "small-edge.json");
    await writeFile(smallDuration, JSON.stringify(SMALL_DURATION), "utf8");
    await writeFile(smallContinuity, JSON.stringify(SMALL_CONTINUITY), "utf8");
    await writeFile(smallEdge, JSON.stringify(SMALL_EDGE_ORDER), "utf8");

    // 1. All real fixtures pass against the independent reference.
    const real = run(["--module", files["reference.mjs"], "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected real audio fixtures to pass against the independent reference\n${real.stdout}\n${real.stderr}`);

    // 2. (C6) A per-frame-rounded resampler drifts and fails the duration fixture.
    const rounded = run(["--module", files["rounded.mjs"], "--fixtures", smallDuration, "--quiet"]);
    assert(rounded.status !== 0, "expected the per-frame-rounded resampler to fail the duration fixture");
    assert(`${rounded.stdout}${rounded.stderr}`.includes("samples"), "expected the rounded failure to name the sample-count mismatch");

    // 3. (C8) A per-chunk grid-reset renderer breaks continuity.
    const reset = run(["--module", files["reset.mjs"], "--fixtures", smallContinuity, "--quiet"]);
    assert(reset.status !== 0, "expected the grid-reset renderer to fail the continuity fixture");
    assert(`${reset.stdout}${reset.stderr}`.includes("continu"), "expected the reset failure to name the continuity break");

    // 4. An edge-dropping renderer fails the edge-order fixture.
    const drop = run(["--module", files["drop.mjs"], "--fixtures", smallEdge, "--quiet"]);
    assert(drop.status !== 0, "expected the edge-dropping renderer to fail the edge-order fixture");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Audio fixture self-test passed: real duration + edge-order + continuity + jitter fixtures validate against an independent reference; per-frame-rounded (drift), grid-reset (frame-boundary click), and edge-dropping renderers are rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
