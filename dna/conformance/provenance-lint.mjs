#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const FIXTURE_DIRS = ["assembler", "audio", "cli", "cpu", "fixtures", "formats", "host-io", "keyboard", "machine", "peripherals", "raster", "screen", "timing"];
const MARKDOWN_CLAIM_DIRS = ["domain", "product"];
const FIXTURE_AREA_BY_DIR = new Map([
  ["assembler", "assembler"],
  ["cli", "toolkit"],
  ["cpu", "emulator"],
  ["machine", "emulator"],
  ["timing", "emulator"],
  ["formats", "emulator"],
  ["host-io", "emulator"],
  ["peripherals", "emulator"],
  ["audio", "gallery"],
  ["keyboard", "emulator"],
  ["raster", "gallery"],
  ["screen", "emulator"],
  ["fixtures", "cross"],
]);

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDnaRoot = path.dirname(thisDir);
const defaultDecisionsFile = path.resolve(defaultDnaRoot, "..", ".harness", "decisions.md");

function usage() {
  return [
    "Usage: node dna/conformance/provenance-lint.mjs [--dna-root <path>] [--decisions <path>] [--quiet]",
    "",
    "Checks provenance tags on coverage rows, fixtures, and authored Markdown claims.",
    "UNKNOWN provenance must have a matching UNKNOWN:<area>:<id> entry in decisions.md.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    dnaRoot: defaultDnaRoot,
    decisionsFile: defaultDecisionsFile,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dna-root") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--dna-root requires a path");
      }
      options.dnaRoot = path.resolve(value);
      i += 1;
      continue;
    }
    if (arg === "--decisions") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--decisions requires a path");
      }
      options.decisionsFile = path.resolve(value);
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

async function collectFiles(directory, predicate) {
  if (!(await pathExists(directory))) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, predicate)));
      continue;
    }
    if (entry.isFile() && predicate(entry.name)) {
      files.push(entryPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
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
        line: lineIndex + 1,
      };
      rows.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const field = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (field) {
      current[field[1]] = parseInlineList(field[2]) ?? unquote(field[2]);
    }
  }

  return rows;
}

function isValidProvenance(value) {
  return VALID_PROVENANCE.has(value) || /^decision:[A-Za-z0-9._-]+$/.test(value);
}

function extractProvenance(line) {
  const match = line.match(/(?:\[|<!--)\s*provenance:\s*([A-Za-z0-9:._-]+)\s*(?:\]|-->)/i);
  return match?.[1] ?? null;
}

function extractClaimId(line) {
  const match = line.match(/\[\s*id:\s*([A-Za-z0-9._/-]+)\s*\]/i);
  return match?.[1] ?? null;
}

function unknownKey(area, id) {
  return `UNKNOWN:${area}:${id}`;
}

