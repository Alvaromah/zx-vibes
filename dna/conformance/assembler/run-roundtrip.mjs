#!/usr/bin/env node
/**
 * ASM-ROUNDTRIP-001 — the assembler<->disassembler bijection oracle
 * (ADR-0025 / W12 Phase C4). It is the regression net for the C2/C3 refactor that
 * moves encode+decode onto the one opcode table: encode then decode (and back) must
 * be identity for every documented form AND consistent over every opcode the CPU
 * actually executes (FUSE = the executable boundary).
 *
 * Two phases, one invariant — `disasm(assemble(disasm(B))) === disasm(B)`:
 *
 *   A. FULL-TABLE STRICT ROUND-TRIP (table-seeded). For every canonical row in
 *      dna/domain/z80-opcodes.yaml, fill its parameter slots with deterministic
 *      sample operands -> bytes B, then assert
 *          assemble(disasm(B)) === B        (strict: encode o decode = id)
 *      Covers all ~1136 documented forms, including the 9 FUSE-seed-gap forms
 *      (DJNZ + the 8 auto-repeat block ops) that FUSE never witnesses.
 *
 *   B. EXECUTABLE-BOUNDARY + ALIAS COLLAPSE (FUSE-seeded). For every distinct FUSE
 *      opcode skeleton (incl. the undocumented decode-only aliases the CPU runs),
 *      assert it decodes (no DB), re-encodes, and is MNEMONIC-STABLE
 *          disasm(assemble(disasm(B))) === disasm(B)
 *      The canonical encodings re-encode to themselves; the decode-only aliases
 *      (NEG<-ED4C.., RETN<-ED55.., BIT z!=6 ..) collapse to their canonical bytes
 *      (B' != B) but keep the same mnemonic. Aliases are reported, never silently
 *      passed (C5).
 *
 * Requires the built assembler (packages/asm/dist). conformance:check builds it via
 * the assembler API fixtures before this runs.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadZ80OpcodeTable } from "../domain/z80-opcodes-check.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const distUrl = pathToFileURL(path.join(repoRoot, "packages", "asm", "dist", "index.js")).href;
const fuseDir = path.join(repoRoot, "dna", "conformance", "cpu", "fuse");
const FUSE_GROUPS = ["base", "cb", "ed", "dd", "fd", "ddcb", "fdcb"];

// Place the opcode at a neutral ORG so JR/DJNZ relative targets and JP/CALL
// absolute literals both disassemble to addresses that re-assemble identically.
const ORG = 0x8000;

// Deterministic sample operands for the table-seeded phase. Distinct values so a
// transposed operand byte would surface as a byte mismatch.
const SLOT_SAMPLE = { n: 0x12, "nn-low": 0x34, "nn-high": 0x12, e: 0x00, d: 0x05 };

// --- byte helpers ------------------------------------------------------------

function parseHexBytes(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 2) {
    out.push(Number.parseInt(text.slice(i, i + 2), 16));
  }
  return out;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if ((a[i] & 0xff) !== (b[i] & 0xff)) return false;
  }
  return true;
}

function hexJoin(bytes) {
  return bytes.map((b) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0")).join("");
}

function fillSlots(encodingBytes) {
  return encodingBytes.map((byte) => {
    if (typeof byte.parameter === "string") {
      if (!(byte.parameter in SLOT_SAMPLE)) {
        throw new Error(`no sample operand for slot '${byte.parameter}'`);
      }
      return SLOT_SAMPLE[byte.parameter];
    }
    return byte.value;
  });
}

// --- the round-trip primitive (pure; takes injected asm for the self-test) ---

function disasmAt(bytes, asm) {
  const read = (addr) => {
    const i = (addr & 0xffff) - ORG;
    return i >= 0 && i < bytes.length ? bytes[i] & 0xff : 0;
  };
  return asm.disassembleOne(read, ORG);
}

function assembleOne(text, asm) {
  const source = `    ORG 0x${ORG.toString(16).toUpperCase()}\n    ${text}\n`;
  const result = asm.assemble(source, { entryPath: "roundtrip.asm" });
  if (!result.ok) return null;
  return Array.from(result.bytes, (b) => b & 0xff);
}

/**
 * Round-trip one byte sequence. Returns:
 *   { ok:true, kind:'canonical'|'alias', mnemonic, instrBytes, reencoded }
 *   { ok:false, reason }
 */
