#!/usr/bin/env node
// Self-test for the ROM artifact runner (ROM-ARTIFACT-001, ADR-0024). Trivial-tier:
// pinning the size + sha256 of an opaque blob is mechanical, so no double-blind-regen —
// just a guard that the check actually bites.
//
// Decisive checks:
//   1. The REAL manifest + vendored blob pass.
//   2. A TAMPERED blob (one byte flipped) fails the sha256 check.
//   3. A WRONG declared size (manifest.artifact.bytes off by one) fails.
//   4. A MISSING blob fails.
//   5. A NON-OPAQUE manifest (opaque: false) fails (ADR-0024 invariant).
import { mkdtemp, mkdir, rm, writeFile, copyFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-rom-fixtures.mjs");
const realManifestPath = path.join(thisDir, "spectrum-48k-rom.manifest.json");
const realRomPath = path.join(thisDir, "spectrum-48k.rom");

function run(manifestPath) {
  return spawnSync(process.execPath, [runnerPath, "--manifest", manifestPath, "--quiet"], { encoding: "utf8" });
}
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  // 1. Real manifest passes against the real runner default.
  const real = spawnSync(process.execPath, [runnerPath, "--quiet"], { encoding: "utf8" });
  assert(real.status === 0, `expected the real ROM manifest to pass\n${real.stdout}\n${real.stderr}`);

  const realManifest = JSON.parse(await readFile(realManifestPath, "utf8"));
  const dir = await mkdtemp(path.join(os.tmpdir(), "rom-self-test-"));
  try {
    // Helper: write a manifest variant + (optionally) a blob into a per-case subdir
    // (each case is isolated so one case's blob can't satisfy another's localPath).
    const writeCase = async (name, mutate, { copyRom = true, tamper = false } = {}) => {
      const m = JSON.parse(JSON.stringify(realManifest));
      mutate(m);
      const caseDir = path.join(dir, name);
      await mkdir(caseDir, { recursive: true });
      const manifestPath = path.join(caseDir, "rom.manifest.json");
      await writeFile(manifestPath, JSON.stringify(m), "utf8");
      const romDest = path.join(caseDir, m.artifact.localPath);
      if (copyRom) {
        await copyFile(realRomPath, romDest);
        if (tamper) {
          const bytes = await readFile(romDest);
          bytes[0] ^= 0xff; // flip the first byte
          await writeFile(romDest, bytes);
        }
      }
      return manifestPath;
    };

    // Sanity: an untouched manifest copy (with the blob) still passes from the temp dir.
    const ok = await writeCase("ok", () => {});
    assert(run(ok).status === 0, "expected an untouched manifest copy to pass from a temp dir");

    // 2. Tampered blob -> sha256 mismatch.
    const tampered = await writeCase("tampered", () => {}, { tamper: true });
    assert(run(tampered).status !== 0, "expected a tampered ROM blob to fail the sha256 check");

    // 3. Wrong declared size.
    const wrongSize = await writeCase("wrong-size", (m) => { m.artifact.bytes = m.artifact.bytes - 1; });
    assert(run(wrongSize).status !== 0, "expected a wrong declared size to fail");

    // 4. Missing blob.
    const missing = await writeCase("missing", () => {}, { copyRom: false });
    assert(run(missing).status !== 0, "expected a missing ROM blob to fail");

    // 5. Non-opaque manifest.
    const notOpaque = await writeCase("not-opaque", (m) => { m.opaque = false; });
    assert(run(notOpaque).status !== 0, "expected opaque: false to fail (ADR-0024 invariant)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "ROM fixture self-test passed: the real ROM-ARTIFACT manifest + blob validate; a tampered blob, a wrong declared size, a missing blob, and a non-opaque manifest are all rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
