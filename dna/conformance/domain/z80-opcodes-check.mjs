#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultTablePath = path.join(repoRoot, "dna", "domain", "z80-opcodes.yaml");

// The eight Z80 condition-bit flags, MSB-first. Every encoding must account for
// each one exactly once across `affected` (changed) and `unchanged`.
const FULL_FLAGS = ["S", "Z", "5", "H", "3", "PV", "N", "C"];
const FLAG_SET = new Set(FULL_FLAGS);

// Families that must keep specific opcodes out of their generated rows. 0x76 is
// HALT, which sits in the LD (HL) opcode hole; the LD memory-reference family
// must not absorb it. (Minimal special case retained from the bespoke era.)
const REQUIRED_EXCLUSIONS = { "Z80-OPC-LD-HL-MEM-001": [0x76] };

// --- CLI plumbing ------------------------------------------------------------

function usage() {
  return [
    "Usage: node dna/conformance/domain/z80-opcodes-check.mjs [--file <path>] [--quiet]",
    "",
    "Validates the machine-readable Z80 opcode domain table.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { file: defaultTablePath, quiet: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--file requires a path");
      }
      options.file = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

// --- Normalization (the single source of truth for derived fields) -----------
// The compressed table writes only what conformance proves: syntax, bytes,
// timing, flags-when-changed, and conformance ids. `normalizeTable` expands that
// terse form into the canonical in-memory shape the validator and summary read:
// derived `lengthBytes`, hex/value byte split, default flags, default provenance,
// conditional-timing expansion, and family-row template substitution.

function hexByte(value) {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

function isHexByteToken(token) {
  return typeof token === "string" && /^[0-9A-Fa-f]{2}$/.test(token);
}

function normalizeByte(token) {
  if (typeof token === "number") {
    return { value: token, hex: hexByte(token) };
  }
  if (isHexByteToken(token)) {
    const value = Number.parseInt(token, 16);
    return { value, hex: hexByte(value) };
  }
  return { parameter: String(token) };
}

function substitutePlaceholders(template, row) {
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in row ? String(row[key]) : whole));
}

function substituteToken(token, row) {
  return typeof token === "string" ? substitutePlaceholders(token, row) : token;
}

function normalizeTiming(t, m) {
  if (Array.isArray(t) || Array.isArray(m)) {
    const taken = Array.isArray(t) ? t : [t, t];
    const cycles = Array.isArray(m) ? m : [m, m];
    return {
      conditionTrue: { tStates: taken[0], machineCycles: cycles[0] },
      conditionFalse: { tStates: taken[1], machineCycles: cycles[1] },
    };
  }
  return { tStates: t, machineCycles: m };
}

function normalizeFlags(flags, defaults) {
  if (!flags) {
    return { affected: [...defaults.affected], unchanged: [...defaults.unchanged] };
  }
  const affected = flags.affected ?? [];
  const unchanged = flags.unchanged ?? FULL_FLAGS.filter((flag) => !affected.includes(flag));
  return { affected, unchanged };
}

function normalizeEncoding(spec, { id, conformance, flagsSource, defaults }) {
  const bytes = (spec.bytes ?? []).map(normalizeByte);
  return {
    id,
    canonicalSyntax: spec.syntax,
    encoding: { bytes, lengthBytes: bytes.length },
    timing: normalizeTiming(spec.t, spec.m),
    flags: normalizeFlags(flagsSource, defaults.flags),
    conformance: conformance ?? [],
    provenance: spec.provenance ?? defaults.provenance,
    caseInsensitive: spec.caseInsensitive ?? defaults.caseInsensitive,
  };
}

function normalizeFamily(family, defaults) {
  const conformance = family.conformance ?? [];
  const members = [];

  if (Array.isArray(family.rows)) {
    for (const row of family.rows) {
      const syntax = substitutePlaceholders(family.syntax ?? "", row);
      const bytes = (family.bytes ?? []).map((token) => normalizeByte(substituteToken(token, row)));
      members.push({
        id: `${family.id} [${syntax}]`,
        canonicalSyntax: syntax,
        encoding: { bytes, lengthBytes: bytes.length },
        timing: normalizeTiming(family.t, family.m),
        flags: normalizeFlags(row.flags ?? family.flags, defaults.flags),
        conformance,
        provenance: defaults.provenance,
        caseInsensitive: defaults.caseInsensitive,
      });
    }
  }

  for (const variant of family.variants ?? []) {
    members.push(
      normalizeEncoding(variant, {
        id: `${family.id} [${variant.syntax}]`,
        conformance,
        flagsSource: variant.flags ?? family.flags,
        defaults,
      }),
    );
  }

  return {
    id: family.id,
    conformance,
    provenance: defaults.provenance,
    excludes: (family.excludes ?? []).map((token) => Number.parseInt(token, 16)),
    members,
  };
}

