#!/usr/bin/env node
// Drift gate for the generated Z80 opcode table (ADR-0025 / W12 Phase C1, D2).
// Regenerates the projection of dna/domain/z80-opcodes.yaml in memory and compares
// it byte-for-byte against the committed packages/asm/src/generated/z80-opcodes-table.ts.
// Fails red if they disagree so the committed table cannot drift from the DNA — the
// same anti-rot device as check-emulator-env-template.mjs / check-starter-template-drift.
//
//   node scripts/check-opcode-table-drift.mjs        (run by `pnpm check:drift`)
//
// Fix on failure: `node scripts/gen-opcode-table.mjs` and commit the regenerated file.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GENERATED_PATH, generateOpcodeTableSource } from "./gen-opcode-table.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..");

function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

export async function checkOpcodeTableDrift() {
  const expected = await generateOpcodeTableSource();
  let actual;
  try {
    actual = await readFile(GENERATED_PATH, "utf8");
  } catch {
    return {
      ok: false,
      reason: `missing generated table: ${path.relative(repoRoot, GENERATED_PATH)} (run: node scripts/gen-opcode-table.mjs)`,
    };
  }
  if (normalizeEol(actual) !== normalizeEol(expected)) {
    return {
      ok: false,
      reason:
        `${path.relative(repoRoot, GENERATED_PATH)} is stale (drifts from dna/domain/z80-opcodes.yaml). ` +
        "Fix: node scripts/gen-opcode-table.mjs && commit the regenerated file.",
    };
  }
  return { ok: true };
}

async function main() {
  const result = await checkOpcodeTableDrift();
  if (!result.ok) {
    console.error(`opcode-table drift: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.warn("opcode-table drift: generated table is in sync with z80-opcodes.yaml");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
