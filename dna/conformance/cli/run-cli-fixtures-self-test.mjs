#!/usr/bin/env node
// Self-test for the cli-fixtures runner (`run-cli-fixtures.mjs`). Mirrors the
// assembler CLI self-test: inject a FAKE `zxs` (so no real toolkit build/assembly
// is needed) and a synthetic fixture, then prove the runner (a) GREENS when the
// fake's exit + JSON satisfy `expected`, and (b) FAILS, with a descriptive
// message, when an expectation is wrong. Exercises every comparison path the real
// fixtures use: exit code (`exitCode` / `exitNonZero`), JSON subset (`json`), and
// a typed numeric field (`field` + `type` + `min`). Per-case materialization is
// proven via inline `files` — the fake reads the materialized `main.asm` from its
// cwd to distinguish cases that share a command.

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-cli-fixtures.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(args) {
  return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" });
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-cli-self-test-"));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await withTempDir(async (dir) => {
  // A fake `zxs`: reads the materialized project's main.asm from cwd to distinguish
  // cases, and emits a canned envelope + exit code per the leading subcommand.
  const fakeCli = path.join(dir, "fake-zxs.mjs");
  await writeFile(
    fakeCli,
    [
      "import { readFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "let src = '';",
      "try { src = readFileSync('main.asm', 'utf8'); } catch {}",
      "if (args.includes('verify')) {",
      "  if (src.includes('FAIL')) {",
      "    console.log(JSON.stringify({ ok: false, stage: 'verify', error: { message: 'boom', exitCode: 1 } }));",
      "    process.exit(1);",
      "  }",
      "  console.log(JSON.stringify({ ok: true, stage: 'verify', run: { stage: 'run' } }));",
      "  process.exit(0);",
      "}",
      "if (args.includes('run')) {",
      "  const edges = src.includes('BEEP') ? 7 : 0;",
      "  console.log(JSON.stringify({ ok: true, stage: 'run', status: 'ok', audio: { beeperEdges: edges } }));",
      "  process.exit(0);",
      "}",
      "console.error('fake-zxs: unrecognized command');",
      "process.exit(1);",
    ].join("\n"),
    "utf8",
  );

  const fakeCommand = JSON.stringify([process.execPath, fakeCli]);

  // Synthetic fixtures mirroring the real cli fixtures' shapes (exit + json + field),
  // but with inline `files` so the runner materializes a per-case project.
  const exitFixture = {
    id: "CLI-SELF-TEST-EXIT",
    tier: "contract",
    provenance: "contract",
    input: {
      kind: "cli-exit",
      cases: [
        { name: "ok-pass", command: "zxs verify --json", files: [{ path: "main.asm", data: "OK" }] },
        { name: "bad-fail", command: "zxs verify --json", files: [{ path: "main.asm", data: "FAIL" }] },
      ],
    },
    expected: {
      cases: [
        { name: "ok-pass", exitCode: 0, json: { ok: true, stage: "verify" } },
        { name: "bad-fail", exitNonZero: true, json: { ok: false, stage: "verify" } },
      ],
    },
    normalization: { profile: "cli-snapshot" },
  };
  const fieldFixture = {
    id: "CLI-SELF-TEST-FIELD",
    tier: "contract",
    provenance: "contract",
    input: {
      kind: "cli-json-field",
      cases: [
        { name: "beep", command: "zxs run --json", frames: 30, files: [{ path: "main.asm", data: "BEEP" }] },
      ],
    },
    expected: {
      cases: [{ name: "beep", field: "audio.beeperEdges", type: "integer", min: 0 }],
    },
    normalization: { profile: "cli-snapshot" },
  };

  const exitPath = path.join(dir, "exit-fixture.json");
  const fieldPath = path.join(dir, "field-fixture.json");
  await writeJson(exitPath, exitFixture);
  await writeJson(fieldPath, fieldFixture);

  const ok = run([
    "--fixtures",
    exitPath,
    "--fixtures",
    fieldPath,
    "--zxs-command-json",
    fakeCommand,
    "--skip-build",
    "--quiet",
  ]);
  assert(ok.status === 0, `expected the synthetic fixtures to pass\n${ok.stdout}\n${ok.stderr}`);

  // Failure path 1: a wrong JSON-subset expectation must be reported as a mismatch.
  const badJson = structuredClone(exitFixture);
  badJson.expected.cases[0].json = { ok: false, stage: "verify" }; // the pass case is ok:true
  const badJsonPath = path.join(dir, "bad-json-fixture.json");
  await writeJson(badJsonPath, badJson);
  const jsonFail = run([
    "--fixtures",
    badJsonPath,
    "--zxs-command-json",
    fakeCommand,
    "--skip-build",
    "--quiet",
  ]);
  const jsonFailOut = `${jsonFail.stdout}\n${jsonFail.stderr}`;
  assert(jsonFail.status !== 0, "expected a wrong JSON-subset expectation to fail");
  assert(jsonFailOut.includes("JSON mismatch"), `expected a 'JSON mismatch' report\n${jsonFailOut}`);

  // Failure path 2: a violated numeric field bound must be reported.
  const badField = structuredClone(fieldFixture);
  badField.expected.cases[0].min = 9999; // the fake reports beeperEdges: 7
  const badFieldPath = path.join(dir, "bad-field-fixture.json");
  await writeJson(badFieldPath, badField);
  const fieldFail = run([
    "--fixtures",
    badFieldPath,
    "--zxs-command-json",
    fakeCommand,
    "--skip-build",
    "--quiet",
  ]);
  const fieldFailOut = `${fieldFail.stdout}\n${fieldFail.stderr}`;
  assert(fieldFail.status !== 0, "expected a violated field bound to fail");
  assert(
    fieldFailOut.includes("expected >= 9999"),
    `expected a field-bound failure report\n${fieldFailOut}`,
  );
});

console.log("CLI fixture self-test passed: exit/json/field cases pass and mismatches fail.");
