#!/usr/bin/env node
// CLI-fixtures conformance runner for the regenerated `@zx-vibes/toolkit` (`zxs`).
//
// Backs the two `toolkit` coverage rows (CLI-EXIT-VERIFY-001, RUN-BEEPER-001) by
// executing the REGENERATED `zxs` against the cli fixtures and asserting the
// CONTRACT — exit code + JSON shape — never byte-for-byte legacy output
// (ADR-0013, ADR-0015). Mirrors the assembler CLI runner
// (`../assembler/run-assembler-cli-fixtures.mjs`): locate the bin (build on
// demand), spawn it per case, capture exit + stdout, normalize via the
// `cli-snapshot` profile, compare to `expected`, report pass/fail.
//
// The cli fixtures describe each scenario in PROSE (a passing project, a project
// with an assembly error, a beeper program) rather than carrying concrete files,
// so this runner MATERIALIZES a real project per case: a case may carry inline
// `files` (used by the self-test), otherwise the runner looks up a built-in
// scenario by case name (the materialization of the fixture's prose). The built-in
// programs mirror the regenerated toolkit's own verify/run tests.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDeterministicEnv } from "../determinism.mjs";
import { normalizeByProfile } from "../normalization.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultFixturePaths = [
  path.join(thisDir, "verify-exit.json"),
  path.join(thisDir, "run-beeper-edges.json"),
];

/** Fixture kinds this runner knows how to drive. */
const SUPPORTED_KINDS = new Set(["cli-exit", "cli-json-field"]);

// --- built-in scenario programs (mirror the toolkit's own verify/run tests) ---

// A clean HALT-synced game loop: border 2, writes RAM, idles. `run`.status === "ok",
// so `verify` passes (build + run, no failing tests). (toolkit verify.test.ts OK_MAIN)
const OK_MAIN = [
  "ORG 0x8000",
  "  ld sp, 0xFF00",
  "  ld a, 2",
  "  out (0xFE), a",
  "  ld a, 0x2A",
  "  ld (0x9000), a",
  "  im 1",
  "  ei",
  "main:",
  "  halt",
  "  jr main",
  "",
].join("\n");

// A duplicate label — an assembly error, so the build stage fails. (BAD_MAIN)
const BAD_MAIN = ["ORG 0x8000", "dup:", "dup:", "  ret", ""].join("\n");

// Toggles port 0xFE bit 4 (the speaker) AND makes RAM progress every iteration, so
// it produces beeper edges without tripping the hang watchdog. (run.test.ts BEEPER)
const BEEPER = [
  "ORG 0x8000",
  "loop:",
  "  ld a, 0x10",
  "  out (0xFE), a",
  "  ld hl, (0x9000)",
  "  inc hl",
  "  ld (0x9000), hl",
  "  ld a, 0x00",
  "  out (0xFE), a",
  "  jr loop",
  "",
].join("\n");

/** A minimal `zxs` project: `zx.config.json` (entry main.asm) + the entry program. */
function projectFiles(asm) {
  return [
    { path: "zx.config.json", data: JSON.stringify({ entry: "main.asm" }) },
    { path: "main.asm", data: asm },
  ];
}

/** The built-in materialization for a fixture case name, or null if unknown. */
function builtinScenarioFiles(name) {
  switch (name) {
    case "pass":
      return projectFiles(OK_MAIN);
    case "fail-build":
      return projectFiles(BAD_MAIN);
    case "beeper-program":
      return projectFiles(BEEPER);
    default:
      return null;
  }
}

// --- argument parsing --------------------------------------------------------

