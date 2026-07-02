#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "runner.mjs");

function run(root) {
  return spawnSync(process.execPath, [runnerPath, "--root", root, "--quiet"], {
    encoding: "utf8",
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function withTempRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-conformance-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

await withTempRoot(async (root) => {
  const result = run(root);
  assert(result.status === 0, `empty suite should pass, got ${result.status}`);
});

await withTempRoot(async (root) => {
  const fixtureDir = path.join(root, "assembler");
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(
    path.join(fixtureDir, "bad-fixture.json"),
    JSON.stringify(
      {
        id: "BAD-001",
        tier: "contract",
        provenance: "contract",
        input: {},
        normalization: { profile: "none" },
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = run(root);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "malformed fixture should fail");
  assert(
    output.includes("missing required field 'expected'"),
    "malformed fixture should report the missing expected field",
  );
});

console.log("Conformance self-test passed: empty suite green; malformed fixture rejected.");
