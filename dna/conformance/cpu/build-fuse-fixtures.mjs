#!/usr/bin/env node
// Authoring tool (NOT part of the conformance gate). Reads the pinned FUSE Z80
// test payload (tests.in / tests.expected) and emits CPU-step conformance
// fixtures for the whole instruction set, grouped by opcode prefix. The expected
// values are transcribed verbatim from FUSE (provenance `fuse`), so this is the
// mechanical authoring of the emulator's CPU-execution conformance suite from an
// external, hash-pinned oracle (specs-plan §3.6; the EMULATOR PIVOT at scale).
//
// Each FUSE test has the format (see z80/tests/README):
//   <desc>
//   AF BC DE HL AF' BC' DE' HL' IX IY SP PC MEMPTR        (13 hex words)
//   I R IFF1 IFF2 IM <halted> <tstates>
//   <addr> <b..> -1 ...   (initial memory)   then a lone -1
// tests.expected mirrors it with an event list before the register line and the
// changed-memory bytes after the state line; <tstates> there is the final time.
//
// MEMPTR (WZ, the internal latch) is now asserted on output as well as fed as
// input: the G-2 relaxation was lifted once @zx-vibes/cpu modeled the full
// per-instruction WZ-update rules (ADR-0009 G-2 / ADR-0020). Everything is
// emitted: single-instruction cases (FUSE input budget == 1) become cpu-step
// fixtures under `fuse/`; multi-instruction cases (budget > 1: DJNZ/block-op
// loops and prefix NONI timing) become run-to-budget cpu-run fixtures under
// `fuse-budget/`. See .harness/decisions.md ADR-0009 / ADR-0020.
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultPayloadDir = path.join(
  repoRoot,
  ".cache",
  "external-suites",
  "artifacts",
  "ext-fuse-z80-tests-001",
  "z80",
  "tests",
);
const defaultOutDir = path.join(thisDir, "fuse");

// Port I/O (IN/OUT, block I/O including the repeating forms) and HALT are modeled
// via the io interface (see run-cpu-exec-fixtures.mjs). Multi-instruction cases
// are routed to run-to-budget fixtures rather than excluded (the budget split
// below).

function parseArgs(argv) {
  const options = { payloadDir: defaultPayloadDir, outDir: defaultOutDir, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--payload-dir") {
      options.payloadDir = path.resolve(argv[++i] ?? "");
    } else if (arg === "--out") {
      options.outDir = path.resolve(argv[++i] ?? "");
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const isBlank = (line) => line.trim() === "";
const isTerminator = (line) => line.trim() === "-1";
const tokens = (line) => line.trim().split(/\s+/);

function parseMemoryLine(line) {
  const parts = tokens(line);
  // <addr> <b..> -1
  const addr = Number.parseInt(parts[0], 16);
  const bytes = parts.slice(1, -1).map((b) => Number.parseInt(b, 16));
  return { addr, bytes };
}

// Collapse FUSE memory lines into { "<addr4hex>": "<contiguous hex bytes>" }.
function memoryToObject(lines) {
  const out = {};
  for (const { addr, bytes } of lines) {
    if (bytes.length === 0) continue;
    out[addr.toString(16).toUpperCase().padStart(4, "0")] = bytes
      .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
      .join("");
  }
  return out;
}

// The state line is "I R IFF1 IFF2 IM <halted> <tstates>". I and R are HEX
// bytes; IFF1/IFF2/IM/halted are 0/1/2 (base-agnostic); tstates is DECIMAL.
// Parsing the whole line base-10 silently corrupts I/R whenever they carry a
// hex digit (e.g. "1e" -> 1), which breaks LD A,I / LD A,R. Parse per field.
function parseState(line) {
  const t = tokens(line);
  return [
    Number.parseInt(t[0], 16), // I (hex)
    Number.parseInt(t[1], 16), // R (hex)
    Number.parseInt(t[2], 10), // IFF1
    Number.parseInt(t[3], 10), // IFF2
    Number.parseInt(t[4], 10), // IM
    Number.parseInt(t[5], 10), // halted
    Number.parseInt(t[6], 10), // tstates (decimal)
  ];
}

function parseIn(text) {
  const lines = text.split(/\r?\n/);
  const map = new Map();
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && isBlank(lines[i])) i += 1;
    if (i >= lines.length) break;
    const desc = lines[i++].trim();
    const words = tokens(lines[i++]).map((w) => Number.parseInt(w, 16));
    const state = parseState(lines[i++]);
    const memory = [];
    while (i < lines.length && !isTerminator(lines[i])) {
      memory.push(parseMemoryLine(lines[i++]));
    }
    i += 1; // consume the lone -1
    map.set(desc, { words, state, memory });
  }
  return map;
}

