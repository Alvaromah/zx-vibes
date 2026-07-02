#!/usr/bin/env node
// Runs machine-layer conformance fixtures against the regenerated @zx-vibes/machine
// package. Three fixture kinds, each decided by dna/domain/machine-execution.md:
//
//   - "machine-interrupt": one acceptInterrupt() call per case. Tests the maskable
//     interrupt response (IM 0/1/2 dispatch, IFF/R/SP/PC effects, the pushed return
//     address, HALT-exit adjustment, and the masked no-accept case).
//   - "machine-nmi": one acceptNmi() call per case. Tests the non-maskable interrupt
//     response (accepts regardless of IFF1, IFF1<-0 with IFF2 preserved, R bump,
//     HALT-exit return address, pushed PC, PC<-0x0066, 11 T-states).
//   - "machine-run": builds a Machine and runs N stepInstruction() calls with
//     interrupts left disabled, isolating memory contention threaded onto the
//     executed stream. Asserts final registers/memory, the frame clock, and the
//     accumulated contention + elapsed T-states. A case with "exact": true selects
//     the M-cycle-exact contention model (MACHINE-CONTENTION-MCYCLE-001) instead of
//     the default per-access model (MACHINE-CONTENTION-CLOCK-001).
//   - "machine-frame": builds a Machine and runs one runFrame(), exercising the
//     boundary interrupt sampling + acceptance integrated with contention + HALT.
//
// Package contract (the regeneration target, @zx-vibes/machine):
//   createMachine({ registers?, memory?, io?, clock? }) -> Machine
//     machine.stepInstruction() -> { tStates, contention, halted }
//     machine.runFrame({ dataBus? }) -> { tStates, accepted }
//     machine.registers / machine.memory / machine.clock / machine.halted
//   acceptInterrupt({ registers, memory, halted?, dataBus? })
//     -> { registers, tStates, accepted }
//   acceptNmi({ registers, memory, halted? })
//     -> { registers, tStates, accepted, halted }
//
// A case lists only the registers/memory it sets; the expected block asserts only
// the fields it names. Memory is address -> even-length hex string; registers and
// scalars accept a number or hex string.
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultModule = path.join(repoRoot, "packages", "machine", "src", "index.mjs");

const WIDE_REGISTERS = new Set(["pc", "sp", "memptr"]);

