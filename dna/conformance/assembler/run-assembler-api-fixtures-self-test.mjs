#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-assembler-api-fixtures.mjs");

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
  const dir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-asm-api-self-test-"));
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
      "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
      "import { dirname, join } from 'node:path';",
      "export function assemble(source) {",
      "  if (source.includes('draw_sprtie')) {",
      "    return {",
      "      ok: false,",
      "      bytes: new Uint8Array(),",
      "      errors: [{ message: 'Label not found: draw_sprtie', hint: \"Did you mean 'draw_sprite'?\" }],",
      "      warnings: [],",
      "      symbols: []",
      "    };",
      "  }",
      "  return { ok: true, bytes: new Uint8Array([0x3e, 0x02]), errors: [], warnings: [], symbols: [] };",
      "}",
      "export function assembleFile(entry) {",
      "  const source = readFileSync(entry, 'utf8');",
      "  if (source.includes('db 0x2a')) {",
      "    return {",
      "      ok: true,",
      "      bytes: new Uint8Array([0x2a]),",
      "      artifacts: [{ kind: 'bin', path: 'nested/out.bin', start: 0x8000, length: 1, bytes: new Uint8Array([0x2a]) }],",
      "      sld: '|SLD.data.version|1\\n|32768|F|answer\\n|32768|T|',",
      "      errors: [],",
      "      warnings: [],",
      "      symbols: [{ name: 'answer', value: 0x8000 }]",
      "    };",
      "  }",
      "  return { ok: false, bytes: new Uint8Array(), errors: [{ message: 'unexpected file source' }], warnings: [], symbols: [] };",
      "}",
      "export function writeAssemblyOutputs(result, options) {",
      "  const artifacts = result.artifacts ?? [];",
      "  for (const artifact of artifacts) {",
      "    const target = join(options.outDir, artifact.path);",
      "    mkdirSync(dirname(target), { recursive: true });",
      "    writeFileSync(target, artifact.bytes);",
      "  }",
      "  return { artifacts };",
      "}",
    ].join("\n"),
    "utf8",
  );

  const fixture = {
    id: "ASM-API-SELF-TEST",
    tier: "contract",
    provenance: "contract",
    input: {
      kind: "assembler-api",
      files: [
        {
          path: "src/main.asm",
          lines: ["    ORG 0x8000", "answer:", "    db 0x2a", ""],
        },
      ],
      cases: [
        {
          name: "undefined-label",
          source: "call draw_sprtie\ndraw_sprite:\n  ret\n",
          options: { entryPath: "bad-label.asm" },
        },
        {
          name: "file-backed-source",
          mode: "assembleFile",
          entry: "<tmp>/src/main.asm",
          writeOutputs: {
            entry: "<tmp>/src/main.asm",
            outDir: "<tmp>/build",
          },
        },
      ],
    },
    expected: {
      cases: [
        {
          name: "undefined-label",
          ok: false,
          errorCount: 1,
          errors: [
            {
              message: "Label not found: draw_sprtie",
              hint: "Did you mean 'draw_sprite'?",
            },
          ],
        },
        {
          name: "file-backed-source",
          ok: true,
          bytesHex: "2A",
          sldContains: ["|SLD.data.version|1", "|32768|F|answer", "|32768|T|"],
          artifacts: [
            {
              kind: "bin",
              path: "nested/out.bin",
              start: 0x8000,
              length: 1,
              bytesHex: "2A",
            },
          ],
          outputArtifactCount: 1,
          outputFiles: [{ path: "nested/out.bin", bytesHex: "2A" }],
          symbols: [{ name: "answer", value: 0x8000 }],
        },
      ],
    },
    normalization: { profile: "json" },
  };

  const fixturePath = path.join(dir, "fixture.json");
  await writeJson(fixturePath, fixture);
  const ignoredCliFixture = path.join(dir, "ignored-cli.json");
  await writeJson(ignoredCliFixture, {
    id: "ASM-API-SELF-TEST-IGNORED",
    tier: "contract",
    provenance: "contract",
    input: { kind: "assembler-cli", cases: [{ name: "ignored" }] },
    expected: { cases: [{ name: "ignored", ok: false }] },
    normalization: { profile: "json" },
  });
  const ok = run(["--fixtures", dir, "--module", fakeModule, "--skip-build", "--quiet"]);
  assert(ok.status === 0, `expected fixture to pass\n${ok.stdout}\n${ok.stderr}`);

  fixture.expected.cases[0].errors[0].message = "wrong";
  const badFixturePath = path.join(dir, "bad-fixture.json");
  await writeJson(badFixturePath, fixture);
  const bad = run(["--fixtures", badFixturePath, "--module", fakeModule, "--skip-build", "--quiet"]);
  const badOutput = `${bad.stdout}\n${bad.stderr}`;
  assert(bad.status !== 0, "expected mismatch fixture to fail");
  assert(badOutput.includes("errors[0].message"), "expected mismatch report to mention diagnostic message");
});

console.log("Assembler API fixture self-test passed: assemble() and assembleFile() cases pass and mismatches fail.");
