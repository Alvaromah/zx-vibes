#!/usr/bin/env node
// Runs CPU-execution conformance fixtures against an implementation module that
// executes a single Z80 instruction. Two fixture kinds:
//   - "cpu-step": one step() call per case (the per-opcode FUSE single-step ISA).
//   - "cpu-run":  a run-to-budget driver loops step() until the case's `budget`
//     (FUSE input T-states) is reached, threading the same registers/memory/io.
//     This covers the multi-instruction cases (DJNZ loops, prefix NONI timing,
//     and the repeating block ops LDIR/CPIR/INIR/...). The expected `tStates` is
//     the FINAL accumulated count (FUSE output T-states), not a single step.
//
// Implementation module contract (the regeneration target):
//   export function step({ registers, memory, io }) -> { registers, tStates }
//   - io: port interface for IN/OUT/INI/OUTI/IND/OUTD. io.read(port) returns the
//     byte the 16-bit port yields; io.write(port, value) records an output. A case
//     with no port activity passes an io whose reads default to 0xFF and whose
//     writes are unused. Instructions that do no I/O may ignore io.
//   - registers: a plain object with integer fields a,f,b,c,d,e,h,l (8-bit),
//     pc,sp (16-bit), i,r (8-bit), iff1,iff2,im, and ixh,ixl,iyh,iyl (8-bit).
//   - memory: a Uint8Array of length 0x10000 with the opcode bytes preloaded;
//     step reads the instruction at registers.pc.
//   - step executes exactly one instruction and returns the updated register
//     object (new or mutated in place) plus the T-states the instruction took.
//     It may mutate `memory` in place for instructions that write memory.
//
// A fixture case lists only the registers/memory it sets (everything else
// defaults to 0x00 / PC 0x0000); the expected block asserts only the register
// fields it names, plus tStates. This keeps the implementation under test
// decoupled from the legacy emulator's structure (it is derived from the DNA,
// not copied): the contract is this function shape, nothing more.
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultFixturePath = thisDir;

// Every register field the contract recognizes, defaulting to 0.
const REGISTER_NAMES = [
  "a", "f", "b", "c", "d", "e", "h", "l",
  "a_", "f_", "b_", "c_", "d_", "e_", "h_", "l_",
  "pc", "sp", "i", "r", "iff1", "iff2", "im", "memptr",
  "ixh", "ixl", "iyh", "iyl",
];

// 16-bit register fields render as four hex digits; the rest as two.
const WIDE_REGISTERS = new Set(["pc", "sp", "memptr"]);

function usage() {
  return [
    "Usage: node dna/conformance/cpu/run-cpu-exec-fixtures.mjs --module <path> [options]",
    "",
    "Options:",
    "  --module <path>     Implementation module exporting step({registers, memory})",
    "  --fixtures <path>   Fixture JSON file or directory (default: cpu/)",
    "  --quiet             Suppress pass output",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    fixtures: defaultFixturePath,
    modulePath: null,
    quiet: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--fixtures requires a path");
      }
      options.fixtures = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--module") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--module requires a path");
      }
      options.modulePath = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseHex(value, label) {
  if (typeof value === "number") {
    return value;
  }
  assert(typeof value === "string" && /^[0-9a-fA-F]+$/.test(value), `${label}: not a hex value: ${JSON.stringify(value)}`);
  return Number.parseInt(value, 16);
}

