#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { collectFixtureFiles } from "./runner.mjs";

const VALID_AREAS = new Set([
  "assembler",
  "emulator",
  "toolkit",
  "scaffolding",
  "gallery",
  "reference",
  "cross",
]);
const VALID_TIERS = new Set(["contract", "fidelity", "incidental"]);
const VALID_STATUS = new Set(["covered", "partial", "uncovered", "unknown"]);
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
const GATED_TIERS = new Set(["contract", "fidelity"]);
const OPEN_STATUS = new Set(["partial", "uncovered", "unknown"]);

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCoverageFile = path.join(thisDir, "coverage.yaml");
const defaultDnaRoot = path.dirname(thisDir);

function usage() {
  return [
    "Usage: node dna/conformance/coverage-check.mjs [--file <coverage.yaml>] [--dna-root <path>] [--cutover <area|all>] [--area <area>] [--by-area] [--quiet]",
    "",
    "Default mode validates coverage.yaml shape and covered-row fixture references.",
    "--cutover enforces that matching contract/fidelity rows are covered.",
    "--area reports the covered/total count for a single product area (shard).",
    "--by-area appends a per-area covered/total breakdown after the aggregate.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    coverageFile: defaultCoverageFile,
    dnaRoot: defaultDnaRoot,
    cutover: null,
    area: null,
    byArea: false,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--file requires a path");
      }
      options.coverageFile = path.resolve(value);
      i += 1;
      continue;
    }
    if (arg === "--dna-root") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--dna-root requires a path");
      }
      options.dnaRoot = path.resolve(value);
      i += 1;
      continue;
    }
    if (arg === "--cutover") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--cutover requires an area or 'all'");
      }
      options.cutover = value;
      i += 1;
      continue;
    }
    if (arg === "--area") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--area requires an area name");
      }
      options.area = value;
      i += 1;
      continue;
    }
    if (arg === "--by-area") {
      options.byArea = true;
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

function stripInlineComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "#" && !quote) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function unquote(value) {
  const trimmed = stripInlineComment(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value) {
  const trimmed = stripInlineComment(value).trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return null;
  }
  const body = trimmed.slice(1, -1).trim();
  if (body === "") {
    return [];
  }
  return body.split(",").map((item) => unquote(item));
}

function parseCoverageYaml(text) {
  const rows = [];
  let inBehaviors = false;
  let current = null;

  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    if (/^\s*(#.*)?$/.test(line)) {
      continue;
    }
    if (/^behaviors:\s*$/.test(line)) {
      inBehaviors = true;
      continue;
    }
    if (!inBehaviors) {
      continue;
    }

    const rowStart = line.match(/^\s*-\s+id:\s*(.+?)\s*$/);
    if (rowStart) {
      current = {
        id: unquote(rowStart[1]),
        fixtures: null,
        line: lineIndex + 1,
      };
      rows.push(current);
      continue;
    }

    if (!current) {
      throw new Error(`coverage.yaml:${lineIndex + 1}: expected '- id:' row`);
    }

    const field = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!field) {
      throw new Error(`coverage.yaml:${lineIndex + 1}: unsupported YAML shape`);
    }

    const key = field[1];
    const rawValue = field[2];
    current[key] = parseInlineList(rawValue) ?? unquote(rawValue);
  }

  return rows;
}

function validateProvenance(value) {
  return VALID_PROVENANCE.has(value) || /^decision:[A-Za-z0-9._-]+$/.test(value);
}

