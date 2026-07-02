#!/usr/bin/env node
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
const defaultFixturePath = path.join(thisDir, "cli-surface.json");

function usage() {
  return [
    "Usage: node dna/conformance/assembler/run-assembler-cli-fixtures.mjs [options]",
    "",
    "Options:",
    "  --fixtures <path>              Fixture JSON file (default: cli-surface.json)",
    "  --root <path>                  Repo root for the default zxasm build",
    "  --zxasm-command-json <json>    Command array override, e.g. [\"node\",\"fake.mjs\"]",
    "  --skip-build                   Do not build packages/asm before default execution",
    "  --quiet                        Suppress pass output",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    fixtures: defaultFixturePath,
    root: repoRoot,
    zxasmCommand: null,
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
    if (arg === "--zxasm-command-json") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--zxasm-command-json requires a JSON array");
      }
      options.zxasmCommand = JSON.parse(value);
      if (
        !Array.isArray(options.zxasmCommand) ||
        options.zxasmCommand.length === 0 ||
        options.zxasmCommand.some((part) => typeof part !== "string" || part.length === 0)
      ) {
        throw new Error("--zxasm-command-json must be a non-empty string array");
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

function ensureDefaultCommand(root, skipBuild) {
  const cliPath = path.join(root, "packages", "asm", "dist", "cli.js");
  if (!skipBuild) {
    const build = runProcess(
      "corepack",
      ["pnpm", "--filter", "@zx-vibes/asm", "run", "build"],
      {
        cwd: root,
        shell: true,
      },
    );
    if (build.status !== 0 || build.error) {
      throw new Error(
        [
          "failed to build @zx-vibes/asm before CLI conformance",
          build.error?.message,
          build.stdout,
          build.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
  if (!existsSync(cliPath)) {
    throw new Error(`built zxasm CLI does not exist: ${cliPath}`);
  }
  return [process.execPath, cliPath];
}

async function writeFixtureFiles(files, tempDir) {
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

function replacePlaceholders(value, tempDir) {
  return value.replaceAll("<tmp>", tempDir);
}

function normalizeOutput(output, fixture, tempDir, root) {
  return normalizeByProfile(output, fixture.normalization, {
    paths: [tempDir, root],
    tempDirs: [tempDir],
  });
}

function assertOutput(caseName, streamName, actual, expectation) {
  if (Object.hasOwn(expectation, `${streamName}Exact`)) {
    assert(
      actual === expectation[`${streamName}Exact`],
      `${caseName}: ${streamName} mismatch\nexpected: ${JSON.stringify(
        expectation[`${streamName}Exact`],
      )}\nactual: ${JSON.stringify(actual)}`,
    );
  }
  for (const snippet of expectation[`${streamName}Contains`] ?? []) {
    assert(
      actual.includes(snippet),
      `${caseName}: ${streamName} missing snippet ${JSON.stringify(snippet)}\nactual: ${actual}`,
    );
  }
}

async function loadFixture(file) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  if (Array.isArray(parsed)) {
    return parsed;
  }
  return [parsed];
}

export async function runAssemblerCliFixtures({
  fixtures = defaultFixturePath,
  root = repoRoot,
  zxasmCommand = null,
  skipBuild = false,
  quiet = false,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedFixtures = path.resolve(fixtures);
  const fixtureObjects = await loadFixture(resolvedFixtures);
  const command = zxasmCommand ?? ensureDefaultCommand(resolvedRoot, skipBuild);
  const executable = command[0];
  const prefixArgs = command.slice(1);
  const errors = [];
  let caseCount = 0;

  assert(await pathExists(executable), `zxasm executable does not exist: ${executable}`);

  for (const fixture of fixtureObjects) {
    if (fixture.input?.kind !== "assembler-cli") {
      continue;
    }
    const expectedByName = new Map((fixture.expected?.cases ?? []).map((item) => [item.name, item]));
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-asm-cli-"));
    try {
      await writeFixtureFiles(fixture.input.files, tempDir);
      for (const testCase of fixture.input.cases ?? []) {
        caseCount += 1;
        const expected = expectedByName.get(testCase.name);
        if (!expected) {
          errors.push(`${fixture.id}/${testCase.name}: missing expected case`);
          continue;
        }
        const args = [...prefixArgs, ...testCase.args.map((arg) => replacePlaceholders(arg, tempDir))];
        const result = runProcess(executable, args, { cwd: tempDir });
        if (result.error) {
          errors.push(`${fixture.id}/${testCase.name}: ${result.error.message}`);
          continue;
        }
        try {
          assert(
            result.status === expected.status,
            `${testCase.name}: status ${result.status}, expected ${expected.status}`,
          );
          const stdout = normalizeOutput(result.stdout, fixture, tempDir, resolvedRoot);
          const stderr = normalizeOutput(result.stderr, fixture, tempDir, resolvedRoot);
          assertOutput(testCase.name, "stdout", stdout, expected);
          assertOutput(testCase.name, "stderr", stderr, expected);
        } catch (error) {
          errors.push(`${fixture.id}/${error.message}`);
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  if (errors.length > 0) {
    console.error(`Assembler CLI fixtures: ${errors.length} failure(s)`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return { ok: false, cases: caseCount, errors };
  }

  if (!quiet) {
    console.log(`Assembler CLI fixtures: ${caseCount} case(s) passed`);
  }
  return { ok: true, cases: caseCount, errors: [] };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await runAssemblerCliFixtures(options);
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
