#!/usr/bin/env node
// Runs gallery audio (beeper edge -> PCM) conformance fixtures against the beeper
// PCM model (dna/product/beeper-output.md). This is what flips the AUDIO-* rows to
// `covered`: it executes the committed reference renderer, not a scratchpad
// artifact.
//
// Four fixture kinds, each decided by dna/product/beeper-output.md:
//   - "audio-duration" (C6): the sample count for a multi-second capture is the
//     fractional-exact floor(tStates * sampleRate / clock), with NO per-frame
//     rounding (a rounded samples/frame drifts ~28 ms/min at 44.1 kHz).
//   - "audio-edge-order": a short edge stream renders to the exact PCM sample array,
//     each level transition landing at the right sample (edge order preserved).
//   - "audio-continuity" (C8): a capture split into two chunks, rendered with the
//     global sample grid + carried level, equals the continuous capture sample for
//     sample (no forced frame-boundary reset / click).
//   - "audio-jitter" (C9): a stable square-wave tone captures with sub-sample
//     rising-edge jitter (a faithful, deterministic capture).
//
// Model module (default --module): dna/conformance/audio/beeper-pcm-model.mjs.
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultModule = path.join(thisDir, "beeper-pcm-model.mjs");

function parseArgs(argv) {
  const options = { fixtures: thisDir, modulePath: defaultModule, quiet: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") {
      if (!argv[index + 1]) throw new Error("--fixtures requires a path");
      options.fixtures = path.resolve(argv[index + 1]); index += 1;
    } else if (arg === "--module") {
      if (!argv[index + 1]) throw new Error("--module requires a path");
      options.modulePath = path.resolve(argv[index + 1]); index += 1;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    "Usage: node dna/conformance/audio/run-audio-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]",
    "",
    "Runs audio-duration / audio-edge-order / audio-continuity / audio-jitter fixtures against the beeper PCM model.",
  ].join("\n");
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function runDurationCase(model, testCase, expected, failures) {
  const actual = model.samplesForDuration(testCase.tStates, testCase.sampleRate);
  if (actual !== expected.samples) {
    failures.push(`${testCase.name}: samples = ${actual}, expected ${expected.samples} (fractional-exact count, no per-frame rounding)`);
  }
}

function runEdgeOrderCase(model, testCase, expected, failures) {
  const actual = model.capture(testCase.edges ?? [], {
    sampleRate: testCase.sampleRate,
    tStatesTotal: testCase.tStatesTotal,
    initialLevel: testCase.initialLevel ?? 0,
    level0: testCase.level0 ?? -1,
    level1: testCase.level1 ?? 1,
  });
  if (!arraysEqual(actual, expected.samples)) {
    failures.push(`${testCase.name}: samples = [${actual.join(",")}], expected [${(expected.samples ?? []).join(",")}]`);
  }
}

function runContinuityCase(model, testCase, expected, failures) {
  const opts = {
    sampleRate: testCase.sampleRate,
    initialLevel: testCase.initialLevel ?? 0,
    level0: testCase.level0 ?? -1,
    level1: testCase.level1 ?? 1,
  };
  const edges = testCase.edges ?? [];
  const total = model.samplesForDuration(testCase.tStatesTotal, testCase.sampleRate);
  const countA = model.samplesForDuration(testCase.splitTStates, testCase.sampleRate);
  const continuous = model.capture(edges, { ...opts, tStatesTotal: testCase.tStatesTotal });
  const chunkA = model.renderRange(edges, { ...opts, startSample: 0, endSample: countA });
  const chunkB = model.renderRange(edges, { ...opts, startSample: countA, endSample: total });
  const chunked = [...chunkA, ...chunkB];
  const isContinuous = arraysEqual(chunked, continuous);
  if (expected.continuous !== undefined && isContinuous !== Boolean(expected.continuous)) {
    failures.push(`${testCase.name}: chunked-equals-continuous = ${isContinuous}, expected ${Boolean(expected.continuous)} (frame-boundary reset breaks continuity)`);
  }
}

function runJitterCase(model, testCase, expected, failures) {
  const edges = model.squareWaveEdges(testCase.halfPeriodT, testCase.tStatesTotal);
  const tone = model.capture(edges, {
    sampleRate: testCase.sampleRate,
    tStatesTotal: testCase.tStatesTotal,
    initialLevel: testCase.initialLevel ?? 1,
  });
  const jitter = model.risingEdgeJitter(tone);
  if (expected.maxJitterSamples !== undefined && jitter > expected.maxJitterSamples) {
    failures.push(`${testCase.name}: rising-edge jitter = ${jitter} sample(s), expected <= ${expected.maxJitterSamples}`);
  }
}

const DISPATCH = {
  "audio-duration": runDurationCase,
  "audio-edge-order": runEdgeOrderCase,
  "audio-continuity": runContinuityCase,
  "audio-jitter": runJitterCase,
};

async function collectFixtureFiles(target) {
  const info = await stat(target);
  if (info.isFile()) return [target];
  const entries = await readdir(target, { withFileTypes: true });
  const collected = [];
  for (const entry of entries.sort((l, r) => l.name.localeCompare(r.name))) {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) collected.push(...(await collectFixtureFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".json")) collected.push(entryPath);
  }
  return collected;
}

async function loadFixtures(target) {
  const files = await collectFixtureFiles(target);
  const fixtures = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    for (const fixture of Array.isArray(parsed) ? parsed : [parsed]) fixtures.push(fixture);
  }
  return fixtures;
}

export async function runAudioFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return { exitCode: 0 };
  }

  const model = await import(pathToFileURL(options.modulePath).href);
  const fixtures = await loadFixtures(options.fixtures);
  const failures = [];
  let caseCount = 0;

  for (const fixture of fixtures) {
    const runner = DISPATCH[fixture?.input?.kind];
    if (!runner) continue;
    const expectedByName = new Map((fixture.expected?.cases ?? []).map((item) => [item.name, item]));
    for (const testCase of fixture.input.cases ?? []) {
      caseCount += 1;
      const expected = expectedByName.get(testCase.name);
      if (!expected) {
        failures.push(`${fixture.id}: missing expected case '${testCase.name}'`);
        continue;
      }
      try {
        runner(model, testCase, expected, failures);
      } catch (error) {
        failures.push(`${testCase.name}: threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`Audio fixtures: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`- ${failure}`);
    return { exitCode: 1 };
  }

  if (!options.quiet) console.log(`Audio fixtures: ${caseCount} case(s) passed (beeper PCM model via run-audio-fixtures)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAudioFixtures()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
