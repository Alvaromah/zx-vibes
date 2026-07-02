#!/usr/bin/env node
// Verifies the pinned ZX Spectrum 48K ROM artifact (ROM-ARTIFACT-001, ADR-0024,
// dna/domain/memory-map.md MM-ROM-ARTIFACT-001) against its manifest. This flips
// ROM-ARTIFACT-001 to `covered`: it re-hashes the VENDORED blob and asserts its
// identity, mapping, and referenced entry point match the manifest, so a regeneration
// loads byte-identical firmware and any drift is caught.
//
// The ROM is OPAQUE (ADR-0024): the DNA pins which ROM, not what its routines do.
//
// Checks (against dna/conformance/rom/spectrum-48k-rom.manifest.json by default):
//   - the vendored blob exists, is a file, and its size matches artifact.bytes
//   - its sha256 matches artifact.sha256
//   - mapping spans exactly `bytes` addresses (end - start + 1 === bytes)
//   - every referenced entry point lies inside [start, end]
//   - the artifact is marked opaque
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultManifest = path.join(thisDir, "spectrum-48k-rom.manifest.json");

function parseArgs(argv) {
  const options = { manifest: defaultManifest, quiet: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") { options.manifest = path.resolve(argv[++i] ?? ""); }
    else if (arg === "--quiet") { options.quiet = true; }
    else if (arg === "--help" || arg === "-h") { options.help = true; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function isSafeRelative(value) {
  if (typeof value !== "string" || value.trim() === "" || path.isAbsolute(value)) return false;
  return !value.split(/[\\/]+/).some((part) => part === ".." || part === "");
}

export async function runRomFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Usage: run-rom-fixtures.mjs [--manifest <path>] [--quiet]");
    return { exitCode: 0 };
  }

  const failures = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(options.manifest, "utf8"));
  } catch (error) {
    console.error(`ROM fixtures: cannot read manifest ${options.manifest}: ${error instanceof Error ? error.message : String(error)}`);
    return { exitCode: 2 };
  }

  const fail = (msg) => failures.push(msg);

  // Required shape.
  const artifact = manifest.artifact;
  const mapping = manifest.mapping;
  if (manifest.id !== "ROM-ARTIFACT-001") fail(`id must be ROM-ARTIFACT-001 (got ${JSON.stringify(manifest.id)})`);
  if (manifest.opaque !== true) fail("artifact must be marked opaque: true (ADR-0024)");
  if (!artifact || typeof artifact !== "object") fail("missing 'artifact' object");
  if (!mapping || typeof mapping !== "object") fail("missing 'mapping' object");
  if (!manifest.license || typeof manifest.license !== "object") fail("missing 'license' object");

  if (artifact && mapping && failures.length === 0) {
    if (!Number.isInteger(artifact.bytes) || artifact.bytes <= 0) fail(`artifact.bytes must be a positive integer (got ${JSON.stringify(artifact.bytes)})`);
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) fail("artifact.sha256 must be lowercase 64-char hex");
    if (artifact.vendored !== true) fail("artifact.vendored must be true (the blob is checked locally)");
    if (!isSafeRelative(artifact.localPath)) fail("artifact.localPath must be a safe relative path");

    // Mapping spans exactly `bytes` addresses.
    if (Number.isInteger(mapping.start) && Number.isInteger(mapping.end) && Number.isInteger(artifact.bytes)) {
      const span = mapping.end - mapping.start + 1;
      if (span !== artifact.bytes) fail(`mapping spans ${span} addresses but artifact.bytes is ${artifact.bytes}`);
      if (mapping.start !== 0) fail(`48K ROM must map at start 0x0000 (got ${mapping.start})`);
    } else {
      fail("mapping.start/end must be integers");
    }

    // Referenced entry points must lie inside the ROM.
    for (const [name, addr] of Object.entries(manifest.referencedEntryPoints ?? {})) {
      if (!Number.isInteger(addr) || addr < mapping.start || addr > mapping.end) {
        fail(`referenced entry point ${name}=${addr} is outside the ROM [${mapping.start}, ${mapping.end}]`);
      }
    }

    // Re-hash the vendored blob and check identity.
    if (failures.length === 0) {
      const romPath = path.resolve(path.dirname(options.manifest), artifact.localPath);
      const manifestDir = path.resolve(path.dirname(options.manifest));
      if (romPath !== manifestDir && !romPath.startsWith(`${manifestDir}${path.sep}`)) {
        fail("artifact.localPath escapes the manifest directory");
      } else {
        let info;
        try { info = await stat(romPath); }
        catch { info = null; }
        if (!info) fail(`vendored ROM missing at ${artifact.localPath}`);
        else if (!info.isFile()) fail(`vendored ROM is not a file: ${artifact.localPath}`);
        else {
          if (info.size !== artifact.bytes) fail(`vendored ROM size ${info.size} does not match artifact.bytes ${artifact.bytes}`);
          const bytes = await readFile(romPath);
          const actual = createHash("sha256").update(bytes).digest("hex");
          if (actual !== artifact.sha256) fail(`vendored ROM sha256 ${actual} does not match manifest ${artifact.sha256}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(`ROM fixtures: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`- ${f}`);
    return { exitCode: 1 };
  }
  if (!options.quiet) {
    console.log(`ROM fixtures: ROM-ARTIFACT-001 ok (${manifest.artifact.bytes} bytes, sha256 ${manifest.artifact.sha256.slice(0, 12)}…, mapped ${manifest.mapping.region}, opaque).`);
  }
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRomFixtures().then((r) => { process.exitCode = r.exitCode; }).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  });
}
