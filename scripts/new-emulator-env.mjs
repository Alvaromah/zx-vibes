#!/usr/bin/env node
// new-emulator-env.mjs — package the CURRENT dna/ genome + the emulator harness
// template into a fresh, isolated clean-room environment in any target folder.
//
//   node scripts/new-emulator-env.mjs <target-dir> [--force] [--name <pkg-name>]
//
// It copies dna/ whole, drops the templated harness (AGENTS.md, package.json gates,
// README, rom/ + tapes/ placeholders, .gitignore), substitutes the project name and
// the DNA provenance (source commit + date), and writes dna.provenance.json so each
// environment records exactly which genome it was grown from.
//
// Portable: Node-only, resolves every path relative to this file, spawns no shell.
// The template lives at scripts/templates/emulator-env/ and is kept in sync with the
// genome by scripts/check-emulator-env-template.mjs (registered: .harness ADR-0017).
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const dnaDir = path.join(repoRoot, "dna");
const templateDir = path.join(scriptDir, "templates", "emulator-env");

// Text files that get {{TOKEN}} substitution. package.json is handled specially
// (parsed + name set), gitignore is renamed to .gitignore.
const TEXT_TEMPLATES = ["AGENTS.md", "README.md", "rom/README.md", "tapes/README.md"];

function fail(message) {
  console.error(`new-emulator-env: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { target: null, force: false, name: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force" || arg === "-f") opts.force = true;
    else if (arg === "--name") { opts.name = argv[++i] ?? fail("--name requires a value"); }
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("-")) fail(`unknown flag: ${arg}`);
    else if (!opts.target) opts.target = arg;
    else fail(`unexpected extra argument: ${arg}`);
  }
  return opts;
}

function isEmptyDir(dir) {
  try { return readdirSync(dir).length === 0; }
  catch (err) { if (err?.code === "ENOENT") return true; throw err; }
}

function exists(p) {
  try { statSync(p); return true; } catch { return false; }
}

function sanitizeName(raw) {
  // npm package name: lowercase, no spaces, safe chars.
  const cleaned = String(raw).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "zx-emulator-regen";
}

// Read the DNA source provenance via git; degrade gracefully if git is unavailable.
function dnaProvenance() {
  const git = (args) => {
    const r = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  return {
    sourceRepo: "zx-vibes-dna",
    commit: git(["rev-parse", "HEAD"]) ?? "unknown",
    commitShort: git(["rev-parse", "--short", "HEAD"]) ?? "unknown",
    commitDate: git(["log", "-1", "--format=%cI"]) ?? "unknown",
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "unknown",
    dnaDirty: git(["status", "--porcelain", "dna"]) ? true : false,
  };
}

function applyTokens(text, tokens) {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : whole,
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.target) {
    console.log("Usage: node scripts/new-emulator-env.mjs <target-dir> [--force] [--name <pkg-name>]");
    process.exit(opts.help ? 0 : 1);
  }
  if (!exists(dnaDir)) fail(`genome not found at ${dnaDir} (run from the zx-vibes-dna repo)`);
  if (!exists(templateDir)) fail(`template not found at ${templateDir}`);

  const target = path.resolve(process.cwd(), opts.target);
  if (target === repoRoot) fail("refusing to generate into the source repo itself");
  if (!opts.force && !isEmptyDir(target)) {
    fail(`target ${target} is not empty (use --force to overwrite)`);
  }

  const projectName = sanitizeName(opts.name ?? path.basename(target));
  const prov = dnaProvenance();
  const generatedDate = new Date().toISOString();
  const tokens = {
    PROJECT_NAME: projectName,
    DNA_COMMIT: prov.commitShort,
    DNA_COMMIT_DATE: prov.commitDate,
    GENERATED_DATE: generatedDate,
  };

  mkdirSync(target, { recursive: true });

  // 1. The genome — copied whole.
  cpSync(dnaDir, path.join(target, "dna"), { recursive: true });

  // 2. Text templates with token substitution.
  for (const rel of TEXT_TEMPLATES) {
    const src = path.join(templateDir, rel);
    const out = path.join(target, rel);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, applyTokens(readFileSync(src, "utf8"), tokens));
  }

  // 3. package.json — parse, set the project name, keep the gate scripts verbatim.
  const pkg = JSON.parse(readFileSync(path.join(templateDir, "package.json"), "utf8"));
  pkg.name = projectName;
  writeFileSync(path.join(target, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  // 4. gitignore -> .gitignore (so the source tree never treats it as a live ignore).
  writeFileSync(path.join(target, ".gitignore"), readFileSync(path.join(templateDir, "gitignore"), "utf8"));

  // 5. Ensure the host-asset folders exist even though their contents are gitignored.
  mkdirSync(path.join(target, "rom"), { recursive: true });
  mkdirSync(path.join(target, "tapes"), { recursive: true });

  // 6. Provenance stamp — which genome this environment was grown from.
  const provenance = {
    generator: "scripts/new-emulator-env.mjs",
    generatedAt: generatedDate,
    projectName,
    dna: prov,
  };
  writeFileSync(path.join(target, "dna.provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);

  const dnaFileCount = readdirSync(path.join(target, "dna"), { recursive: true }).length;
  console.log(`Created emulator regeneration environment at ${target}`);
  console.log(`  project name : ${projectName}`);
  console.log(`  dna source   : ${prov.sourceRepo}@${prov.commitShort} (${prov.commitDate})${prov.dnaDirty ? " [DIRTY]" : ""}`);
  console.log(`  dna entries  : ${dnaFileCount}`);
  if (prov.dnaDirty) {
    console.log("  WARNING: dna/ had uncommitted changes — provenance commit may not reflect the copied bytes.");
  }
  console.log("\nNext:");
  console.log(`  cd ${opts.target}`);
  console.log("  npm run conformance:self-test     # genome intact (green now)");
  console.log("  # then open AGENTS.md and build packages/ + web/ (see its Quick commands)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { sanitizeName, applyTokens, dnaProvenance };
