#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const coverageCheckPath = path.join(thisDir, "coverage-check.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(args) {
  return spawnSync(process.execPath, [coverageCheckPath, ...args], {
    encoding: "utf8",
  });
}

async function withTempDna(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-coverage-"));
  try {
    const dnaRoot = path.join(root, "dna");
    const conformanceRoot = path.join(dnaRoot, "conformance");
    await mkdir(conformanceRoot, { recursive: true });
    await callback({ root, dnaRoot, conformanceRoot });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function ledger(rows) {
  return [
    "behaviors:",
    ...rows.flatMap((row) => [
      `  - id: ${row.id}`,
      `    area: ${row.area}`,
      `    behavior: "${row.behavior}"`,
      `    tier: ${row.tier}`,
      `    provenance: ${row.provenance}`,
      `    fixtures: [${row.fixtures.join(", ")}]`,
      `    status: ${row.status}`,
    ]),
    "",
  ].join("\n");
}

await withTempDna(async ({ dnaRoot, conformanceRoot }) => {
  const fixturePath = path.join(conformanceRoot, "fixture.json");
  const coveragePath = path.join(conformanceRoot, "coverage.yaml");
  await writeFile(fixturePath, "{}", "utf8");
  await writeFile(
    coveragePath,
    ledger([
      {
        id: "GOOD-001",
        area: "cross",
        behavior: "covered contract rows reference real fixtures",
        tier: "contract",
        provenance: "decision:ADR-0001",
        fixtures: ["conformance/fixture.json"],
        status: "covered",
      },
    ]),
    "utf8",
  );

  const result = run(["--file", coveragePath, "--dna-root", dnaRoot, "--quiet"]);
  assert(result.status === 0, `covered row with real fixture should pass: ${result.stderr}`);
});

await withTempDna(async ({ dnaRoot, conformanceRoot }) => {
  const coveragePath = path.join(conformanceRoot, "coverage.yaml");
  await writeFile(
    coveragePath,
    ledger([
      {
        id: "BAD-UNCOVERED-001",
        area: "assembler",
        behavior: "bootstrap mode allows open rows before cutover",
        tier: "fidelity",
        provenance: "z80-spec",
        fixtures: ["conformance/missing-later.json"],
        status: "uncovered",
      },
      {
        id: "BAD-UNKNOWN-001",
        area: "toolkit",
        behavior: "cutover mode rejects unknown contract rows",
        tier: "contract",
        provenance: "UNKNOWN",
        fixtures: ["conformance/missing-later.json"],
        status: "unknown",
      },
      {
        id: "BAD-PARTIAL-001",
        area: "emulator",
        behavior: "cutover mode rejects partial fidelity rows",
        tier: "fidelity",
        provenance: "fuse",
        fixtures: ["conformance/missing-later.json"],
        status: "partial",
      },
    ]),
    "utf8",
  );

  const bootstrap = run(["--file", coveragePath, "--dna-root", dnaRoot, "--quiet"]);
  assert(bootstrap.status === 0, "bootstrap coverage check should allow open rows");

  const cutover = run([
    "--file",
    coveragePath,
    "--dna-root",
    dnaRoot,
    "--cutover",
    "all",
    "--quiet",
  ]);
  const output = `${cutover.stdout}\n${cutover.stderr}`;
  assert(cutover.status !== 0, "cutover coverage check should reject open rows");
  assert(output.includes("BAD-UNCOVERED-001"), "cutover failure should name uncovered row id");
  assert(output.includes("uncovered"), "cutover failure should name the uncovered status");
  assert(output.includes("BAD-UNKNOWN-001"), "cutover failure should name unknown row id");
  assert(output.includes("unknown"), "cutover failure should name the unknown status");
  assert(output.includes("UNKNOWN provenance"), "cutover failure should name UNKNOWN provenance");
  assert(output.includes("BAD-PARTIAL-001"), "cutover failure should name partial row id");
  assert(output.includes("partial"), "cutover failure should name the partial status");
});

await withTempDna(async ({ dnaRoot, conformanceRoot }) => {
  const coveragePath = path.join(conformanceRoot, "coverage.yaml");
  await writeFile(
    coveragePath,
    ledger([
      {
        id: "BAD-FIXTURE-001",
        area: "cross",
        behavior: "covered rows must reference existing fixtures",
        tier: "contract",
        provenance: "contract",
        fixtures: ["conformance/missing.json"],
        status: "covered",
      },
    ]),
    "utf8",
  );

  const result = run(["--file", coveragePath, "--dna-root", dnaRoot, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "covered row with missing fixture should fail");
  assert(output.includes("does not exist"), "missing fixture failure should be explicit");
});

await withTempDna(async ({ dnaRoot, conformanceRoot }) => {
  const fixturePath = path.join(conformanceRoot, "fixture.json");
  const coveragePath = path.join(conformanceRoot, "coverage.yaml");
  await writeFile(fixturePath, "{}", "utf8");
  await writeFile(
    coveragePath,
    ledger([
      {
        id: "SHARD-ASM-001",
        area: "assembler",
        behavior: "covered assembler fidelity row",
        tier: "fidelity",
        provenance: "z80-spec",
        fixtures: ["conformance/fixture.json"],
        status: "covered",
      },
      {
        id: "SHARD-ASM-002",
        area: "assembler",
        behavior: "covered assembler contract row",
        tier: "contract",
        provenance: "contract",
        fixtures: ["conformance/fixture.json"],
        status: "covered",
      },
      {
        id: "SHARD-EMU-001",
        area: "emulator",
        behavior: "covered emulator fidelity row",
        tier: "fidelity",
        provenance: "fuse",
        fixtures: ["conformance/fixture.json"],
        status: "covered",
      },
      {
        id: "SHARD-EMU-002",
        area: "emulator",
        behavior: "bootstrap allows an open emulator row",
        tier: "fidelity",
        provenance: "fuse",
        fixtures: ["conformance/later.json"],
        status: "uncovered",
      },
    ]),
    "utf8",
  );

  const base = ["--file", coveragePath, "--dna-root", dnaRoot];

  const aggregate = run(base);
  assert(aggregate.status === 0, `shard ledger should validate: ${aggregate.stderr}`);
  assert(
    aggregate.stdout.includes("Coverage: 3/4 contract+fidelity rows covered"),
    "default output must report the unchanged aggregate count",
  );
  assert(!aggregate.stdout.includes("["), "default output must not include a per-area tag");

  const asm = run([...base, "--area", "assembler"]);
  assert(asm.status === 0, "per-area shard should pass in bootstrap mode");
  assert(
    asm.stdout.includes("Coverage: 2/2 contract+fidelity rows covered [assembler]"),
    "per-area shard must report that area's covered/gated count",
  );

  const emu = run([...base, "--area", "emulator"]);
  assert(
    emu.stdout.includes("Coverage: 1/2 contract+fidelity rows covered [emulator]"),
    "per-area shard must count only that area's gated rows",
  );

  const empty = run([...base, "--area", "gallery"]);
  assert(empty.status === 0, "an area with no rows is a valid 0/0 shard");
  assert(
    empty.stdout.includes("Coverage: 0/0 contract+fidelity rows covered [gallery]"),
    "an area with no rows reports 0/0",
  );

  const byArea = run([...base, "--by-area"]);
  assert(byArea.status === 0, "--by-area should pass in bootstrap mode");
  assert(
    byArea.stdout.includes("Coverage: 3/4 contract+fidelity rows covered"),
    "--by-area keeps the aggregate line",
  );
  assert(/assembler\s+2\/2/.test(byArea.stdout), "--by-area must break down assembler 2/2");
  assert(/emulator\s+1\/2/.test(byArea.stdout), "--by-area must break down emulator 1/2");

  const bogus = run([...base, "--area", "bogus"]);
  assert(bogus.status !== 0, "an unknown --area must be rejected");
  assert(
    `${bogus.stdout}\n${bogus.stderr}`.includes("must be one of"),
    "unknown --area error should list valid areas",
  );
});

await withTempDna(async ({ dnaRoot, conformanceRoot }) => {
  const fixtureDir = path.join(conformanceRoot, "assembler");
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(path.join(fixtureDir, "orphan.json"), "{}", "utf8");
  const coveragePath = path.join(conformanceRoot, "coverage.yaml");

  // A fixture under a fixture dir that no row references must fail the gate.
  await writeFile(
    coveragePath,
    ledger([
      {
        id: "ORPHAN-DECOY-001",
        area: "assembler",
        behavior: "a row that references some other (future) fixture",
        tier: "contract",
        provenance: "contract",
        fixtures: ["conformance/assembler/other.json"],
        status: "uncovered",
      },
    ]),
    "utf8",
  );
  const orphan = run(["--file", coveragePath, "--dna-root", dnaRoot, "--quiet"]);
  const orphanOut = `${orphan.stdout}\n${orphan.stderr}`;
  assert(orphan.status !== 0, "an unreferenced fixture file must fail the ledger gate");
  assert(
    orphanOut.includes("conformance/assembler/orphan.json"),
    "orphan failure should name the unreferenced fixture",
  );
  assert(
    orphanOut.includes("not referenced"),
    "orphan failure should explain the fixture is unreferenced",
  );

  // Referencing that fixture from any row clears the orphan error.
  await writeFile(
    coveragePath,
    ledger([
      {
        id: "ORPHAN-CLAIMED-001",
        area: "assembler",
        behavior: "a covered row that claims the fixture",
        tier: "contract",
        provenance: "contract",
        fixtures: ["conformance/assembler/orphan.json"],
        status: "covered",
      },
    ]),
    "utf8",
  );
  const claimed = run(["--file", coveragePath, "--dna-root", dnaRoot, "--quiet"]);
  assert(
    claimed.status === 0,
    `referencing the fixture should clear the orphan error: ${claimed.stderr}`,
  );
});

console.log(
  "Coverage self-test passed: bootstrap rows validate; cutover gate rejects open rows; covered rows need real fixtures; orphan fixtures (unreferenced .json under fixture dirs) are rejected; per-area shards (--area/--by-area) report per-product counts without changing the aggregate.",
);
