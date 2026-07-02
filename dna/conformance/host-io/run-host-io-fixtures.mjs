#!/usr/bin/env node
// Runs host-I/O port-0xFE conformance fixtures against the port-0xFE event model
// (dna/domain/host-io-port-fe.md) and, for the timestamp-base fixture, the
// regenerated @zx-vibes/machine. This is what flips the HOST-IO-* rows to
// `covered`: it executes committed implementations, not scratchpad artifacts.
//
// Three fixture kinds:
//   - "host-io-events" (S1): a chronological OUT (0xFE) write sequence
//     { tFrame, value } -> the ordered border/beeper event stream. Model:
//     extractPortFeEvents(writes, options?).
//   - "host-io-chrono" (S2, C7): writes with an ABSOLUTE machine clock crossing
//     the frame wrap { clock, value } + a frameStart -> events whose tFrame is the
//     chronological offset (clock - frameStart) and which stay monotonically
//     ordered. Model: extractFrameEvents(writes, { frameStart }). A model that
//     timestamps/sorts by the ULA-frame modulo reorders the edges and fails.
//   - "host-io-iotime" (S2, contended-machine base): an OUT (0xFE),A run through
//     @zx-vibes/machine in contended/uncontended RAM -> the captured ULA-port write
//     and the contended-machine duration (memory contention in the base, no
//     I/O-port contention added).
//
// Model module: dna/conformance/host-io/port-fe-event-model.mjs (default --module).
// Machine module: packages/machine/src/index.mjs (default --machine).
//
// Fixture shape (mirrors the timing/machine fixtures): input.cases name a case;
// expected.cases give each case's result, matched by name. A write `value` may be a
// number or a hex string ("0x12"); it is normalized to a byte before the model.
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultModule = path.join(thisDir, "port-fe-event-model.mjs");
const defaultMachine = path.join(repoRoot, "packages", "machine", "src", "index.mjs");
const defaultFixturePath = thisDir;

function parseArgs(argv) {
  const options = {
    fixtures: defaultFixturePath,
    modulePath: defaultModule,
    machinePath: defaultMachine,
    quiet: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") {
      if (!argv[index + 1]) throw new Error("--fixtures requires a path");
      options.fixtures = path.resolve(argv[index + 1]); index += 1;
    } else if (arg === "--module") {
      if (!argv[index + 1]) throw new Error("--module requires a path");
      options.modulePath = path.resolve(argv[index + 1]); index += 1;
    } else if (arg === "--machine") {
      if (!argv[index + 1]) throw new Error("--machine requires a path");
      options.machinePath = path.resolve(argv[index + 1]); index += 1;
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
    "Usage: node dna/conformance/host-io/run-host-io-fixtures.mjs [--module <path>] [--machine <path>] [--fixtures <path>] [--quiet]",
    "",
    "Runs host-io-events / host-io-chrono / host-io-iotime fixtures against the port-0xFE event model and @zx-vibes/machine.",
  ].join("\n");
}

function parseNum(value, label) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?(0x)?[0-9a-fA-F]+$/.test(value)) {
    return value.startsWith("0x") || value.startsWith("0X")
      ? Number.parseInt(value.slice(2), 16)
      : Number.parseInt(value, value.includes("x") ? 16 : 10);
  }
  throw new Error(`${label}: not a numeric/hex value: ${JSON.stringify(value)}`);
}

function parseByte(value, label) {
  return parseNum(value, label) & 0xff;
}

function describeEvent(event) {
  if (!event || typeof event !== "object") return JSON.stringify(event);
  if (event.kind === "beeper") return `{${event.tFrame}, beeper, level ${event.level}}`;
  if (event.kind === "border") return `{${event.tFrame}, border, value ${event.value}}`;
  return JSON.stringify(event);
}

function eventsEqual(actual, expected) {
  if (!actual || !expected) return false;
  if (actual.tFrame !== expected.tFrame || actual.kind !== expected.kind) return false;
  if (expected.kind === "border") return actual.value === expected.value;
  if (expected.kind === "beeper") return actual.level === expected.level;
  return false;
}

function compareEvents(caseName, expectedEvents, actualEvents, failures) {
  const expected = expectedEvents ?? [];
  const actual = actualEvents ?? [];
  if (actual.length !== expected.length) {
    failures.push(`${caseName}: produced ${actual.length} event(s), expected ${expected.length}`);
  }
  const limit = Math.max(actual.length, expected.length);
  for (let i = 0; i < limit; i += 1) {
    if (!eventsEqual(actual[i], expected[i])) {
      failures.push(`${caseName}: event[${i}] = ${describeEvent(actual[i])}, expected ${describeEvent(expected[i])}`);
    }
  }
}

function checkMonotonic(caseName, events, failures) {
  for (let i = 1; i < (events?.length ?? 0); i += 1) {
    if (events[i].tFrame < events[i - 1].tFrame) {
      failures.push(`${caseName}: events not chronological — tFrame ${events[i].tFrame} after ${events[i - 1].tFrame} (modulo reorders across the frame wrap)`);
      return;
    }
  }
}

function runEventsCase(model, testCase, expected, failures) {
  if (typeof model.extractPortFeEvents !== "function") {
    failures.push(`${testCase.name}: model does not export extractPortFeEvents()`);
    return;
  }
  const writes = (testCase.writes ?? []).map((w, i) => ({ tFrame: w.tFrame, value: parseByte(w.value, `${testCase.name}.writes[${i}].value`) }));
  const actual = model.extractPortFeEvents(writes, testCase.options ?? {});
  compareEvents(testCase.name, expected.events, actual, failures);
}

