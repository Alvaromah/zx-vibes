#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");

function parseArgs(argv) {
  const options = {
    root: repoRoot,
    quiet: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--root requires a path");
      }
      options.root = path.resolve(value);
      index += 1;
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
    "Usage: node dna/conformance/distribution/distribution-bootstrap-check.mjs [--root <path>] [--quiet]",
    "",
    "Checks the thin distribution bootstrap gate: workspace shape, root scripts,",
    "and CI/release validation include the DNA conformance gate.",
  ].join("\n");
}

async function readText(root, relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function requireIncludes(errors, label, text, needle) {
  if (!text.includes(needle)) {
    errors.push(`${label}: missing ${needle}`);
  }
}

function requireScript(errors, scripts, name) {
  if (typeof scripts[name] !== "string" || scripts[name].trim() === "") {
    errors.push(`package.json: missing script '${name}'`);
  }
}

function commandOrder(text, commands) {
  let cursor = -1;
  for (const command of commands) {
    const index = text.indexOf(command, cursor + 1);
    if (index === -1) {
      return false;
    }
    cursor = index;
  }
  return true;
}

export async function checkDistributionBootstrap({ root = repoRoot, quiet = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const errors = [];
  const packageJson = JSON.parse(await readText(resolvedRoot, "package.json"));
  const workspace = await readText(resolvedRoot, "pnpm-workspace.yaml");
  const ci = await readText(resolvedRoot, ".github/workflows/ci.yml");
  const release = await readText(resolvedRoot, ".github/workflows/release.yml");

  if (packageJson.packageManager !== "pnpm@10.34.3") {
    errors.push("package.json: packageManager must pin pnpm@10.34.3");
  }
  for (const script of [
    "check:drift",
    "conformance:check",
    "build",
    "typecheck",
    "lint",
    "test",
    "pack",
    "verify",
  ]) {
    requireScript(errors, packageJson.scripts ?? {}, script);
  }
  if (
    typeof packageJson.scripts?.verify === "string" &&
    !commandOrder(packageJson.scripts.verify, [
      "pnpm run check:drift",
      "pnpm run conformance:check",
      "pnpm run build",
      "pnpm run typecheck",
      "pnpm run lint",
      "pnpm run test",
    ])
  ) {
    errors.push(
      "package.json: verify must run check:drift, conformance, build, typecheck, lint, test in order",
    );
  }

  requireIncludes(errors, "pnpm-workspace.yaml", workspace, '  - "packages/*"');
  requireIncludes(errors, "pnpm-workspace.yaml", workspace, "onlyBuiltDependencies:");
  requireIncludes(errors, "pnpm-workspace.yaml", workspace, "  - esbuild");

  for (const workflow of [
    { label: ".github/workflows/ci.yml", text: ci },
    { label: ".github/workflows/release.yml", text: release },
  ]) {
    requireIncludes(errors, workflow.label, workflow.text, "pnpm/action-setup@v4");
    requireIncludes(errors, workflow.label, workflow.text, "actions/setup-node@v4");
    requireIncludes(errors, workflow.label, workflow.text, "node-version: [20, 22]");
    requireIncludes(errors, workflow.label, workflow.text, "pnpm install --frozen-lockfile");
    requireIncludes(errors, workflow.label, workflow.text, "pnpm run conformance:check");
    requireIncludes(errors, workflow.label, workflow.text, "pnpm run build");
    requireIncludes(errors, workflow.label, workflow.text, "pnpm run typecheck");
    requireIncludes(errors, workflow.label, workflow.text, "pnpm run lint");
    requireIncludes(errors, workflow.label, workflow.text, "pnpm run test");
  }
  requireIncludes(
    errors,
    ".github/workflows/ci.yml",
    ci,
    "os: [ubuntu-latest, macos-latest, windows-latest]",
  );
  if (!commandOrder(ci, ["pnpm run check:drift", "pnpm run conformance:check", "pnpm run build"])) {
    errors.push(".github/workflows/ci.yml: conformance gate must run between drift checks and build");
  }
  if (
    !commandOrder(release, ["pnpm run check:drift", "pnpm run conformance:check", "pnpm run build"])
  ) {
    errors.push(".github/workflows/release.yml: conformance gate must run between drift checks and build");
  }

  if (errors.length > 0) {
    console.error(`Distribution bootstrap: ${errors.length} error(s)`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return { ok: false, errors };
  }

  if (!quiet) {
    console.log(
      "Distribution bootstrap check passed: workspace scripts and CI/release conformance gates are wired.",
    );
  }
  return { ok: true, errors: [] };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await checkDistributionBootstrap(options);
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
