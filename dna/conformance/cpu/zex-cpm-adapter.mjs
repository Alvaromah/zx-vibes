#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { Z80 } from "../../../packages/emulator/src/index.js";

const DEFAULT_MAX_INSTRUCTIONS = 5_000_000;
const BDOS_ENTRY = 0x0005;
const WARM_BOOT = 0x0000;
const PROGRAM_LOAD = 0x0100;
const TRANSIENT_TOP = 0xfe00;

function parseArgs(argv) {
  const options = {
    maxInstructions: DEFAULT_MAX_INSTRUCTIONS,
  };

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
    "Usage: node dna/conformance/cpu/zex-cpm-adapter.mjs [--max-instructions <count>]",
    "",
    "Runs a CP/M COM payload through the local Z80 engine and reports the",
    "self-checking zex-style console transcript as pass/fail/not_run/error.",
  ].join("\n");
}

class FlatMemory {
  constructor() {
    this.bytes = new Uint8Array(0x10000);
  }

  read(address) {
    return this.bytes[address & 0xffff];
  }

  write(address, value) {
    this.bytes[address & 0xffff] = value & 0xff;
  }
}

class NullIo {
  readPort() {
    return 0xff;
  }

  writePort() {}
}

async function readRequest() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
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
    const byte = memory.read((address + offset) & 0xffff);
    if (byte === 0x24) {
      return output;
    }
    output += String.fromCharCode(byte);
  }
  throw new Error(`BDOS function 9 string at ${address.toString(16)} is not '$'-terminated`);
}

function popReturnAddress(cpu, memory) {
  const state = cpu.getState();
  const low = memory.read(state.sp);
  const high = memory.read((state.sp + 1) & 0xffff);
  cpu.setState({
    sp: (state.sp + 2) & 0xffff,
    pc: low | (high << 8),
  });
}

function handleBdos(cpu, memory) {
  const state = cpu.getState();
  if (state.c === 2) {
    popReturnAddress(cpu, memory);
    return String.fromCharCode(state.e & 0xff);
  }
  if (state.c === 9) {
    popReturnAddress(cpu, memory);
    return readDollarString(memory, ((state.d << 8) | state.e) & 0xffff);
  }
  throw new Error(`unsupported CP/M BDOS function ${state.c}`);
}

function normalizeConsole(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function classifyConsole(text, completed, instructions, maxInstructions) {
  const normalized = normalizeConsole(text);
  const errorMatches = normalized.match(/ERROR[^\n]*/g) ?? [];
  if (errorMatches.length > 0) {
    return {
      status: "fail",
      tests: null,
      failures: errorMatches.length,
      message: errorMatches[0],
    };
  }
  if (completed && normalized.includes("Tests complete")) {
    return {
      status: "pass",
      tests: null,
      failures: 0,
      message: "zex-style CP/M transcript completed without ERROR",
    };
  }
  if (instructions >= maxInstructions) {
    return {
      status: "not_run",
      tests: null,
      failures: null,
      message: `instruction limit reached before completion (${maxInstructions})`,
    };
  }
  return {
    status: "error",
    tests: null,
    failures: null,
    message: "CP/M program stopped before reporting completion",
  };
}

async function runCom(programPath, { maxInstructions }) {
  const program = await readFile(programPath);
  if (program.length + PROGRAM_LOAD > 0x10000) {
    throw new Error(`COM payload is too large: ${program.length} bytes`);
  }

  const memory = new FlatMemory();
  memory.bytes.set(program, PROGRAM_LOAD);
  memory.write(0x0006, TRANSIENT_TOP & 0xff);
  memory.write(0x0007, TRANSIENT_TOP >> 8);

  const cpu = new Z80(memory, new NullIo());
  cpu.setState({
    pc: PROGRAM_LOAD,
    sp: TRANSIENT_TOP,
  });

  let console = "";
  let instructions = 0;
  let completed = false;

  while (instructions < maxInstructions) {
    const state = cpu.getState();
    if (state.pc === WARM_BOOT) {
      completed = true;
      break;
    }
    if (state.pc === BDOS_ENTRY) {
      console += handleBdos(cpu, memory);
      continue;
    }
    cpu.execute();
    instructions += 1;
  }

  return {
    console,
    completed,
    instructions,
  };
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
  const classification = classifyConsole(
    result.console,
    result.completed,
    result.instructions,
    options.maxInstructions,
  );

  emit({
    ...classification,
    details: {
      suite: request.suite,
      payload: payload.path,
      instructions: result.instructions,
      completed: result.completed,
      console: result.console.slice(0, 8192),
    },
  });
}

main().catch((error) => {
  emit({
    status: "error",
    message: error instanceof Error ? error.message : String(error),
  });
});
