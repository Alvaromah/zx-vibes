#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDeterministicEnv } from "../determinism.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultFixturePath = thisDir;

function usage() {
  return [
    "Usage: node dna/conformance/assembler/run-assembler-api-fixtures.mjs [options]",
    "",
    "Options:",
    "  --fixtures <path>       Fixture JSON file or directory (default: assembler/)",
    "  --root <path>           Repo root for the default @zx-vibes/asm build",
    "  --module <path>         Assembler module override exporting assemble() and optionally assembleFile()",
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

function runProcess(command, args, options = {}) {
  const useShell = options.shell ?? false;
  const spawnCommand = useShell ? [command, ...args].join(" ") : command;
  const spawnArgs = useShell ? [] : args;
  return spawnSync(spawnCommand, spawnArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    env: createDeterministicEnv({
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    }),
    shell: useShell,
  });
}

function ensureDefaultModule(root, skipBuild) {
  const modulePath = path.join(root, "packages", "asm", "dist", "index.js");
  if (!skipBuild) {
    const build = runProcess("corepack", ["pnpm", "--filter", "@zx-vibes/asm", "run", "build"], {
      cwd: root,
      shell: true,
    });
    if (build.status !== 0 || build.error) {
      throw new Error(
        [
          "failed to build @zx-vibes/asm before API conformance",
          build.error?.message,
          build.stdout,
          build.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
  if (!existsSync(modulePath)) {
    throw new Error(`built assembler module does not exist: ${modulePath}`);
  }
  return modulePath;
}

async function loadFixture(file) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  if (Array.isArray(parsed)) {
    return parsed;
  }
  return [parsed];
}

async function collectFixtureFiles(target) {
  const info = await stat(target);
  if (info.isFile()) {
    return [target];
  }
  if (!info.isDirectory()) {
    throw new Error(`fixtures path must be a JSON file or directory: ${target}`);
  }

  const entries = await readdir(target, { withFileTypes: true });
  const collected = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await collectFixtureFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      collected.push(entryPath);
    }
  }
  return collected;
}

async function loadFixtures(target) {
  const files = await collectFixtureFiles(target);
  const fixtures = [];
  for (const file of files) {
    fixtures.push(...(await loadFixture(file)));
  }
  return fixtures;
}

function assertInsideTempDir(target, tempDir) {
  const relative = path.relative(tempDir, target);
  assert(
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)),
    `fixture file escapes temp dir: ${target}`,
  );
}

async function writeFixtureFiles(files, tempDir) {
  for (const file of files ?? []) {
    const target = path.resolve(tempDir, file.path);
    assertInsideTempDir(target, tempDir);
    await mkdir(path.dirname(target), { recursive: true });
    if (file.encoding === "hex") {
      await writeFile(target, Buffer.from(file.data, "hex"));
      continue;
    }
    if (file.encoding === "utf8" || !file.encoding) {
      const data = Array.isArray(file.lines) ? file.lines.join("\n") : file.data ?? "";
      await writeFile(target, data, "utf8");
      continue;
    }
    throw new Error(`unsupported fixture file encoding '${file.encoding}' for ${file.path}`);
  }
}

function replacePlaceholders(value, tempDir) {
  return value.replaceAll("<tmp>", tempDir);
}

function replacePlaceholdersDeep(value, tempDir) {
  if (typeof value === "string") {
    return replacePlaceholders(value, tempDir);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholdersDeep(item, tempDir));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replacePlaceholdersDeep(item, tempDir)]),
    );
  }
  return value;
}

function caseSource(testCase) {
  if (typeof testCase.source === "string") {
    return testCase.source;
  }
  if (Array.isArray(testCase.sourceLines)) {
    return testCase.sourceLines.join("\n");
  }
  throw new Error(`${testCase.name}: source or sourceLines is required`);
}

function hex(bytes) {
  return Buffer.from(bytes ?? []).toString("hex").toUpperCase();
}

function findExpectedCases(fixture) {
  return new Map((fixture.expected?.cases ?? []).map((item) => [item.name, item]));
}

