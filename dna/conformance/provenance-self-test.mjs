#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const lintPath = path.join(thisDir, "provenance-lint.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(args) {
  return spawnSync(process.execPath, [lintPath, ...args], {
    encoding: "utf8",
  });
}

async function withTempDna(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-provenance-"));
  try {
    const dnaRoot = path.join(root, "dna");
    const decisionsFile = path.join(root, ".harness", "decisions.md");
    await mkdir(path.join(dnaRoot, "conformance", "assembler"), { recursive: true });
    await mkdir(path.join(dnaRoot, "domain"), { recursive: true });
    await mkdir(path.dirname(decisionsFile), { recursive: true });
    await callback({ root, dnaRoot, decisionsFile });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function coverageRow({ id = "GOOD-001", provenance = "contract", area = "cross" } = {}) {
  return [
    "behaviors:",
    `  - id: ${id}`,
    `    area: ${area}`,
    '    behavior: "a behavior with provenance"',
    "    tier: contract",
    `    provenance: ${provenance}`,
    "    fixtures: []",
    "    status: uncovered",
    "",
  ].join("\n");
}

await withTempDna(async ({ dnaRoot, decisionsFile }) => {
  await writeFile(decisionsFile, "# Decisions\n\n## UNKNOWN backlog\n\n(empty)\n", "utf8");
  const result = run(["--dna-root", dnaRoot, "--decisions", decisionsFile, "--quiet"]);
  assert(result.status === 0, `empty temp DNA should pass provenance lint: ${result.stderr}`);
});

await withTempDna(async ({ dnaRoot, decisionsFile }) => {
  await writeFile(path.join(dnaRoot, "conformance", "coverage.yaml"), coverageRow(), "utf8");
  await writeFile(decisionsFile, "# Decisions\n\n## UNKNOWN backlog\n\n(empty)\n", "utf8");
  await writeFile(
    path.join(dnaRoot, "domain", "z80-cpu.md"),
    "The Z80 has an 8-bit accumulator. [id: CPU-A] [provenance: z80-spec]\n",
    "utf8",
  );

  const result = run(["--dna-root", dnaRoot, "--decisions", decisionsFile, "--quiet"]);
  assert(result.status === 0, `valid provenance should pass: ${result.stderr}`);
});

await withTempDna(async ({ dnaRoot, decisionsFile }) => {
  await writeFile(path.join(dnaRoot, "conformance", "coverage.yaml"), coverageRow(), "utf8");
  await writeFile(decisionsFile, "# Decisions\n", "utf8");
  await writeFile(
    path.join(dnaRoot, "conformance", "assembler", "missing-provenance.json"),
    JSON.stringify(
      {
        id: "FIX-MISSING",
        tier: "contract",
        input: {},
        expected: {},
        normalization: { profile: "none" },
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = run(["--dna-root", dnaRoot, "--decisions", decisionsFile, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "fixture missing provenance should fail");
  assert(output.includes("missing provenance"), "fixture failure should name missing provenance");
});

await withTempDna(async ({ dnaRoot, decisionsFile }) => {
  await writeFile(path.join(dnaRoot, "conformance", "coverage.yaml"), coverageRow(), "utf8");
  await writeFile(decisionsFile, "# Decisions\n", "utf8");
  await writeFile(
    path.join(dnaRoot, "domain", "z80-cpu.md"),
    "The Z80 has an 8-bit accumulator. [id: CPU-A]\n",
    "utf8",
  );

  const result = run(["--dna-root", dnaRoot, "--decisions", decisionsFile, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "Markdown claim missing provenance should fail");
  assert(output.includes("domain/z80-cpu.md:1"), "claim failure should name file and line");
  assert(output.includes("missing provenance"), "claim failure should name missing provenance");
});

await withTempDna(async ({ dnaRoot, decisionsFile }) => {
  await writeFile(
    path.join(dnaRoot, "conformance", "coverage.yaml"),
    coverageRow({ id: "UNK-001", provenance: "UNKNOWN", area: "assembler" }),
    "utf8",
  );
  await writeFile(decisionsFile, "# Decisions\n\n## UNKNOWN backlog\n\n(empty)\n", "utf8");

  const missing = run(["--dna-root", dnaRoot, "--decisions", decisionsFile, "--quiet"]);
  const missingOutput = `${missing.stdout}\n${missing.stderr}`;
  assert(missing.status !== 0, "UNKNOWN without decisions backlog key should fail");
  assert(
    missingOutput.includes("UNKNOWN:assembler:UNK-001"),
    "UNKNOWN failure should name required backlog key",
  );

  await writeFile(
    decisionsFile,
    "# Decisions\n\n## UNKNOWN backlog\n\n- UNKNOWN:assembler:UNK-001 needs resolution.\n",
    "utf8",
  );
  const tracked = run(["--dna-root", dnaRoot, "--decisions", decisionsFile, "--quiet"]);
  assert(tracked.status === 0, `tracked UNKNOWN should pass: ${tracked.stderr}`);
});

await withTempDna(async ({ dnaRoot, decisionsFile }) => {
  await writeFile(
    path.join(dnaRoot, "conformance", "coverage.yaml"),
    coverageRow({ id: "BAD-DECISION-001", provenance: "decision:ADR-9999" }),
    "utf8",
  );
  await writeFile(
    decisionsFile,
    [
      "# Decisions",
      "",
      "### ADR-0001 — accepted",
      "Accepted.",
      "",
      "### ADR-9999 — PENDING: not accepted",
      "Not accepted yet.",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = run(["--dna-root", dnaRoot, "--decisions", decisionsFile, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "decision provenance must reference an accepted ADR");
  assert(output.includes("decision:ADR-9999"), "decision failure should name the pending ADR");
});

console.log(
  "Provenance self-test passed: missing fixture/claim provenance fails; UNKNOWNs and decision refs are tracked.",
);
