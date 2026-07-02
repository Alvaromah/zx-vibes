#!/usr/bin/env node
// Runs the instant/trap-load conformance fixture (`kind: "tape-instant-load-query"`,
// TAPE-INSTANT-LOAD-001 / TAPE-INSTANT-*, dna/domain/tape-loading.md "Instant / trap loading")
// against the regenerated @zx-vibes/machine. It flips TAPE-INSTANT-LOAD-001 to `covered`.
//
// The oracle is `instant == edge` (TAPE-INSTANT-EQUIV-001): for each case it loads the SAME
// block body BOTH ways — the instant/trap loader (no ROM, no pulses, tStates 0) and the real
// ROM LD-BYTES edge-load (0x0556, over the W10.9 EAR pulse stream) — and asserts they agree on
// the OBSERVABLE result { ok, bytesLoaded, the RAM written }, and that both equal the SOURCE
// bytes. This is a mutual cross-check against the real ROM, fabrication-free (ADR-0024): the
// expected value is the source bytes, never a hand-authored constant. The loaders' internal
// `reason` string is deliberately NOT compared (the ROM may time out where instant names the
// cause; only the observable triplet is the contract).
//
// Package contract (the regeneration target, default --module = @zx-vibes/machine index):
//   createMachine({ memory }) -> machine with .memory (Uint8Array) and .tStatesTotal
//   blockToPulses(bodyBytes) -> number[]
//   tapChecksum(flag, data) -> number
//   edgeLoad(machine, pulses, { ix, de, flag, tStateBudget }) -> { ok, bytesLoaded, tStates }
//   instantLoad(machine, body, { ix, de, flag }) -> { ok, bytesLoaded, tStates }
//
// Fixture shape:
//   input:    { kind: "tape-instant-load-query", flag, ix, data: "<hex>", tStateBudget }
//   expected: { ok, bytesLoaded, ram: "<hex>", instantEqualsEdge }
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

// Build a 64 KB address space with the opaque ROM mapped at 0x0000-0x3FFF and the rest (RAM)
// zero. The edge-load half drives the real ROM; the instant half ignores it (it traps the
// load) but uses an identical machine so the RAM comparison is fair.
function machineWithRom(model, rom) {
  const memory = new Uint8Array(0x10000);
  memory.set(rom, 0x0000);
  return model.createMachine({ memory });
}

export async function runTapeInstantLoadFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Usage: run-tape-instant-load-fixtures.mjs [--module <path>] [--rom <path>] [--fixtures <path>] [--quiet]");
    return { exitCode: 0 };
  }
  const model = await import(pathToFileURL(options.modulePath).href);
  for (const name of ["createMachine", "blockToPulses", "tapChecksum", "edgeLoad", "instantLoad"]) {
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
      if (input?.kind !== "tape-instant-load-query") continue;
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

      let edge;
      let instant;
      try {
        const body = Uint8Array.from([flag, ...data, model.tapChecksum(flag, data)]);

        // The real ROM edge-load (the fidelity oracle).
        const edgeMachine = machineWithRom(model, rom);
        const pulses = model.blockToPulses(body);
        const edgeResult = model.edgeLoad(edgeMachine, pulses, { ix, de: data.length, flag, tStateBudget: budget });
        edge = { r: edgeResult, ram: bytesToHex(edgeMachine.memory.slice(ix, ix + data.length)) };

        // The instant/trap load (no ROM, no pulses).
        const instantMachine = machineWithRom(model, rom);
        const instantResult = model.instantLoad(instantMachine, body, { ix, de: data.length, flag });
        instant = { r: instantResult, ram: bytesToHex(instantMachine.memory.slice(ix, ix + data.length)) };
      } catch (error) {
        failures.push(`${id}: load threw: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      // 1. The recorded expected result.
      if (instant.r.ok !== expected.ok) failures.push(`${id}: instant ok = ${instant.r.ok}, expected ${expected.ok}`);
      if (instant.r.bytesLoaded !== expected.bytesLoaded) failures.push(`${id}: instant bytesLoaded = ${instant.r.bytesLoaded}, expected ${expected.bytesLoaded}`);
      if (instant.ram !== expected.ram) failures.push(`${id}: instant RAM ${instant.ram} != source ${expected.ram}`);

      // 2. instant is instantaneous (zero machine time).
      if (instant.r.tStates !== 0) failures.push(`${id}: instant tStates = ${instant.r.tStates}, expected 0 (instant load elapses no machine time)`);

      // 3. THE ORACLE — instant == edge on the observable result (TAPE-INSTANT-EQUIV-001).
      if (instant.r.ok !== edge.r.ok) failures.push(`${id}: instant.ok ${instant.r.ok} != edge.ok ${edge.r.ok} (instant must equal the real ROM)`);
      if (instant.r.bytesLoaded !== edge.r.bytesLoaded) failures.push(`${id}: instant.bytesLoaded ${instant.r.bytesLoaded} != edge.bytesLoaded ${edge.r.bytesLoaded}`);
      if (instant.ram !== edge.ram) failures.push(`${id}: instant RAM ${instant.ram} != edge RAM ${edge.ram} (instant must reproduce the real ROM's RAM)`);

      // 4. The edge half really ran the ROM (a positive control: the load finished in-budget
      //    on actual machine time, so "agreement" is not two no-ops agreeing).
      if (edge.r.tStates <= 0 || edge.r.tStates > budget) failures.push(`${id}: edge tStates ${edge.r.tStates} not in (0, ${budget}] — the real-ROM control did not run as expected`);
    }
  }

  if (failures.length > 0) {
    console.error(`Tape instant-load fixtures: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`- ${f}`);
    return { exitCode: 1 };
  }
  if (!options.quiet) console.log(`Tape instant-load fixtures: ${caseCount} case(s) passed (instant == edge through the real ROM LD-BYTES; @zx-vibes/machine instantLoad)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTapeInstantLoadFixtures().then((r) => { process.exitCode = r.exitCode; }).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  });
}
