#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-assembler-corpus-fixtures.mjs");

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
  const dir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-asm-corpus-self-test-"));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await withTempDir(async (dir) => {
  const fakeModule = path.join(dir, "fake-assembler.mjs");
  await writeFile(
    fakeModule,
    [
      "import { readFileSync } from 'node:fs';",
      "export function assembleFile(entry) {",
      "  const source = readFileSync(entry, 'utf8');",
      "  if (source.includes('FAIL')) {",
      "    return { ok: false, errors: [{ message: 'fixture requested failure' }] };",
      "  }",
      "  return { ok: true, bytes: new Uint8Array([0x00]), errors: [], warnings: [] };",
      "}",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(dir, "src", "one.asm"), "    ORG 0x8000\n    db 1\n", "utf8");
  await writeFile(path.join(dir, "src", "two.asm"), "    ORG 0x8000\n    db 2\n", "utf8");
  await writeFile(path.join(dir, "src", "bad.asm"), "FAIL\n", "utf8");

  const fixture = {
    id: "ASM-CORPUS-SELF-TEST",
    tier: "contract",
    provenance: "contract",
    input: {
      kind: "assembler-corpus",
      entries: ["src/one.asm", "src/two.asm"],
    },
    expected: {
      ok: true,
      count: 2,
    },
    normalization: { profile: "json" },
  };

  const fixturePath = path.join(dir, "corpus.json");
  await writeJson(fixturePath, fixture);
  const ok = run(["--fixtures", fixturePath, "--root", dir, "--module", fakeModule, "--skip-build", "--quiet"]);
  assert(ok.status === 0, `expected corpus fixture to pass\n${ok.stdout}\n${ok.stderr}`);

  fixture.input.entries = ["src/one.asm", "src/bad.asm"];
  const badPath = path.join(dir, "bad-corpus.json");
  await writeJson(badPath, fixture);
  const bad = run(["--fixtures", badPath, "--root", dir, "--module", fakeModule, "--skip-build", "--quiet"]);
  const badOutput = `${bad.stdout}\n${bad.stderr}`;
  assert(bad.status !== 0, "expected failing corpus source to fail");
  assert(badOutput.includes("src/bad.asm"), "expected failing path in corpus report");
});

console.log("Assembler corpus fixture self-test passed: corpus sources pass and failures are reported.");