function assertDiagnostics(caseName, kind, actualDiagnostics, expectedDiagnostics) {
  for (const [index, expected] of (expectedDiagnostics ?? []).entries()) {
    const actual = actualDiagnostics?.[index];
    assert(actual, `${caseName}: missing ${kind}[${index}]`);
    if (Object.hasOwn(expected, "message")) {
      assert(
        actual.message === expected.message,
        `${caseName}: ${kind}[${index}].message ${JSON.stringify(
          actual.message,
        )}, expected ${JSON.stringify(expected.message)}`,
      );
    }
    if (Object.hasOwn(expected, "messageContains")) {
      assert(
        actual.message?.includes(expected.messageContains),
        `${caseName}: ${kind}[${index}].message missing ${JSON.stringify(
          expected.messageContains,
        )}; actual ${JSON.stringify(actual.message)}`,
      );
    }
    if (Object.hasOwn(expected, "hint")) {
      assert(
        actual.hint === expected.hint,
        `${caseName}: ${kind}[${index}].hint ${JSON.stringify(actual.hint)}, expected ${JSON.stringify(
          expected.hint,
        )}`,
      );
    }
  }
}

function assertSld(caseName, actualSld, expected) {
  if (Object.hasOwn(expected, "sldContains")) {
    assert(typeof actualSld === "string", `${caseName}: missing SLD output`);
    for (const snippet of expected.sldContains ?? []) {
      assert(actualSld.includes(snippet), `${caseName}: SLD missing snippet ${JSON.stringify(snippet)}`);
    }
  }
}

function assertArtifacts(caseName, actualArtifacts, expected) {
  if (Object.hasOwn(expected, "artifactCount")) {
    assert(
      (actualArtifacts?.length ?? 0) === expected.artifactCount,
      `${caseName}: artifact count ${actualArtifacts?.length ?? 0}, expected ${expected.artifactCount}`,
    );
  }
  if (!Object.hasOwn(expected, "artifacts")) {
    return;
  }

  assert(
    (actualArtifacts?.length ?? 0) === expected.artifacts.length,
    `${caseName}: artifact count ${actualArtifacts?.length ?? 0}, expected ${expected.artifacts.length}`,
  );

  for (const [index, expectedArtifact] of expected.artifacts.entries()) {
    const actual = actualArtifacts?.[index];
    assert(actual, `${caseName}: missing artifact[${index}]`);
    for (const field of ["kind", "path", "start", "length"]) {
      if (Object.hasOwn(expectedArtifact, field)) {
        assert(
          actual[field] === expectedArtifact[field],
          `${caseName}: artifact[${index}].${field} ${JSON.stringify(actual[field])}, expected ${JSON.stringify(
            expectedArtifact[field],
          )}`,
        );
      }
    }
    if (Object.hasOwn(expectedArtifact, "bytesHex")) {
      assert(
        hex(actual.bytes) === expectedArtifact.bytesHex,
        `${caseName}: artifact[${index}] bytes mismatch`,
      );
    }
  }
}

function assertSymbols(caseName, actualSymbols, expectedSymbols) {
  for (const expected of expectedSymbols ?? []) {
    const actual = actualSymbols?.find((symbol) => symbol.name === expected.name);
    assert(actual, `${caseName}: missing symbol ${expected.name}`);
    if (Object.hasOwn(expected, "value")) {
      assert(
        actual.value === expected.value,
        `${caseName}: symbol ${expected.name} value ${actual.value}, expected ${expected.value}`,
      );
    }
  }
}

function assertCaseResult(testCase, result, expected) {
  assert(result.ok === expected.ok, `${testCase.name}: ok ${result.ok}, expected ${expected.ok}`);
  if (Object.hasOwn(expected, "errorCount")) {
    assert(
      (result.errors?.length ?? 0) === expected.errorCount,
      `${testCase.name}: error count ${result.errors?.length ?? 0}, expected ${expected.errorCount}`,
    );
  }
  if (Object.hasOwn(expected, "warningCount")) {
    assert(
      (result.warnings?.length ?? 0) === expected.warningCount,
      `${testCase.name}: warning count ${result.warnings?.length ?? 0}, expected ${expected.warningCount}`,
    );
  }
  if (Object.hasOwn(expected, "bytesHex")) {
    assert(hex(result.bytes) === expected.bytesHex, `${testCase.name}: emitted bytes mismatch`);
  }
  assertDiagnostics(testCase.name, "errors", result.errors, expected.errors);
  assertDiagnostics(testCase.name, "warnings", result.warnings, expected.warnings);
  assertSld(testCase.name, result.sld, expected);
  assertArtifacts(testCase.name, result.artifacts, expected);
  assertSymbols(testCase.name, result.symbols, expected.symbols);
}

