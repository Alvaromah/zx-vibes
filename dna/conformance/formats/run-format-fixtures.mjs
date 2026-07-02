#!/usr/bin/env node
// Runs snapshot-format conformance fixtures against the regenerated
// @zx-vibes/machine package. Two fixture kinds, decided by
// dna/domain/snapshot-z80.md:
//
//   - "z80-roundtrip": load a state (registers + sparse memory + border), call
//     writeZ80() then readZ80(), and assert the read-back state equals the input
//     (RAM + registers + border preserved). This is the FMT-Z80-V3-001 contract.
//   - "z80-decode": parse a pinned .z80 byte blob (hex) with readZ80() and assert
//     the decoded registers/memory/border/version. This pins the on-disk format
//     (header offsets, version markers, RLE) to the documented spec, not merely to
//     write()'s own inverse.
//
// Package contract (the regeneration target, @zx-vibes/machine):
//   writeZ80({ registers, memory, border }) -> Uint8Array
//   readZ80(bytes) -> { registers, memory, border, version }
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultModule = path.join(repoRoot, "packages", "machine", "src", "index.mjs");
const WIDE = new Set(["pc", "sp"]);

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

function assert(c, m) { if (!c) throw new Error(m); }
function parseNum(v, label) {
  if (typeof v === "number") return v;
  assert(typeof v === "string" && /^(0x)?[0-9a-fA-F]+$/.test(v), `${label}: not numeric/hex: ${JSON.stringify(v)}`);
  return Number.parseInt(v.replace(/^0x/i, ""), 16);
}
function hex(v, w) { return (v & (w === 4 ? 0xffff : 0xff)).toString(16).toUpperCase().padStart(w, "0"); }

function buildRegisters(caseRegisters = {}, name) {
  const r = {};
  for (const [k, v] of Object.entries(caseRegisters)) r[k] = parseNum(v, `${name}.registers.${k}`);
  return r;
}
function buildMemory(caseMemory = {}, name) {
  const mem = new Uint8Array(0x10000);
  for (const [addr, data] of Object.entries(caseMemory)) {
    let p = parseNum(addr, `${name}.memory addr`);
    assert(typeof data === "string" && data.length % 2 === 0, `${name}: memory must be even-length hex`);
    for (let i = 0; i < data.length; i += 2) { mem[p & 0xffff] = parseNum(data.slice(i, i + 2), `${name}.byte`); p += 1; }
  }
  return mem;
}
function hexToBytes(s, name) {
  assert(typeof s === "string" && s.length % 2 === 0, `${name}: bytes must be even-length hex`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseNum(s.slice(i * 2, i * 2 + 2), `${name}.byte`);
  return out;
}

function compareRegisters(name, expected = {}, got, failures) {
  for (const [k, v] of Object.entries(expected)) {
    const want = parseNum(v, `${name}.expected.${k}`);
    const w = WIDE.has(k) ? 4 : 2;
    if ((got[k] ?? 0) !== want) failures.push(`${name}: register ${k} = 0x${hex(got[k] ?? 0, w)}, expected 0x${hex(want, w)}`);
  }
}
function compareMemory(name, expected = {}, mem, failures) {
  for (const [addr, data] of Object.entries(expected)) {
    let p = parseNum(addr, `${name}.expected.memory addr`);
    for (let i = 0; i < data.length; i += 2) {
      const want = parseNum(data.slice(i, i + 2), `${name}.expected.byte`);
      if (mem[p & 0xffff] !== want) failures.push(`${name}: memory[0x${hex(p & 0xffff, 4)}] = 0x${hex(mem[p & 0xffff], 2)}, expected 0x${hex(want, 2)}`);
      p += 1;
    }
  }
}
function compareScalar(name, label, expected, actual, failures) {
  if (expected === undefined) return;
  const want = parseNum(expected, `${name}.${label}`);
  if (actual !== want) failures.push(`${name}: ${label} = ${actual}, expected ${want}`);
}

function runRoundtrip(module, c, failures) {
  const registers = buildRegisters(c.registers, c.name);
  const memory = buildMemory(c.memory, c.name);
  const border = c.border === undefined ? 0 : parseNum(c.border, `${c.name}.border`);
  const bytes = module.writeZ80({ registers, memory, border });
  assert(bytes instanceof Uint8Array && bytes.length > 0, `${c.name}: writeZ80 must return a non-empty Uint8Array`);
  const back = module.readZ80(bytes);
  // The read-back state must equal what we wrote.
  compareRegisters(c.name, c.registers, back.registers, failures);
  compareMemory(c.name, c.memory, back.memory, failures);
  compareScalar(c.name, "border", c.border, back.border, failures);
}

function runDecode(module, c, expected, failures) {
  const bytes = hexToBytes(c.bytes, c.name);
  const result = module.readZ80(bytes);
  compareRegisters(c.name, expected.registers, result.registers, failures);
  compareMemory(c.name, expected.memory, result.memory, failures);
  compareScalar(c.name, "border", expected.border, result.border, failures);
  compareScalar(c.name, "version", expected.version, result.version, failures);
}

const DISPATCH = { "z80-roundtrip": "roundtrip", "z80-decode": "decode" };

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

export async function runFormatFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { console.log("Usage: run-format-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]"); return { exitCode: 0 }; }
  const module = await import(pathToFileURL(options.modulePath).href);
  for (const name of ["readZ80", "writeZ80"]) {
    if (typeof module[name] !== "function") { console.error(`module ${options.modulePath} must export ${name}()`); return { exitCode: 2 }; }
  }
  const files = await collect(options.fixtures);
  const failures = [];
  let caseCount = 0;
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    for (const fixture of Array.isArray(parsed) ? parsed : [parsed]) {
      const kind = fixture?.input?.kind;
      if (!DISPATCH[kind]) continue;
      const expectedByName = new Map((fixture.expected?.cases ?? []).map((x) => [x.name, x]));
      for (const c of fixture.input.cases ?? []) {
        caseCount += 1;
        try {
          if (kind === "z80-roundtrip") runRoundtrip(module, c, failures);
          else runDecode(module, c, expectedByName.get(c.name) ?? {}, failures);
        } catch (err) { failures.push(`${c.name}: threw: ${err instanceof Error ? err.message : String(err)}`); }
      }
    }
  }
  if (failures.length > 0) {
    console.error(`Format fixtures: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`- ${f}`);
    return { exitCode: 1 };
  }
  if (!options.quiet) console.log(`Format fixtures: ${caseCount} case(s) passed (@zx-vibes/machine .z80 read/write)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFormatFixtures().then((r) => { process.exitCode = r.exitCode; }).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  });
}
