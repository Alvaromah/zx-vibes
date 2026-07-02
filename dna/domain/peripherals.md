# Peripherals

Optional 48K-era input peripherals that sit on the Z80 I/O bus alongside the ULA.
Each is addressed by an `IN`/`OUT` to a decoded port; none is part of the ULA or the
core execution machine. This file pins the **documented, oracle-stable** read
contracts only; finer per-clone address-decoding variants are interface-specific and
out of scope (called out per claim).

## Scope

In scope for the 48K base (ratified `decision:ADR-0021`, gap F1): the **Kempston
joystick** read at the canonical port `0x1F`, active-high `000FUDLR`. Out of scope
here: the Sinclair / Cursor joysticks (keyboard-mapped — F2, resolvable in
`keyboard-input.md`), and the ZX Printer / Interface 1/2 / Microdrive / Kempston mouse
(F3, beyond the 48K base). The browser-key → joystick input *policy* (a product
concern, like the keyboard browser map) is not authored here.

## Kempston joystick

The Kempston interface is the de-facto 48K joystick standard: a single read port whose
data lines the interface drives active-high with the current button state. It is an
external add-on, so at the bare 48K base its port floats (`ula-timing.md`
ULA-FLOATBUS-PORT-001); with the interface fitted that port is driven.

<!-- provenance: hardware -->
- [id: JOY-KEMPSTON-PORT-001] The Kempston joystick is read at port low byte `0x1F`
  (decimal 31). The interface decodes the low address byte; the high byte (register
  `B` of an `IN A,(C)`, or the accumulator of `IN A,(n)`) is **don't-care**, so any
  port whose low 8 bits are `0x1F` reads the joystick. Because `0x1F` is odd
  (`A0 = 1`), the ULA does not drive it, so the Kempston — when fitted — is what carves
  `0x1F` out of the floating odd-port set (`ula-timing.md` ULA-FLOATBUS-PORT-001).
  Finer incomplete decoding (clones that respond to any `A5 = 0` port, aliasing `0x1F`
  across a wider range) is interface-specific and **out of scope**; the canonical
  `0x1F` is what is pinned.

<!-- provenance: hardware -->
- [id: JOY-KEMPSTON-READ-001] A read returns an **active-high** byte in the layout
  `000FUDLR`: bit 0 = Right, bit 1 = Left, bit 2 = Down, bit 3 = Up, bit 4 = Fire, and
  bits 7-5 are always `0`. A pressed control sets its bit to `1` — the opposite sense
  to the keyboard, which reads active-low on even ports (`host-io-port-fe.md`). With
  nothing pressed the read is `0x00`. The five controls are independent: the hardware
  imposes no interlock, so a model must not mask the physically-impossible Left+Right
  or Up+Down — it returns exactly the OR of the pressed bits.

## Acceptance criteria

A regenerated Kempston model satisfies these facts iff it passes
`dna/conformance/peripherals/kempston.json` through
`dna/conformance/peripherals/run-kempston-fixtures.mjs`: `kempstonByte(state)` returns
the active-high `000FUDLR` byte (idle `0x00`, each control its own bit, the top three
bits always `0`), `kempstonPort` is `0x1F`, and `kempstonDecodes(port)` is true exactly
for the ports whose low byte is `0x1F` (high byte don't-care) and false otherwise. The
self-test additionally checks the shipped model against an independent reference across
all 32 button combinations and the full 16-bit port range, and rejects an active-low
read, a swapped-direction layout, a model that leaks non-zero top bits, and a wrong
port decode.