async function assertWrittenOutputFiles(caseName, expectedFiles, outDir) {
  for (const expectedFile of expectedFiles ?? []) {
    const target = path.resolve(outDir, expectedFile.path);
    assertInsideTempDir(target, outDir);
    const actual = await readFile(target);
    assert(hex(actual) === expectedFile.bytesHex, `${caseName}: output file ${expectedFile.path} bytes mismatch`);
  }
}

async function assertWriteOutputs(testCase, result, expected, assembler, tempDir) {
  if (!testCase.writeOutputs && !Object.hasOwn(expected, "outputFiles")) {
    return;
  }
  assert(typeof assembler.writeAssemblyOutputs === "function", "assembler module must export writeAssemblyOutputs()");
  const options = replacePlaceholdersDeep(testCase.writeOutputs ?? {}, tempDir);
  assert(options.outDir, `${testCase.name}: writeOutputs.outDir is required`);
  const outputs = assembler.writeAssemblyOutputs(result, options);
  if (Object.hasOwn(expected, "outputArtifactCount")) {
    assert(
      (outputs.artifacts?.length ?? 0) === expected.outputArtifactCount,
      `${testCase.name}: written artifact count ${outputs.artifacts?.length ?? 0}, expected ${expected.outputArtifactCount}`,
    );
  }
  await assertWrittenOutputFiles(testCase.name, expected.outputFiles, options.outDir);
}

export async function runAssemblerApiFixtures({
  fixtures = defaultFixturePath,
  root = repoRoot,
  modulePath = null,
  skipBuild = false,
  quiet = false,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedFixtures = path.resolve(fixtures);
  const resolvedModule = modulePath ?? ensureDefaultModule(resolvedRoot, skipBuild);
  const assembler = await import(pathToFileURL(resolvedModule).href);
  assert(typeof assembler.assemble === "function", `${resolvedModule} must export assemble()`);

  const fixtureObjects = await loadFixtures(resolvedFixtures);
  const errors = [];
  let caseCount = 0;

  for (const fixture of fixtureObjects) {
    if (fixture.input?.kind !== "assembler-api") {
      continue;
    }
    const expectedByName = findExpectedCases(fixture);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-asm-api-"));
    try {
      await writeFixtureFiles(fixture.input.files, tempDir);
      for (const testCase of fixture.input.cases ?? []) {
        caseCount += 1;
        const expected = expectedByName.get(testCase.name);
        if (!expected) {
          errors.push(`${fixture.id}/${testCase.name}: missing expected case`);
          continue;
        }
        try {
          const options = replacePlaceholdersDeep(testCase.options ?? {}, tempDir);
          const result =
            testCase.mode === "assembleFile"
              ? (() => {
                  assert(
                    typeof assembler.assembleFile === "function",
                    `${resolvedModule} must export assembleFile()`,
                  );
                  return assembler.assembleFile(replacePlaceholders(testCase.entry, tempDir), options);
                })()
              : assembler.assemble(caseSource(testCase), options);
          assertCaseResult(testCase, result, expected);
          await assertWriteOutputs(testCase, result, expected, assembler, tempDir);
        } catch (error) {
          errors.push(`${fixture.id}/${error.message}`);
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  if (errors.length > 0) {
    console.error(`Assembler API fixtures: ${errors.length} failure(s)`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return { ok: false, cases: caseCount, errors };
  }

  if (!quiet) {
    console.log(`Assembler API fixtures: ${caseCount} case(s) passed`);
  }
  return { ok: true, cases: caseCount, errors: [] };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await runAssemblerApiFixtures(options);
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
