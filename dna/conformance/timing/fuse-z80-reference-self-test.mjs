#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-fuse-z80.mjs");
const adapterPath = path.join(thisDir, "fuse-z80-reference-adapter.mjs");

const readmeText = "self-test FUSE README\n";
const testsInText = [
  "00_1",
  "0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 fffe 0000 0000",
  "00 00 0 0 0 0 4",
  "0000 00 -1",
  "-1",
  "",
  "37_1",
  "0001 0002 0003 0004 0005 0006 0007 0008 0009 000a fffe 0000 0000",
  "00 00 0 0 0 0 4",
  "0000 37 -1",
  "-1",
  "",
].join("\n");
const testsExpectedText = [
  "00_1",
  "0 MR 0000 00",
  "0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 fffe 0001 0000",
  "00 00 0 0 0 0 4",
  "-1",
  "",
  "37_1",
  "0 MR 0000 37",
  "0001 0002 0003 0004 0005 0006 0007 0008 0009 000a fffe 0001 0000",
  "00 00 0 0 0 0 4",
  "-1",
  "",
].join("\n");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function commandFor(...parts) {
  return parts.map((part) => `"${String(part).replaceAll('"', '\\"')}"`).join(" ");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runNode(script, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
  });
}

async function withTempRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-fuse-reference-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function writePayloads(root, { aligned = true } = {}) {
  const external = path.join(root, "external");
  const payloadDir = path.join(external, "payloads");
  await mkdir(payloadDir, { recursive: true });
  const expectedText = aligned
    ? testsExpectedText
    : testsExpectedText.replace("37_1", "37_mismatch");

  await writeFile(path.join(payloadDir, "README"), readmeText, "utf8");
  await writeFile(path.join(payloadDir, "tests.in"), testsInText, "utf8");
  await writeFile(path.join(payloadDir, "tests.expected"), expectedText, "utf8");

  await writeFile(
    path.join(external, "fuse-self-test.manifest.json"),
    JSON.stringify(
      {
        id: "EXT-FUSE-REFERENCE-SELF-TEST-001",
        suite: "fuse-reference-self-test",
        area: "emulator",
        tier: "fidelity",
        provenance: "fuse",
        source: {
          name: "FUSE reference self-test",
          url: "https://example.invalid/fuse-reference-self-test",
          vcs: "git",
          commit: "0123456789abcdef0123456789abcdef01234567",
          license: "manual",
          artifacts: [
            {
              path: "z80/tests/README",
              localPath: "payloads/README",
              bytes: Buffer.byteLength(readmeText),
              sha256: sha256(readmeText),
              vendored: true
            },
            {
              path: "z80/tests/tests.in",
              localPath: "payloads/tests.in",
              bytes: Buffer.byteLength(testsInText),
              sha256: sha256(testsInText),
              vendored: true
            },
            {
              path: "z80/tests/tests.expected",
              localPath: "payloads/tests.expected",
              bytes: Buffer.byteLength(expectedText),
              sha256: sha256(expectedText),
              vendored: true
            }
          ]
        },
        execution: {
          status: "executable",
          passFail: "reference-suite",
          report: "Self-test manifest for the FUSE Z80 reference transcript adapter.",
          candidateCoverage: ["TIM-CONTENTION-001"]
        }
      },
      null,
      2,
    ),
    "utf8",
  );
}

await withTempRoot(async (root) => {
  await writePayloads(root);
  const pass = runNode(runnerPath, [
    "--root",
    root,
    "--suite",
    "fuse-reference-self-test",
    "--resolve-payloads",
    "--reference",
    commandFor(process.execPath, adapterPath),
  ]);
  assert(pass.status === 0, `aligned transcript should pass: ${pass.stderr}`);
  assert(pass.stdout.includes("PASS EXT-FUSE-REFERENCE-SELF-TEST-001"), "pass output should name manifest");
  assert(pass.stdout.includes("tests=2"), "pass output should include test count");
});

await withTempRoot(async (root) => {
  await writePayloads(root, { aligned: false });
  const fail = runNode(runnerPath, [
    "--root",
    root,
    "--suite",
    "fuse-reference-self-test",
    "--resolve-payloads",
    "--reference",
    commandFor(process.execPath, adapterPath),
  ]);
  assert(fail.status === 1, "mismatched transcript should fail");
  assert(fail.stdout.includes("FAIL EXT-FUSE-REFERENCE-SELF-TEST-001"), "failure output should name manifest");
});

console.log("FUSE Z80 reference self-test passed: transcript adapter reports PASS and FAIL.");
