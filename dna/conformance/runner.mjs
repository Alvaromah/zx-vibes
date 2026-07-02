#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FIXTURE_DIRS = ["assembler", "audio", "cli", "cpu", "formats", "host-io", "keyboard", "machine", "peripherals", "raster", "screen", "timing"];
const VALID_TIERS = new Set(["contract", "fidelity", "incidental"]);
const VALID_PROVENANCE = new Set([
  "hardware",
  "z80-spec",
  "zexall",
  "zexdoc",
  "fuse",
  "contract",
  "manual",
  "UNKNOWN",
]);
const VALID_NORMALIZATION_PROFILES = new Set([
  "none",
  "binary",
  "json",
  "cli-snapshot",
  "screen-hash",
  "custom",
]);

const thisDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = {
    root: thisDir,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--root requires a path");
      }
      options.root = path.resolve(value);
      i += 1;
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

function usage() {
  return [
    "Usage: node dna/conformance/runner.mjs [--root <path>] [--quiet]",
    "",
    "Validates conformance fixture files under the known fixture directories.",
    "An empty suite is valid and exits 0.",
  ].join("\n");
}

async function pathExists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function collectJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }

  return files;
}

export async function collectFixtureFiles(root) {
  const files = [];

  for (const fixtureDir of FIXTURE_DIRS) {
    const directory = path.join(root, fixtureDir);
    if (!(await pathExists(directory))) {
      continue;
    }
    files.push(...(await collectJsonFiles(directory)));
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function describePath(file, root, suffix = "") {
  return `${path.relative(root, file).replaceAll(path.sep, "/")}${suffix}`;
}

function validateProvenance(value) {
  return VALID_PROVENANCE.has(value) || /^decision:[A-Za-z0-9._-]+$/.test(value);
}

function validateFixtureObject(value, file, root, suffix = "") {
  const where = describePath(file, root, suffix);
  const errors = [];

  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return [`${where}: fixture must be a JSON object`];
  }

  for (const field of ["id", "tier", "provenance", "input", "expected", "normalization"]) {
    if (!hasOwn(value, field)) {
      errors.push(`${where}: missing required field '${field}'`);
    }
  }

  if (hasOwn(value, "id") && (typeof value.id !== "string" || value.id.trim() === "")) {
    errors.push(`${where}: 'id' must be a non-empty string`);
  }

  if (hasOwn(value, "tier") && !VALID_TIERS.has(value.tier)) {
    errors.push(
      `${where}: 'tier' must be one of ${Array.from(VALID_TIERS).join(", ")}`,
    );
  }

  if (
    hasOwn(value, "provenance") &&
    (typeof value.provenance !== "string" || !validateProvenance(value.provenance))
  ) {
    errors.push(`${where}: 'provenance' must use the approved provenance enumeration`);
  }

  if (hasOwn(value, "normalization")) {
    const normalization = value.normalization;
    if (normalization === null || Array.isArray(normalization) || typeof normalization !== "object") {
      errors.push(`${where}: 'normalization' must be an object`);
    } else if (!hasOwn(normalization, "profile")) {
      errors.push(`${where}: missing required field 'normalization.profile'`);
    } else if (!VALID_NORMALIZATION_PROFILES.has(normalization.profile)) {
      errors.push(
        `${where}: 'normalization.profile' must be one of ${Array.from(
          VALID_NORMALIZATION_PROFILES,
        ).join(", ")}`,
      );
    }
  }

  return errors;
}

async function validateFixtureFile(file, root) {
  const raw = await readFile(file, "utf8");
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return [`${describePath(file, root)}: invalid JSON: ${error.message}`];
  }

  if (Array.isArray(parsed)) {
    return parsed.flatMap((fixture, index) =>
      validateFixtureObject(fixture, file, root, `[${index}]`),
    );
  }

  return validateFixtureObject(parsed, file, root);
}

export async function runConformance({ root = thisDir, quiet = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const fixtureFiles = await collectFixtureFiles(resolvedRoot);
  const errors = [];

  for (const fixtureFile of fixtureFiles) {
    errors.push(...(await validateFixtureFile(fixtureFile, resolvedRoot)));
  }

  if (errors.length > 0) {
    console.error(`Conformance: ${errors.length} fixture schema error(s)`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return { ok: false, fixtures: fixtureFiles.length, errors };
  }

  if (!quiet) {
    const emptyNote = fixtureFiles.length === 0 ? "; suite is empty and green" : "";
    console.log(`Conformance: ${fixtureFiles.length} fixture(s) checked${emptyNote}`);
  }

  return { ok: true, fixtures: fixtureFiles.length, errors: [] };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = await runConformance(options);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
