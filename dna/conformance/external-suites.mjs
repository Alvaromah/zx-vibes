#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const VALID_EXECUTION_STATUS = new Set(["manifest-only", "executable"]);
const VALID_PASS_FAIL = new Set(["registry-only", "reference-suite"]);

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = thisDir;

function usage() {
  return [
    "Usage: node dna/conformance/external-suites.mjs [--root <path>] [--quiet]",
    "",
    "Validates pinned external-suite manifests under external/*.manifest.json.",
    "Vendored artifacts are hashed when a manifest marks them vendored.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    root: defaultRoot,
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

async function collectManifestFiles(directory) {
  if (!(await pathExists(directory))) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectManifestFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".manifest.json")) {
      files.push(entryPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function relativePath(root, file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function describe(file, root, suffix = "") {
  return `${relativePath(root, file)}${suffix}`;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateRequiredObject(value, file, root, field, errors) {
  if (!hasOwn(value, field)) {
    errors.push(`${describe(file, root)}: missing required field '${field}'`);
    return null;
  }
  if (!isPlainObject(value[field])) {
    errors.push(`${describe(file, root)}: '${field}' must be an object`);
    return null;
  }
  return value[field];
}

function validateRequiredString(value, file, root, field, errors, suffix = "") {
  if (!hasOwn(value, field)) {
    errors.push(`${describe(file, root, suffix)}: missing required field '${field}'`);
    return null;
  }
  if (typeof value[field] !== "string" || value[field].trim() === "") {
    errors.push(`${describe(file, root, suffix)}: '${field}' must be a non-empty string`);
    return null;
  }
  return value[field];
}

function validateProvenance(value) {
  return VALID_PROVENANCE.has(value) || /^decision:[A-Za-z0-9._-]+$/.test(value);
}

function validateId(value) {
  return /^[A-Z0-9-]+$/.test(value);
}

function validateSha256(value) {
  return /^[a-f0-9]{64}$/.test(value);
}

function validateRelativeArtifactPath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  if (path.isAbsolute(value)) {
    return false;
  }
  return !value.split(/[\\/]+/).some((part) => part === ".." || part === "");
}

async function fileSha256(file) {
  const bytes = await readFile(file);
  return createHash("sha256").update(bytes).digest("hex");
}

async function validateVendoredArtifact(artifact, file, root, index, errors) {
  const suffix = `.source.artifacts[${index}]`;
  const localPath = validateRequiredString(artifact, file, root, "localPath", errors, suffix);
  if (!localPath) {
    return 0;
  }
  if (!validateRelativeArtifactPath(localPath)) {
    errors.push(`${describe(file, root, suffix)}: 'localPath' must be a safe relative path`);
    return 0;
  }

  const artifactPath = path.resolve(path.dirname(file), localPath);
  const manifestDir = path.resolve(path.dirname(file));
  if (artifactPath !== manifestDir && !artifactPath.startsWith(`${manifestDir}${path.sep}`)) {
    errors.push(`${describe(file, root, suffix)}: 'localPath' escapes the manifest directory`);
    return 0;
  }

  let artifactStat;
  try {
    artifactStat = await stat(artifactPath);
  } catch (error) {
    errors.push(`${describe(file, root, suffix)}: vendored artifact missing at ${localPath}`);
    return 0;
  }

  if (!artifactStat.isFile()) {
    errors.push(`${describe(file, root, suffix)}: vendored artifact is not a file`);
    return 0;
  }
  if (artifactStat.size !== artifact.bytes) {
    errors.push(
      `${describe(file, root, suffix)}: vendored artifact size ${artifactStat.size} does not match ${artifact.bytes}`,
    );
  }

  const actualHash = await fileSha256(artifactPath);
  if (actualHash !== artifact.sha256) {
    errors.push(
      `${describe(file, root, suffix)}: vendored artifact sha256 ${actualHash} does not match ${artifact.sha256}`,
    );
  }
  return 1;
}

async function validateArtifact(artifact, file, root, index, errors) {
  const suffix = `.source.artifacts[${index}]`;
  if (!isPlainObject(artifact)) {
    errors.push(`${describe(file, root, suffix)}: artifact must be an object`);
    return 0;
  }

  const artifactPath = validateRequiredString(artifact, file, root, "path", errors, suffix);
  if (artifactPath && !validateRelativeArtifactPath(artifactPath)) {
    errors.push(`${describe(file, root, suffix)}: 'path' must be a safe relative path`);
  }

  if (!hasOwn(artifact, "bytes") || !Number.isInteger(artifact.bytes) || artifact.bytes <= 0) {
    errors.push(`${describe(file, root, suffix)}: 'bytes' must be a positive integer`);
  }

  const sha256 = validateRequiredString(artifact, file, root, "sha256", errors, suffix);
  if (sha256 && !validateSha256(sha256)) {
    errors.push(`${describe(file, root, suffix)}: 'sha256' must be lowercase 64-character hex`);
  }

  if (!hasOwn(artifact, "vendored") || typeof artifact.vendored !== "boolean") {
    errors.push(`${describe(file, root, suffix)}: 'vendored' must be a boolean`);
    return 0;
  }

  if (!artifact.vendored) {
    return 0;
  }
  return validateVendoredArtifact(artifact, file, root, index, errors);
}

async function validateManifestObject(manifest, file, root) {
  const errors = [];
  const counts = {
    vendoredArtifacts: 0,
    executableManifests: 0,
  };

  if (!isPlainObject(manifest)) {
    return {
      errors: [`${describe(file, root)}: manifest must be a JSON object`],
      counts,
    };
  }

  for (const field of ["id", "suite", "area", "tier", "provenance", "source", "execution"]) {
    if (!hasOwn(manifest, field)) {
      errors.push(`${describe(file, root)}: missing required field '${field}'`);
    }
  }

  const id = hasOwn(manifest, "id") ? manifest.id : null;
  if (typeof id !== "string" || id.trim() === "") {
    errors.push(`${describe(file, root)}: 'id' must be a non-empty string`);
  } else if (!validateId(id)) {
    errors.push(`${describe(file, root)}: 'id' must be stable uppercase kebab form`);
  }

  if (hasOwn(manifest, "suite") && (typeof manifest.suite !== "string" || manifest.suite.trim() === "")) {
    errors.push(`${describe(file, root)}: 'suite' must be a non-empty string`);
  }

  if (hasOwn(manifest, "area") && !VALID_AREAS.has(manifest.area)) {
    errors.push(`${describe(file, root)}: 'area' must be one of ${Array.from(VALID_AREAS).join(", ")}`);
  }

  if (hasOwn(manifest, "tier") && !VALID_TIERS.has(manifest.tier)) {
    errors.push(`${describe(file, root)}: 'tier' must be one of ${Array.from(VALID_TIERS).join(", ")}`);
  }

  if (hasOwn(manifest, "provenance")) {
    if (typeof manifest.provenance !== "string" || !validateProvenance(manifest.provenance)) {
      errors.push(`${describe(file, root)}: 'provenance' must use the approved provenance enumeration`);
    }
  }

  const source = validateRequiredObject(manifest, file, root, "source", errors);
  if (source) {
    for (const field of ["name", "url", "vcs", "commit", "license"]) {
      validateRequiredString(source, file, root, field, errors, ".source");
    }
    if (source.vcs && source.vcs !== "git") {
      errors.push(`${describe(file, root, ".source")}: 'vcs' must be git`);
    }
    if (source.commit && !/^[a-f0-9]{40}$/.test(source.commit)) {
      errors.push(`${describe(file, root, ".source")}: 'commit' must be lowercase 40-character git SHA`);
    }
    if (!Array.isArray(source.artifacts) || source.artifacts.length === 0) {
      errors.push(`${describe(file, root, ".source")}: 'artifacts' must be a non-empty array`);
    } else {
      for (const [index, artifact] of source.artifacts.entries()) {
        counts.vendoredArtifacts += await validateArtifact(artifact, file, root, index, errors);
      }
    }
  }

  const execution = validateRequiredObject(manifest, file, root, "execution", errors);
  if (execution) {
    const status = validateRequiredString(execution, file, root, "status", errors, ".execution");
    if (status && !VALID_EXECUTION_STATUS.has(status)) {
      errors.push(
        `${describe(file, root, ".execution")}: 'status' must be one of ${Array.from(
          VALID_EXECUTION_STATUS,
        ).join(", ")}`,
      );
    }
    if (status === "executable") {
      counts.executableManifests += 1;
    }

    const passFail = validateRequiredString(execution, file, root, "passFail", errors, ".execution");
    if (passFail && !VALID_PASS_FAIL.has(passFail)) {
      errors.push(
        `${describe(file, root, ".execution")}: 'passFail' must be one of ${Array.from(
          VALID_PASS_FAIL,
        ).join(", ")}`,
      );
    }

    const report = validateRequiredString(execution, file, root, "report", errors, ".execution");
    if (report && report.length < 20) {
      errors.push(`${describe(file, root, ".execution")}: 'report' must describe execution status`);
    }

    if (hasOwn(execution, "candidateCoverage")) {
      if (!Array.isArray(execution.candidateCoverage)) {
        errors.push(`${describe(file, root, ".execution")}: 'candidateCoverage' must be an array`);
      } else {
        for (const [index, coverageId] of execution.candidateCoverage.entries()) {
          if (typeof coverageId !== "string" || !validateId(coverageId)) {
            errors.push(
              `${describe(file, root, `.execution.candidateCoverage[${index}]`)}: coverage id must be uppercase kebab form`,
            );
          }
        }
      }
    }
  }

  return { errors, counts };
}

async function validateManifestFile(file, root) {
  const raw = await readFile(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      errors: [`${describe(file, root)}: invalid JSON: ${error.message}`],
      counts: { vendoredArtifacts: 0, executableManifests: 0 },
    };
  }

  return validateManifestObject(parsed, file, root);
}

export async function checkExternalSuites({ root = defaultRoot, quiet = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const manifestFiles = await collectManifestFiles(path.join(resolvedRoot, "external"));
  const errors = [];
  const counts = {
    vendoredArtifacts: 0,
    executableManifests: 0,
  };

  if (manifestFiles.length === 0) {
    errors.push("external: at least one external-suite manifest is required");
  }

  for (const manifestFile of manifestFiles) {
    const result = await validateManifestFile(manifestFile, resolvedRoot);
    errors.push(...result.errors);
    counts.vendoredArtifacts += result.counts.vendoredArtifacts;
    counts.executableManifests += result.counts.executableManifests;
  }

  if (errors.length > 0) {
    console.error(`External suites: ${errors.length} manifest error(s)`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return { ok: false, manifests: manifestFiles.length, errors, counts };
  }

  if (!quiet) {
    console.log(
      `External suites: ${manifestFiles.length} manifest(s) checked; ` +
        `${counts.vendoredArtifacts} vendored artifact(s) hashed; ` +
        `${counts.executableManifests} executable suite(s) declared`,
    );
  }

  return { ok: true, manifests: manifestFiles.length, errors: [], counts };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = await checkExternalSuites(options);
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
