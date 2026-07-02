// @zx-vibes/cpu — regenerated Z80 CPU core.
//
// The implementation is decided by the FUSE per-case conformance oracle
// (dna/conformance/cpu/fuse/*.json) and authored from the project DNA
// (dna/domain/z80-opcodes.{md,yaml}, dna/domain/z80-cpu-execution.md). It covers
// single-instruction execution for the whole base/CB/ED/DD/FD/DDCB/FDCB opcode
// space except the explicitly excluded classes (port I/O, HALT, repeating block
// ops, MEMPTR output) tracked in .harness/decisions.md (ADR-0009).
export { step } from "./z80-step.mjs";
