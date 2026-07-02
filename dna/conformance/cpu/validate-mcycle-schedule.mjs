#!/usr/bin/env node
// Validation tool (offline; NOT part of the conformance gate, like
// build-fuse-fixtures.mjs). It proves the M-cycle-exact contention model carries
// NO silent debt (constraint C5): for every single-step FUSE case, the bus-cycle
// schedule @zx-vibes/cpu emits (via the clock.mcycle/internal hooks) must either
//
//   (a) match FUSE's own per-instruction memory-cycle timeline exactly
//       (offsets + bus addresses of every MC contention point), in which case the
//       machine's exact clock (MACHINE-CONTENTION-MCYCLE-001) is provably correct
//       for that instruction; or
//   (b) be explicitly marked inexact() by the CPU, in which case the machine
//       falls back to the conformed per-access model (MACHINE-CONTENTION-CLOCK-001).
//
// A case that is neither (a strictly-wrong schedule that is NOT flagged inexact)
// is a SILENT failure and exits non-zero. Multi-instruction (run-to-budget) FUSE
// cases are reported separately: one step() emits a correct prefix of FUSE's
// timeline, which is expected.
//
// The FUSE payload (tests.in / tests.expected) is the same hash-pinned artifact
// build-fuse-fixtures.mjs transcribes; this tool reads its event timeline, which
// the committed per-opcode fixtures intentionally drop. When the payload is not
// cached the tool prints NOT_RUN and exits 0 (offline, like the full zex runs).
//
// Run: node dna/conformance/cpu/validate-mcycle-schedule.mjs
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const payloadDir = path.join(
  repoRoot, ".cache", "external-suites", "artifacts",
  "ext-fuse-z80-tests-001", "z80", "tests",
);
const stepModule = path.join(repoRoot, "packages", "cpu", "src", "z80-step.mjs");

function parseIn(txt) {
  const lines = txt.split(/\r?\n/);
  let i = 0; const cases = {};
  while (i < lines.length) {
    if (lines[i].trim() === "") { i += 1; continue; }
    const name = lines[i].trim(); i += 1;
    const regs = lines[i].trim().split(/\s+/).map((x) => parseInt(x, 16)); i += 1;
    const sl = lines[i].trim().split(/\s+/); i += 1; // I R IFF1 IFF2 IM halted tstates
    const mem = {};
    while (i < lines.length && lines[i].trim() !== "") {
      const t = lines[i].trim().split(/\s+/); i += 1;
      let a = parseInt(t[0], 16);
      for (let k = 1; k < t.length; k += 1) { if (t[k] === "-1") break; mem[a & 0xffff] = parseInt(t[k], 16); a += 1; }
    }
    cases[name] = { regs, I: parseInt(sl[0], 16), R: parseInt(sl[1], 16), iff1: +sl[2], iff2: +sl[3], im: +sl[4], mem };
  }
  return cases;
}

function parseExpected(txt) {
  const lines = txt.split(/\r?\n/);
  let i = 0; const cases = {};
  while (i < lines.length) {
    if (lines[i].trim() === "") { i += 1; continue; }
    const name = lines[i].trim(); i += 1;
    const mc = [];
    while (i < lines.length && /^\s+\d/.test(lines[i])) {
      const t = lines[i].trim().split(/\s+/); i += 1;
      if (t[1] === "MC") mc.push([parseInt(t[0], 10), parseInt(t[2], 16)]); // contention points only
    }
    while (i < lines.length && lines[i].trim() !== "") i += 1; // skip state/memory
    cases[name] = mc;
  }
  return cases;
}

function buildRegisters(c) {
  const r = {
    a: 0, f: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
    a_: 0, f_: 0, b_: 0, c_: 0, d_: 0, e_: 0, h_: 0, l_: 0,
    pc: 0, sp: 0, i: 0, r: 0, iff1: 0, iff2: 0, im: 0, memptr: 0,
    ixh: 0, ixl: 0, iyh: 0, iyl: 0,
  };
  const w = c.regs;
  const s = (hi, lo, v) => { r[hi] = (v >> 8) & 0xff; r[lo] = v & 0xff; };
  s("a", "f", w[0]); s("b", "c", w[1]); s("d", "e", w[2]); s("h", "l", w[3]);
  s("a_", "f_", w[4]); s("b_", "c_", w[5]); s("d_", "e_", w[6]); s("h_", "l_", w[7]);
  s("ixh", "ixl", w[8]); s("iyh", "iyl", w[9]); r.sp = w[10]; r.pc = w[11]; r.memptr = w[12];
  r.i = c.I; r.r = c.R; r.iff1 = c.iff1; r.iff2 = c.iff2; r.im = c.im;
  return r;
}

async function main() {
  try { await access(path.join(payloadDir, "tests.expected")); }
  catch {
    console.log("M-cycle schedule validation: NOT_RUN (FUSE payload not cached). Run `pnpm external-suites:payloads` to resolve it.");
    return 0;
  }
  const { step } = await import(pathToFileURL(stepModule).href);
  const ins = parseIn(await readFile(path.join(payloadDir, "tests.in"), "utf8"));
  const exps = parseExpected(await readFile(path.join(payloadDir, "tests.expected"), "utf8"));

  let exact = 0, fallback = 0, budgetPrefix = 0;
  const silent = [];
  for (const name of Object.keys(ins)) {
    const fmc = exps[name];
    if (!fmc) continue;
    const reg = buildRegisters(ins[name]);
    const memory = new Uint8Array(0x10000);
    for (const [a, v] of Object.entries(ins[name].mem)) memory[a] = v;
    const mc = []; let t = 0; let inexact = false;
    const io = { read: (p) => (p >> 8) & 0xff, write: () => {} };
    const clock = {
      mcycle(addr, len) { mc.push([t, addr & 0xffff]); t += len; },
      internal(addr, n) { for (let k = 0; k < n; k += 1) { mc.push([t, addr & 0xffff]); t += 1; } },
      inexact() { inexact = true; },
    };
    try { step({ registers: reg, memory, io, clock }); }
    catch (err) { silent.push(`${name}: threw ${err instanceof Error ? err.message : err}`); continue; }
    const n = Math.min(mc.length, fmc.length);
    let prefixOk = true;
    for (let k = 0; k < n; k += 1) { if (mc[k][0] !== fmc[k][0] || mc[k][1] !== fmc[k][1]) { prefixOk = false; break; } }
    if (prefixOk && mc.length === fmc.length) exact += 1;
    else if (inexact) fallback += 1;
    else if (prefixOk && mc.length < fmc.length) budgetPrefix += 1; // multi-instruction case
    else silent.push(`${name}: schedule diverges from FUSE and is not flagged inexact (mine=${mc.length} fuse=${fmc.length})`);
  }

  console.log(`M-cycle schedule validation vs pinned FUSE timeline:`);
  console.log(`  exact (schedule matches FUSE)      = ${exact}`);
  console.log(`  fallback (CPU flagged inexact)     = ${fallback}`);
  console.log(`  budget prefix (multi-instruction)  = ${budgetPrefix}`);
  console.log(`  SILENT (wrong & unflagged)         = ${silent.length}`);
  if (silent.length > 0) {
    for (const s of silent) console.error(`- ${s}`);
    console.error("M-cycle schedule validation FAILED: silent contention debt detected (C5).");
    return 1;
  }
  console.log("M-cycle schedule validation passed: every single-step FUSE case is schedule-exact or honestly flagged inexact.");
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 2;
});
