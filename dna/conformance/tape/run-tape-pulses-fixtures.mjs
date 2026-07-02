#!/usr/bin/env node
// Runs the tape→EAR pulse conformance fixture (`kind: "tape-pulses-query"`,
// TAPE-EAR-PULSES-001 / TAPE-PULSE-*, dna/domain/tape-loading.md) against the
// regenerated @zx-vibes/machine tape-pulses model. This flips TAPE-EAR-PULSES-001 to
// `covered`: it executes the SHIPPED blockToPulses/bytePulses (not a scratchpad artifact).
//
// A tape block body ([flag][data…][checksum]) becomes a list of EAR pulse durations
// (T-states): a pilot tone (2168 T × 8063 for a header flag<0x80, else × 3223), then
// sync 667 T + 735 T, then each byte MSB-first as two pulses per bit (855 for 0, 1710
// for 1).
//
// Package contract (the regeneration target, default --module = @zx-vibes/machine index):
//   export function blockToPulses(bytes) -> number[]   (throws on an empty body)
//   export function bytePulses(byte) -> number[]        (16 pulses, MSB first)
//
// Fixture shape:
//   input:    { kind: "tape-pulses-query", bytes: "<hex>",   // the block body
//               cases: [ { name, query, args? } ] }
//   expected: { cases: [ { name, value: <number | boolean> } ] }
// queries (args in []):
//   pulseCount                 -> blockToPulses(bytes).length
//   pulseAt[i]                 -> blockToPulses(bytes)[i]
//   pilotRun                   -> count of leading 2168 T pilot pulses
//   bytePulseAt[byteValue, k]  -> bytePulses(byteValue)[k]
//   throws                     -> blockToPulses(bytes) throws (e.g. empty body)
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultModule = path.join(repoRoot, "packages", "machine", "src", "index.mjs");
const PILOT_PULSE_T = 2168;

function parseArgs(argv) {
  const options = { fixtures: thisDir, modulePath: defaultModule, quiet: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixtures") { options.fixtures = path.resolve(argv[++i] ?? ""); }
    else if (arg === "--module") { options.modulePath = path.resolve(argv[++i] ?? ""); }
    else if (arg === "--quiet") { options.quiet = true; }
    else if (arg === "--help" || arg === "-h") { options.help = true; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function hexToBytes(s) {
  const text = (s ?? "").replace(/\s+/g, "");
  if (text.length % 2 !== 0) throw new Error(`hex must be even-length: ${JSON.stringify(s)}`);
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`bad hex byte at ${i}: ${JSON.stringify(s)}`);
    out[i] = byte;
  }
  return out;
}

function buildDispatch(model, bytes) {
  // blockToPulses may throw on an empty body; compute lazily so `throws` can catch it.
  const pulses = () => model.blockToPulses(bytes);
  return {
    pulseCount: () => pulses().length,
    pulseAt: (i) => pulses()[i],
    pilotRun: () => {
      const p = pulses();
      let n = 0;
      while (n < p.length && p[n] === PILOT_PULSE_T) n += 1;
      return n;
    },
    bytePulseAt: (byteValue, k) => model.bytePulses(byteValue)[k],
    throws: () => {
      try { model.blockToPulses(bytes); return false; }
      catch { return true; }
    },
  };
}

async function collect(target) {
  const info = await stat(target);
  if (info.isFile()) return [target];
  const entries = await readdir(target, { withFileTypes: true });
  const out = [];
  for (const e of entries.sort((l, r) => l.name.localeCompare(r.name))) {
    const p = path.join(target, e.name);
    if (e.isDirectory()) out.push(...(await collect(p)));
    else if (e.isFile() && e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

export async function runTapePulsesFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Usage: run-tape-pulses-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]");
    return { exitCode: 0 };
  }
  const model = await import(pathToFileURL(options.modulePath).href);
  for (const name of ["blockToPulses", "bytePulses"]) {
    if (typeof model[name] !== "function") {
      console.error(`module ${options.modulePath} must export ${name}()`);
      return { exitCode: 2 };
    }
  }

  const files = await collect(options.fixtures);
  const failures = [];
  let caseCount = 0;
  for (const fileName of files) {
    const parsedFile = JSON.parse(await readFile(fileName, "utf8"));
    for (const fixture of Array.isArray(parsedFile) ? parsedFile : [parsedFile]) {
      if (fixture?.input?.kind !== "tape-pulses-query") continue;
      const bytes = hexToBytes(fixture.input.bytes);
      const dispatch = buildDispatch(model, bytes);
      const expectedByName = new Map((fixture.expected?.cases ?? []).map((x) => [x.name, x]));
      for (const testCase of fixture.input.cases ?? []) {
        caseCount += 1;
        const expected = expectedByName.get(testCase.name);
        if (!expected) { failures.push(`${fixture.id}: missing expected case '${testCase.name}'`); continue; }
        const fn = dispatch[testCase.query];
        if (!fn) { failures.push(`${fixture.id}/${testCase.name}: unknown query '${testCase.query}'`); continue; }
        let actual;
        try { actual = fn(...(testCase.args ?? [])); }
        catch (error) { failures.push(`${fixture.id}/${testCase.name}: ${testCase.query}() threw: ${error instanceof Error ? error.message : String(error)}`); continue; }
        if (actual !== expected.value) {
          failures.push(`${fixture.id}/${testCase.name}: ${testCase.query}(${(testCase.args ?? []).join(", ")}) = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected.value)}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(`Tape-pulses fixtures: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`- ${f}`);
    return { exitCode: 1 };
  }
  if (!options.quiet) console.log(`Tape-pulses fixtures: ${caseCount} case(s) passed (@zx-vibes/machine blockToPulses/bytePulses)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTapePulsesFixtures().then((r) => { process.exitCode = r.exitCode; }).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  });
}
