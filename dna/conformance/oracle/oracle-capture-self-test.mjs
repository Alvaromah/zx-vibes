#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const captureScript = path.join(thisDir, "oracle-capture.mjs");

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

function git(args, cwd) {
  const result = run("git", args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function withTempRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-oracle-capture-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function createOracle(root) {
  const oracle = path.join(root, "oracle");
  await mkdir(path.join(oracle, "tools"), { recursive: true });
  await mkdir(path.join(oracle, "fixtures"), { recursive: true });
  await writeFile(
    path.join(oracle, "tools", "fake-cli.mjs"),
    "console.log(`fake cli ${process.cwd()} ${process.env.TZ}`);\n",
    "utf8",
  );
  await writeFile(path.join(oracle, "fixtures", "bytes.bin"), Buffer.from([0, 1, 2, 3]));
  git(["init", "--quiet"], oracle);
  git(["checkout", "-b", "main"], oracle);
  git(["config", "user.email", "self-test@example.invalid"], oracle);
  git(["config", "user.name", "Oracle Capture Self Test"], oracle);
  git(["add", "."], oracle);
  git(["commit", "--quiet", "-m", "Add oracle fixtures"], oracle);
  return {
    oracle,
    commit: git(["rev-parse", "HEAD"], oracle),
  };
}

async function writePlan(root, commit) {
  const plan = {
    id: "oracle-capture-self-test",
    tier: "contract",
    provenance: "decision:ADR-0001",
    oracle: {
      expectedBranch: "main",
      expectedCommit: commit,
      dirtyPolicy: "reject",
    },
    cases: [
      {
        id: "SELF-CLI-001",
        kind: "command",
        tier: "contract",
        provenance: "contract",
        command: ["node", "tools/fake-cli.mjs"],
        cwd: ".",
        expectedExitCode: 0,
        normalization: { profile: "cli-snapshot" },
        output: "cli/fake.json",
      },
      {
        id: "SELF-BIN-001",
        kind: "file",
        tier: "contract",
        provenance: "contract",
        path: "fixtures/bytes.bin",
        normalization: { profile: "binary" },
        output: "bin/bytes.json",
        copyTo: "bin/bytes.bin",
      },
    ],
  };
  const planPath = path.join(root, "plan.json");
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return planPath;
}

function runCapture({ oracle, plan, out, extra = [] }) {
  return run(process.execPath, [
    captureScript,
    "--oracle-root",
    oracle,
    "--plan",
    plan,
    "--out",
    out,
    "--json",
    ...extra,
  ]);
}

await withTempRoot(async (root) => {
  const { oracle, commit } = await createOracle(root);
  const plan = await writePlan(root, commit);
  const out1 = path.join(root, "out1");
  const out2 = path.join(root, "out2");

  const first = runCapture({ oracle, plan, out: out1 });
  assert(first.status === 0, `first capture should pass: ${first.stderr}`);
  const second = runCapture({ oracle, plan, out: out2 });
  assert(second.status === 0, `second capture should pass: ${second.stderr}`);

  const firstCli = await readFile(path.join(out1, "cli", "fake.json"), "utf8");
  const secondCli = await readFile(path.join(out2, "cli", "fake.json"), "utf8");
  assert(firstCli === secondCli, "normalized command capture should be reproducible");
  assert(firstCli.includes("<PATH>"), "CLI capture should normalize oracle paths");
  assert(firstCli.includes("UTC"), "CLI capture should use deterministic environment");

  const firstBytes = JSON.parse(await readFile(path.join(out1, "bin", "bytes.json"), "utf8"));
  const secondBytes = JSON.parse(await readFile(path.join(out2, "bin", "bytes.json"), "utf8"));
  assert(firstBytes.sha256 === secondBytes.sha256, "binary capture hash should be reproducible");
  assert(firstBytes.bytes === 4, "binary capture should record byte length");

  await writeFile(path.join(oracle, "dirty.txt"), "dirty", "utf8");
  const dirty = runCapture({ oracle, plan, out: path.join(root, "dirty-out") });
  assert(dirty.status !== 0, "dirty oracle should be rejected by default");

  const dirtyAllowed = runCapture({
    oracle,
    plan,
    out: path.join(root, "dirty-allowed-out"),
    extra: ["--allow-dirty"],
  });
  assert(dirtyAllowed.status === 0, `--allow-dirty should permit exploratory capture: ${dirtyAllowed.stderr}`);

  const badPlan = await writePlan(root, "0000000000000000000000000000000000000000");
  const wrongCommit = runCapture({
    oracle,
    plan: badPlan,
    out: path.join(root, "wrong-commit-out"),
    extra: ["--allow-dirty"],
  });
  assert(wrongCommit.status !== 0, "wrong oracle commit should be rejected");

  const listed = run(process.execPath, [
    captureScript,
    "--plan",
    plan,
    "--oracle-root",
    oracle,
    "--list",
    "--json",
  ]);
  assert(listed.status === 0, `case listing should pass: ${listed.stderr}`);
  const listedJson = JSON.parse(listed.stdout);
  assert(listedJson.cases.length === 2, "case listing should report plan cases");
});

console.log(
  "Oracle capture self-test passed: pinned clean oracle required; command and file captures are reproducible.",
);
