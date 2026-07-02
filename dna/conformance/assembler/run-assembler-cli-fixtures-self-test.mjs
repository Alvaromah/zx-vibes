#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-assembler-cli-fixtures.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(args) {
  return spawnSync(process.execPath, [runnerPath, ...args], {
    encoding: "utf8",
  });
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-asm-cli-self-test-"));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await withTempDir(async (dir) => {
  const fakeCli = path.join(dir, "fake-zxasm.mjs");
  await writeFile(
    fakeCli,
    [
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) { console.log('9.8.7'); process.exit(0); }",
      "if (args[0] === 'doctor') {",
      "  console.log(JSON.stringify({ ok: true, assembler: '@zx-vibes/asm', version: '9.8.7' }, null, 2));",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'disasm' && args.includes('--org') && args.includes('NaN')) {",
      "  console.error(\"error: Invalid origin: 'NaN' must be a 16-bit address\");",
      "  process.exit(1);",
      "}",
      "console.log('Usage: zxasm [options] [command]\\nassemble [options] <file>');",
    ].join("\n"),
    "utf8",
  );

  const fixture = {
    id: "ASM-CLI-SELF-TEST",
    tier: "contract",
    provenance: "contract",
    input: {
      kind: "assembler-cli",
      cases: [
        { name: "version", args: ["--version"] },
        { name: "doctor-json", args: ["doctor", "--json"] },
        { name: "bad-origin", args: ["disasm", "<tmp>/wrap.bin", "--org", "NaN"] },
      ],
    },
    expected: {
      cases: [
        { name: "version", status: 0, stdoutExact: "<VERSION>\n", stderrExact: "" },
        {
          name: "doctor-json",
          status: 0,
          stdoutContains: ["\"assembler\": \"@zx-vibes/asm\"", "\"version\": \"<VERSION>\""],
          stderrExact: "",
        },
        {
          name: "bad-origin",
          status: 1,
          stderrContains: ["Invalid origin: 'NaN' must be a 16-bit address"],
        },
      ],
    },
    normalization: { profile: "cli-snapshot" },
  };

  const fixturePath = path.join(dir, "fixture.json");
  await writeJson(fixturePath, fixture);

  const ok = run([
    "--fixtures",
    fixturePath,
    "--zxasm-command-json",
    JSON.stringify([process.execPath, fakeCli]),
    "--quiet",
  ]);
  assert(ok.status === 0, `expected fixture to pass\n${ok.stdout}\n${ok.stderr}`);

  fixture.expected.cases[0].stdoutExact = "wrong\n";
  const badFixturePath = path.join(dir, "bad-fixture.json");
  await writeJson(badFixturePath, fixture);
  const bad = run([
    "--fixtures",
    badFixturePath,
    "--zxasm-command-json",
    JSON.stringify([process.execPath, fakeCli]),
    "--quiet",
  ]);
  const badOutput = `${bad.stdout}\n${bad.stderr}`;
  assert(bad.status !== 0, "expected mismatch fixture to fail");
  assert(badOutput.includes("stdout mismatch"), "expected mismatch report to mention stdout mismatch");
});

console.log("Assembler CLI fixture self-test passed: command cases pass and mismatches fail.");
