#!/usr/bin/env node
/**
 * Self-test for the round-trip oracle's primitive `roundtripByteCase`. It must
 * accept a correct canonical round-trip and a correct decode-only alias, and it
 * must REJECT every way the bijection can break: an undecoded byte (DB fallback),
 * an un-assemblable mnemonic, and a mnemonic that does not survive re-encoding.
 * Stubbed assemble/disasm exercise the comparison logic without the built package.
 */
import { roundtripByteCase } from "./run-roundtrip.mjs";

const ORG = 0x8000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Build a stub asm. `decode(b0, b1)` returns {text, len}; `encode(text)` returns
// number[] | null. disassembleOne reconstructs the leading bytes via `read`.
function stubAsm(decode, encode) {
  return {
    disassembleOne(read, addr) {
      const b0 = read(addr) & 0xff;
      const b1 = read((addr + 1) & 0xffff) & 0xff;
      const { text, len } = decode(b0, b1);
      const bytes = [];
      for (let i = 0; i < len; i += 1) bytes.push(read((addr + i) & 0xffff) & 0xff);
      return { addr, bytes, text };
    },
    assemble(source) {
      const text = source.trim().split("\n").pop().trim();
      const bytes = encode(text);
      if (bytes === null) return { ok: false, bytes: new Uint8Array(), errors: [{ message: "stub fail" }] };
      return { ok: true, bytes: new Uint8Array(bytes), errors: [], warnings: [] };
    },
  };
}

// 1. Correct canonical round-trip: 0x00 <-> "NOP".
{
  const asm = stubAsm(
    (b0) => (b0 === 0x00 ? { text: "NOP", len: 1 } : { text: "DB", len: 1 }),
    (text) => (text === "NOP" ? [0x00] : null),
  );
  const r = roundtripByteCase([0x00], asm);
  assert(r.ok && r.kind === "canonical", `expected canonical NOP round-trip, got ${JSON.stringify(r)}`);
}

// 2. Decode-only alias: ED 4C decodes to "NEG", which re-encodes to the canonical
//    ED 44 (different bytes, same mnemonic, mnemonic-stable) -> classified alias.
{
  const asm = stubAsm(
    (b0, b1) => (b0 === 0xed ? { text: "NEG", len: 2 } : { text: "DB", len: 1 }),
    (text) => (text === "NEG" ? [0xed, 0x44] : null),
  );
  const alias = roundtripByteCase([0xed, 0x4c], asm);
  assert(alias.ok && alias.kind === "alias", `expected ED4C to classify as alias, got ${JSON.stringify(alias)}`);
  const canonical = roundtripByteCase([0xed, 0x44], asm);
  assert(canonical.ok && canonical.kind === "canonical", `expected ED44 canonical, got ${JSON.stringify(canonical)}`);
}

// 3. Undecoded byte (DB fallback) is rejected.
{
  const asm = stubAsm(() => ({ text: "DB 0xED,0x00", len: 2 }), () => null);
  const r = roundtripByteCase([0xed, 0x00], asm);
  assert(!r.ok && /undecoded/.test(r.reason), `expected DB fallback rejection, got ${JSON.stringify(r)}`);
}

// 4. Un-assemblable mnemonic is rejected.
{
  const asm = stubAsm((b0) => (b0 === 0xcb ? { text: "SLL B", len: 2 } : { text: "DB", len: 1 }), () => null);
  const r = roundtripByteCase([0xcb, 0x30], asm);
  assert(!r.ok && /re-assemble failed/.test(r.reason), `expected assemble-failure rejection, got ${JSON.stringify(r)}`);
}

// 5. Mnemonic that does not survive re-encoding is rejected. 0x01 -> "FOO" -> 0x02,
//    but 0x02 decodes to "BAR" != "FOO".
{
  const asm = stubAsm(
    (b0) => (b0 === 0x01 ? { text: "FOO", len: 1 } : { text: "BAR", len: 1 }),
    (text) => (text === "FOO" ? [0x02] : [0x99]),
  );
  const r = roundtripByteCase([0x01], asm);
  assert(!r.ok && /not stable/.test(r.reason), `expected mnemonic-instability rejection, got ${JSON.stringify(r)}`);
}

console.warn("Assembler round-trip self-test passed: canonical + alias accepted; DB / un-assemblable / unstable rejected.");
