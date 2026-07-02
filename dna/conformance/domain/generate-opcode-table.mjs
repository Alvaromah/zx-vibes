#!/usr/bin/env node
/**
 * OFFLINE Z80 opcode-table generator + ratification harness (ADR-0025, Phase A1).
 *
 * This tool is NOT shipped and NOT wired into any conformance gate. It exists to
 * de-risk completing `dna/domain/z80-opcodes.yaml` to the full executable ISA by:
 *
 *   1. Seeding from the FUSE per-opcode fixtures (the executable byte boundary):
 *      every distinct opcode byte-sequence the CPU actually steps.
 *   2. Decoding each sequence with the proven octal x/y/z decoder
 *      (`disassembleOne` from @zx-vibes/asm) to obtain candidate mnemonic syntax.
 *   3. Normalizing each candidate into the YAML table row shape: a canonical
 *      `syntax` string and a `bytes` template (hex literals for opcode bytes +
 *      parameter tokens n / nn-low,nn-high / e / d for operands).
 *   4. RATIFYING the candidates three ways (the core deliverable):
 *        a. Reproduce-208: every FUSE sequence that matches a hand-authored row
 *           must reproduce its canonical syntax + bytes template exactly.
 *        b. Completeness + uniqueness: every distinct FUSE sequence decodes to
 *           exactly one candidate row; none undecoded (no `DB` fallback).
 *        c. Phase-B worklist: candidate rows NOT among the trusted set, grouped
 *           by prefix, with counts and spot-check samples.
 *
 * It MUTATES NOTHING. It only READS the YAML (via z80-opcodes-check.mjs's
 * `loadZ80OpcodeTable`) and the FUSE fixtures, and imports the built disassembler.
 *
 * Run:  node dna/conformance/domain/generate-opcode-table.mjs
 * (requires @zx-vibes/asm to be built: `pnpm --filter @zx-vibes/asm build`)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { disassembleOne } from "../../../packages/asm/dist/index.js";
import { loadZ80OpcodeTable } from "./z80-opcodes-check.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const fuseDir = path.join(repoRoot, "dna", "conformance", "cpu", "fuse");
const FUSE_GROUPS = ["base", "cb", "ed", "dd", "fd", "ddcb", "fdcb"];

// --- byte helpers ------------------------------------------------------------

function hex2(value) {
  return (value & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

function parseHexBytes(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 2) {
    out.push(Number.parseInt(text.slice(i, i + 2), 16));
  }
  return out;
}

function makeRead(bytes) {
  return (addr) => (addr >= 0 && addr < bytes.length ? bytes[addr] & 0xff : 0);
}

function decode(bytes) {
  return disassembleOne(makeRead(bytes), 0);
}

// Mask every hex literal (immediate, address, signed displacement) to a sentinel
// so two decodes that differ ONLY in operand values compare equal.
function maskHex(text) {
  return text.replace(/[+-]?0x[0-9A-Fa-f]+/g, "<H>");
}

// Region of `a` that differs from `b` (common-prefix / common-suffix trim).
function diffSpan(a, b) {
  let s = 0;
  const min = Math.min(a.length, b.length);
  while (s < min && a[s] === b[s]) s += 1;
  let e = 0;
  while (e < min - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e += 1;
  return { start: s, end: a.length - e };
}

function prefixOf(bytes) {
  if (bytes[0] === 0xdd && bytes[1] === 0xcb) return "DDCB";
  if (bytes[0] === 0xfd && bytes[1] === 0xcb) return "FDCB";
  if (bytes[0] === 0xdd) return "DD";
  if (bytes[0] === 0xfd) return "FD";
  if (bytes[0] === 0xed) return "ED";
  if (bytes[0] === 0xcb) return "CB";
  return "BASE";
}

// --- the templatizer ---------------------------------------------------------
// Decode concrete FUSE bytes, detect which byte positions are OPERANDS (data the
// instruction reads, not opcode/prefix bytes), and rewrite the decoded text +
// bytes into the parameterized table-row shape.

function templatize(fullBytes) {
  const base = decode(fullBytes);
  const L = base.bytes.length;
  const instr = base.bytes.slice(0, L).map((b) => b & 0xff);
  const baseMasked = maskHex(base.text);
  const undecoded = base.text.startsWith("DB ");

  // 1) Operand byte positions. The first byte is always opcode/prefix; only
  //    length>=2 instructions can carry operand bytes. A byte is an operand iff
  //    flipping it (0x00 vs 0xFF) keeps the instruction length and the masked
  //    mnemonic shape identical (only a hex literal changes). RST's single byte
  //    is structural and excluded by the position>=1 / length>=2 guard.
  const operandPos = [];
  if (L >= 2 && !undecoded) {
    for (let i = 1; i < L; i += 1) {
      const lo = instr.slice();
      lo[i] = 0x00;
      const hi = instr.slice();
      hi[i] = 0xff;
      const dLo = decode(lo);
      const dHi = decode(hi);
      if (
        dLo.bytes.length === L &&
        dHi.bytes.length === L &&
        maskHex(dLo.text) === baseMasked &&
        maskHex(dHi.text) === baseMasked
      ) {
        operandPos.push(i);
      }
    }
  }

  // 2) Render text with all operands fixed at 0x11, then perturb each operand
  //    byte to 0xEE to locate the literal token it controls. Group positions by
  //    the literal token they map to (a 16-bit immediate = one token, two bytes).
  const aBytes = instr.slice();
  for (const p of operandPos) aBytes[p] = 0x11;
  const textA = decode(aBytes).text;
  const literals = [...textA.matchAll(/[+-]?0x[0-9A-Fa-f]+/g)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    text: m[0],
  }));

  const groupByLiteral = new Map(); // literalIndex -> [positions]
  const anomalies = [];
  for (const p of operandPos) {
    const bb = aBytes.slice();
    bb[p] = 0xee;
    const span = diffSpan(textA, decode(bb).text);
    const li = literals.findIndex((l) => span.start >= l.start && span.end <= l.end);
    if (li === -1) {
      anomalies.push(`operand byte ${p} produced no enclosing literal in "${textA}"`);
      continue;
    }
    if (!groupByLiteral.has(li)) groupByLiteral.set(li, []);
    groupByLiteral.get(li).push(p);
  }

  // 3) Classify each operand group -> token, and record the literal text span.
  const groups = [];
  const mnemonic = textA.split(/[ \t]/, 1)[0];
  for (const [li, positions] of [...groupByLiteral.entries()].sort((x, y) => x[0] - y[0])) {
    const lit = literals[li];
    const inIndex = textA.slice(lit.start - 2, lit.start) === "IX" || textA.slice(lit.start - 2, lit.start) === "IY";
    let kind;
    if (inIndex) kind = "d";
    else if (mnemonic === "JR" || mnemonic === "DJNZ") kind = "e";
    else if (positions.length === 2) kind = "nn";
    else kind = "n";
    groups.push({ kind, positions: positions.slice().sort((a, b) => a - b), lit });
  }

  // 4) Build canonical syntax: replace each operand literal token (rightmost
  //    first so indices stay valid), then normalize the structural RST literal.
  let syntax = textA;
  const replacements = groups
    .map((g) => ({ start: g.lit.start, end: g.lit.end, with: g.kind === "d" ? "+d" : g.kind }))
    .sort((a, b) => b.start - a.start);
  for (const r of replacements) {
    syntax = syntax.slice(0, r.start) + r.with + syntax.slice(r.end);
  }
  syntax = syntax.replace(/^RST 0x([0-9A-Fa-f]{2})$/, (_, h) => `RST ${h.toUpperCase()}H`);

  // 5) Build the bytes template (opcode bytes -> hex; operand bytes -> token).
  const posToken = new Map();
  for (const g of groups) {
    if (g.kind === "nn") {
      posToken.set(g.positions[0], "nn-low");
      posToken.set(g.positions[1], "nn-high");
    } else {
      for (const p of g.positions) posToken.set(p, g.kind);
    }
  }
  const bytesTemplate = [];
  for (let i = 0; i < L; i += 1) {
    bytesTemplate.push(posToken.has(i) ? { param: posToken.get(i) } : { hex: hex2(instr[i]) });
  }

  return { syntax, bytesTemplate, length: L, prefix: prefixOf(instr), undecoded, anomalies, decodedText: base.text };
}

// Canonical key for a bytes template so FUSE candidates and YAML rows compare.
function bytesKey(template) {
  return template.map((b) => (b.param ? `:${b.param}` : b.hex)).join(" ");
}

// YAML normalized bytes ({value,hex}|{parameter}) -> the same template shape.
function yamlBytesTemplate(bytes) {
  return bytes.map((b) => (b.parameter ? { param: b.parameter } : { hex: b.hex }));
}

// --- load inputs -------------------------------------------------------------

async function loadFuseSkeletons() {
  const skeletons = new Map(); // skeleton name -> { name, group, memHex }
  let totalCases = 0;
  for (const group of FUSE_GROUPS) {
    const json = JSON.parse(await readFile(path.join(fuseDir, `${group}.json`), "utf8"));
    for (const c of json.input.cases) {
      totalCases += 1;
      const name = c.name.replace(/_\d+$/, "");
      if (skeletons.has(name)) continue;
      // The instruction bytes live at the PC. Most cases run from 0x0000, but
      // forms that jump (e.g. RST) seed the opcode at a non-zero PC so the jump
      // target stays clear, recording PC in registers.pc.
      const pcKey = (c.registers?.pc ?? "0000").toUpperCase().padStart(4, "0");
      const memHex = c.memory?.[pcKey] ?? c.memory?.["0000"];
      if (!memHex) throw new Error(`FUSE ${group} case ${c.name} has no memory at PC ${pcKey}`);
      skeletons.set(name, { name, group, memHex });
    }
  }
  return { skeletons, totalCases };
}

function collectTrustedRows(table) {
  const rows = [];
  for (const enc of table.instructions) {
    rows.push({ id: enc.id, syntax: enc.canonicalSyntax, template: yamlBytesTemplate(enc.encoding.bytes) });
  }
  for (const family of table.families) {
    for (const member of family.members) {
      rows.push({ id: member.id, syntax: member.canonicalSyntax, template: yamlBytesTemplate(member.encoding.bytes) });
    }
  }
  return rows;
}

// --- main --------------------------------------------------------------------

async function main() {
  const table = await loadZ80OpcodeTable();
  const trustedRows = collectTrustedRows(table);
  const trustedByKey = new Map();
  for (const row of trustedRows) {
    const key = bytesKey(row.template);
    if (trustedByKey.has(key)) {
      // Two trusted rows sharing a bytes key would be a YAML problem; record it.
      trustedByKey.get(key).dupes.push(row);
    } else {
      trustedByKey.set(key, { row, dupes: [] });
    }
  }

  const { skeletons, totalCases } = await loadFuseSkeletons();

  // Templatize every distinct FUSE opcode skeleton.
  const candidates = []; // { name, group, key, syntax, template, prefix, ... }
  const undecodedList = [];
  const anomalyList = [];
  for (const { name, group, memHex } of skeletons.values()) {
    const fullBytes = parseHexBytes(memHex);
    const t = templatize(fullBytes);
    const key = bytesKey(t.bytesTemplate);
    candidates.push({ name, group, key, syntax: t.syntax, template: t.bytesTemplate, prefix: t.prefix, decodedText: t.decodedText });
    if (t.undecoded) undecodedList.push({ name, group, text: t.decodedText });
    for (const a of t.anomalies) anomalyList.push(`${name} (${group}): ${a}`);
    // Cross-check: opcode hex bytes (in fetch order) must equal the skeleton name.
    const opcodeHex = t.bytesTemplate.filter((b) => b.hex).map((b) => b.hex).join("").toLowerCase();
    if (opcodeHex !== name.toLowerCase()) {
      anomalyList.push(`${name} (${group}): opcode-hex "${opcodeHex}" != skeleton name "${name}"`);
    }
  }

  // ---- Ratify (a): reproduce the trusted rows -------------------------------
  const candidateByKey = new Map();
  const keyCollisions = [];
  for (const c of candidates) {
    if (candidateByKey.has(key_(c))) keyCollisions.push([candidateByKey.get(key_(c)), c]);
    else candidateByKey.set(key_(c), c);
  }
  function key_(c) {
    return c.key;
  }

  const matched = [];
  const syntaxMismatches = [];
  const trustedNotInFuse = [];
  for (const row of trustedRows) {
    const key = bytesKey(row.template);
    const cand = candidateByKey.get(key);
    if (!cand) {
      trustedNotInFuse.push(row);
      continue;
    }
    if (cand.syntax === row.syntax) {
      matched.push({ row, cand });
    } else {
      syntaxMismatches.push({ row, cand });
    }
  }

  // ---- Ratify (c): Phase-B worklist (candidates not among trusted) ----------
  const worklist = candidates.filter((c) => !trustedByKey.has(c.key));
  const byPrefix = new Map();
  for (const c of worklist) {
    if (!byPrefix.has(c.prefix)) byPrefix.set(c.prefix, []);
    byPrefix.get(c.prefix).push(c);
  }

  // Syntax collisions: distinct candidate byte templates that share a mnemonic
  // syntax (decode-only undocumented duplicates -> encode ambiguity to flag).
  const bySyntax = new Map();
  for (const c of candidates) {
    if (!bySyntax.has(c.syntax)) bySyntax.set(c.syntax, []);
    bySyntax.get(c.syntax).push(c);
  }
  const syntaxCollisions = [...bySyntax.entries()].filter(([, list]) => list.length > 1);

  // ----------------------------- REPORT --------------------------------------
  const line = "=".repeat(78);
  console.log(line);
  console.log("Z80 OPCODE-TABLE GENERATOR — Phase A1 ratification report (offline, no DNA mutated)");
  console.log(line);

  console.log(`\nSEED (FUSE executable boundary)`);
  console.log(`  FUSE single-step cases (total) : ${totalCases}`);
  console.log(`  distinct opcode skeletons      : ${skeletons.size}`);
  const perGroup = {};
  for (const s of skeletons.values()) perGroup[s.group] = (perGroup[s.group] ?? 0) + 1;
  console.log(`  per group                      : ${FUSE_GROUPS.map((g) => `${g}=${perGroup[g] ?? 0}`).join("  ")}`);

  console.log(`\nTRUSTED SET (hand-authored YAML rows)`);
  console.log(`  instruction rows               : ${table.instructions.length}`);
  console.log(`  family member rows             : ${table.families.reduce((a, f) => a + f.members.length, 0)}`);
  console.log(`  total trusted rows             : ${trustedRows.length}`);

  console.log(`\nRATIFY (b) — COMPLETENESS + UNIQUENESS`);
  console.log(`  candidates generated           : ${candidates.length}`);
  console.log(`  undecoded (DB fallback)        : ${undecodedList.length}`);
  if (undecodedList.length) {
    for (const u of undecodedList) console.log(`     ! ${u.name} (${u.group}) -> ${u.text}`);
  }
  console.log(`  bytes-key collisions           : ${keyCollisions.length}` + (keyCollisions.length ? "  (STOP — two byte-seqs share a template key)" : ""));
  for (const [a, b] of keyCollisions) console.log(`     ! ${a.name} vs ${b.name} both key="${a.key}"`);
  console.log(`  templatizer anomalies          : ${anomalyList.length}`);
  for (const a of anomalyList) console.log(`     ! ${a}`);

  console.log(`\nRATIFY (a) — REPRODUCE THE TRUSTED ROWS`);
  console.log(`  trusted rows reproduced        : ${matched.length} / ${trustedRows.length}`);
  console.log(`  syntax mismatches              : ${syntaxMismatches.length}`);
  for (const m of syntaxMismatches) {
    console.log(`     ! key="${bytesKey(m.row.template)}"`);
    console.log(`         YAML (${m.row.id}): "${m.row.syntax}"`);
    console.log(`         GEN  (${m.cand.name}/${m.cand.group}): "${m.cand.syntax}"  [decoded "${m.cand.decodedText}"]`);
  }
  console.log(`  trusted rows NOT seen in FUSE  : ${trustedNotInFuse.length}`);
  for (const r of trustedNotInFuse) console.log(`     ! ${r.id}: "${r.syntax}"  key="${bytesKey(r.template)}"`);

  console.log(`\nRATIFY (c) — PHASE-B WORKLIST (candidates not among trusted)`);
  console.log(`  total new candidate rows       : ${worklist.length}`);
  const order = ["BASE", "CB", "ED", "DD", "FD", "DDCB", "FDCB"];
  for (const pfx of order) {
    const list = byPrefix.get(pfx) ?? [];
    console.log(`  ${pfx.padEnd(5)} : ${list.length}`);
  }
  for (const pfx of order) {
    const list = (byPrefix.get(pfx) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) continue;
    console.log(`\n  --- ${pfx} sample candidates (up to 10) ---`);
    const step = Math.max(1, Math.floor(list.length / 10));
    const samples = [];
    for (let i = 0; i < list.length && samples.length < 10; i += step) samples.push(list[i]);
    for (const c of samples) {
      console.log(`     ${c.name.padEnd(8)} ${bytesKey(c.template).padEnd(26)} -> ${c.syntax}`);
    }
  }

  console.log(`\nDECODE-ONLY SYNTAX COLLISIONS (same mnemonic, distinct bytes — undocumented dups)`);
  console.log(`  colliding syntaxes             : ${syntaxCollisions.length}`);
  for (const [syntax, list] of syntaxCollisions.slice().sort((a, b) => b[1].length - a[1].length)) {
    console.log(`     "${syntax}" <- ${list.map((c) => c.name).join(", ")}`);
  }

  console.log(`\n${line}`);
  const ok =
    syntaxMismatches.length === 0 &&
    undecodedList.length === 0 &&
    keyCollisions.length === 0 &&
    anomalyList.length === 0 &&
    trustedNotInFuse.length === 0;
  console.log(`RESULT: reproduce-trusted=${matched.length}/${trustedRows.length}  ` +
    `completeness=${candidates.length - undecodedList.length}/${candidates.length}  ` +
    `worklist=${worklist.length}  ` +
    `${ok ? "RATIFIED-CLEAN" : "REVIEW-REQUIRED (see flags above)"}`);
  console.log(line);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
