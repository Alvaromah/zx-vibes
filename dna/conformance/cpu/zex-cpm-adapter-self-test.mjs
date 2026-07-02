#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-zex.mjs");
const adapterPath = path.join(thisDir, "zex-cpm-adapter.mjs");

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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function zexStyleCom(message) {
  const text = Buffer.from(`${message}$`, "ascii");
  const messageAddress = 0x010b;
  return Buffer.concat([
    Buffer.from([
      0x11,
      messageAddress & 0xff,
      messageAddress >> 8,
      0x0e,
      0x09,
      0xcd,
      0x05,
      0x00,
      0xc3,
      0x00,
      0x00,
    ]),
    text,
  ]);
}

const passCom = zexStyleCom("Z80 instruction exerciser\r\nTests complete");
const failCom = zexStyleCom("Z80 instruction exerciser\r\n  ERROR **** crc expected:00000000 found:ffffffff");
const loopCom = Buffer.from([0xc3, 0x00, 0x01]);

async function withTempRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-zex-cpm-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function writeManifest(root, { suite, id, payload }) {
  const external = path.join(root, "external");
  const payloadDir = path.join(external, "payloads");
  await mkdir(payloadDir, { recursive: true });
  await writeFile(path.join(payloadDir, `${suite}.com`), payload);
  await writeFile(
    path.join(external, `${suite}.manifest.json`),
    JSON.stringify(
      {
        id,
        suite,
        area: "emulator",
        tier: "fidelity",
        provenance: "zexdoc",
        source: {
          name: "zex CP/M adapter self-test",
          url: "https://example.invalid/zex-cpm-adapter-self-test",
          vcs: "git",
          commit: "0123456789abcdef0123456789abcdef01234567",
          license: "manual",
          artifacts: [
            {
              path: `${suite}.com`,
              localPath: `payloads/${suite}.com`,
              bytes: payload.length,
              sha256: sha256(payload),
              vendored: true,
            },
          ],
        },
        execution: {
          status: "executable",
          passFail: "reference-suite",
          report: "Self-test manifest for CP/M zex-style console classification.",
          candidateCoverage: ["CPU-ZEXDOC-001"],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

await withTempRoot(async (root) => {
  await writeManifest(root, {
    suite: "zex-cpm-pass",
    id: "EXT-ZEX-CPM-PASS-001",
    payload: passCom,
  });
  const pass = runNode(runnerPath, [
    "--root",
    root,
    "--suite",
    "zex-cpm-pass",
    "--resolve-payloads",
    "--reference",
    commandFor(process.execPath, adapterPath),
  ]);
  assert(pass.status === 0, `zex-style pass COM should exit 0: ${pass.stderr}`);
  assert(pass.stdout.includes("PASS EXT-ZEX-CPM-PASS-001"), "pass output should name manifest");
});

await withTempRoot(async (root) => {
  await writeManifest(root, {
    suite: "zex-cpm-fail",
    id: "EXT-ZEX-CPM-FAIL-001",
    payload: failCom,
  });
  const fail = runNode(runnerPath, [
    "--root",
    root,
    "--suite",
    "zex-cpm-fail",
    "--resolve-payloads",
    "--reference",
    commandFor(process.execPath, adapterPath),
  ]);
  assert(fail.status === 1, "zex-style ERROR transcript should exit 1");
  assert(fail.stdout.includes("FAIL EXT-ZEX-CPM-FAIL-001"), "failure output should name manifest");
});

await withTempRoot(async (root) => {
  await writeManifest(root, {
    suite: "zex-cpm-loop",
    id: "EXT-ZEX-CPM-LOOP-001",
    payload: loopCom,
  });
  const notRun = runNode(runnerPath, [
    "--root",
    root,
    "--suite",
    "zex-cpm-loop",
    "--resolve-payloads",
    "--reference",
    commandFor(process.execPath, adapterPath, "--max-instructions", "25"),
  ]);
  assert(notRun.status === 2, "instruction limit should exit 2");
  assert(notRun.stdout.includes("NOT_RUN EXT-ZEX-CPM-LOOP-001"), "limit output should report NOT_RUN");
});

console.log("ZEX CP/M adapter self-test passed: PASS, FAIL, and NOT_RUN transcripts classify correctly.");
