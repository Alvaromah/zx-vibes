#!/usr/bin/env node
// Runs the `.scr` screen-dump conformance fixture (`kind: "scr-format-query"`,
// FORMAT-SCR-001 / FMT-SCR-*, dna/domain/file-formats.md "`.scr` — raw screen dump")
// against the regenerated @zx-vibes/ula scr-format module. This flips FORMAT-SCR-001
// to `covered`: it executes the SHIPPED loadScr/saveScr (not a scratchpad artifact).
//
// A `.scr` file is a raw, headerless copy of memory 0x4000-0x5AFF (6144 display + 768
// attribute = 6912 bytes), file offset o = address 0x4000 + o.
//
// Package contract (the regeneration target, default --module = @zx-vibes/ula index):
//   export const SCR_SIZE   // 6912
//   export const SCR_BASE   // 0x4000
//   export function saveScr(memory) -> Uint8Array (length SCR_SIZE)
//   export function loadScr(memory, scr) -> void  (writes scr into 0x4000.., region only)
//
// Fixture shape:
//   input:    { kind: "scr-format-query",
//               memory?: { fill?: 0, writes: [ [addr, value], ... ] },   // absolute 0..0xFFFF
//               file?:   { fill?: 0, writes: [ [offset, value], ... ] }, // 0..6911
//               cases: [ { name, query, args? } ] }
//   expected: { cases: [ { name, value: <number | boolean> } ] }
// queries (no args unless noted):
//   scrSize | scrBase | saveLength
//   saveByte(offset)        -> saveScr(memory)[offset]
//   loadMemByte(addr)       -> load `file` into a sentinel-filled memory; memory[addr]
//   roundtripSaveLoadSave   -> saveScr(loadScr-applied(saveScr(memory))) equals saveScr(memory)
//   roundtripLoadSaveLoad   -> save(load(file)) equals file (the on-disk identity)
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultModule = path.join(repoRoot, "packages", "ula", "src", "index.mjs");

const MEMORY_SIZE = 0x10000;
// Memory fill for load tests: a sentinel so an out-of-region write is detectable.
const LOAD_SENTINEL = 0xaa;

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

function buildMemory(spec) {
  const fill = spec?.fill ?? 0;
  const memory = new Uint8Array(MEMORY_SIZE).fill(fill & 0xff);
  for (const [addr, value] of spec?.writes ?? []) {
    if (!Number.isInteger(addr) || addr < 0 || addr >= MEMORY_SIZE) {
      throw new Error(`memory write address out of range: ${addr}`);
    }
    memory[addr] = value & 0xff;
  }
  return memory;
}

function buildFile(spec, size) {
  const fill = spec?.fill ?? 0;
  const file = new Uint8Array(size).fill(fill & 0xff);
  for (const [offset, value] of spec?.writes ?? []) {
    if (!Number.isInteger(offset) || offset < 0 || offset >= size) {
      throw new Error(`file write offset out of range: ${offset}`);
    }
    file[offset] = value & 0xff;
  }
  return file;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function buildDispatch(model, memory, file) {
  // Load `file` into a sentinel-filled memory so untouched bytes are detectable.
  const loadInto = () => {
    const mem = new Uint8Array(MEMORY_SIZE).fill(LOAD_SENTINEL);
    model.loadScr(mem, file);
    return mem;
  };
  return {
    scrSize: () => model.SCR_SIZE,
    scrBase: () => model.SCR_BASE,
    saveLength: () => model.saveScr(memory).length,
    saveByte: (offset) => model.saveScr(memory)[offset],
    loadMemByte: (addr) => loadInto()[addr],
    roundtripSaveLoadSave: () => {
      const first = model.saveScr(memory);
      const mem = new Uint8Array(MEMORY_SIZE);
      model.loadScr(mem, first);
      return bytesEqual(model.saveScr(mem), first);
    },
    roundtripLoadSaveLoad: () => {
      const mem = new Uint8Array(MEMORY_SIZE);
      model.loadScr(mem, file);
      return bytesEqual(model.saveScr(mem), file);
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

export async function runScrFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Usage: run-scr-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]");
    return { exitCode: 0 };
  }
  const model = await import(pathToFileURL(options.modulePath).href);
  for (const name of ["saveScr", "loadScr"]) {
    if (typeof model[name] !== "function") {
      console.error(`module ${options.modulePath} must export ${name}()`);
      return { exitCode: 2 };
    }
  }

  const files = await collect(options.fixtures);
  const failures = [];
  let caseCount = 0;
  for (const fileName of files) {
    const parsed = JSON.parse(await readFile(fileName, "utf8"));
    for (const fixture of Array.isArray(parsed) ? parsed : [parsed]) {
      if (fixture?.input?.kind !== "scr-format-query") continue;
      const size = typeof model.SCR_SIZE === "number" ? model.SCR_SIZE : 6912;
      const memory = buildMemory(fixture.input.memory);
      const file = buildFile(fixture.input.file, size);
      const dispatch = buildDispatch(model, memory, file);
      const expectedByName = new Map((fixture.expected?.cases ?? []).map((x) => [x.name, x]));
      for (const testCase of fixture.input.cases ?? []) {
        caseCount += 1;
        const expected = expectedByName.get(testCase.name);
        if (!expected) { failures.push(`${fixture.id}: missing expected case '${testCase.name}'`); continue; }
        const fn = dispatch[testCase.query];
        if (!fn) { failures.push(`${fixture.id}/${testCase.name}: unknown query '${testCase.query}'`); continue; }
        let actual;
        try { actual = fn(...(testCase.args ?? [])); }
        catch (error) { failures.push(`${testCase.name}: ${testCase.query}() threw: ${error instanceof Error ? error.message : String(error)}`); continue; }
        if (actual !== expected.value) {
          failures.push(`${testCase.name}: ${testCase.query}(${(testCase.args ?? []).join(", ")}) = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected.value)}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(`SCR fixtures: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`- ${f}`);
    return { exitCode: 1 };
  }
  if (!options.quiet) console.log(`SCR fixtures: ${caseCount} case(s) passed (@zx-vibes/ula .scr load/save)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScrFixtures().then((r) => { process.exitCode = r.exitCode; }).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  });
}