function parseExpected(text) {
  const lines = text.split(/\r?\n/);
  const map = new Map();
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && isBlank(lines[i])) i += 1;
    if (i >= lines.length) break;
    const desc = lines[i++].trim();
    const events = [];
    while (i < lines.length && /^\s+\d+\s+(MR|MW|MC|PR|PW|PC)/.test(lines[i])) {
      const t = tokens(lines[i]); // <time> <type> <addr> [data]
      if (t[1] === "PR" || t[1] === "PW") {
        events.push({ type: t[1], port: Number.parseInt(t[2], 16), data: Number.parseInt(t[3], 16) });
      }
      i += 1;
    }
    const words = tokens(lines[i++]).map((w) => Number.parseInt(w, 16));
    const state = parseState(lines[i++]);
    const memory = [];
    while (i < lines.length && !isBlank(lines[i])) {
      if (isTerminator(lines[i])) { i += 1; break; }
      memory.push(parseMemoryLine(lines[i++]));
    }
    map.set(desc, { words, state, memory, events });
  }
  return map;
}

const hi = (w) => (w >> 8) & 0xff;
const lo = (w) => w & 0xff;
const h2 = (v) => v.toString(16).toUpperCase().padStart(2, "0");
const h4 = (v) => v.toString(16).toUpperCase().padStart(4, "0");

// Decompose the 13 register words + state into the runner's register contract.
// MEMPTR (WZ, the 13th word) is fed as INPUT so instructions whose flags depend
// on it (notably BIT n,(HL), whose undocumented 5/3 bits come from WZ-high) are
// constrainable, AND asserted in the EXPECTED block (the G-2 relaxation is lifted
// now that the core models the full WZ-update rules). See ADR-0009 / ADR-0020.
function decompose(words, state) {
  const [af, bc, de, hl, af_, bc_, de_, hl_, ix, iy, sp, pc, memptr] = words;
  const [i, r, iff1, iff2, im] = state;
  return {
    a: hi(af), f: lo(af), b: hi(bc), c: lo(bc), d: hi(de), e: lo(de), h: hi(hl), l: lo(hl),
    a_: hi(af_), f_: lo(af_), b_: hi(bc_), c_: lo(bc_), d_: hi(de_), e_: lo(de_), h_: hi(hl_), l_: lo(hl_),
    ixh: hi(ix), ixl: lo(ix), iyh: hi(iy), iyl: lo(iy),
    sp, pc, memptr, i, r, iff1, iff2, im,
  };
}

function registersToHex(reg, { all }) {
  const out = {};
  for (const [name, value] of Object.entries(reg)) {
    if (!all && value === 0) continue; // input: emit only nonzero (runner defaults to 0)
    out[name] = name === "sp" || name === "pc" ? h4(value) : h2(value);
  }
  return out;
}

function classify(desc) {
  const hex = (desc.match(/^[0-9a-fA-F]+/)?.[0] ?? "").toLowerCase();
  if (hex.startsWith("ddcb")) return { group: "ddcb" };
  if (hex.startsWith("fdcb")) return { group: "fdcb" };
  if (hex.startsWith("cb")) return { group: "cb" };
  if (hex.startsWith("ed")) return { group: "ed" };
  if (hex.startsWith("dd")) return { group: "dd" };
  if (hex.startsWith("fd")) return { group: "fd" };
  return { group: "base" };
}