export function normalizeTable(parsed) {
  const defaults = {
    provenance: parsed?.defaults?.provenance ?? "z80-spec",
    caseInsensitive: parsed?.defaults?.caseInsensitive ?? true,
    flags: {
      affected: parsed?.defaults?.flags?.affected ?? [],
      unchanged: parsed?.defaults?.flags?.unchanged ?? [...FULL_FLAGS],
    },
  };

  const instructions = (parsed?.instructions ?? []).map((spec) =>
    normalizeEncoding(spec, {
      id: spec.id,
      conformance: spec.conformance,
      flagsSource: spec.flags,
      defaults,
    }),
  );
  const families = (parsed?.families ?? []).map((family) => normalizeFamily(family, defaults));

  return {
    schemaVersion: parsed?.schemaVersion,
    status: parsed?.status,
    purpose: parsed?.purpose,
    sources: parsed?.sources,
    defaults,
    instructions,
    families,
  };
}

// --- Generic, data-driven validation -----------------------------------------

function requirePositiveInt(value, errors, label) {
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${label}: ${JSON.stringify(value)}, expected a positive integer`);
  }
}

function validateTiming(timing, errors, id) {
  if (!timing) {
    errors.push(`${id}.timing is required`);
    return;
  }
  if (timing.conditionTrue || timing.conditionFalse) {
    for (const branch of ["conditionTrue", "conditionFalse"]) {
      const value = timing[branch];
      if (!value) {
        errors.push(`${id}.timing.${branch} is required`);
        continue;
      }
      requirePositiveInt(value.tStates, errors, `${id}.timing.${branch}.tStates`);
      requirePositiveInt(value.machineCycles, errors, `${id}.timing.${branch}.machineCycles`);
    }
    return;
  }
  requirePositiveInt(timing.tStates, errors, `${id}.timing.tStates`);
  requirePositiveInt(timing.machineCycles, errors, `${id}.timing.machineCycles`);
}

function validateFlags(flags, errors, id) {
  const affected = flags?.affected;
  const unchanged = flags?.unchanged;
  if (!Array.isArray(affected)) {
    errors.push(`${id}.flags.affected must be an array`);
    return;
  }
  if (!Array.isArray(unchanged)) {
    errors.push(`${id}.flags.unchanged must be an array`);
    return;
  }
  for (const flag of affected) {
    if (!FLAG_SET.has(flag)) {
      errors.push(`${id}.flags.affected has unknown flag ${JSON.stringify(flag)}`);
    }
  }
  for (const flag of unchanged) {
    if (!FLAG_SET.has(flag)) {
      errors.push(`${id}.flags.unchanged has unknown flag ${JSON.stringify(flag)}`);
    }
  }
  for (const flag of affected) {
    if (unchanged.includes(flag)) {
      errors.push(`${id}.flags: ${flag} is both affected and unchanged`);
    }
  }
  const union = new Set([...affected, ...unchanged]);
  if (union.size !== FULL_FLAGS.length) {
    errors.push(`${id}.flags must partition all 8 condition bits across affected and unchanged`);
  }
}

// --- Slot-token grammar (ADR-0008 / pilot finding F-1) -----------------------
// The table's parameter slots are the RESERVED LOWERCASE tokens `n`, `nn`, and
// `e`; the 16-bit `nn` slot is emitted as the byte pair `nn-low`,`nn-high`. They
// are recognized CASE-SENSITIVELY and are distinct from register identifiers:
// the register `E` in `LD B,E` is NOT the displacement slot `e`. The table's
// `caseInsensitive` flag governs user-facing mnemonic/operand spelling, not this
// slot grammar. This check pins the rule by cross-validating each row's
// canonical-syntax slots against its byte-template parameters, so a consumer that
// regenerates an encoder by folding case (reading register `E` as slot `e`) is
// provably inconsistent with the table.
// `d` is the signed 8-bit index displacement byte carried inside the `(IX+d)` /
// `(IY+d)` operand (z80-spec); like `e` it contributes exactly one template byte.
// It is recognized case-sensitively and is distinct from register `D`.
const SLOT_TOKEN_PARAMS = { n: ["n"], nn: ["nn-low", "nn-high"], e: ["e"], d: ["d"] };

function syntaxSlotParams(canonicalSyntax) {
  const space = canonicalSyntax.indexOf(" ");
  if (space === -1) return [];
  const operands = canonicalSyntax
    .slice(space + 1)
    .split(",")
    .map((operand) => operand.trim());
  const params = [];
  for (const operand of operands) {
    const paren = operand.match(/^\((.*)\)$/);
    const inner = paren ? paren[1].trim() : operand;
    // The indexed memory operand `(IX+d)` / `(IY+d)` carries the displacement
    // slot `d` after the index register; reduce it to that token. Case-sensitive:
    // register `D` (e.g. `LD (IX+d),D`) is never the displacement slot `d`.
    const indexDisp = inner.match(/^I[XY]\+(\w+)$/);
    const token = indexDisp ? indexDisp[1] : inner;
    // Case-sensitive: only the lowercase reserved tokens are slots; `E` is a register.
    if (Object.prototype.hasOwnProperty.call(SLOT_TOKEN_PARAMS, token)) {
      params.push(...SLOT_TOKEN_PARAMS[token]);
    }
  }
  return params;
}

function validateSlotGrammar(enc, errors, id) {
  if (typeof enc.canonicalSyntax !== "string") return;
  const bytes = enc.encoding?.bytes;
  if (!Array.isArray(bytes)) return;
  const expected = syntaxSlotParams(enc.canonicalSyntax).slice().sort();
  const actual = bytes
    .filter((byte) => typeof byte?.parameter === "string" && byte.parameter.length > 0)
    .map((byte) => byte.parameter)
    .slice()
    .sort();
  if (expected.join("|") !== actual.join("|")) {
    errors.push(
      `${id}.encoding: canonical-syntax slot tokens [${expected.join(", ")}] do not match byte ` +
        `parameters [${actual.join(", ")}] (reserved slot tokens n/nn/e are case-sensitive; ` +
        `register identifiers like E are not slots)`,
    );
  }
}

function validateEncoding(enc, errors, seenIds) {
  const id = enc.id;
  if (typeof id !== "string" || id.trim() === "") {
    errors.push("instruction id is required");
    return;
  }
  if (seenIds.has(id)) {
    errors.push(`${id}: duplicate instruction id`);
  }
  seenIds.add(id);

  assertEqual(errors, enc.provenance, "z80-spec", `${id}.provenance`);

  if (typeof enc.canonicalSyntax !== "string" || enc.canonicalSyntax.trim() === "") {
    errors.push(`${id}.canonicalSyntax is required`);
  }

  const bytes = enc.encoding?.bytes;
  if (!Array.isArray(bytes) || bytes.length === 0) {
    errors.push(`${id}.encoding.bytes must be a non-empty array`);
  } else {
    for (const [index, byte] of bytes.entries()) {
      const hasValue = Number.isInteger(byte?.value) && byte.value >= 0 && byte.value <= 255;
      const hasParameter = typeof byte?.parameter === "string" && byte.parameter.length > 0;
      if (hasValue === hasParameter) {
        errors.push(`${id}.encoding.bytes[${index}] must have exactly one byte value or parameter`);
      }
    }
    assertEqual(errors, enc.encoding.lengthBytes, bytes.length, `${id}.encoding.lengthBytes`);
  }

  validateSlotGrammar(enc, errors, id);
  validateTiming(enc.timing, errors, id);
  validateFlags(enc.flags, errors, id);

  if (!Array.isArray(enc.conformance) || enc.conformance.length === 0) {
    errors.push(`${id}.conformance must be a non-empty array`);
  }
}

function validateFamily(family, errors, seenIds) {
  const id = family.id;
  if (typeof id !== "string" || id.trim() === "") {
    errors.push("instruction family id is required");
    return;
  }
  assertEqual(errors, family.provenance, "z80-spec", `${id}.provenance`);
  if (!Array.isArray(family.conformance) || family.conformance.length === 0) {
    errors.push(`${id}.conformance must be a non-empty array`);
  }
  if (!Array.isArray(family.members) || family.members.length === 0) {
    errors.push(`${id}.members must be a non-empty array`);
    return;
  }

  for (const member of family.members) {
    validateEncoding(member, errors, seenIds);
  }

  const required = REQUIRED_EXCLUSIONS[id] ?? [];
  for (const value of required) {
    if (!family.excludes.includes(value)) {
      errors.push(`${id} must exclude opcode 0x${hexByte(value)}`);
    }
  }
  for (const member of family.members) {
    const first = member.encoding?.bytes?.[0]?.value;
    if (typeof first === "number" && family.excludes.includes(first)) {
      errors.push(`${id} variants must not include opcode 0x${hexByte(first)}`);
    }
  }
}

function requireLdACompatibility(table, errors) {
  const instruction = table.instructions?.find((item) => item.id === "Z80-OPC-LD-A-N-001");
  if (!instruction) {
    return;
  }
  if (!(instruction.conformance ?? []).includes("ASM-EMIT-001")) {
    errors.push("Z80-OPC-LD-A-N-001.conformance must include ASM-EMIT-001");
  }
}

// --- Decode uniqueness (OPCODE-DECODE-UNIQUE-001, ADR-0025 / W12 Phase C4) ----
// Each decodable byte sequence must map to EXACTLY ONE canonical table row, so the
// disassembler's bytes -> row -> mnemonic step is unambiguous. The canonical key is
// the byte template: fixed opcode bytes by hex, parameter slots by their token name
// (so two rows that encode the same bytes share a key). The undocumented duplicate
// encodings (NEG<-ED4C.., RETN<-ED55.., IM dups, LD (nn),HL<-ED63, BIT z!=6 ..) are
// DECODE-ONLY ALIASES and deliberately NOT table rows (the documented form wins);
// any genuine collision here is two canonical rows claiming the same bytes — a real
// ambiguity to STOP on, never silently accept.

function byteTemplateKey(enc) {
  return (enc.encoding?.bytes ?? [])
    .map((byte) => (typeof byte.parameter === "string" ? `:${byte.parameter}` : byte.hex))
    .join(" ");
}

function validateDecodeUniqueness(table, errors) {
  const ownerByKey = new Map();
  const encodings = [
    ...(table.instructions ?? []),
    ...(table.families ?? []).flatMap((family) => family.members ?? []),
  ];
  for (const enc of encodings) {
    const key = byteTemplateKey(enc);
    if (key === "") {
      continue;
    }
    const owner = ownerByKey.get(key);
    if (owner) {
      errors.push(
        `OPCODE-DECODE-UNIQUE: byte template [${key}] maps to multiple canonical rows ` +
          `(${owner} and ${enc.id}); each decodable byte sequence must map to exactly one row ` +
          `(decode-only aliases are documented, not table rows)`,
      );
    } else {
      ownerByKey.set(key, enc.id);
    }
  }
}

export function validateZ80OpcodeTable(table) {
  const errors = [];
  assertEqual(errors, table?.schemaVersion, 1, "schemaVersion");
  if (!table?.sources?.["z80-spec"]) {
    errors.push("sources.z80-spec is required");
  }
  if (!Array.isArray(table?.instructions) || table.instructions.length === 0) {
    errors.push("instructions must be a non-empty array");
  }

  const seenIds = new Set();
  for (const enc of table?.instructions ?? []) {
    validateEncoding(enc, errors, seenIds);
  }
  for (const family of table?.families ?? []) {
    validateFamily(family, errors, seenIds);
  }
  requireLdACompatibility(table, errors);
  validateDecodeUniqueness(table, errors);
  return errors;
}

// --- Assertion helpers -------------------------------------------------------

function assertEqual(errors, actual, expected, label) {
  if (actual !== expected) {
    errors.push(`${label}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

function byteLabel(byte) {
  if (typeof byte?.value === "number") {
    return `0x${hexByte(byte.value)}`;
  }
  if (typeof byte?.parameter === "string") {
    return byte.parameter;
  }
  return JSON.stringify(byte);
}

// --- Loader + runner ---------------------------------------------------------

export async function loadZ80OpcodeTable(file = defaultTablePath) {
  const raw = await readFile(file, "utf8");
  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (error) {
    throw new Error(`${file}: z80-opcodes.yaml must be valid YAML: ${error.message}`);
  }
  return normalizeTable(parsed);
}

export async function runZ80OpcodeCheck({ file = defaultTablePath, quiet = false } = {}) {
  const table = await loadZ80OpcodeTable(file);
  const errors = validateZ80OpcodeTable(table);
  if (errors.length > 0) {
    if (!quiet) {
      console.error(`Z80 opcodes: ${errors.length} domain error(s)`);
      for (const error of errors) {
        console.error(`- ${error}`);
      }
    }
    return { ok: false, errors };
  }

  if (!quiet) {
    const familyEncodings = table.families.reduce((total, family) => total + family.members.length, 0);
    const totalEncodings = table.instructions.length + familyEncodings;
    const instructionSummary = table.instructions
      .map((enc) => `${enc.canonicalSyntax}=${enc.encoding.bytes.map(byteLabel).join(" ")}`)
      .join(", ");
    const familySummary = table.families
      .map((family) => `${family.id}=${family.members.length} forms`)
      .join(", ");
    console.log(
      `Z80 opcodes: ${table.instructions.length} instruction row(s), ${table.families.length} family row(s), ` +
        `${totalEncodings} encoding(s) checked; ${instructionSummary}; ${familySummary}`,
    );
  }
  return { ok: true, errors: [] };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await runZ80OpcodeCheck(options);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
