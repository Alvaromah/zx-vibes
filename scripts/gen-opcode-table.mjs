#!/usr/bin/env node
// Codegen: project the normalized Z80 opcode table (the single authority,
// dna/domain/z80-opcodes.yaml) into a committed TypeScript data module that the
// assembler (encode) and disassembler (decode) consume. ADR-0025 / W12 Phase C1,
// decision D2 (committed codegen + drift gate, reusing the conformance
// normalizeTable() so there is exactly one normalization).
//
//   Regenerate:  node scripts/gen-opcode-table.mjs
//   Drift-gate:  node scripts/check-opcode-table-drift.mjs  (in `pnpm check:drift`)
//
// The emitted file is GENERATED — do not hand-edit; change z80-opcodes.yaml and
// regenerate. The drift gate fails red if the committed file and a fresh
// generation disagree, so the projection cannot rot.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadZ80OpcodeTable } from "../dna/conformance/domain/z80-opcodes-check.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..");

export const GENERATED_PATH = path.join(
  repoRoot,
  "packages",
  "asm",
  "src",
  "generated",
  "z80-opcodes-table.ts",
);

const SOURCE_REL = "dna/domain/z80-opcodes.yaml";

// --- Projection (faithful, deterministic key order) --------------------------

function toByte(byte) {
  if (typeof byte.parameter === "string") {
    return { parameter: byte.parameter };
  }
  return { value: byte.value, hex: byte.hex };
}

function toTiming(timing) {
  if (timing.conditionTrue || timing.conditionFalse) {
    return {
      conditionTrue: {
        tStates: timing.conditionTrue.tStates,
        machineCycles: timing.conditionTrue.machineCycles,
      },
      conditionFalse: {
        tStates: timing.conditionFalse.tStates,
        machineCycles: timing.conditionFalse.machineCycles,
      },
    };
  }
  return { tStates: timing.tStates, machineCycles: timing.machineCycles };
}

function toEntry(enc) {
  return {
    id: enc.id,
    canonicalSyntax: enc.canonicalSyntax,
    bytes: enc.encoding.bytes.map(toByte),
    lengthBytes: enc.encoding.lengthBytes,
    timing: toTiming(enc.timing),
    flags: {
      affected: [...enc.flags.affected],
      unchanged: [...enc.flags.unchanged],
    },
    conformance: [...enc.conformance],
    provenance: enc.provenance,
    caseInsensitive: enc.caseInsensitive,
  };
}

export function projectEntries(table) {
  return [
    ...table.instructions,
    ...table.families.flatMap((family) => family.members),
  ].map(toEntry);
}

// --- Emit --------------------------------------------------------------------

const HEADER = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Projection of the normalized Z80 opcode table (the single authority,
// ${SOURCE_REL}) produced via the conformance normalizeTable().
// The assembler (encode: mnemonic -> row -> bytes) and disassembler (decode:
// bytes -> row -> mnemonic) consume this one table (ADR-0025, W12 Phase C).
//
//   Regenerate:  node scripts/gen-opcode-table.mjs
//   Drift-gated: node scripts/check-opcode-table-drift.mjs  (run by \`pnpm check:drift\`)
//
// Each entry is one fully-expanded encoding (instruction rows + every templated
// family member). \`bytes\` carries fixed opcode bytes (\`value\`/\`hex\`) and the
// named parameter slots the encoder fills in: \`n\` (8-bit immediate), \`nn\` as the
// LE pair \`nn-low\`/\`nn-high\`, \`e\` (relative displacement), \`d\` (index
// displacement). Reserved slot tokens are case-sensitive (register \`E\` is not the
// slot \`e\`).

export type Z80Flag = 'S' | 'Z' | '5' | 'H' | '3' | 'PV' | 'N' | 'C';

export type OpcodeByte =
  | { readonly value: number; readonly hex: string }
  | { readonly parameter: string };

export interface OpcodeTimingFixed {
  readonly tStates: number;
  readonly machineCycles: number;
}

export interface OpcodeTimingConditional {
  readonly conditionTrue: OpcodeTimingFixed;
  readonly conditionFalse: OpcodeTimingFixed;
}

export type OpcodeTiming = OpcodeTimingFixed | OpcodeTimingConditional;

export interface OpcodeFlags {
  readonly affected: readonly Z80Flag[];
  readonly unchanged: readonly Z80Flag[];
}

export interface OpcodeEntry {
  readonly id: string;
  readonly canonicalSyntax: string;
  readonly bytes: readonly OpcodeByte[];
  readonly lengthBytes: number;
  readonly timing: OpcodeTiming;
  readonly flags: OpcodeFlags;
  readonly conformance: readonly string[];
  readonly provenance: string;
  readonly caseInsensitive: boolean;
}
`;

export async function generateOpcodeTableSource(file) {
  const table = await loadZ80OpcodeTable(file);
  const entries = projectEntries(table);
  const rows = entries.map((entry) => `  ${JSON.stringify(entry)},`).join("\n");
  return (
    `${HEADER}\n` +
    `export const Z80_OPCODE_TABLE: readonly OpcodeEntry[] = [\n${rows}\n];\n\n` +
    `export const Z80_OPCODE_TABLE_ENTRY_COUNT = ${entries.length};\n`
  );
}

async function main() {
  const source = await generateOpcodeTableSource();
  await mkdir(path.dirname(GENERATED_PATH), { recursive: true });
  await writeFile(GENERATED_PATH, source, "utf8");
  const lineCount = source.split("\n").length;
  console.warn(`generated ${path.relative(repoRoot, GENERATED_PATH)} (${lineCount} lines)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