function rowLabel(row) {
  return row.id || `line ${row.line}`;
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

async function validateFixtureReferences(row, dnaRoot) {
  const errors = [];
  if (!Array.isArray(row.fixtures)) {
    return [`${rowLabel(row)}: fixtures must be an inline list`];
  }

  if (GATED_TIERS.has(row.tier) && row.status === "covered" && row.fixtures.length === 0) {
    errors.push(`${rowLabel(row)}: covered ${row.tier} row must list at least one fixture`);
  }

  if (GATED_TIERS.has(row.tier) && row.status === "covered") {
    for (const fixture of row.fixtures) {
      if (!fixture.startsWith("conformance/")) {
        errors.push(`${rowLabel(row)}: fixture '${fixture}' must be under conformance/`);
        continue;
      }
      const fixturePath = path.join(dnaRoot, fixture);
      if (!(await pathExists(fixturePath))) {
        errors.push(`${rowLabel(row)}: fixture '${fixture}' does not exist`);
      }
    }
  }

  return errors;
}

function collectReferencedFixtures(rows) {
  const referenced = new Set();
  for (const row of rows) {
    if (Array.isArray(row.fixtures)) {
      for (const fixture of row.fixtures) {
        referenced.add(fixture);
      }
    }
  }
  return referenced;
}

// Inverse of validateFixtureReferences: every fixture file the runner would
// discover under FIXTURE_DIRS must be claimed by at least one ledger row, so a
// fixture can never sit on disk with no behavior pointing at it (an orphan).
async function validateNoOrphanFixtures(rows, dnaRoot) {
  const referenced = collectReferencedFixtures(rows);
  const fixtureFiles = await collectFixtureFiles(path.join(dnaRoot, "conformance"));
  const errors = [];
  for (const file of fixtureFiles) {
    const rel = path.relative(dnaRoot, file).replaceAll(path.sep, "/");
    if (!referenced.has(rel)) {
      errors.push(`${rel}: fixture is not referenced by any coverage.yaml row`);
    }
  }
  return errors;
}

function validateRowShape(row) {
  const errors = [];
  for (const field of ["id", "area", "behavior", "tier", "provenance", "fixtures", "status"]) {
    if (row[field] === undefined || row[field] === "") {
      errors.push(`${rowLabel(row)}: missing required field '${field}'`);
    }
  }
  if (row.id && !/^[A-Z0-9-]+$/.test(row.id)) {
    errors.push(`${rowLabel(row)}: id must be stable uppercase kebab form`);
  }
  if (row.area && !VALID_AREAS.has(row.area)) {
    errors.push(`${rowLabel(row)}: area must be one of ${Array.from(VALID_AREAS).join(", ")}`);
  }
  if (row.tier && !VALID_TIERS.has(row.tier)) {
    errors.push(`${rowLabel(row)}: tier must be one of ${Array.from(VALID_TIERS).join(", ")}`);
  }
  if (row.status && !VALID_STATUS.has(row.status)) {
    errors.push(`${rowLabel(row)}: status must be one of ${Array.from(VALID_STATUS).join(", ")}`);
  }
  if (row.provenance && !validateProvenance(row.provenance)) {
    errors.push(`${rowLabel(row)}: provenance must use the approved enumeration`);
  }
  if (row.tier === "incidental" && row.fixtures !== null && !Array.isArray(row.fixtures)) {
    errors.push(`${rowLabel(row)}: incidental fixtures must be an inline list`);
  }
  return errors;
}

function validateCutover(row, cutover) {
  if (!cutover || !GATED_TIERS.has(row.tier)) {
    return [];
  }
  if (cutover !== "all" && row.area !== cutover) {
    return [];
  }

  const errors = [];
  if (OPEN_STATUS.has(row.status)) {
    errors.push(`${rowLabel(row)}: ${row.tier} row is ${row.status} at ${cutover} cutover`);
  }
  if (row.provenance === "UNKNOWN") {
    errors.push(`${rowLabel(row)}: ${row.tier} row has UNKNOWN provenance at cutover`);
  }
  return errors;
}

function tallyByArea(rows) {
  const counts = new Map();
  for (const row of rows) {
    if (!GATED_TIERS.has(row.tier)) {
      continue;
    }
    const entry = counts.get(row.area) ?? { covered: 0, gated: 0 };
    entry.gated += 1;
    if (row.status === "covered") {
      entry.covered += 1;
    }
    counts.set(row.area, entry);
  }
  return counts;
}

export async function checkCoverage({
  coverageFile = defaultCoverageFile,
  dnaRoot = defaultDnaRoot,
  cutover = null,
  area = null,
  byArea = false,
  quiet = false,
} = {}) {
  if (cutover && cutover !== "all" && !VALID_AREAS.has(cutover)) {
    throw new Error(`--cutover must be 'all' or one of ${Array.from(VALID_AREAS).join(", ")}`);
  }
  if (area && !VALID_AREAS.has(area)) {
    throw new Error(`--area must be one of ${Array.from(VALID_AREAS).join(", ")}`);
  }

  const raw = await readFile(coverageFile, "utf8");
  const rows = parseCoverageYaml(raw);
  const errors = [];

  if (rows.length === 0) {
    errors.push("coverage.yaml: behaviors must contain at least one row");
  }

  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) {
      errors.push(`${rowLabel(row)}: duplicate id`);
    }
    ids.add(row.id);
    errors.push(...validateRowShape(row));
    errors.push(...(await validateFixtureReferences(row, dnaRoot)));
    errors.push(...validateCutover(row, cutover));
  }

  errors.push(...(await validateNoOrphanFixtures(rows, dnaRoot)));

  if (errors.length > 0) {
    console.error(`Coverage: ${errors.length} ledger error(s)`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return { ok: false, rows: rows.length, errors };
  }

  const byAreaCounts = tallyByArea(rows);

  if (!quiet) {
    const suffix = cutover ? `; ${cutover} cutover gate enforced` : "";
    if (area) {
      const entry = byAreaCounts.get(area) ?? { covered: 0, gated: 0 };
      console.log(
        `Coverage: ${entry.covered}/${entry.gated} contract+fidelity rows covered [${area}]${suffix}`,
      );
    } else {
      const gated = rows.filter((row) => GATED_TIERS.has(row.tier));
      const covered = gated.filter((row) => row.status === "covered");
      console.log(`Coverage: ${covered.length}/${gated.length} contract+fidelity rows covered${suffix}`);
      if (byArea) {
        for (const areaName of Array.from(byAreaCounts.keys()).sort()) {
          const entry = byAreaCounts.get(areaName);
          console.log(`  ${areaName.padEnd(12)} ${entry.covered}/${entry.gated}`);
        }
      }
    }
  }

  const byAreaResult = {};
  for (const [areaName, entry] of byAreaCounts) {
    byAreaResult[areaName] = { covered: entry.covered, gated: entry.gated };
  }

  return { ok: true, rows: rows.length, errors: [], byArea: byAreaResult };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await checkCoverage(options);
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
