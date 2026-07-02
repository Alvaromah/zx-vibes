#!/usr/bin/env node
// Runs the `.tap` tape-image conformance fixture (`kind: "tap-format-query"`,
// FORMAT-TAP-001 / FMT-TAP-*, dna/domain/file-formats.md "`.tap` — tape image")
// against the regenerated @zx-vibes/machine tap-format codec. This flips
// FORMAT-TAP-001 to `covered`: it executes the SHIPPED parseTap/serializeTap/tapChecksum
// (not a scratchpad artifact).
//
// A `.tap` file is a flat concatenation of blocks with no header/footer/global length;
// each block is [len:2 LE][flag][data…][checksum], len counts flag+data+checksum, and
// checksum = XOR of the flag byte and every data byte.
//
// Package contract (the regeneration target, default --module = @zx-vibes/machine index):
//   export function tapChecksum(flag, data) -> number  (0..255)
//   export function parseTap(bytes) -> [{ flag, data: Uint8Array, checksum }]  (throws on bad block)
//   export function serializeTap(blocks) -> Uint8Array  (blocks: [{ flag, data }])
//
// Fixture shape:
//   input:    { kind: "tap-format-query",
//               file:  "<hex>",                          // the on-disk byte authority (hand-authored)
//               blocks: [ { flag: <num>, data: "<hex>" } ],  // logical content for serialize queries
//               cases: [ { name, query, args? } ] }
//   expected: { cases: [ { name, value: <number | boolean> } ] }
// queries (args in []):
//   fileLength | blockCount
//   blockFlag[i] | blockDataLength[i] | blockChecksum[i] | blockDataByte[i, o]
//   checksumOf[i]                 -> tapChecksum(blocks[i].flag, blocks[i].data)
//   serializeLength               -> serializeTap(blocks).length
//   serializeByte[o]              -> serializeTap(blocks)[o]
//   serializeMatchesFile          -> serializeTap(blocks) equals the on-disk `file`
//   roundtripParseSerialize       -> serializeTap(parseTap(file)) equals `file`
//   roundtripSerializeParse       -> parseTap(serializeTap(blocks)) recovers blocks (flag/data/checksum)
//   parseThrows                   -> parseTap(file) throws (malformed-file rejection)
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

function buildBlocks(spec) {
  return (spec ?? []).map((b) => ({ flag: b.flag & 0xff, data: hexToBytes(b.data ?? "") }));
}

function buildDispatch(model, fileBytes, blocks) {
  // parseTap may throw on a malformed file; compute lazily so parseThrows can catch it
  // and the well-formed parse queries surface a real error if it throws unexpectedly.
  const parsed = () => model.parseTap(fileBytes);
  return {
    fileLength: () => fileBytes.length,
    blockCount: () => parsed().length,
    blockFlag: (i) => parsed()[i].flag,
    blockDataLength: (i) => parsed()[i].data.length,
    blockChecksum: (i) => parsed()[i].checksum,
    blockDataByte: (i, o) => parsed()[i].data[o],
    checksumOf: (i) => model.tapChecksum(blocks[i].flag, blocks[i].data),
    serializeLength: () => model.serializeTap(blocks).length,
    serializeByte: (o) => model.serializeTap(blocks)[o],
    serializeMatchesFile: () => bytesEqual(model.serializeTap(blocks), fileBytes),
    roundtripParseSerialize: () => bytesEqual(model.serializeTap(parsed()), fileBytes),
    roundtripSerializeParse: () => {
      const back = model.parseTap(model.serializeTap(blocks));
      if (back.length !== blocks.length) return false;
      for (let i = 0; i < blocks.length; i += 1) {
        if (back[i].flag !== (blocks[i].flag & 0xff)) return false;
        if (!bytesEqual(back[i].data, blocks[i].data)) return false;
        if (back[i].checksum !== model.tapChecksum(blocks[i].flag, blocks[i].data)) return false;
      }
      return true;
    },
    parseThrows: () => {
      try { model.parseTap(fileBytes); return false; }
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

export async function runTapFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Usage: run-tap-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]");
    return { exitCode: 0 };
  }
  const model = await import(pathToFileURL(options.modulePath).href);
  for (const name of ["tapChecksum", "parseTap", "serializeTap"]) {
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
      if (fixture?.input?.kind !== "tap-format-query") continue;
      const fileBytes = hexToBytes(fixture.input.file);
      const blocks = buildBlocks(fixture.input.blocks);
      const dispatch = buildDispatch(model, fileBytes, blocks);
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
    console.error(`TAP fixtures: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`- ${f}`);
    return { exitCode: 1 };
  }
  if (!options.quiet) console.log(`TAP fixtures: ${caseCount} case(s) passed (@zx-vibes/machine .tap parse/serialize)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTapFixtures().then((r) => { process.exitCode = r.exitCode; }).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  });
}