function runChronoCase(model, testCase, expected, failures) {
  if (typeof model.extractFrameEvents !== "function") {
    failures.push(`${testCase.name}: model does not export extractFrameEvents()`);
    return;
  }
  const writes = (testCase.writes ?? []).map((w, i) => ({ clock: w.clock, value: parseByte(w.value, `${testCase.name}.writes[${i}].value`) }));
  const actual = model.extractFrameEvents(writes, { frameStart: testCase.frameStart ?? 0 });
  compareEvents(testCase.name, expected.events, actual, failures);
  checkMonotonic(testCase.name, actual, failures);
}

function buildMemory(caseMemory = {}, caseName) {
  const memory = new Uint8Array(0x10000);
  for (const [address, data] of Object.entries(caseMemory)) {
    let pointer = parseNum(address, `${caseName}.memory address`);
    if (typeof data !== "string" || data.length % 2 !== 0) throw new Error(`${caseName}: memory bytes must be an even-length hex string`);
    for (let i = 0; i < data.length; i += 2) { memory[pointer & 0xffff] = parseNum(`0x${data.slice(i, i + 2)}`, `${caseName}.memory byte`); pointer += 1; }
  }
  return memory;
}

function buildRegisters(caseRegisters = {}, caseName) {
  const registers = {};
  for (const [name, value] of Object.entries(caseRegisters)) registers[name] = parseNum(value, `${caseName}.registers.${name}`);
  return registers;
}

function runIotimeCase(machineModule, testCase, expected, failures) {
  if (!machineModule || typeof machineModule.createMachine !== "function") {
    failures.push(`${testCase.name}: machine module does not export createMachine()`);
    return;
  }
  const writes = [];
  const io = { read: () => 0xff, write: (port, value) => writes.push({ port: port & 0xffff, value: value & 0xff }) };
  const machine = machineModule.createMachine({
    registers: buildRegisters(testCase.registers, testCase.name),
    memory: buildMemory(testCase.memory, testCase.name),
    io,
    clock: parseNum(testCase.clock ?? 0, `${testCase.name}.clock`),
    exactContention: Boolean(testCase.exact),
  });
  const steps = parseNum(testCase.steps ?? 1, `${testCase.name}.steps`);
  let contention = 0;
  let tStates = 0;
  for (let i = 0; i < steps; i += 1) {
    const r = machine.stepInstruction();
    contention += r.contention;
    tStates += r.tStates;
  }
  if (expected.contention !== undefined && contention !== parseNum(expected.contention, `${testCase.name}.expected.contention`)) {
    failures.push(`${testCase.name}: contention = ${contention}, expected ${parseNum(expected.contention)}`);
  }
  if (expected.tStates !== undefined && tStates !== parseNum(expected.tStates, `${testCase.name}.expected.tStates`)) {
    failures.push(`${testCase.name}: tStates = ${tStates}, expected ${parseNum(expected.tStates)}`);
  }
  const expectedWrites = expected.writes ?? [];
  if (writes.length !== expectedWrites.length) {
    failures.push(`${testCase.name}: captured ${writes.length} port write(s), expected ${expectedWrites.length}`);
  }
  for (let i = 0; i < expectedWrites.length; i += 1) {
    const want = expectedWrites[i];
    const got = writes[i];
    const wantLow = parseByte(want.portLow, `${testCase.name}.expected.writes[${i}].portLow`);
    const wantValue = parseByte(want.value, `${testCase.name}.expected.writes[${i}].value`);
    if (!got) { failures.push(`${testCase.name}: missing port write[${i}]`); continue; }
    if ((got.port & 0xff) !== wantLow || got.value !== wantValue) {
      failures.push(`${testCase.name}: port write[${i}] = {portLow 0x${(got.port & 0xff).toString(16)}, value ${got.value}}, expected {portLow 0x${wantLow.toString(16)}, value ${wantValue}}`);
    }
  }
}

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
    for (const fixture of Array.isArray(parsed) ? parsed : [parsed]) fixtures.push({ file, fixture });
  }
  return fixtures;
}

const HANDLED_KINDS = new Set(["host-io-events", "host-io-chrono", "host-io-iotime"]);

export async function runHostIoFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return { exitCode: 0 };
  }

  const model = await import(pathToFileURL(options.modulePath).href);
  const fixtures = await loadFixtures(options.fixtures);

  // The machine is only needed for host-io-iotime fixtures; import it lazily.
  let machineModule = null;
  if (fixtures.some(({ fixture }) => fixture?.input?.kind === "host-io-iotime")) {
    machineModule = await import(pathToFileURL(options.machinePath).href);
  }

  const failures = [];
  let caseCount = 0;

  for (const { fixture } of fixtures) {
    const kind = fixture?.input?.kind;
    if (!HANDLED_KINDS.has(kind)) continue;
    const expectedByName = new Map((fixture.expected?.cases ?? []).map((item) => [item.name, item]));
    for (const testCase of fixture.input.cases ?? []) {
      caseCount += 1;
      const expected = expectedByName.get(testCase.name);
      if (!expected) {
        failures.push(`${fixture.id}: missing expected case '${testCase.name}'`);
        continue;
      }
      try {
        if (kind === "host-io-events") runEventsCase(model, testCase, expected, failures);
        else if (kind === "host-io-chrono") runChronoCase(model, testCase, expected, failures);
        else if (kind === "host-io-iotime") runIotimeCase(machineModule, testCase, expected, failures);
      } catch (error) {
        failures.push(`${testCase.name}: threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`Host-I/O fixtures: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`- ${failure}`);
    return { exitCode: 1 };
  }

  if (!options.quiet) console.log(`Host-I/O fixtures: ${caseCount} case(s) passed (port-0xFE event model + @zx-vibes/machine via run-host-io-fixtures)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHostIoFixtures()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
