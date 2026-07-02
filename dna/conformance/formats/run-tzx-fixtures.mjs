#!/usr/bin/env node
// Runs the `.tzx` tape-image conformance fixture (`kind: "tzx-format-query"`,
// FORMAT-TZX-001 / FMT-TZX-*, dna/domain/file-formats.md "`.tzx` — tape image
// (versioned block stream)") against the regenerated @zx-vibes/machine tzx-format
// codec. This flips FORMAT-TZX-001 to `covered`: it executes the SHIPPED
// parseTzx/serializeTzx (not a scratchpad artifact).
//
// A `.tzx` file is a 10-byte header ("ZXTape!" + 0x1A + major + minor) followed by a
// flat sequence of typed blocks, each introduced by a 1-byte block ID. Every multi-byte
// field is little-endian; the 0x11/0x14 data length is a 3-byte LE value (not a WORD).
//
// Package contract (the regeneration target, default --module = @zx-vibes/machine index):
//   export function parseTzx(bytes) -> { version: { major, minor }, blocks: [ <block> ] }  (throws on bad file)
//   export function serializeTzx(tzx) -> Uint8Array  (tzx: { version?, blocks })
//
// Fixture shape:
//   input:    { kind: "tzx-format-query",
//               file:  "<hex>",                       // the on-disk byte authority (hand-authored)
//               tzx:   { version?: {major,minor},     // logical content for serialize queries
//                        blocks: [ { id, ...fields, data?: "<hex>" } ] },
//               cases: [ { name, query, args? } ] }
//   expected: { cases: [ { name, value: <number | boolean | string> } ] }
// queries (args in []):
//   fileLength | versionMajor | versionMinor | blockCount
//   blockId[i] | blockField[i, "name"] | blockDataLength[i] | blockDataByte[i, o]
//   blockName[i] | blockText[i] | blockPulseCount[i] | blockPulse[i, k]
//   serializeLength | serializeByte[o] | serializeMatchesFile
//   roundtripParseSerialize | roundtripSerializeParse
//   parseThrows                                       // parseTzx(file) throws (malformed-file rejection)
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultModule = path.join(repoRoot, "packages", "machine", "src", "index.mjs");

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

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if ((a[i] & 0xff) !== (b[i] & 0xff)) return false;
  return true;
}

// Build the logical tzx object the serialize queries consume: copy each block, turning
// a `data` hex string into a Uint8Array (so the runner mirrors the package's data shape).
function buildTzx(spec) {
  const blocks = (spec?.blocks ?? []).map((b) => {
    const block = { ...b };
    if (b.data !== undefined) block.data = hexToBytes(b.data);
    return block;
  });
  return { version: spec?.version, blocks };
}

function blocksRecover(back, expected) {
  // Deep-compare parseTzx(serializeTzx(tzx)) against the input blocks: id + every
  // declared field, data bytes, pulse arrays, and name/text strings.
  if (back.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    const e = expected[i];
    const a = back[i];
    if ((a.id & 0xff) !== (e.id & 0xff)) return false;
    if (e.data !== undefined && !bytesEqual(a.data ?? new Uint8Array(), hexToBytes(e.data))) return false;
    if (e.pulses !== undefined) {
      if (!Array.isArray(a.pulses) || a.pulses.length !== e.pulses.length) return false;
      for (let k = 0; k < e.pulses.length; k += 1) if (a.pulses[k] !== e.pulses[k]) return false;
    }
    if (e.name !== undefined && a.name !== e.name) return false;
    if (e.text !== undefined && a.text !== e.text) return false;
    for (const key of ["pause", "pilot", "sync1", "sync2", "zero", "one", "pilotPulses", "usedBits", "pulseLength", "pulseCount"]) {
      if (e[key] !== undefined && a[key] !== e[key]) return false;
    }
  }
  return true;
}

function buildDispatch(model, fileBytes, tzx, tzxSpec) {
  const parsed = () => model.parseTzx(fileBytes); // may throw on a malformed file
  return {
    fileLength: () => fileBytes.length,
    versionMajor: () => parsed().version.major,
    versionMinor: () => parsed().version.minor,
    blockCount: () => parsed().blocks.length,
    blockId: (i) => parsed().blocks[i].id,
    blockField: (i, name) => parsed().blocks[i][name],
    blockDataLength: (i) => parsed().blocks[i].data.length,
    blockDataByte: (i, o) => parsed().blocks[i].data[o],
    blockName: (i) => parsed().blocks[i].name,
    blockText: (i) => parsed().blocks[i].text,
    blockPulseCount: (i) => parsed().blocks[i].pulses.length,
    blockPulse: (i, k) => parsed().blocks[i].pulses[k],
    serializeLength: () => model.serializeTzx(tzx).length,
    serializeByte: (o) => model.serializeTzx(tzx)[o],
    serializeMatchesFile: () => bytesEqual(model.serializeTzx(tzx), fileBytes),
    roundtripParseSerialize: () => bytesEqual(model.serializeTzx(parsed()), fileBytes),
    roundtripSerializeParse: () => blocksRecover(model.parseTzx(model.serializeTzx(tzx)).blocks, tzxSpec?.blocks ?? []),
    parseThrows: () => {
      try { model.parseTzx(fileBytes); return false; }
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

export async function runTzxFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Usage: run-tzx-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]");
    return { exitCode: 0 };
  }
  const model = await import(pathToFileURL(options.modulePath).href);
  for (const name of ["parseTzx", "serializeTzx"]) {
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
      if (fixture?.input?.kind !== "tzx-format-query") continue;
      const fileBytes = hexToBytes(fixture.input.file);
      const tzx = buildTzx(fixture.input.tzx);
      const dispatch = buildDispatch(model, fileBytes, tzx, fixture.input.tzx);
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
    console.error(`TZX fixtures: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`- ${f}`);
    return { exitCode: 1 };
  }
  if (!options.quiet) console.log(`TZX fixtures: ${caseCount} case(s) passed (@zx-vibes/machine .tzx parse/serialize)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTzxFixtures().then((r) => { process.exitCode = r.exitCode; }).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  });
}
