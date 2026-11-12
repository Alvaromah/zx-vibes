#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensurePackageBuilt } from "../package-build.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultFixturePath = path.join(thisDir, "corpus.json");

function usage() {
  return [
    "Usage: node dna/conformance/assembler/run-assembler-corpus-fixtures.mjs [options]",
    "",
    "Options:",
    "  --fixtures <path>       Corpus fixture JSON file (default: corpus.json)",
    "  --root <path>           Repo root containing corpus source files",
    "  --module <path>         Assembler module override exporting assembleFile()",
    "  --skip-build            Do not build packages/asm before default import",
    "  --quiet                 Suppress pass output",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    fixtures: defaultFixturePath,
    root: repoRoot,
    modulePath: null,
    skipBuild: false,
    quiet: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--fixtures requires a path");
      }
      options.fixtures = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--root requires a path");
      }
      options.root = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--module") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--module requires a path");
      }
      options.modulePath = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--skip-build") {
      options.skipBuild = true;
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureDefaultModule(root, skipBuild) {
  return ensurePackageBuilt({
    root,
    packageDir: path.join("packages", "asm"),
    packageName: "@zx-vibes/asm",
    artifact: path.join("dist", "index.js"),
    skipBuild,
    label: "corpus conformance",
  });
}

async function loadFixture(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function resolveEntry(root, rel) {
  assert(typeof rel === "string" && rel.length > 0, "corpus entry path must be a non-empty string");
  assert(!path.isAbsolute(rel), `corpus entry must be repo-relative: ${rel}`);
  const resolved = path.resolve(root, rel);
  const relative = path.relative(root, resolved);
  assert(!relative.startsWith("..") && !path.isAbsolute(relative), `corpus entry escapes repo root: ${rel}`);
  return resolved;
}

async function assertFileExists(entry, resolved) {
  try {
    const info = await stat(resolved);
    assert(info.isFile(), `corpus entry is not a file: ${entry}`);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`corpus entry does not exist: ${entry}`);
    }
    throw error;
  }
}

function formatDiagnostics(result) {
  return JSON.stringify(result.errors ?? []);
}

export async function runAssemblerCorpusFixtures({
  fixtures = defaultFixturePath,
  root = repoRoot,
  modulePath = null,
  skipBuild = false,
  quiet = false,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const fixture = await loadFixture(path.resolve(fixtures));
  assert(fixture.input?.kind === "assembler-corpus", `${fixtures} must be an assembler-corpus fixture`);
  assert(Array.isArray(fixture.input.entries), `${fixture.id}: input.entries must be an array`);
  assert(fixture.expected?.ok === true, `${fixture.id}: expected.ok must be true`);
  if (Object.hasOwn(fixture.expected, "count")) {
    assert(
      fixture.expected.count === fixture.input.entries.length,
      `${fixture.id}: expected.count ${fixture.expected.count}, input has ${fixture.input.entries.length}`,
    );
  }

  const resolvedModule = modulePath ?? ensureDefaultModule(resolvedRoot, skipBuild);
  const assembler = await import(pathToFileURL(resolvedModule).href);
  assert(typeof assembler.assembleFile === "function", `${resolvedModule} must export assembleFile()`);

  const errors = [];
  let caseCount = 0;
  for (const entry of fixture.input.entries) {
    caseCount += 1;
    try {
      const resolvedEntry = resolveEntry(resolvedRoot, entry);
      await assertFileExists(entry, resolvedEntry);
      const result = assembler.assembleFile(resolvedEntry);
      assert(result.ok === true, `${entry}: expected ok true, got ${formatDiagnostics(result)}`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (errors.length > 0) {
    console.error(`Assembler corpus fixtures: ${errors.length} failure(s)`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return { ok: false, cases: caseCount, errors };
  }

  if (!quiet) {
    console.log(`Assembler corpus fixtures: ${caseCount} corpus source(s) assembled`);
  }
  return { ok: true, cases: caseCount, errors: [] };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await runAssemblerCorpusFixtures(options);
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
