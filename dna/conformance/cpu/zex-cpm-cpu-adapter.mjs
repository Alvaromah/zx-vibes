#!/usr/bin/env node
// Independent zex CP/M reference adapter for ADR-0006.
//
// Same minimal CP/M monitor as zex-cpm-adapter.mjs (load COM at 0x100, trap BDOS
// at 0x0005 for console output, warm boot at 0x0000), but driven by the
// REGENERATED, DNA-derived CPU @zx-vibes/cpu (decided by the FUSE oracle) instead
// of the legacy project emulator. That makes it an independent, repository-
// reproducible reference: the acceptance bar ADR-0006 sets for moving
// CPU-ZEXDOC-001 / CPU-ZEXALL-001 to covered (a COMPLETE passing run that reaches
// "Tests complete"). It speaks the external-adapter protocol (JSON request on
// stdin, JSON report on stdout) so run-zex.mjs can drive it as the reference.
//
// NOTE ON COST: the zex suites execute billions of T-states. This pure-JS,
// per-instruction reference is correct but slow; a complete run is an offline
// validation, not a CI gate (see ADR-0006 follow-up). --max-instructions bounds
// a probe run, which reports `not_run` if it stops before completion.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { step } from "../../../packages/cpu/src/z80-step.mjs";

const DEFAULT_MAX_INSTRUCTIONS = 5_000_000;
const BDOS_ENTRY = 0x0005;
const WARM_BOOT = 0x0000;
const PROGRAM_LOAD = 0x0100;
const TRANSIENT_TOP = 0xfe00;

const REGISTER_NAMES = [
  "a", "f", "b", "c", "d", "e", "h", "l",
  "a_", "f_", "b_", "c_", "d_", "e_", "h_", "l_",
  "pc", "sp", "i", "r", "iff1", "iff2", "im", "memptr",
  "ixh", "ixl", "iyh", "iyl",
];

function parseArgs(argv) {
  const options = { maxInstructions: DEFAULT_MAX_INSTRUCTIONS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--max-instructions") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--max-instructions requires a positive integer");
      }
      options.maxInstructions = value;
      index += 1;
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

function usage() {
  return [
    "Usage: node dna/conformance/cpu/zex-cpm-cpu-adapter.mjs [--max-instructions <count>]",
    "",
    "Runs a CP/M COM payload through the regenerated @zx-vibes/cpu and reports the",
    "self-checking zex-style console transcript as pass/fail/not_run/error.",
  ].join("\n");
}

function freshRegisters() {
  const registers = {};
  for (const name of REGISTER_NAMES) registers[name] = 0;
  return registers;
}

async function readRequest() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function findComPayload(request) {
  const payload = request.payloads?.find((entry) => entry.path.toLowerCase().endsWith(".com"));
  if (!payload?.localPath) {
    throw new Error("missing CP/M COM payload");
  }
  return payload;
}

function readDollarString(memory, address) {
  let output = "";
  for (let offset = 0; offset < 4096; offset += 1) {
    const byte = memory[(address + offset) & 0xffff];
    if (byte === 0x24) return output;
    output += String.fromCharCode(byte);
  }
  throw new Error(`BDOS function 9 string at ${address.toString(16)} is not '$'-terminated`);
}

function popReturnAddress(registers, memory) {
  const sp = registers.sp & 0xffff;
  const low = memory[sp];
  const high = memory[(sp + 1) & 0xffff];
  registers.sp = (sp + 2) & 0xffff;
  registers.pc = low | (high << 8);
}

function handleBdos(registers, memory) {
  if (registers.c === 2) {
    popReturnAddress(registers, memory);
    return String.fromCharCode(registers.e & 0xff);
  }
  if (registers.c === 9) {
    popReturnAddress(registers, memory);
    return readDollarString(memory, ((registers.d << 8) | registers.e) & 0xffff);
  }
  throw new Error(`unsupported CP/M BDOS function ${registers.c}`);
}

function normalizeConsole(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function classifyConsole(text, completed, instructions, maxInstructions) {
  const normalized = normalizeConsole(text);
  const errorMatches = normalized.match(/ERROR[^\n]*/g) ?? [];
  if (errorMatches.length > 0) {
    return { status: "fail", tests: null, failures: errorMatches.length, message: errorMatches[0] };
  }
  if (completed && normalized.includes("Tests complete")) {
    return { status: "pass", tests: null, failures: 0, message: "zex-style CP/M transcript completed without ERROR" };
  }
  if (instructions >= maxInstructions) {
    return { status: "not_run", tests: null, failures: null, message: `instruction limit reached before completion (${maxInstructions})` };
  }
  return { status: "error", tests: null, failures: null, message: "CP/M program stopped before reporting completion" };
}

async function runCom(programPath, { maxInstructions }) {
  const program = await readFile(programPath);
  if (program.length + PROGRAM_LOAD > 0x10000) {
    throw new Error(`COM payload is too large: ${program.length} bytes`);
  }

  const memory = new Uint8Array(0x10000);
  memory.set(program, PROGRAM_LOAD);
  memory[0x0006] = TRANSIENT_TOP & 0xff;
  memory[0x0007] = TRANSIENT_TOP >> 8;

  const registers = freshRegisters();
  registers.pc = PROGRAM_LOAD;
  registers.sp = TRANSIENT_TOP;
  const io = { read: () => 0xff, write: () => {} };

  let consoleText = "";
  let instructions = 0;
  let completed = false;

  while (instructions < maxInstructions) {
    const pc = registers.pc & 0xffff;
    if (pc === WARM_BOOT) {
      completed = true;
      break;
    }
    if (pc === BDOS_ENTRY) {
      consoleText += handleBdos(registers, memory);
      continue;
    }
    step({ registers, memory, io });
    instructions += 1;
  }

  return { console: consoleText, completed, instructions };
}

function emit(report) {
  console.log(JSON.stringify(report));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const request = await readRequest();
  if (request.kind !== "cpu-zex") {
    emit({ status: "error", message: `unsupported request kind '${request.kind}'` });
    return;
  }

  const payload = findComPayload(request);
  const result = await runCom(payload.localPath, options);
  const classification = classifyConsole(result.console, result.completed, result.instructions, options.maxInstructions);

  emit({
    ...classification,
    details: {
      suite: request.suite,
      payload: payload.path,
      reference: "@zx-vibes/cpu",
      instructions: result.instructions,
      completed: result.completed,
      console: result.console.slice(0, 8192),
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    emit({ status: "error", message: error instanceof Error ? error.message : String(error) });
  });
}

export { runCom, classifyConsole };
