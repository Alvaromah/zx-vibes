#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createDeterministicEnv } from "../determinism.mjs";
import { normalizeByProfile } from "../normalization.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultPlan = path.join(thisDir, "capture-plan.json");
const defaultOracleRoot = path.resolve(repoRoot, "..", "zx-vibes");
const defaultOut = path.join(repoRoot, ".cache", "oracle-captures");
const SCHEMA = "zx-vibes.oracle-capture.v1";

function parseArgs(argv) {
  const options = {
    plan: defaultPlan,
    oracleRoot: defaultOracleRoot,
    out: defaultOut,
    cases: [],
    allowDirty: false,
    allowOracleDrift: false,
    list: false,
    json: false,
    quiet: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plan") {
      options.plan = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--oracle-root") {
      options.oracleRoot = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--case") {
      options.cases.push(requireValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--allow-dirty") {
      options.allowDirty = true;
      continue;
    }
    if (arg === "--allow-oracle-drift") {
      options.allowOracleDrift = true;
      continue;
    }
    if (arg === "--list") {
      options.list = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
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

  options.plan = path.resolve(options.plan);
  options.oracleRoot = path.resolve(options.oracleRoot);
  options.out = path.resolve(options.out);
  return options;
}

function requireValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${arg} requires a value`);
  }
  return value;
}

function usage() {
  return [
    "Usage: node dna/conformance/oracle/oracle-capture.mjs [options]",
    "",
    "Runs the pinned oracle capture plan against ../zx-vibes by default.",
    "",
    "Options:",
    "  --plan <path>          capture plan JSON",
    "  --oracle-root <path>   oracle worktree root",
    "  --out <path>           output directory (default: .cache/oracle-captures)",
    "  --case <id>            run one case; repeatable",
    "  --allow-dirty          allow a dirty oracle worktree",
    "  --allow-oracle-drift   allow branch/commit different from the plan pin",
    "  --list                 list cases without capturing",
    "  --json                 emit JSON report",
    "  --quiet                suppress human report",
  ].join("\n");
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(text) {
  return sha256Bytes(Buffer.from(text, "utf8"));
}

function git(oracleRoot, args) {
  const result = spawnSync("git", args, {
    cwd: oracleRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in oracle: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function commandLabel(command) {
  return command.map((part) => JSON.stringify(part)).join(" ");
}

function ensureRelativePath(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty relative path`);
  }
  if (path.isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error(`${field} must stay inside the capture root`);
  }
  return value;
}

