#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const checkerPath = path.join(thisDir, "external-suites.mjs");
const helloSha256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(root) {
  return spawnSync(process.execPath, [checkerPath, "--root", root, "--quiet"], {
    encoding: "utf8",
  });
}

async function withTempRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-external-suites-"));
  try {
    await mkdir(path.join(root, "external"), { recursive: true });
    await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function manifest({ artifact = {}, execution = {}, provenance = "zexdoc" } = {}) {
  return {
    id: "EXT-SELF-TEST-001",
    suite: "self-test",
    area: "emulator",
    tier: "fidelity",
    provenance,
    source: {
      name: "self-test suite",
      url: "https://example.invalid/self-test",
      vcs: "git",
      commit: "0123456789abcdef0123456789abcdef01234567",
      license: "manual",
      artifacts: [
        {
          path: "payload.bin",
          bytes: 5,
          sha256: helloSha256,
          vendored: false,
          ...artifact,
        },
      ],
    },
    execution: {
      status: "manifest-only",
      passFail: "registry-only",
      report: "Self-test manifest validates registry-only external suite metadata.",
      candidateCoverage: ["EXT-SELF-TEST-001"],
      ...execution,
    },
  };
}

async function writeManifest(root, value) {
  await writeFile(
    path.join(root, "external", "self-test.manifest.json"),
    JSON.stringify(value, null, 2),
    "utf8",
  );
}

await withTempRoot(async (root) => {
  await writeManifest(root, manifest());
  const result = run(root);
  assert(result.status === 0, `manifest-only external suite should pass: ${result.stderr}`);
});

await withTempRoot(async (root) => {
  const value = manifest();
  delete value.provenance;
  await writeManifest(root, value);
  const result = run(root);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "manifest missing provenance should fail");
  assert(output.includes("missing required field 'provenance'"), "failure should name provenance");
});

await withTempRoot(async (root) => {
  await writeFile(path.join(root, "external", "payload.bin"), "hello", "utf8");
  await writeManifest(
    root,
    manifest({
      artifact: {
        vendored: true,
        localPath: "payload.bin",
      },
    }),
  );
  const result = run(root);
  assert(result.status === 0, `vendored artifact with matching hash should pass: ${result.stderr}`);
});

await withTempRoot(async (root) => {
  await writeFile(path.join(root, "external", "payload.bin"), "hello", "utf8");
  await writeManifest(
    root,
    manifest({
      artifact: {
        vendored: true,
        localPath: "payload.bin",
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    }),
  );
  const result = run(root);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "vendored artifact with wrong hash should fail");
  assert(output.includes("sha256"), "hash failure should mention sha256");
});

console.log(
  "External suite self-test passed: manifests validate; missing provenance and bad hashes fail.",
);