export function roundtripByteCase(bytes, asm) {
  const line = disasmAt(bytes, asm);
  const mnemonic = line.text;
  const instrBytes = line.bytes.map((b) => b & 0xff);
  if (mnemonic.startsWith("DB ")) {
    return { ok: false, reason: `undecoded (DB fallback): bytes=${hexJoin(instrBytes)} -> "${mnemonic}"` };
  }
  const reencoded = assembleOne(mnemonic, asm);
  if (reencoded === null) {
    return { ok: false, reason: `re-assemble failed for "${mnemonic}" (bytes=${hexJoin(instrBytes)})` };
  }
  const mnemonic2 = disasmAt(reencoded, asm).text;
  if (mnemonic2 !== mnemonic) {
    return {
      ok: false,
      reason: `mnemonic not stable: "${mnemonic}" -> ${hexJoin(reencoded)} -> "${mnemonic2}"`,
    };
  }
  return {
    ok: true,
    kind: bytesEqual(reencoded, instrBytes) ? "canonical" : "alias",
    mnemonic,
    instrBytes,
    reencoded,
  };
}

// --- FUSE seed ---------------------------------------------------------------

async function loadFuseSkeletons() {
  const skeletons = new Map(); // skeleton name -> bytes[]
  for (const group of FUSE_GROUPS) {
    const json = JSON.parse(await readFile(path.join(fuseDir, `${group}.json`), "utf8"));
    for (const testCase of json.input.cases) {
      const name = testCase.name.replace(/_\d+$/, "");
      if (skeletons.has(name)) continue;
      const pcKey = (testCase.registers?.pc ?? "0000").toUpperCase().padStart(4, "0");
      const memHex = testCase.memory?.[pcKey] ?? testCase.memory?.["0000"];
      if (!memHex) {
        throw new Error(`FUSE ${group} case ${testCase.name} has no memory at PC ${pcKey}`);
      }
      skeletons.set(name, parseHexBytes(memHex));
    }
  }
  return skeletons;
}

// --- the oracle --------------------------------------------------------------

export async function runRoundtrip({ asm, quiet = false } = {}) {
  const resolvedAsm = asm ?? (await import(distUrl));
  const table = await loadZ80OpcodeTable();
  const failures = [];

  // Phase A — full-table strict round-trip.
  const rows = [
    ...table.instructions,
    ...table.families.flatMap((family) => family.members),
  ];
  let tableStrict = 0;
  for (const enc of rows) {
    let bytes;
    try {
      bytes = fillSlots(enc.encoding.bytes);
    } catch (error) {
      failures.push(`${enc.id}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const result = roundtripByteCase(bytes, resolvedAsm);
    if (!result.ok) {
      failures.push(`A ${enc.id} ("${enc.canonicalSyntax}"): ${result.reason}`);
      continue;
    }
    if (result.kind !== "canonical") {
      failures.push(
        `A ${enc.id} ("${enc.canonicalSyntax}"): table row is not its own canonical encoding — ` +
          `bytes ${hexJoin(bytes)} re-encode to ${hexJoin(result.reencoded)} via "${result.mnemonic}"`,
      );
      continue;
    }
    tableStrict += 1;
  }

  // Phase B — FUSE executable boundary + alias collapse.
  const skeletons = await loadFuseSkeletons();
  let fuseCanonical = 0;
  let fuseAlias = 0;
  for (const [name, bytes] of skeletons) {
    const result = roundtripByteCase(bytes, resolvedAsm);
    if (!result.ok) {
      failures.push(`B fuse:${name}: ${result.reason}`);
      continue;
    }
    if (result.kind === "canonical") fuseCanonical += 1;
    else fuseAlias += 1;
  }

  if (failures.length > 0) {
    console.error(`Assembler round-trip (ASM-ROUNDTRIP-001): ${failures.length} failure(s)`);
    for (const failure of failures.slice(0, 40)) {
      console.error(`- ${failure}`);
    }
    if (failures.length > 40) {
      console.error(`  ... and ${failures.length - 40} more`);
    }
    return { ok: false, failures };
  }

  if (!quiet) {
    console.log(
      `Assembler round-trip (ASM-ROUNDTRIP-001): table strict=${tableStrict}/${rows.length}, ` +
        `FUSE skeletons=${skeletons.size} (canonical=${fuseCanonical}, decode-only alias=${fuseAlias}); ` +
        `encode o decode = identity on every documented form, mnemonic-stable over the executable ISA.`,
    );
  }
  return { ok: true, tableStrict, tableRows: rows.length, fuseCanonical, fuseAlias, fuseTotal: skeletons.size };
}

async function main() {
  const quiet = process.argv.includes("--quiet");
  const result = await runRoundtrip({ quiet });
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
