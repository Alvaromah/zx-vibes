#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const zexRunner = path.join(thisDir, "cpu", "run-zex.mjs");
const fuseRunner = path.join(thisDir, "timing", "run-fuse-z80.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function commandFor(...parts) {
  return parts.map((part) => `"${String(part).replaceAll('"', '\\"')}"`).join(" ");
}

function runNode(script, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
  });
}

async function withTempDir(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-external-adapters-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

await withTempDir(async (root) => {
  const adapterPath = path.join(root, "adapter.mjs");
  await writeFile(
    adapterPath,
    [
      "const chunks = [];",
      "process.stdin.on('data', (chunk) => chunks.push(chunk));",
      "process.stdin.on('end', () => {",
      "  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
      "  const [mode, expectedKind] = process.argv.slice(2);",
      "  if (request.protocol !== process.env.ZX_VIBES_EXTERNAL_SUITE_PROTOCOL) {",
      "    console.log(JSON.stringify({ status: 'error', message: 'protocol mismatch' }));",
      "    return;",
      "  }",
      "  if (request.kind !== expectedKind) {",
      "    console.log(JSON.stringify({ status: 'fail', tests: 1, failures: 1, message: 'kind mismatch' }));",
      "    return;",
      "  }",
      "  if (!request.manifest?.source?.artifacts?.length) {",
      "    console.log(JSON.stringify({ status: 'error', message: 'missing artifacts' }));",
      "    return;",
      "  }",
      "  if (mode === 'pass') {",
      "    console.log(JSON.stringify({ status: 'pass', tests: 3, failures: 0, message: request.suite }));",
      "    return;",
      "  }",
      "  if (mode === 'fail') {",
      "    console.log(JSON.stringify({ status: 'fail', tests: 3, failures: 1, message: request.suite }));",
      "    return;",
      "  }",
      "  console.log('not-json');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const cpuPass = runNode(zexRunner, [
    "--suite",
    "zexdoc",
    "--reference",
    commandFor(process.execPath, adapterPath, "pass", "cpu-zex"),
  ]);
  assert(cpuPass.status === 0, `zex pass should exit 0: ${cpuPass.stderr}`);
  assert(cpuPass.stdout.includes("PASS EXT-ZEXDOC-001"), "zex pass should report PASS");

  const cpuFail = runNode(zexRunner, [
    "--suite",
    "zexall",
    "--reference",
    commandFor(process.execPath, adapterPath, "fail", "cpu-zex"),
  ]);
  assert(cpuFail.status === 1, "zex fail should exit 1");
  assert(cpuFail.stdout.includes("FAIL EXT-ZEXALL-001"), "zex fail should report FAIL");

  const cpuNotRun = runNode(zexRunner, ["--suite", "zexdoc"]);
  assert(cpuNotRun.status === 2, "zex without reference should exit 2");
  assert(cpuNotRun.stdout.includes("NOT_RUN"), "zex without reference should report NOT_RUN");

  const timingPass = runNode(fuseRunner, [
    "--json",
    "--reference",
    commandFor(process.execPath, adapterPath, "pass", "timing-fuse-z80"),
  ]);
  assert(timingPass.status === 0, `FUSE timing pass should exit 0: ${timingPass.stderr}`);
  const timingReport = JSON.parse(timingPass.stdout);
  assert(timingReport.status === "pass", "FUSE timing JSON should report pass");
  assert(timingReport.id === "EXT-FUSE-Z80-TESTS-001", "FUSE timing JSON should name manifest id");

  const timingBadAdapter = runNode(fuseRunner, [
    "--reference",
    commandFor(process.execPath, adapterPath, "bad-json", "timing-fuse-z80"),
  ]);
  assert(timingBadAdapter.status === 2, "bad adapter output should exit 2");
  assert(timingBadAdapter.stdout.includes("ERROR"), "bad adapter output should report ERROR");
});

console.log(
  "External adapter self-test passed: CPU and timing runners map PASS/FAIL/NOT_RUN/error.",
);