function resolveInside(root, relativePath, field) {
  const safe = ensureRelativePath(relativePath, field);
  const resolved = path.resolve(root, safe);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${field} escapes the capture root`);
  }
  return resolved;
}

function validatePlan(plan) {
  if (plan === null || Array.isArray(plan) || typeof plan !== "object") {
    throw new Error("capture plan must be a JSON object");
  }
  if (!Array.isArray(plan.cases)) {
    throw new Error("capture plan requires a cases array");
  }
  const ids = new Set();
  for (const entry of plan.cases) {
    if (!entry?.id || typeof entry.id !== "string") {
      throw new Error("each capture case requires a string id");
    }
    if (ids.has(entry.id)) {
      throw new Error(`duplicate capture case id: ${entry.id}`);
    }
    ids.add(entry.id);
    if (!["command", "file"].includes(entry.kind)) {
      throw new Error(`${entry.id}: kind must be command or file`);
    }
    if (!entry.tier || !entry.provenance) {
      throw new Error(`${entry.id}: tier and provenance are required`);
    }
    if (!entry.normalization?.profile) {
      throw new Error(`${entry.id}: normalization.profile is required`);
    }
    ensureRelativePath(entry.output, `${entry.id}.output`);
    if (entry.kind === "command") {
      if (!Array.isArray(entry.command) || entry.command.length === 0) {
        throw new Error(`${entry.id}: command cases require a command array`);
      }
      if (!entry.command.every((part) => typeof part === "string" && part !== "")) {
        throw new Error(`${entry.id}: command entries must be non-empty strings`);
      }
    }
    if (entry.kind === "file") {
      ensureRelativePath(entry.path, `${entry.id}.path`);
      if (entry.copyTo) {
        ensureRelativePath(entry.copyTo, `${entry.id}.copyTo`);
      }
    }
  }
}

async function loadPlan(planPath) {
  const raw = await readFile(planPath, "utf8");
  const plan = JSON.parse(raw);
  validatePlan(plan);
  return { plan, raw };
}

function selectedCases(plan, ids) {
  if (ids.length === 0) {
    return plan.cases;
  }
  const byId = new Map(plan.cases.map((entry) => [entry.id, entry]));
  return ids.map((id) => {
    const entry = byId.get(id);
    if (!entry) {
      throw new Error(`unknown capture case: ${id}`);
    }
    return entry;
  });
}

function inspectOracle(oracleRoot) {
  const commit = git(oracleRoot, ["rev-parse", "HEAD"]);
  const branch = git(oracleRoot, ["branch", "--show-current"]);
  const status = git(oracleRoot, ["status", "--porcelain"]);
  return {
    branch,
    commit,
    shortCommit: commit.slice(0, 7),
    dirty: status.length > 0,
    status,
  };
}

function enforceOraclePin(plan, oracle, options) {
  const expected = plan.oracle ?? {};
  if (!options.allowOracleDrift) {
    if (expected.expectedCommit && oracle.commit !== expected.expectedCommit) {
      throw new Error(
        `oracle commit ${oracle.commit} does not match plan pin ${expected.expectedCommit}`,
      );
    }
    if (expected.expectedBranch && oracle.branch !== expected.expectedBranch) {
      throw new Error(
        `oracle branch ${oracle.branch || "(detached)"} does not match plan pin ${expected.expectedBranch}`,
      );
    }
  }
  if (!options.allowDirty && expected.dirtyPolicy !== "allow" && oracle.dirty) {
    throw new Error("oracle worktree is dirty; commit or pass --allow-dirty for exploratory captures");
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(`${file}.tmp`, file);
}

async function captureCommand(entry, context) {
  const [command, ...args] = entry.command;
  const cwd = path.resolve(context.oracleRoot, entry.cwd ?? ".");
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: createDeterministicEnv(process.env),
    shell: false,
  });

  const exitCode = result.status === null ? 1 : result.status;
  const expectedExitCode = entry.expectedExitCode ?? 0;
  const stdout = normalizeByProfile(result.stdout ?? "", entry.normalization, {
    paths: [context.oracleRoot, context.out],
  });
  const stderr = normalizeByProfile(result.stderr ?? "", entry.normalization, {
    paths: [context.oracleRoot, context.out],
  });
  const record = {
    schema: SCHEMA,
    id: entry.id,
    kind: entry.kind,
    tier: entry.tier,
    provenance: entry.provenance,
    description: entry.description ?? "",
    oracle: {
      commit: context.oracle.commit,
      branch: context.oracle.branch,
    },
    command: {
      argv: entry.command,
      cwd: entry.cwd ?? ".",
      label: commandLabel(entry.command),
    },
    expectedExitCode,
    exitCode,
    stdout,
    stderr,
    stdoutSha256: sha256Text(stdout),
    stderrSha256: sha256Text(stderr),
    normalization: entry.normalization,
  };

  const output = resolveInside(context.out, entry.output, `${entry.id}.output`);
  await writeJson(output, record);

  if (exitCode !== expectedExitCode) {
    throw new Error(`${entry.id}: expected exit ${expectedExitCode}, got ${exitCode}`);
  }

  return {
    id: entry.id,
    kind: entry.kind,
    output: path.relative(context.out, output).replaceAll(path.sep, "/"),
    sha256: sha256Text(JSON.stringify(record)),
  };
}

async function captureFile(entry, context) {
  const source = path.resolve(context.oracleRoot, ensureRelativePath(entry.path, `${entry.id}.path`));
  const bytes = await readFile(source);
  const digest = sha256Bytes(bytes);
  let copyTo = null;

  if (entry.copyTo) {
    const copyPath = resolveInside(context.out, entry.copyTo, `${entry.id}.copyTo`);
    await mkdir(path.dirname(copyPath), { recursive: true });
    await copyFile(source, copyPath);
    copyTo = path.relative(context.out, copyPath).replaceAll(path.sep, "/");
  }

  const record = {
    schema: SCHEMA,
    id: entry.id,
    kind: entry.kind,
    tier: entry.tier,
    provenance: entry.provenance,
    description: entry.description ?? "",
    oracle: {
      commit: context.oracle.commit,
      branch: context.oracle.branch,
    },
    source: {
      path: entry.path,
    },
    bytes: bytes.length,
    sha256: digest,
    copyTo,
    normalization: entry.normalization,
  };

  const output = resolveInside(context.out, entry.output, `${entry.id}.output`);
  await writeJson(output, record);

  return {
    id: entry.id,
    kind: entry.kind,
    output: path.relative(context.out, output).replaceAll(path.sep, "/"),
    sha256: digest,
  };
}

async function writeManifest(context, planSha256, captures) {
  const manifest = {
    schema: SCHEMA,
    plan: {
      id: context.plan.id,
      sha256: planSha256,
    },
    oracle: {
      branch: context.oracle.branch,
      commit: context.oracle.commit,
      dirty: context.oracle.dirty,
    },
    captures,
  };
  const manifestPath = path.join(context.out, "manifest.json");
  await writeJson(manifestPath, manifest);
}

export async function runOracleCapture(rawOptions = {}) {
  const options = {
    plan: defaultPlan,
    oracleRoot: defaultOracleRoot,
    out: defaultOut,
    cases: [],
    allowDirty: false,
    allowOracleDrift: false,
    list: false,
    json: false,
    quiet: false,
    ...rawOptions,
  };
  options.plan = path.resolve(options.plan);
  options.oracleRoot = path.resolve(options.oracleRoot);
  options.out = path.resolve(options.out);

  const { plan, raw } = await loadPlan(options.plan);
  const cases = selectedCases(plan, options.cases ?? []);

  if (options.list) {
    const report = { plan: plan.id, cases: plan.cases.map(({ id, kind, description }) => ({ id, kind, description })) };
    emit(report, options);
    return report;
  }

  const oracle = inspectOracle(options.oracleRoot);
  enforceOraclePin(plan, oracle, options);
  const context = {
    plan,
    oracle,
    oracleRoot: options.oracleRoot,
    out: options.out,
  };
  await mkdir(options.out, { recursive: true });

  const captures = [];
  for (const entry of cases) {
    captures.push(
      entry.kind === "command"
        ? await captureCommand(entry, context)
        : await captureFile(entry, context),
    );
  }
  await writeManifest(context, sha256Text(raw), captures);

  const report = {
    ok: true,
    plan: plan.id,
    oracle: {
      branch: oracle.branch,
      commit: oracle.commit,
      dirty: oracle.dirty,
    },
    out: options.out,
    captures,
  };
  emit(report, options);
  return report;
}

function emit(report, options) {
  if (options.quiet) {
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (Array.isArray(report.cases)) {
    for (const entry of report.cases) {
      console.log(`${entry.id} ${entry.kind} ${entry.description ?? ""}`.trim());
    }
    return;
  }
  for (const entry of report.captures ?? []) {
    console.log(`CAPTURE ${entry.id} ${entry.kind} ${entry.output}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  await runOracleCapture(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
