#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const payloadResolver = path.join(thisDir, "external-payloads.mjs");
const zexRunner = path.join(thisDir, "cpu", "run-zex.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
}

function runNode(script, args = []) {
  return run(process.execPath, [script, ...args]);
}

function commandFor(...parts) {
  return parts.map((part) => `"${String(part).replaceAll('"', '\\"')}"`).join(" ");
}

function git(args, cwd) {
  const result = run("git", args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function withTempRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-external-payloads-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function createSourceRepo(root) {
  const source = path.join(root, "source");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "payload.bin"), "hello", "utf8");
  git(["init", "--quiet"], source);
  git(["config", "user.email", "self-test@example.invalid"], source);
  git(["config", "user.name", "External Payload Self Test"], source);
  git(["add", "payload.bin"], source);
  git(["commit", "--quiet", "-m", "Add payload"], source);
  return {
    source,
    commit: git(["rev-parse", "HEAD"], source),
  };
}

async function writeManifest(root, { source, commit, artifactSha = sha256("hello") }) {
  const conformanceRoot = path.join(root, "conformance");
  await mkdir(path.join(conformanceRoot, "external"), { recursive: true });
  await writeFile(
    path.join(conformanceRoot, "external", "self-test.manifest.json"),
    JSON.stringify(
      {
        id: "EXT-PAYLOAD-SELF-TEST-001",
        suite: "self-test",
        area: "emulator",
        tier: "fidelity",
        provenance: "zexdoc",
        source: {
          name: "external payload self-test",
          url: source,
          vcs: "git",
          commit,
          license: "manual",
          artifacts: [
            {
              path: "payload.bin",
              bytes: 5,
              sha256: artifactSha,
              vendored: false,
            },
          ],
        },
        execution: {
          status: "manifest-only",
          passFail: "registry-only",
          report: "Self-test manifest for resolving a pinned git payload.",
          candidateCoverage: ["EXT-PAYLOAD-SELF-TEST-001"],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return conformanceRoot;
}

await withTempRoot(async (root) => {
  const cache = path.join(root, "cache");
  const { source, commit } = await createSourceRepo(root);
  const conformanceRoot = await writeManifest(root, { source, commit });

  const resolved = runNode(payloadResolver, [
    "--root",
    conformanceRoot,
    "--cache",
    cache,
    "--suite",
    "self-test",
    "--json",
  ]);
  assert(resolved.status === 0, `payload resolver should pass: ${resolved.stderr}`);
  const report = JSON.parse(resolved.stdout);
  assert(report.ok === true, "payload resolver JSON should report ok");
  assert(report.artifacts.length === 1, "payload resolver should return one artifact");
  await stat(report.artifacts[0].localPath);

  const offline = runNode(payloadResolver, [
    "--root",
    conformanceRoot,
    "--cache",
    cache,
    "--suite",
    "self-test",
    "--offline",
    "--quiet",
  ]);
  assert(offline.status === 0, `offline cache reuse should pass: ${offline.stderr}`);

  const badCache = path.join(root, "bad-cache");
  const badOffline = runNode(payloadResolver, [
    "--root",
    conformanceRoot,
    "--cache",
    badCache,
    "--suite",
    "self-test",
    "--offline",
    "--quiet",
  ]);
  assert(badOffline.status !== 0, "offline resolution without cache should fail");

  const adapterPath = path.join(root, "adapter.mjs");
  await writeFile(
    adapterPath,
    [
      "const chunks = [];",
      "process.stdin.on('data', (chunk) => chunks.push(chunk));",
      "process.stdin.on('end', () => {",
      "  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
      "  if (!request.payloads?.length) {",
      "    console.log(JSON.stringify({ status: 'error', message: 'missing payloads' }));",
      "    return;",
      "  }",
      "  if (request.payloads[0].sha256 !== request.manifest.source.artifacts[0].sha256) {",
      "    console.log(JSON.stringify({ status: 'fail', tests: 1, failures: 1, message: 'hash mismatch' }));",
      "    return;",
      "  }",
      "  console.log(JSON.stringify({ status: 'pass', tests: 1, failures: 0, message: request.payloads[0].path }));",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const adapterRun = runNode(zexRunner, [
    "--root",
    conformanceRoot,
    "--suite",
    "self-test",
    "--payload-cache",
    cache,
    "--resolve-payloads",
    "--reference",
    commandFor(process.execPath, adapterPath),
  ]);
  assert(adapterRun.status === 0, `adapter should receive resolved payloads: ${adapterRun.stderr}`);
  assert(adapterRun.stdout.includes("PASS EXT-PAYLOAD-SELF-TEST-001"), "adapter run should report PASS");

  const wrongShaRoot = path.join(root, "wrong-sha");
  const wrongShaConformance = await writeManifest(wrongShaRoot, {
    source,
    commit,
    artifactSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const wrongSha = runNode(payloadResolver, [
    "--root",
    wrongShaConformance,
    "--cache",
    path.join(root, "wrong-sha-cache"),
    "--suite",
    "self-test",
    "--quiet",
  ]);
  assert(wrongSha.status !== 0, "wrong artifact sha should fail");
});

console.log(
  "External payload self-test passed: pinned git artifacts resolve, verify, cache offline, and reach adapters.",
);
