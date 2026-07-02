#!/usr/bin/env node
// Fast self-test for the independent zex CP/M reference adapter (ADR-0006).
//
// The real zexdoc/zexall suites run billions of T-states (an offline validation,
// not a CI gate). This self-test instead drives the SAME adapter
// (zex-cpm-cpu-adapter.mjs, backed by @zx-vibes/cpu) on tiny synthetic CP/M COM
// programs in microseconds, proving the CP/M monitor wiring is correct: BDOS
// function 9 ($-string) and function 2 (char) reach the console, warm boot at
// 0x0000 ends the run, and the zex-style classifier maps the transcript to
// pass/fail. That keeps the reference's harness honest in the gate while the
// full-suite acceptance run (ADR-0006) stays offline.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCom, classifyConsole } from "./zex-cpm-cpu-adapter.mjs";

const PROGRAM_LOAD = 0x0100;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Assemble a tiny COM that prints `text` via BDOS func 9 then warm-boots (JP 0).
// Layout at 0x100: LD DE,msg / LD C,9 / CALL 5 / JP 0 / msg "<text>$"
function buildPrintStringCom(text) {
  const header = [];
  const msgAddr = PROGRAM_LOAD + 11; // 11 bytes of code precede the message
  header.push(0x11, msgAddr & 0xff, (msgAddr >> 8) & 0xff); // LD DE,msg
  header.push(0x0e, 0x09); // LD C,9
  header.push(0xcd, 0x05, 0x00); // CALL 0x0005
  header.push(0xc3, 0x00, 0x00); // JP 0x0000
  const body = [...text].map((c) => c.charCodeAt(0));
  body.push(0x24); // '$'
  return Buffer.from([...header, ...body]);
}

// Assemble a tiny COM that prints one char via BDOS func 2 then warm-boots.
// Layout at 0x100: LD E,ch / LD C,2 / CALL 5 / JP 0
function buildPrintCharCom(ch) {
  return Buffer.from([
    0x1e, ch & 0xff, // LD E,ch
    0x0e, 0x02, // LD C,2
    0xcd, 0x05, 0x00, // CALL 0x0005
    0xc3, 0x00, 0x00, // JP 0x0000
  ]);
}

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zex-cpu-adapter-self-test-"));
  try {
    const okCom = path.join(dir, "ok.com");
    const errCom = path.join(dir, "err.com");
    const charCom = path.join(dir, "char.com");
    await writeFile(okCom, buildPrintStringCom("Tests complete"));
    await writeFile(errCom, buildPrintStringCom("oops ERROR 0001"));
    await writeFile(charCom, buildPrintCharCom(0x5a)); // 'Z'

    const max = 100_000;

    // 1. BDOS func 9 + warm boot: the string reaches the console and the run
    //    completes; the classifier reports pass on "Tests complete" with no ERROR.
    const ok = await runCom(okCom, { maxInstructions: max });
    assert(ok.completed, "expected the print-string COM to warm-boot (complete)");
    assert(ok.console === "Tests complete", `expected console 'Tests complete', got ${JSON.stringify(ok.console)}`);
    const okClass = classifyConsole(ok.console, ok.completed, ok.instructions, max);
    assert(okClass.status === "pass", `expected pass classification, got ${okClass.status}`);

    // 2. An ERROR in the transcript classifies as fail (even though it completed).
    const err = await runCom(errCom, { maxInstructions: max });
    const errClass = classifyConsole(err.console, err.completed, err.instructions, max);
    assert(errClass.status === "fail", `expected fail classification on ERROR, got ${errClass.status}`);

    // 3. BDOS func 2 emits a single character.
    const ch = await runCom(charCom, { maxInstructions: max });
    assert(ch.completed && ch.console === "Z", `expected console 'Z', got ${JSON.stringify(ch.console)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Zex CP/M CPU adapter self-test passed: @zx-vibes/cpu drives the CP/M monitor (BDOS 9/2, warm boot) and the zex classifier maps pass/fail.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
