#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runZ80OpcodeCheck } from "./z80-opcodes-check.mjs";

// Self-test for the data-driven Z80 opcode validator. The validator runs over
// the *normalized* table, so these cases exercise the compressed source schema
// end to end (write terse YAML -> load -> normalize -> validate). Each negative
// breaks one field that the validator still checks (syntax, bytes, timing,
// flags, conformance, exclusions); fields that were dropped in the compression
// (operand roles, cycle-breakdown kinds, widthBits, derived lengthBytes) no
// longer have cases because they no longer exist.

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const FULL_FLAGS = ["S", "Z", "5", "H", "3", "PV", "N", "C"];

// A small but representative valid compressed table: a plain row, the LD A,n
// compatibility row, a flag-changing row (7+1 partition), a flag-changing row
// that touches all eight bits, a conditional-timing row, plus the two families
// (templated rows and explicit variants with an opcode exclusion). JSON is valid
// YAML, so the loader parses this object as-is.
const validTable = {
  schemaVersion: 1,
  status: "partial",
  purpose: "self-test",
  defaults: {
    caseInsensitive: true,
    provenance: "z80-spec",
    flags: { affected: [], unchanged: [...FULL_FLAGS] },
  },
  sources: {
    "z80-spec": { title: "self-test source", url: "https://www.zilog.com/docs/z80/um0080.pdf" },
  },
  instructions: [
    { id: "Z80-OPC-NOP-001", syntax: "NOP", bytes: ["00"], t: 4, m: 1, conformance: ["ASM-EMIT-NOP-001"] },
    { id: "Z80-OPC-LD-A-N-001", syntax: "LD A,n", bytes: ["3E", "n"], t: 7, m: 2, conformance: ["ASM-EMIT-001", "ASM-EMIT-LD-R-N-001"] },
    { id: "Z80-OPC-LD-B-N-001", syntax: "LD B,n", bytes: ["06", "n"], t: 7, m: 2, conformance: ["ASM-EMIT-LD-R-N-001"] },
    { id: "Z80-OPC-LD-B-IX-D-001", syntax: "LD B,(IX+d)", bytes: ["DD", "46", "d"], t: 19, m: 5, conformance: ["ASM-EMIT-INDEX-LD-R-001"] },
    {
      id: "Z80-OPC-LD-A-I-001",
      syntax: "LD A,I",
      bytes: ["ED", "57"],
      t: 9,
      m: 2,
      flags: { affected: ["S", "Z", "5", "H", "3", "PV", "N"], unchanged: ["C"] },
      conformance: ["ASM-EMIT-LD-A-I-R-001"],
    },
    {
      id: "Z80-OPC-POP-AF-001",
      syntax: "POP AF",
      bytes: ["F1"],
      t: 10,
      m: 3,
      flags: { affected: [...FULL_FLAGS], unchanged: [] },
      conformance: ["ASM-EMIT-POP-QQ-001"],
    },
    {
      id: "Z80-OPC-JR-NZ-E-001",
      syntax: "JR NZ,e",
      bytes: ["20", "e"],
      t: [12, 7],
      m: [3, 2],
      conformance: ["ASM-EMIT-JR-CC-E-001"],
    },
  ],
  families: [
    {
      id: "Z80-OPC-LD-R-R-001",
      syntax: "LD {d},{s}",
      bytes: ["{op}"],
      t: 4,
      m: 1,
      conformance: ["ASM-EMIT-LD-R-R-001"],
      rows: [
        { d: "B", s: "B", op: "40" },
        { d: "A", s: "L", op: "7D" },
      ],
    },
    {
      id: "Z80-OPC-LD-HL-MEM-001",
      conformance: ["ASM-EMIT-LD-HL-MEM-001"],
      excludes: ["76"],
      variants: [
        { syntax: "LD (HL),n", bytes: ["36", "n"], t: 10, m: 3 },
        { syntax: "LD B,(HL)", bytes: ["46"], t: 7, m: 2 },
      ],
    },
  ],
};

function instruction(table, id) {
  return table.instructions.find((item) => item.id === id);
}

function family(table, id) {
  return table.families.find((item) => item.id === id);
}

async function writeTable(tempDir, name, table) {
  const file = path.join(tempDir, name);
  await writeFile(file, JSON.stringify(table, null, 2), "utf8");
  return file;
}

async function expectOk(file) {
  const result = await runZ80OpcodeCheck({ file, quiet: true });
  if (!result.ok) {
    throw new Error(`expected ${path.basename(file)} to pass, got: ${result.errors.join("; ")}`);
  }
}