const GROUP_IDS = {
  base: "CPU-FUSE-BASE-001", cb: "CPU-FUSE-CB-001", ed: "CPU-FUSE-ED-001",
  dd: "CPU-FUSE-DD-001", fd: "CPU-FUSE-FD-001", ddcb: "CPU-FUSE-DDCB-001", fdcb: "CPU-FUSE-FDCB-001",
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node dna/conformance/cpu/build-fuse-fixtures.mjs [--payload-dir <dir>] [--out <dir>] [--quiet]");
    return;
  }

  let inText;
  let expectedText;
  try {
    inText = await readFile(path.join(options.payloadDir, "tests.in"), "utf8");
    expectedText = await readFile(path.join(options.payloadDir, "tests.expected"), "utf8");
  } catch (error) {
    console.error(`FUSE payload not found under ${options.payloadDir}.`);
    console.error("Resolve it first: node dna/conformance/external-payloads.mjs --suite fuse-z80-tests");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  const inputs = parseIn(inText);
  const expected = parseExpected(expectedText);

  const groups = new Map();        // single-step (cpu-step) groups
  const budgetGroups = new Map();  // run-to-budget (cpu-run) groups
  const skipped = { noExpected: 0 };
  const budgetCases = [];
  let emitted = 0;
  let emittedBudget = 0;

  for (const [desc, input] of inputs) {
    const exp = expected.get(desc);
    if (!exp) { skipped.noExpected += 1; continue; }
    const { group } = classify(desc);

    const inReg = registersToHex(decompose(input.words, input.state), { all: false });
    const outFull = decompose(exp.words, exp.state);
    const outReg = registersToHex(outFull, { all: true }); // MEMPTR (WZ) asserted on output (ADR-0009 G-2 lifted, ADR-0020)

    // Port I/O: PR events (what each read port returned) feed the input io.reads;
    // PW events (what was written) become asserted io.writes.
    const reads = {};
    const writes = [];
    for (const ev of exp.events) {
      if (ev.type === "PR") reads[h4(ev.port)] = h2(ev.data);
      else writes.push({ port: h4(ev.port), value: h2(ev.data) });
    }

    const inCase = { name: desc, registers: inReg, memory: memoryToObject(input.memory) };
    if (Object.keys(reads).length > 0) inCase.io = { reads };
    const expCase = { name: desc, registers: outReg, memory: memoryToObject(exp.memory), tStates: exp.state[6] };
    if (writes.length > 0) expCase.io = { writes };

    // FUSE input budget (state[6]) > 1 means the harness runs MULTIPLE instructions
    // until the T-state budget is reached (DJNZ/block-op loops, prefix NONI timing):
    // route to a run-to-budget (cpu-run) case carrying the input budget. budget == 1
    // is the ordinary single-instruction case (exactly one opcode of any duration).
    if (input.state[6] > 1) {
      inCase.budget = input.state[6];
      if (!budgetGroups.has(group)) budgetGroups.set(group, { input: [], expected: [] });
      const bucket = budgetGroups.get(group);
      bucket.input.push(inCase);
      bucket.expected.push(expCase);
      budgetCases.push(`${desc}(${input.state[6]}->${exp.state[6]}t)`);
      emittedBudget += 1;
    } else {
      if (!groups.has(group)) groups.set(group, { input: [], expected: [] });
      const bucket = groups.get(group);
      bucket.input.push(inCase);
      bucket.expected.push(expCase);
      emitted += 1;
    }
  }

  await rm(options.outDir, { recursive: true, force: true });
  await mkdir(options.outDir, { recursive: true });
  const budgetOutDir = `${options.outDir}-budget`;
  await rm(budgetOutDir, { recursive: true, force: true });
  await mkdir(budgetOutDir, { recursive: true });

  const summary = [];
  for (const [group, { input, expected: exp }] of [...groups.entries()].sort()) {
    const fixture = {
      id: GROUP_IDS[group] ?? `CPU-FUSE-${group.toUpperCase()}-001`,
      tier: "fidelity",
      provenance: "fuse",
      input: { kind: "cpu-step", note: `FUSE Z80 tests, ${group} opcode group; MEMPTR (WZ) asserted on output; port I/O via io.reads/io.writes.`, cases: input },
      expected: { cases: exp },
      normalization: { profile: "custom" },
    };
    await writeFile(path.join(options.outDir, `${group}.json`), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    summary.push(`${group}=${input.length}`);
  }

  const budgetSummary = [];
  for (const [group, { input, expected: exp }] of [...budgetGroups.entries()].sort()) {
    const fixture = {
      id: `CPU-FUSE-BUDGET-${group.toUpperCase()}-001`,
      tier: "fidelity",
      provenance: "fuse",
      input: { kind: "cpu-run", note: `FUSE Z80 multi-instruction (run-to-budget) cases, ${group} group: DJNZ/block-op loops and prefix NONI timing. Each case runs whole opcodes until its input budget T-states; expected tStates is the final accumulated count.`, cases: input },
      expected: { cases: exp },
      normalization: { profile: "custom" },
    };
    await writeFile(path.join(budgetOutDir, `${group}.json`), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    budgetSummary.push(`${group}=${input.length}`);
  }

  if (!options.quiet) {
    console.log(`FUSE fixtures: emitted ${emitted} single-step case(s) across ${groups.size} group(s) [${summary.join(", ")}]`);
    console.log(`FUSE fixtures: emitted ${emittedBudget} run-to-budget case(s) across ${budgetGroups.size} group(s) [${budgetSummary.join(", ")}]`);
    console.log(`FUSE fixtures: run-to-budget cases: ${budgetCases.join(", ")}`);
    console.log(`FUSE fixtures: skipped ${skipped.noExpected} without expected (logged, not silent)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