function usage() {
  return [
    "Usage: node dna/conformance/machine/run-machine-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]",
    "",
    "Runs machine-interrupt / machine-run / machine-frame fixtures against @zx-vibes/machine.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { fixtures: thisDir, modulePath: defaultModule, quiet: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixtures") {
      if (!argv[i + 1]) throw new Error("--fixtures requires a path");
      options.fixtures = path.resolve(argv[i + 1]); i += 1;
    } else if (arg === "--module") {
      if (!argv[i + 1]) throw new Error("--module requires a path");
      options.modulePath = path.resolve(argv[i + 1]); i += 1;
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseNum(value, label) {
  if (typeof value === "number") return value;
  assert(typeof value === "string" && /^(0x)?[0-9a-fA-F]+$/.test(value), `${label}: not a numeric/hex value: ${JSON.stringify(value)}`);
  return Number.parseInt(value.replace(/^0x/i, ""), 16);
}

function hex(value, width) {
  return (value & (width === 4 ? 0xffff : 0xff)).toString(16).toUpperCase().padStart(width, "0");
}

function buildRegisters(caseRegisters = {}, caseName) {
  const registers = {};
  for (const [name, value] of Object.entries(caseRegisters)) {
    registers[name] = parseNum(value, `${caseName}.registers.${name}`);
  }
  return registers;
}

function buildMemory(caseMemory = {}, caseName) {
  const memory = new Uint8Array(0x10000);
  for (const [address, data] of Object.entries(caseMemory)) {
    let pointer = parseNum(address, `${caseName}.memory address`);
    assert(typeof data === "string" && data.length % 2 === 0, `${caseName}: memory bytes must be an even-length hex string`);
    for (let i = 0; i < data.length; i += 2) {
      memory[pointer & 0xffff] = parseNum(data.slice(i, i + 2), `${caseName}.memory byte`);
      pointer += 1;
    }
  }
  return memory;
}

function compareRegisters(caseName, expected = {}, registers, failures) {
  for (const [name, value] of Object.entries(expected)) {
    const want = parseNum(value, `${caseName}.expected.${name}`);
    const got = registers[name] ?? 0;
    const width = WIDE_REGISTERS.has(name) ? 4 : 2;
    if (got !== want) failures.push(`${caseName}: register ${name} = 0x${hex(got, width)}, expected 0x${hex(want, width)}`);
  }
}

function compareMemory(caseName, expected = {}, memory, failures) {
  for (const [address, data] of Object.entries(expected)) {
    let pointer = parseNum(address, `${caseName}.expected.memory address`);
    for (let i = 0; i < data.length; i += 2) {
      const want = parseNum(data.slice(i, i + 2), `${caseName}.expected.memory byte`);
      const got = memory[pointer & 0xffff];
      if (got !== want) failures.push(`${caseName}: memory[0x${hex(pointer & 0xffff, 4)}] = 0x${hex(got, 2)}, expected 0x${hex(want, 2)}`);
      pointer += 1;
    }
  }
}

function compareScalar(caseName, label, expected, actual, failures) {
  if (expected === undefined) return;
  if (typeof expected === "boolean") {
    if (Boolean(actual) !== expected) failures.push(`${caseName}: ${label} = ${Boolean(actual)}, expected ${expected}`);
    return;
  }
  const want = parseNum(expected, `${caseName}.expected.${label}`);
  if (actual !== want) failures.push(`${caseName}: ${label} = ${actual}, expected ${want}`);
}

function runInterruptCase(module, testCase, expected, failures) {
  const registers = buildRegisters(testCase.registers, testCase.name);
  const memory = buildMemory(testCase.memory, testCase.name);
  const dataBus = testCase.dataBus === undefined ? undefined : parseNum(testCase.dataBus, `${testCase.name}.dataBus`);
  const result = module.acceptInterrupt({ registers, memory, halted: Boolean(testCase.halted), dataBus });
  compareRegisters(testCase.name, expected.registers, result.registers, failures);
  compareMemory(testCase.name, expected.memory, memory, failures);
  compareScalar(testCase.name, "tStates", expected.tStates, result.tStates, failures);
  compareScalar(testCase.name, "accepted", expected.accepted, result.accepted, failures);
}

function runNmiCase(module, testCase, expected, failures) {
  const registers = buildRegisters(testCase.registers, testCase.name);
  const memory = buildMemory(testCase.memory, testCase.name);
  const result = module.acceptNmi({ registers, memory, halted: Boolean(testCase.halted) });
  compareRegisters(testCase.name, expected.registers, result.registers, failures);
  compareMemory(testCase.name, expected.memory, memory, failures);
  compareScalar(testCase.name, "tStates", expected.tStates, result.tStates, failures);
  compareScalar(testCase.name, "accepted", expected.accepted, result.accepted, failures);
  compareScalar(testCase.name, "halted", expected.halted, result.halted, failures);
}

function runRunCase(module, testCase, expected, failures) {
  const machine = module.createMachine({
    registers: buildRegisters(testCase.registers, testCase.name),
    memory: buildMemory(testCase.memory, testCase.name),
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
  compareRegisters(testCase.name, expected.registers, machine.registers, failures);
  compareMemory(testCase.name, expected.memory, machine.memory, failures);
  compareScalar(testCase.name, "clock", expected.clock, machine.clock, failures);
  compareScalar(testCase.name, "contention", expected.contention, contention, failures);
  compareScalar(testCase.name, "tStates", expected.tStates, tStates, failures);
}

function runFrameCase(module, testCase, expected, failures) {
  const machine = module.createMachine({
    registers: buildRegisters(testCase.registers, testCase.name),
    memory: buildMemory(testCase.memory, testCase.name),
    clock: parseNum(testCase.clock ?? 0, `${testCase.name}.clock`),
  });
  const dataBus = testCase.dataBus === undefined ? undefined : parseNum(testCase.dataBus, `${testCase.name}.dataBus`);
  const frame = machine.runFrame(dataBus === undefined ? {} : { dataBus });
  compareRegisters(testCase.name, expected.registers, machine.registers, failures);
  compareMemory(testCase.name, expected.memory, machine.memory, failures);
  compareScalar(testCase.name, "accepted", expected.accepted, frame.accepted, failures);
  compareScalar(testCase.name, "clock", expected.clock, machine.clock, failures);
  compareScalar(testCase.name, "halted", expected.halted, machine.halted, failures);
  compareScalar(testCase.name, "tStates", expected.tStates, frame.tStates, failures);
}

function runResetCase(module, testCase, expected, failures) {
  // Dirty a machine with arbitrary state, then reset() it: the documented reset
  // state must not depend on what came before (MACHINE-RESET-001).
  const machine = module.createMachine({
    registers: buildRegisters(testCase.registers, testCase.name),
    memory: buildMemory(testCase.memory, testCase.name),
    clock: parseNum(testCase.clock ?? 0, `${testCase.name}.clock`),
  });
  if (typeof machine.reset !== "function") {
    failures.push(`${testCase.name}: machine has no reset() method`);
    return;
  }
  machine.reset();
  compareRegisters(testCase.name, expected.registers, machine.registers, failures);
  compareMemory(testCase.name, expected.memory, machine.memory, failures);
  compareScalar(testCase.name, "clock", expected.clock, machine.clock, failures);
  compareScalar(testCase.name, "halted", expected.halted, machine.halted, failures);
  if (expected.memoryAllZero !== undefined) {
    const allZero = !machine.memory.some((byte) => byte !== 0);
    compareScalar(testCase.name, "memoryAllZero", expected.memoryAllZero, allZero, failures);
  }
}

const DISPATCH = {
  "machine-interrupt": runInterruptCase,
  "machine-nmi": runNmiCase,
  "machine-run": runRunCase,
  "machine-frame": runFrameCase,
  "machine-reset": runResetCase,
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

export async function runMachineFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return { exitCode: 0 };
  }

  const module = await import(pathToFileURL(options.modulePath).href);
  for (const name of ["createMachine", "acceptInterrupt", "acceptNmi"]) {
    if (typeof module[name] !== "function") {
      console.error(`module ${options.modulePath} must export ${name}()`);
      return { exitCode: 2 };
    }
  }

  const fixtures = await loadFixtures(options.fixtures);
  const failures = [];
  let caseCount = 0;

  for (const fixture of fixtures) {
    const kind = fixture?.input?.kind;
    const runner = DISPATCH[kind];
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
        runner(module, testCase, expected, failures);
      } catch (error) {
        failures.push(`${testCase.name}: threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`Machine fixtures: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`- ${failure}`);
    return { exitCode: 1 };
  }

  if (!options.quiet) console.log(`Machine fixtures: ${caseCount} case(s) passed (@zx-vibes/machine via run-machine-fixtures)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMachineFixtures()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
