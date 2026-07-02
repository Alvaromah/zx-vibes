#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkExternalSuites } from "./external-suites.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = thisDir;
const defaultCache = path.resolve(thisDir, "..", "..", ".cache", "external-suites");

function usage() {
  return [
    "Usage: node dna/conformance/external-payloads.mjs [--root <path>] [--cache <path>] [--suite <suite>] [--offline] [--json] [--quiet]",
    "",
    "Materializes pinned external-suite artifacts into an untracked cache.",
    "Artifacts are read from the manifest git commit and verified by size + SHA-256.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    root: defaultRoot,
    cache: defaultCache,
    suite: null,
    offline: false,
    json: false,
    quiet: false,
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
    if (arg === "--cache") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--cache requires a path");
      }
      options.cache = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--suite") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--suite requires a suite id");
      }
      options.suite = value;
      index += 1;
      continue;
    }
    if (arg === "--offline") {
      options.offline = true;
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

async function loadManifests(root, suite) {
  const manifestFiles = await collectManifestFiles(path.join(root, "external"));
  const manifests = [];

  for (const file of manifestFiles) {
    const manifest = JSON.parse(await readFile(file, "utf8"));
    if (!suite || manifest.suite === suite) {
      manifests.push({ manifest, file });
    }
  }

  if (suite && manifests.length === 0) {
    throw new Error(`external suite manifest not found for '${suite}'`);
  }

  return manifests;
}

function safeSegment(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function git(args, { cwd = undefined, input = undefined, encoding = "utf8" } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    input,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
    throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  }
  return result.stdout;
}

async function fileSha256(file) {
  const bytes = await readFile(file);
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifyArtifact(file, artifact) {
  const artifactStat = await stat(file);
  if (!artifactStat.isFile()) {
    throw new Error(`${file} is not a file`);
  }
  if (artifactStat.size !== artifact.bytes) {
    throw new Error(`${file} has ${artifactStat.size} bytes; expected ${artifact.bytes}`);
  }
  const actualHash = await fileSha256(file);
  if (actualHash !== artifact.sha256) {
    throw new Error(`${file} has sha256 ${actualHash}; expected ${artifact.sha256}`);
  }
}

async function cachedArtifact(cache, manifest, artifact) {
  return path.join(cache, "artifacts", safeSegment(manifest.id), ...artifact.path.split("/"));
}

async function ensureRepository(cache, manifest, offline) {
  const repoDir = path.join(cache, "repositories", safeSegment(manifest.id));
  if (await pathExists(path.join(repoDir, ".git"))) {
    return repoDir;
  }

  if (offline) {
    throw new Error(`${manifest.id}: repository is not cached and --offline was set`);
  }

  await mkdir(path.dirname(repoDir), { recursive: true });
  git(["clone", "--quiet", "--no-checkout", manifest.source.url, repoDir]);
  return repoDir;
}

function repositoryHasCommit(repoDir, commit) {
  const result = spawnSync("git", ["-C", repoDir, "cat-file", "-e", `${commit}^{commit}`], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function ensureCommit(repoDir, manifest, offline) {
  if (repositoryHasCommit(repoDir, manifest.source.commit)) {
    return;
  }

  if (offline) {
    throw new Error(`${manifest.id}: commit ${manifest.source.commit} is not cached and --offline was set`);
  }

  git(["-C", repoDir, "fetch", "--quiet", "origin", manifest.source.commit]);
}

async function materializeFromGit({ cache, manifest, artifact, offline }) {
  const target = await cachedArtifact(cache, manifest, artifact);
  if (await pathExists(target)) {
    await verifyArtifact(target, artifact);
    return {
      status: "cached",
      localPath: target,
    };
  }

  const repoDir = await ensureRepository(cache, manifest, offline);
  ensureCommit(repoDir, manifest, offline);
  const blob = git(["-C", repoDir, "show", `${manifest.source.commit}:${artifact.path}`], {
    encoding: "buffer",
  });

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, blob);
  await verifyArtifact(target, artifact);
  return {
    status: "resolved",
    localPath: target,
  };
}

async function resolveArtifact({ cache, manifest, manifestFile, artifact, offline }) {
  if (artifact.vendored) {
    const localPath = path.resolve(path.dirname(manifestFile), artifact.localPath);
    await verifyArtifact(localPath, artifact);
    return {
      id: manifest.id,
      suite: manifest.suite,
      path: artifact.path,
      localPath,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      status: "vendored",
    };
  }

  const materialized = await materializeFromGit({ cache, manifest, artifact, offline });
  return {
    id: manifest.id,
    suite: manifest.suite,
    path: artifact.path,
    localPath: materialized.localPath,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    status: materialized.status,
  };
}

export async function resolveExternalPayloads({
  root = defaultRoot,
  cache = defaultCache,
  suite = null,
  offline = false,
  quiet = false,
  json = false,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedCache = path.resolve(cache);
  const errors = [];
  const artifacts = [];

  const manifestCheck = await checkExternalSuites({ root: resolvedRoot, quiet: true });
  if (!manifestCheck.ok) {
    errors.push(...manifestCheck.errors);
  }

  if (errors.length === 0) {
    try {
      const manifests = await loadManifests(resolvedRoot, suite);
      for (const { manifest, file } of manifests) {
        for (const artifact of manifest.source.artifacts) {
          artifacts.push(
            await resolveArtifact({
              cache: resolvedCache,
              manifest,
              manifestFile: file,
              artifact,
              offline,
            }),
          );
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const result = {
    ok: errors.length === 0,
    suite,
    cache: resolvedCache,
    artifacts,
    errors,
  };

  if (!quiet) {
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      const suiteLabel = suite ? ` for suite ${suite}` : "";
      console.log(`External payloads: ${artifacts.length} artifact(s) ready${suiteLabel}`);
    } else {
      console.error(`External payloads: ${errors.length} error(s)`);
      for (const error of errors) {
        console.error(`- ${error}`);
      }
    }
  }

  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = await resolveExternalPayloads(options);
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