function hex(value, width) {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

function buildRegisters(caseRegisters = {}, caseName) {
  const registers = {};
  for (const name of REGISTER_NAMES) {
    registers[name] = 0;
  }
  for (const [name, value] of Object.entries(caseRegisters)) {
    assert(REGISTER_NAMES.includes(name), `${caseName}: unknown input register '${name}'`);
    registers[name] = parseHex(value, `${caseName}.registers.${name}`);
  }
  return registers;
}

function buildMemory(caseMemory = {}, caseName) {
  const memory = new Uint8Array(0x10000);
  for (const [address, data] of Object.entries(caseMemory)) {
    let pointer = parseHex(address, `${caseName}.memory address`);
    assert(typeof data === "string" && data.length % 2 === 0, `${caseName}: memory bytes must be an even-length hex string`);
    for (let i = 0; i < data.length; i += 2) {
      memory[pointer & 0xffff] = parseHex(data.slice(i, i + 2), `${caseName}.memory byte`);
      pointer += 1;
    }
  }
  return memory;
}

// Build the io interface a case sees: reads return the FUSE-recorded port value
// (default 0xFF if a port not listed is read); writes are recorded for assertion.
function buildIo(caseIo = {}, caseName) {
  const reads = {};
  for (const [port, value] of Object.entries(caseIo.reads ?? {})) {
    reads[parseHex(port, `${caseName}.io.reads port`) & 0xffff] = parseHex(value, `${caseName}.io.reads value`);
  }
  const writes = [];
  return {
    read: (port) => reads[port & 0xffff] ?? 0xff,
    write: (port, value) => { writes.push({ port: port & 0xffff, value: value & 0xff }); },
    writes,
  };
}

function compareCase(caseName, expected, result, memory, io) {
  const failures = [];
  const registers = result?.registers;
  if (!registers || typeof registers !== "object") {
    failures.push(`${caseName}: step() must return { registers, tStates }`);
    return failures;
  }
  const expWrites = expected.io?.writes ?? [];
  for (const [index, ew] of expWrites.entries()) {
    const want = { port: parseHex(ew.port, `${caseName}.io.writes port`) & 0xffff, value: parseHex(ew.value, `${caseName}.io.writes value`) };
    const got = io.writes[index];
    if (!got || got.port !== want.port || got.value !== want.value) {
      failures.push(`${caseName}: io.write[${index}] = ${got ? `0x${hex(got.value, 2)}->0x${hex(got.port, 4)}` : "(none)"}, expected 0x${hex(want.value, 2)}->0x${hex(want.port, 4)}`);
    }
  }
  if (io.writes.length > expWrites.length) {
    failures.push(`${caseName}: ${io.writes.length} io write(s), expected ${expWrites.length}`);
  }
  for (const [name, value] of Object.entries(expected.registers ?? {})) {
    const want = parseHex(value, `${caseName}.expected.${name}`);
    const got = registers[name];
    const width = WIDE_REGISTERS.has(name) ? 4 : 2;
    if (got !== want) {
      failures.push(`${caseName}: register ${name} = 0x${hex(got ?? 0, width)}, expected 0x${hex(want, width)}`);
    }
  }
  for (const [address, data] of Object.entries(expected.memory ?? {})) {
    let pointer = parseHex(address, `${caseName}.expected.memory address`);
    for (let i = 0; i < data.length; i += 2) {
      const want = parseHex(data.slice(i, i + 2), `${caseName}.expected.memory byte`);
      const got = memory[pointer & 0xffff];
      if (got !== want) {
        failures.push(`${caseName}: memory[0x${hex(pointer & 0xffff, 4)}] = 0x${hex(got ?? 0, 2)}, expected 0x${hex(want, 2)}`);
      }
      pointer += 1;
    }
  }
  if (Object.hasOwn(expected, "tStates") && result.tStates !== expected.tStates) {
    failures.push(`${caseName}: tStates = ${result.tStates}, expected ${expected.tStates}`);
  }
  return failures;
}

async function collectFixtureFiles(target) {
  const info = await stat(target);
  if (info.isFile()) {
    return [target];
  }
  const entries = await readdir(target, { withFileTypes: true });
  const collected = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await collectFixtureFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      collected.push(entryPath);
    }
  }
  return collected;
}

async function loadFixtures(target) {
  const files = await collectFixtureFiles(target);
  const fixtures = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    for (const fixture of Array.isArray(parsed) ? parsed : [parsed]) {
      fixtures.push({ file, fixture });
    }
  }
  return fixtures;
}

export async function runCpuExecFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return { exitCode: 0 };
  }
  if (!options.modulePath) {
    console.error("--module <path> is required");
    return { exitCode: 2 };
  }

  const module = await import(pathToFileURL(options.modulePath).href);
  if (typeof module.step !== "function") {
    console.error(`module ${options.modulePath} must export a step() function`);
    return { exitCode: 2 };
  }

  const fixtures = await loadFixtures(options.fixtures);
  const failures = [];
  let caseCount = 0;

  for (const { fixture } of fixtures) {
    const kind = fixture?.input?.kind;
    if (kind !== "cpu-step" && kind !== "cpu-run") {
      continue;
    }
    const expectedByName = new Map((fixture.expected?.cases ?? []).map((item) => [item.name, item]));
    for (const testCase of fixture.input.cases ?? []) {
      caseCount += 1;
      const expected = expectedByName.get(testCase.name);
      if (!expected) {
        failures.push(`${fixture.id}: missing expected case '${testCase.name}'`);
        continue;
      }
      const registers = buildRegisters(testCase.registers, testCase.name);
      const memory = buildMemory(testCase.memory, testCase.name);
      const io = buildIo(testCase.io, testCase.name);
      let result;
      try {
        if (kind === "cpu-run") {
          // Run-to-budget contract (FUSE multi-instruction cases): execute whole
          // instructions while the accumulated T-state count is below the case's
          // budget, threading the SAME registers/memory/io across iterations.
          // This reproduces FUSE's `while (tstates < budget) z80_do_opcode()`,
          // including repeating block ops (which rewind PC) and prefix NONI timing.
          const budget = testCase.budget;
          assert(Number.isInteger(budget) && budget > 0, `${testCase.name}: cpu-run case needs a positive integer budget`);
          let regs = registers;
          let total = 0;
          let guard = 0;
          while (total < budget) {
            const stepResult = module.step({ registers: regs, memory, io });
            regs = stepResult.registers;
            total += stepResult.tStates;
            if ((guard += 1) > 100000) {
              throw new Error("run-to-budget exceeded 100000 iterations (runaway: PC/T-state contract broken?)");
            }
          }
          result = { registers: regs, tStates: total };
        } else {
          result = module.step({ registers, memory, io });
        }
      } catch (error) {
        failures.push(`${testCase.name}: step() threw: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      failures.push(...compareCase(testCase.name, expected, result, memory, io));
    }
  }

  if (failures.length > 0) {
    console.error(`CPU exec fixtures: ${failures.length} failure(s)`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    return { exitCode: 1 };
  }

  if (!options.quiet) {
    console.log(`CPU exec fixtures: ${caseCount} case(s) passed`);
  }
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCpuExecFixtures()
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