function usage() {
  return [
    "Usage: node dna/conformance/cli/run-cli-fixtures.mjs [options]",
    "",
    "Options:",
    "  --fixtures <path>           Fixture JSON file (repeatable; default: cli fixtures)",
    "  --root <path>               Repo root for the default zxs build",
    "  --zxs-command-json <json>   Command array override, e.g. [\"node\",\"fake.mjs\"]",
    "  --skip-build                Do not build packages/toolkit before execution",
    "  --quiet                     Suppress pass output",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    fixtures: [],
    root: repoRoot,
    zxsCommand: null,
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
      options.fixtures.push(path.resolve(value));
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
    if (arg === "--zxs-command-json") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--zxs-command-json requires a JSON array");
      }
      options.zxsCommand = JSON.parse(value);
      if (
        !Array.isArray(options.zxsCommand) ||
        options.zxsCommand.length === 0 ||
        options.zxsCommand.some((part) => typeof part !== "string" || part.length === 0)
      ) {
        throw new Error("--zxs-command-json must be a non-empty string array");
      }
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
  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    env: createDeterministicEnv({
      ...process.env,
      ...(options.env ?? {}),
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    }),
    shell: useShell,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

async function pathExists(candidate) {
  try {
    await readFile(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** Build the regenerated toolkit (unless skipped) and return `[node, bin/zxs.js]`. */
function ensureDefaultCommand(root, skipBuild) {
  const binPath = path.join(root, "packages", "toolkit", "bin", "zxs.js");
  if (!skipBuild) {
    const build = runProcess(
      "corepack",
      ["pnpm", "--filter", "@zx-vibes/toolkit", "run", "build"],
      {
        cwd: root,
        shell: true,
      },
    );
    if (build.status !== 0 || build.error) {
      throw new Error(
        [
          "failed to build @zx-vibes/toolkit before CLI conformance",
          build.error?.message,
          build.stdout,
          build.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
  if (!existsSync(binPath)) {
    throw new Error(`built zxs CLI does not exist: ${binPath}`);
  }
  return [process.execPath, binPath];
}

async function writeProjectFiles(files, tempDir) {
  for (const file of files ?? []) {
    const target = path.join(tempDir, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    if (file.encoding === "hex") {
      await writeFile(target, Buffer.from(file.data, "hex"));
      continue;
    }
    if (file.encoding === "utf8" || !file.encoding) {
      await writeFile(target, file.data ?? "", "utf8");
      continue;
    }
    throw new Error(`unsupported fixture file encoding '${file.encoding}' for ${file.path}`);
  }
}

/** Split a fixture `command` ("zxs verify --json") into argv after the bin name. */
function commandArgs(command) {
  const parts = String(command ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts[0] === "zxs" || parts[0] === "zx-vibes") {
    parts.shift();
  }
  return parts;
}

/** Walk a dotted field path ("audio.beeperEdges") in a parsed JSON envelope. */
function navigateField(value, fieldPath) {
  let current = value;
  for (const key of fieldPath.split(".")) {
    if (current === null || typeof current !== "object" || !(key in current)) {
      throw new Error(`field '${fieldPath}' is not present in the JSON output`);
    }
    current = current[key];
  }
  return current;
}

/** A JSON value matches `expected` iff every expected key/value is present (recursive subset). */
function matchesSubset(actual, expected, fieldPath = "") {
  if (expected === null || typeof expected !== "object") {
    return actual === expected
      ? null
      : `${fieldPath || "value"} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
  }
  if (actual === null || typeof actual !== "object") {
    return `${fieldPath || "value"} is ${JSON.stringify(actual)}, expected an object`;
  }
  for (const key of Object.keys(expected)) {
    const childPath = fieldPath ? `${fieldPath}.${key}` : key;
    if (!(key in actual)) {
      return `${childPath} is missing`;
    }
    const error = matchesSubset(actual[key], expected[key], childPath);
    if (error) {
      return error;
    }
  }
  return null;
}

function checkType(value, type) {
  switch (type) {
    case undefined:
      return true;
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      throw new Error(`unsupported expected.type '${type}'`);
  }
}

/** Assert a case's actual exit + (normalized) JSON stdout against its `expected` row. */
function checkExpectation(caseName, expected, status, stdout) {
  if (Object.hasOwn(expected, "exitCode")) {
    assert(
      status === expected.exitCode,
      `${caseName}: exit ${status}, expected ${expected.exitCode}`,
    );
  }
  if (expected.exitNonZero) {
    assert(status !== 0, `${caseName}: expected a non-zero exit, got ${status}`);
  }

  const needsJson = expected.json !== undefined || expected.field !== undefined;
  if (!needsJson) {
    return;
  }

  let json;
  try {
    json = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `${caseName}: stdout is not a single JSON envelope (${error.message})\nstdout: ${stdout}`,
    );
  }

  if (expected.json !== undefined) {
    const mismatch = matchesSubset(json, expected.json);
    assert(
      mismatch === null,
      `${caseName}: JSON mismatch: ${mismatch}\nactual: ${JSON.stringify(json)}`,
    );
  }

  if (expected.field !== undefined) {
    const value = navigateField(json, expected.field);
    assert(
      checkType(value, expected.type),
      `${caseName}: field '${expected.field}' is ${JSON.stringify(value)}, expected type ${expected.type}`,
    );
    if (Object.hasOwn(expected, "min")) {
      assert(
        typeof value === "number" && value >= expected.min,
        `${caseName}: field '${expected.field}' is ${JSON.stringify(value)}, expected >= ${expected.min}`,
      );
    }
    if (Object.hasOwn(expected, "max")) {
      assert(
        typeof value === "number" && value <= expected.max,
        `${caseName}: field '${expected.field}' is ${JSON.stringify(value)}, expected <= ${expected.max}`,
      );
    }
  }
}

async function loadFixture(file) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  return Array.isArray(parsed) ? parsed : [parsed];
}

export async function runCliFixtures({
  fixtures = [],
  root = repoRoot,
  zxsCommand = null,
  skipBuild = false,
  quiet = false,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const fixturePaths = (fixtures.length > 0 ? fixtures : defaultFixturePaths).map((file) =>
    path.resolve(file),
  );
  const fixtureObjects = (await Promise.all(fixturePaths.map(loadFixture))).flat();
  const command = zxsCommand ?? ensureDefaultCommand(resolvedRoot, skipBuild);
  const executable = command[0];
  const prefixArgs = command.slice(1);
  const errors = [];
  let caseCount = 0;

  assert(await pathExists(executable), `zxs executable does not exist: ${executable}`);

  for (const fixture of fixtureObjects) {
    if (!SUPPORTED_KINDS.has(fixture.input?.kind)) {
      continue;
    }
    const expectedByName = new Map(
      (fixture.expected?.cases ?? []).map((item) => [item.name, item]),
    );

    for (const testCase of fixture.input.cases ?? []) {
      caseCount += 1;
      const expected = expectedByName.get(testCase.name);
      if (!expected) {
        errors.push(`${fixture.id}/${testCase.name}: missing expected case`);
        continue;
      }

      const files = testCase.files ?? builtinScenarioFiles(testCase.name);
      if (!files) {
        errors.push(
          `${fixture.id}/${testCase.name}: no inline files and no built-in scenario for this case name`,
        );
        continue;
      }

      const tempDir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-cli-"));
      try {
        await writeProjectFiles(files, tempDir);
        const args = [...prefixArgs, ...commandArgs(testCase.command)];
        if (testCase.frames !== undefined && !args.includes("--frames")) {
          args.push("--frames", String(testCase.frames));
        }
        const result = runProcess(executable, args, { cwd: tempDir });
        if (result.error) {
          errors.push(`${fixture.id}/${testCase.name}: ${result.error.message}`);
          continue;
        }
        const stdout = normalizeByProfile(result.stdout, fixture.normalization, {
          paths: [tempDir, resolvedRoot],
          tempDirs: [tempDir],
        });
        checkExpectation(testCase.name, expected, result.status, stdout);
      } catch (error) {
        errors.push(`${fixture.id}/${error.message}`);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  }

  if (errors.length > 0) {
    console.error(`CLI fixtures: ${errors.length} failure(s)`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return { ok: false, cases: caseCount, errors };
  }

  if (!quiet) {
    console.log(`CLI fixtures: ${caseCount} case(s) passed`);
  }
  return { ok: true, cases: caseCount, errors: [] };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await runCliFixtures(options);
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