async function expectFail(file, expectedError) {
  const result = await runZ80OpcodeCheck({ file, quiet: true });
  if (result.ok) {
    throw new Error(`expected ${path.basename(file)} to fail`);
  }
  if (!result.errors.some((error) => error.includes(expectedError))) {
    throw new Error(
      `expected ${path.basename(file)} failure to mention "${expectedError}"; got: ${result.errors.join("; ")}`,
    );
  }
}

export async function runSelfTest() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-z80-opcodes-"));
  try {
    await expectOk(await writeTable(tempDir, "valid.yaml", validTable));

    // --- root shape ---------------------------------------------------------
    const wrongSchema = clone(validTable);
    wrongSchema.schemaVersion = 2;
    await expectFail(await writeTable(tempDir, "wrong-schema.yaml", wrongSchema), "schemaVersion");

    const missingSource = clone(validTable);
    delete missingSource.sources["z80-spec"];
    await expectFail(await writeTable(tempDir, "missing-source.yaml", missingSource), "sources.z80-spec is required");

    const emptyInstructions = clone(validTable);
    emptyInstructions.instructions = [];
    await expectFail(
      await writeTable(tempDir, "empty-instructions.yaml", emptyInstructions),
      "instructions must be a non-empty array",
    );

    // --- identity -----------------------------------------------------------
    const duplicateId = clone(validTable);
    duplicateId.instructions.push(clone(instruction(duplicateId, "Z80-OPC-NOP-001")));
    await expectFail(await writeTable(tempDir, "duplicate-id.yaml", duplicateId), "duplicate instruction id");

    const missingSyntax = clone(validTable);
    instruction(missingSyntax, "Z80-OPC-NOP-001").syntax = "";
    await expectFail(await writeTable(tempDir, "missing-syntax.yaml", missingSyntax), ".canonicalSyntax is required");

    const wrongProvenance = clone(validTable);
    instruction(wrongProvenance, "Z80-OPC-LD-B-N-001").provenance = "house-rules";
    await expectFail(await writeTable(tempDir, "wrong-provenance.yaml", wrongProvenance), ".provenance");

    // --- encoding bytes -----------------------------------------------------
    const emptyBytes = clone(validTable);
    instruction(emptyBytes, "Z80-OPC-NOP-001").bytes = [];
    await expectFail(
      await writeTable(tempDir, "empty-bytes.yaml", emptyBytes),
      "Z80-OPC-NOP-001.encoding.bytes must be a non-empty array",
    );

    const ambiguousByte = clone(validTable);
    instruction(ambiguousByte, "Z80-OPC-NOP-001").bytes = [""];
    await expectFail(
      await writeTable(tempDir, "ambiguous-byte.yaml", ambiguousByte),
      "must have exactly one byte value or parameter",
    );

    // --- slot-token grammar (ADR-0008 / F-1) --------------------------------
    // Dropping the `n` parameter byte from `LD B,n` leaves a canonical-syntax
    // slot with no matching byte parameter; the case-sensitive slot grammar must
    // flag it (this is the rule that keeps register `E` distinct from slot `e`).
    const slotGrammarMismatch = clone(validTable);
    instruction(slotGrammarMismatch, "Z80-OPC-LD-B-N-001").bytes = ["06"];
    await expectFail(
      await writeTable(tempDir, "slot-grammar-mismatch.yaml", slotGrammarMismatch),
      "do not match byte parameters",
    );

    // The `d` index-displacement slot is matched the same way: dropping the `d`
    // byte from `LD B,(IX+d)` leaves the `(IX+d)` operand with no displacement
    // byte parameter, which the case-sensitive slot grammar must flag.
    const indexSlotMismatch = clone(validTable);
    instruction(indexSlotMismatch, "Z80-OPC-LD-B-IX-D-001").bytes = ["DD", "46"];
    await expectFail(
      await writeTable(tempDir, "index-slot-mismatch.yaml", indexSlotMismatch),
      "do not match byte parameters",
    );

    // --- timing -------------------------------------------------------------
    const missingTiming = clone(validTable);
    delete instruction(missingTiming, "Z80-OPC-NOP-001").t;
    await expectFail(await writeTable(tempDir, "missing-timing.yaml", missingTiming), "Z80-OPC-NOP-001.timing.tStates");

    const nonPositiveTiming = clone(validTable);
    instruction(nonPositiveTiming, "Z80-OPC-LD-B-N-001").m = 0;
    await expectFail(
      await writeTable(tempDir, "non-positive-timing.yaml", nonPositiveTiming),
      "Z80-OPC-LD-B-N-001.timing.machineCycles",
    );

    const truncatedConditional = clone(validTable);
    instruction(truncatedConditional, "Z80-OPC-JR-NZ-E-001").t = [12];
    await expectFail(
      await writeTable(tempDir, "truncated-conditional.yaml", truncatedConditional),
      "Z80-OPC-JR-NZ-E-001.timing.conditionFalse.tStates",
    );

    // --- flags --------------------------------------------------------------
    const incompletePartition = clone(validTable);
    instruction(incompletePartition, "Z80-OPC-LD-A-I-001").flags.unchanged = [];
    await expectFail(
      await writeTable(tempDir, "incomplete-partition.yaml", incompletePartition),
      "Z80-OPC-LD-A-I-001.flags must partition all 8 condition bits",
    );

    const unknownFlag = clone(validTable);
    instruction(unknownFlag, "Z80-OPC-LD-A-I-001").flags.affected = ["S", "Z", "5", "H", "3", "PV", "X"];
    await expectFail(await writeTable(tempDir, "unknown-flag.yaml", unknownFlag), ".flags.affected has unknown flag");

    const overlappingFlag = clone(validTable);
    instruction(overlappingFlag, "Z80-OPC-LD-A-I-001").flags.unchanged = ["C", "S"];
    await expectFail(
      await writeTable(tempDir, "overlapping-flag.yaml", overlappingFlag),
      "Z80-OPC-LD-A-I-001.flags: S is both affected and unchanged",
    );

    // --- conformance --------------------------------------------------------
    const missingConformance = clone(validTable);
    instruction(missingConformance, "Z80-OPC-NOP-001").conformance = [];
    await expectFail(
      await writeTable(tempDir, "missing-conformance.yaml", missingConformance),
      "Z80-OPC-NOP-001.conformance must be a non-empty array",
    );

    const missingLdACompat = clone(validTable);
    instruction(missingLdACompat, "Z80-OPC-LD-A-N-001").conformance = ["ASM-EMIT-LD-R-N-001"];
    await expectFail(await writeTable(tempDir, "missing-ld-a-compat.yaml", missingLdACompat), "ASM-EMIT-001");

    // --- families -----------------------------------------------------------
    const emptyFamilyConformance = clone(validTable);
    family(emptyFamilyConformance, "Z80-OPC-LD-R-R-001").conformance = [];
    await expectFail(
      await writeTable(tempDir, "empty-family-conformance.yaml", emptyFamilyConformance),
      "Z80-OPC-LD-R-R-001.conformance must be a non-empty array",
    );

    const emptyFamilyMembers = clone(validTable);
    family(emptyFamilyMembers, "Z80-OPC-LD-R-R-001").rows = [];
    await expectFail(
      await writeTable(tempDir, "empty-family-members.yaml", emptyFamilyMembers),
      "Z80-OPC-LD-R-R-001.members must be a non-empty array",
    );

    const missingHlExclusion = clone(validTable);
    delete family(missingHlExclusion, "Z80-OPC-LD-HL-MEM-001").excludes;
    await expectFail(
      await writeTable(tempDir, "missing-hl-exclusion.yaml", missingHlExclusion),
      "Z80-OPC-LD-HL-MEM-001 must exclude opcode 0x76",
    );

    const hlIncludesHalt = clone(validTable);
    family(hlIncludesHalt, "Z80-OPC-LD-HL-MEM-001").variants[1].bytes = ["76"];
    await expectFail(
      await writeTable(tempDir, "hl-includes-halt.yaml", hlIncludesHalt),
      "Z80-OPC-LD-HL-MEM-001 variants must not include opcode 0x76",
    );

    // --- decode uniqueness (OPCODE-DECODE-UNIQUE-001) -----------------------
    // Two canonical rows that encode the same bytes make decode ambiguous. Adding
    // a second row with NOP's byte template (00) but a distinct id/syntax must be
    // rejected: each decodable byte sequence maps to exactly one canonical row.
    const duplicateEncoding = clone(validTable);
    duplicateEncoding.instructions.push({
      id: "Z80-OPC-NOP-ALIAS-001",
      syntax: "NOP2",
      bytes: ["00"],
      t: 4,
      m: 1,
      conformance: ["ASM-EMIT-NOP-001"],
    });
    await expectFail(
      await writeTable(tempDir, "duplicate-encoding.yaml", duplicateEncoding),
      "OPCODE-DECODE-UNIQUE",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  await runSelfTest();
  console.log("Z80 opcode domain self-test: passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
