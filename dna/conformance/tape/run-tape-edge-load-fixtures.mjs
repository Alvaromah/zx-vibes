#!/usr/bin/env node
// Runs the ROM tape edge-load conformance fixture (`kind: "tape-edge-load-query"`,
// TAPE-EDGE-LOAD-001 / TAPE-EDGE-*, dna/domain/tape-loading.md "Edge loading") against the
// regenerated @zx-vibes/machine edge-load model driving the REAL 48K ROM. This flips
// TAPE-EDGE-LOAD-001 to `covered`: it executes the SHIPPED edgeLoad/blockToPulses (not a
// scratchpad artifact) against the vendored ROM blob (ROM-ARTIFACT-001).
//
// It is a fabrication-free integration oracle (ADR-0024): the expected value is the SOURCE
// bytes, not a hand-authored constant. For each case it builds the block body
// [flag, ...data, checksum] with the conformed tapChecksum, encodes it to EAR pulses with
// the conformed blockToPulses, maps the opaque ROM at 0x0000, edge-loads through LD-BYTES
// (0x0556), and asserts the loaded RAM is BYTE-IDENTICAL to `data`, that LD-BYTES returns
// success (carry set), and that it finished within the case's T-state budget.
//
// Package contract (the regeneration target, default --module = @zx-vibes/machine index):
//   createMachine({ memory }) -> machine with .memory (Uint8Array) and .tStatesTotal
//   blockToPulses(bodyBytes) -> number[]
//   tapChecksum(flag, data) -> number
//   edgeLoad(machine, pulses, { ix, de, flag, tStateBudget }) -> { ok, reason, bytesLoaded, tStates }
//
// Fixture shape:
//   input:    { kind: "tape-edge-load-query", flag, ix, data: "<hex>", tStateBudget }
//   expected: { ok, bytesLoaded, ram: "<hex>", withinBudget }
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultModule = path.join(repoRoot, "packages", "machine", "src", "index.mjs");
const defaultRom = path.join(thisDir, "..", "rom", "spectrum-48k.rom");

function parseArgs(argv) {
  const options = { fixtures: thisDir, modulePath: defaultModule, romPath: defaultRom, quiet: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixtures") { options.fixtures = path.resolve(argv[++i] ?? ""); }
    else if (arg === "--module") { options.modulePath = path.resolve(argv[++i] ?? ""); }
    else if (arg === "--rom") { options.romPath = path.resolve(argv[++i] ?? ""); }
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

function bytesToHex(bytes) {
  let out = "";
  for (const b of bytes) out += (b & 0xff).toString(16).padStart(2, "0");
  return out;
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

// Build a 64 KB address space with the opaque ROM mapped at 0x0000-0x3FFF and the rest
// (RAM) zero — the W10.8 artifact under the W10.10 edge-load.
function machineWithRom(model, rom) {
  const memory = new Uint8Array(0x10000);
  memory.set(rom, 0x0000);
  return model.createMachine({ memory });
}

export async function runTapeEdgeLoadFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Usage: run-tape-edge-load-fixtures.mjs [--module <path>] [--rom <path>] [--fixtures <path>] [--quiet]");
    return { exitCode: 0 };
  }
  const model = await import(pathToFileURL(options.modulePath).href);
  for (const name of ["createMachine", "blockToPulses", "tapChecksum", "edgeLoad"]) {
    if (typeof model[name] !== "function") {
      console.error(`module ${options.modulePath} must export ${name}()`);
      return { exitCode: 2 };
    }
  }
  let rom;
  try { rom = new Uint8Array(await readFile(options.romPath)); }
  catch (error) { console.error(`cannot read ROM blob ${options.romPath}: ${error instanceof Error ? error.message : String(error)}`); return { exitCode: 2 }; }

  const files = await collect(options.fixtures);
  const failures = [];
  let caseCount = 0;
  for (const fileName of files) {
    const parsedFile = JSON.parse(await readFile(fileName, "utf8"));
    for (const fixture of Array.isArray(parsedFile) ? parsedFile : [parsedFile]) {
      const input = fixture?.input;
      if (input?.kind !== "tape-edge-load-query") continue;
      caseCount += 1;
      const id = fixture.id ?? "<no id>";
      const expected = fixture.expected ?? {};
      const data = hexToBytes(input.data);
      const flag = input.flag & 0xff;
      const ix = input.ix & 0xffff;
      const budget = input.tStateBudget;

      // Fixture honesty: the recorded expected RAM must BE the source bytes (oracle is the
      // source, never a fabricated constant).
      if (expected.ram !== input.data) {
        failures.push(`${id}: expected.ram must equal input.data (the source bytes); got ${expected.ram} vs ${input.data}`);
        continue;
      }

      let result;
      try {
        const body = Uint8Array.from([flag, ...data, model.tapChecksum(flag, data)]);
        const pulses = model.blockToPulses(body);
        const machine = machineWithRom(model, rom);
        result = { r: model.edgeLoad(machine, pulses, { ix, de: data.length, flag, tStateBudget: budget }), machine };
      } catch (error) {
        failures.push(`${id}: edgeLoad threw: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const { r, machine } = result;
      const loadedRam = bytesToHex(machine.memory.slice(ix, ix + data.length));
      const withinBudget = r.reason !== "budget" && r.tStates <= budget;

      if (r.ok !== expected.ok) failures.push(`${id}: ok = ${r.ok}, expected ${expected.ok} (reason ${r.reason})`);
      if (r.bytesLoaded !== expected.bytesLoaded) failures.push(`${id}: bytesLoaded = ${r.bytesLoaded}, expected ${expected.bytesLoaded}`);
      if (loadedRam !== expected.ram) failures.push(`${id}: loaded RAM ${loadedRam} != source ${expected.ram}`);
      if (withinBudget !== expected.withinBudget) failures.push(`${id}: withinBudget = ${withinBudget} (tStates ${r.tStates}, budget ${budget}), expected ${expected.withinBudget}`);
    }
  }

  if (failures.length > 0) {
    console.error(`Tape edge-load fixtures: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`- ${f}`);
    return { exitCode: 1 };
  }
  if (!options.quiet) console.log(`Tape edge-load fixtures: ${caseCount} case(s) passed (@zx-vibes/machine edgeLoad through the real ROM LD-BYTES)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTapeEdgeLoadFixtures().then((r) => { process.exitCode = r.exitCode; }).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  });
}
