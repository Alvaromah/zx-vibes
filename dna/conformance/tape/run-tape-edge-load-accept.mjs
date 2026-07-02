#!/usr/bin/env node
// OFFLINE ACCEPTANCE harness for ROM tape edge-loading (TAPE-EDGE-LOAD-ACCEPT-001,
// dna/domain/tape-loading.md "Edge loading"). NOT part of conformance:check — like the
// zexdoc/zexall rows, this is offline acceptance evidence (it runs the real ROM over a
// full program and is recorded in .harness/decisions.md), not the CI gate.
//
// It is the ADR-0024 FABRICATION-FREE INTEGRATION ORACLE: a closed loop over already-
// conformed components, so the expected value is "the bytes we assembled", never a hand-
// authored constant.
//
//   assemble a real program with @zx-vibes/asm  (W2 assembler)
//     -> wrap it to a .tap (header block + data block) with serializeTap  (W10.6)
//     -> round-trip through parseTap                                       (W10.6)
//     -> encode each block to EAR pulses with blockToPulses               (W10.9)
//     -> edge-load each block through the real ROM LD-BYTES (0x0556)       (W10.8 + W10.10)
//     -> ASSERT the loaded RAM is byte-identical to the assembled bytes.
//
// Exits 0 on success, 1 on any mismatch.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const asmModule = path.join(repoRoot, "packages", "asm", "dist", "index.js");
const machineModule = path.join(repoRoot, "packages", "machine", "src", "index.mjs");
const romPath = path.join(thisDir, "..", "rom", "spectrum-48k.rom");

// A real, non-trivial program: a screen clear + a border-cycling loop + a data table
// (DEFB/DEFW/DEFM). Its behaviour is irrelevant to the oracle — only that it assembles to
// real Z80 bytes that must reach RAM byte-identical.
const PROGRAM = [
  "        org 0x8000",
  "start:  di",
  "        ld hl, 0x4000",
  "        ld de, 0x4001",
  "        ld bc, 0x17ff",
  "        ld (hl), 0",
  "        ldir                ; clear the display file",
  "        ld a, 0x38",
  "        ld hl, 0x5800",
  "        ld de, 0x5801",
  "        ld bc, 0x02ff",
  "        ld (hl), a",
  "        ldir                ; paint the attributes",
  "        ld a, 7",
  "main:   out (0xfe), a       ; border",
  "        ld b, 0",
  "wait:   djnz wait",
  "        dec a",
  "        and 7",
  "        call sub",
  "        jr main",
  "sub:    push af",
  "        ld a, (counter)",
  "        inc a",
  "        ld (counter), a",
  "        pop af",
  "        ret",
  "counter: defb 0",
  "table:  defb 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16",
  "        defw 0x1234, 0xabcd, 0xbeef, 0xcafe",
  "        defm \"ZX VIBES DNA — edge-load acceptance\"",
  "        defb 0xff",
];

// A faithful 17-byte ZX tape header (the data inside a header block): type(1) + name(10) +
// length(2 LE) + param1(2 LE) + param2(2 LE). Its fields are not interpreted here (we call
// LD-BYTES per block directly), only loaded back byte-identical.
function tapeHeader17({ type = 3, name = "edgeload", length, param1, param2 = 0x8000 }) {
  const h = new Uint8Array(17);
  h[0] = type & 0xff;
  const padded = (name + " ".repeat(10)).slice(0, 10);
  for (let i = 0; i < 10; i += 1) h[1 + i] = padded.charCodeAt(i) & 0xff;
  h[11] = length & 0xff; h[12] = (length >> 8) & 0xff;
  h[13] = param1 & 0xff; h[14] = (param1 >> 8) & 0xff;
  h[15] = param2 & 0xff; h[16] = (param2 >> 8) & 0xff;
  return h;
}

function bytesToHex(b) { let o = ""; for (const x of b) o += (x & 0xff).toString(16).padStart(2, "0"); return o; }
function sameBytes(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false; return true; }

async function main() {
  const asm = await import(pathToFileURL(asmModule).href);
  const M = await import(pathToFileURL(machineModule).href);
  const rom = new Uint8Array(await readFile(romPath));

  // 1. Assemble the program with the conformed assembler.
  const result = asm.assemble(PROGRAM.join("\n"));
  if (!result.ok) {
    console.error("acceptance: program failed to assemble:");
    for (const d of result.diagnostics ?? []) console.error(`  ${d.severity ?? "error"}: ${d.message}`);
    return 1;
  }
  const code = result.bytes;
  const origin = result.origin;
  console.log(`acceptance: assembled ${code.length} bytes at org 0x${origin.toString(16)}`);

  // 2. Wrap to a .tap with the conformed writer: a header block (flag 0x00) + a data block
  //    (flag 0xFF), exactly as a real SAVE "name" CODE would.
  const header = tapeHeader17({ name: "edgeload", length: code.length, param1: origin });
  const blocks = [
    { flag: 0x00, data: header },
    { flag: 0xff, data: code },
  ];
  const tap = M.serializeTap(blocks);

  // 3. Round-trip the container through the conformed parser.
  const parsed = M.parseTap(tap);
  if (parsed.length !== blocks.length
    || !parsed.every((b, i) => b.flag === blocks[i].flag && sameBytes(b.data, blocks[i].data))) {
    console.error("acceptance: .tap did not round-trip through parseTap");
    return 1;
  }

  // 4. Edge-load each parsed block through the real ROM, on one shared machine (a real
  //    multi-block tape load), to distinct RAM destinations.
  const memory = new Uint8Array(0x10000);
  memory.set(rom, 0x0000);
  const machine = M.createMachine({ memory });

  const targets = [
    { name: "header", block: parsed[0], ix: 0x9000 },
    { name: "code", block: parsed[1], ix: origin },
  ];
  let failures = 0;
  for (const { name, block, ix } of targets) {
    const body = Uint8Array.from([block.flag, ...block.data, M.tapChecksum(block.flag, block.data)]);
    const pulses = M.blockToPulses(body);
    const r = M.edgeLoad(machine, pulses, { ix, de: block.data.length, flag: block.flag, tStateBudget: 30_000_000 });
    const loaded = machine.memory.slice(ix, ix + block.data.length);
    const identical = sameBytes(loaded, block.data);
    if (!r.ok || !identical) {
      failures += 1;
      console.error(`acceptance: ${name} block FAILED — ok=${r.ok} identical=${identical} (reason ${r.reason}, ${r.tStates} T)`);
      console.error(`  expected ${bytesToHex(block.data).slice(0, 64)}…`);
      console.error(`  loaded   ${bytesToHex(loaded).slice(0, 64)}…`);
    } else {
      console.log(`acceptance: ${name} block loaded byte-identical (${block.data.length} bytes -> 0x${ix.toString(16)}, ${r.tStates} T)`);
    }
  }

  if (failures > 0) { console.error(`acceptance: ${failures} block(s) failed`); return 1; }
  console.log(`acceptance PASS: assemble -> .tap -> parse -> edge-load -> RAM-identity over a full program (${code.length}-byte CODE + 17-byte header). Fabrication-free closed loop (ADR-0024).`);
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exitCode = 1;
});