function relativePath(root, file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function validateProvenanceValue({ source, provenance, area, id, unknowns, decisions, errors }) {
  if (!provenance) {
    errors.push(`${source}: missing provenance`);
    return;
  }
  if (!isValidProvenance(provenance)) {
    errors.push(`${source}: invalid provenance '${provenance}'`);
    return;
  }
  if (provenance === "UNKNOWN") {
    unknowns.push({ area, id, source, key: unknownKey(area, id) });
  }
  if (provenance.startsWith("decision:")) {
    decisions.push({ id: provenance.slice("decision:".length), source });
  }
}

async function lintCoverageRows(dnaRoot, errors, unknowns, decisions) {
  const coverageFile = path.join(dnaRoot, "conformance", "coverage.yaml");
  if (!(await pathExists(coverageFile))) {
    return 0;
  }

  const rows = parseCoverageYaml(await readFile(coverageFile, "utf8"));
  for (const row of rows) {
    validateProvenanceValue({
      source: `conformance/coverage.yaml:${row.line} (${row.id || "unknown row"})`,
      provenance: row.provenance,
      area: row.area || "cross",
      id: row.id || `line-${row.line}`,
      unknowns,
      decisions,
      errors,
    });
  }
  return rows.length;
}

async function lintFixtureFile(file, dnaRoot, errors, unknowns, decisions) {
  const text = await readFile(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    errors.push(`${relativePath(dnaRoot, file)}: invalid JSON: ${error.message}`);
    return 0;
  }

  const fixtures = Array.isArray(parsed) ? parsed : [parsed];
  const rootDir = relativePath(path.join(dnaRoot, "conformance"), file).split("/")[0];
  const area = FIXTURE_AREA_BY_DIR.get(rootDir) ?? "cross";

  for (const [index, fixture] of fixtures.entries()) {
    const suffix = Array.isArray(parsed) ? `[${index}]` : "";
    const id = fixture?.id || `${relativePath(dnaRoot, file)}${suffix}`;
    validateProvenanceValue({
      source: `${relativePath(dnaRoot, file)}${suffix}`,
      provenance: fixture?.provenance,
      area: fixture?.area || area,
      id,
      unknowns,
      decisions,
      errors,
    });
  }
  return fixtures.length;
}

async function lintFixtures(dnaRoot, errors, unknowns, decisions) {
  let count = 0;
  for (const fixtureDir of FIXTURE_DIRS) {
    const directory = path.join(dnaRoot, "conformance", fixtureDir);
    const files = await collectFiles(directory, (name) => name.endsWith(".json"));
    for (const file of files) {
      count += await lintFixtureFile(file, dnaRoot, errors, unknowns, decisions);
    }
  }
  return count;
}

function isMarkdownClaimLine(line) {
  return /\[\s*id:\s*[A-Za-z0-9._/-]+\s*\]/i.test(line);
}

async function lintMarkdownClaims(dnaRoot, errors, unknowns, decisions) {
  let count = 0;
  for (const claimDir of MARKDOWN_CLAIM_DIRS) {
    const directory = path.join(dnaRoot, claimDir);
    const files = (await collectFiles(directory, (name) => name.endsWith(".md"))).filter(
      (file) => path.basename(file).toLowerCase() !== "readme.md",
    );

    for (const file of files) {
      const rel = relativePath(dnaRoot, file);
      const area = claimDir;
      let inFence = false;
      let pendingProvenance = null;
      for (const [index, line] of (await readFile(file, "utf8")).split(/\r?\n/).entries()) {
        const trimmed = line.trim();
        if (trimmed.startsWith("```")) {
          inFence = !inFence;
          continue;
        }
        if (inFence) {
          continue;
        }

        const directive = trimmed.match(/^<!--\s*provenance:\s*([A-Za-z0-9:._-]+)\s*-->$/i);
        if (directive) {
          pendingProvenance = directive[1];
          continue;
        }

        if (!isMarkdownClaimLine(line)) {
          continue;
        }

        count += 1;
        const provenance = extractProvenance(line) ?? pendingProvenance;
        pendingProvenance = null;
        const lineNumber = index + 1;
        const id = extractClaimId(line) ?? `${rel}:${lineNumber}`;
        validateProvenanceValue({
          source: `${rel}:${lineNumber}`,
          provenance,
          area,
          id,
          unknowns,
          decisions,
          errors,
        });
      }
    }
  }
  return count;
}

function readTrackedUnknownKeys(decisionsText) {
  const matches = decisionsText.match(/UNKNOWN:[A-Za-z0-9._/-]+:[A-Za-z0-9._/-]+/g);
  return new Set(matches ?? []);
}

function readAcceptedDecisionIds(decisionsText) {
  const accepted = new Set();
  const matches = decisionsText.matchAll(/^###\s+(ADR-\d+)\s+(.+)$/gm);
  for (const match of matches) {
    if (!/\bPENDING\b/i.test(match[2])) {
      accepted.add(match[1]);
    }
  }
  return accepted;
}

function summarizeUnknowns(unknowns) {
  const byArea = new Map();
  for (const unknown of unknowns) {
    byArea.set(unknown.area, (byArea.get(unknown.area) ?? 0) + 1);
  }
  return Array.from(byArea.entries())
    .sort(([areaA], [areaB]) => areaA.localeCompare(areaB))
    .map(([area, count]) => `${area}:${count}`)
    .join(", ");
}

export async function lintProvenance({
  dnaRoot = defaultDnaRoot,
  decisionsFile = defaultDecisionsFile,
  quiet = false,
} = {}) {
  const resolvedDnaRoot = path.resolve(dnaRoot);
  const errors = [];
  const unknowns = [];
  const decisions = [];

  const counts = {
    coverageRows: await lintCoverageRows(resolvedDnaRoot, errors, unknowns, decisions),
    fixtures: await lintFixtures(resolvedDnaRoot, errors, unknowns, decisions),
    markdownClaims: await lintMarkdownClaims(resolvedDnaRoot, errors, unknowns, decisions),
  };

  let decisionsText = "";
  try {
    decisionsText = await readFile(decisionsFile, "utf8");
  } catch (error) {
    errors.push(`${decisionsFile}: unable to read decisions file: ${error.message}`);
  }

  const trackedUnknowns = readTrackedUnknownKeys(decisionsText);
  for (const unknown of unknowns) {
    if (!trackedUnknowns.has(unknown.key)) {
      errors.push(`${unknown.source}: UNKNOWN provenance is not tracked as ${unknown.key}`);
    }
  }

  const acceptedDecisionIds = readAcceptedDecisionIds(decisionsText);
  for (const decision of decisions) {
    if (!acceptedDecisionIds.has(decision.id)) {
      errors.push(`${decision.source}: decision:${decision.id} does not reference an accepted ADR`);
    }
  }

  if (errors.length > 0) {
    console.error(`Provenance: ${errors.length} lint error(s)`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return { ok: false, errors, unknowns, counts };
  }

  if (!quiet) {
    const checked = counts.coverageRows + counts.fixtures + counts.markdownClaims;
    const unknownSummary = unknowns.length === 0 ? "none" : summarizeUnknowns(unknowns);
    console.log(`Provenance: ${checked} item(s) checked; UNKNOWNs by area: ${unknownSummary}`);
  }

  return { ok: true, errors: [], unknowns, counts };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await lintProvenance(options);
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
