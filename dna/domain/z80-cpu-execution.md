# Z80 CPU Execution Semantics

The normative reference for what a single Z80 instruction **does** when executed:
its effect on registers, the condition-flag computation, memory/port side
effects, and T-state timing. This is distinct from
[`z80-opcodes.md`](z80-opcodes.md), which specifies only how an instruction is
*encoded* (syntax → bytes), its length, its timing, and *which* flags it
changes. This document specifies the *values* those flags take and the register
state after the step.

It is the domain oracle for the emulator's CPU-execution fidelity rows
(`dna/conformance/cpu/`). It is authored from external standards (Zilog UM0080
for the documented rule; the FUSE Z80 test suite as a per-instruction witness);
the legacy emulator is not an authority here (ADR-0002).

## Scope

This is grown one behavior at a time, in lockstep with its conformance fixture
and a per-case external oracle (the EMULATOR PIVOT, `.harness/handoff.md`). The
first authored behavior is `INC r` (8-bit register increment). Everything else
is pending and must not be assumed.

## Condition flag register layout

The flag register `F` holds eight condition bits, MSB first: `S` (bit 7, sign),
`Z` (bit 6, zero), `5` (bit 5, undocumented copy), `H` (bit 4, half carry), `3`
(bit 3, undocumented copy), `P/V` (bit 2, parity/overflow), `N` (bit 1,
add/subtract), `C` (bit 0, carry). The bits `5` and `3` are undocumented in
UM0080 but are observable and are pinned here because the FUSE oracle witnesses
them.

## Authored Execution Facts

### INC r (8-bit register increment)

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-INC-R-001] `INC r` for `r ∈ {B,C,D,E,H,L,A}` replaces the operand
  register with `(r + 1) mod 256`. No other register and no memory location is
  modified. The program counter advances by the instruction length (1 byte).

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-INC-R-FLAGS-001] After `INC r` the condition flags are computed
  from the operand `r` and the 8-bit result `res = (r + 1) mod 256` as: `S` =
  bit 7 of `res`; `Z` = 1 iff `res == 0`; `H` = 1 iff the low nibble of `r` is
  `0xF` (i.e. a carry out of bit 3 occurred); `P/V` = 1 iff `r == 0x7F` (signed
  overflow `+127 → -128`, the only operand that overflows on increment); `N` = 0
  (increment is an add operation); `C` is **unchanged** (preserved from before
  the instruction); the undocumented flags `5` and `3` are bit 5 and bit 3 of
  `res` respectively.

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-INC-R-TIMING-001] `INC r` executes in a single M1 opcode-fetch
  machine cycle of 4 T-states. The memory-refresh register `R` is incremented by
  one (its low 7 bits) by that M1 fetch, as for every single-byte opcode.

<!-- provenance: fuse -->
- [id: Z80-EXEC-INC-R-FUSE-001] The documented rule above is witnessed per opcode
  by the FUSE Z80 test suite (`fuse-z80-tests`, manifest
  `dna/conformance/external/fuse-z80-tests.manifest.json`), one case per register
  opcode. Each FUSE case supplies an initial state, runs one instruction, and
  records the final registers, flags, and T-states; all seven match this rule:

  | opcode | instr | r (in) | res (out) | F (out) | flags set | T |
  | --- | --- | --- | --- | --- | --- | --- |
  | `04` | `INC B` | `FF` | `00` | `50` | Z,H | 4 |
  | `0C` | `INC C` | `7F` | `80` | `94` | S,H,P/V | 4 |
  | `14` | `INC D` | `27` | `28` | `28` | 5,3 | 4 |
  | `1C` | `INC E` | `AA` | `AB` | `A8` | S,5,3 | 4 |
  | `24` | `INC H` | `72` | `73` | `20` | 5 | 4 |
  | `2C` | `INC L` | `26` | `27` | `20` | 5 | 4 |
  | `3C` | `INC A` | `CF` | `D0` | `90` | S,H | 4 |

  In every FUSE case the input `C` flag is 0; `C`-preservation when set is
  witnessed by the spec-derived boundary cases in the conformance fixture.

### WZ (MEMPTR) and the BIT instruction flags

The Z80 has an internal 16-bit register **WZ** (also called MEMPTR), not in the
documented programmer model but observable through the `BIT` instruction's
undocumented flags. The execution conformance state exposes it as the `memptr`
register. Behavior that *reads* it (`BIT n,(HL)`) is constrained by the rules
below, and its full per-instruction **output**-update rules are now modeled and
asserted on output as well (the per-class subsection "WZ (MEMPTR) output-update
rules" below; ADR-0009 G-2 lifted, ADR-0020). Every case of the FUSE oracle
carries MEMPTR as its 13th register word and the conformance fixtures assert it.

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-BIT-001] `BIT b,m` tests bit `b` (0-7) of the operand `m` (a
  register `r`, the memory byte `(HL)`, or `(IX+d)`/`(IY+d)`) without storing a
  result. It sets `Z` = 1 iff bit `b` of the operand is 0; `P/V` = `Z` (the
  parity bit mirrors zero for `BIT`); `H` = 1; `N` = 0; `S` = 1 iff `b == 7` and
  bit 7 of the operand is 1 (else 0); and `C` is unchanged. The operand value and
  WZ are not modified.

<!-- provenance: fuse -->
- [id: Z80-EXEC-BIT-UNDOC-53-001] The undocumented flags `5` and `3` after `BIT`
  depend on the operand form, witnessed by FUSE: for `BIT b,r` they are bit 5 and
  bit 3 of the register `r`; for `BIT b,(IX+d)` / `BIT b,(IY+d)` they are bit 5
  and bit 3 of the **high byte of the effective address** `(IX+d)`/`(IY+d)`; and
  for `BIT b,(HL)` they are bit 5 and bit 3 of the **high byte of WZ (MEMPTR)**,
  which `BIT b,(HL)` leaves unchanged. FUSE `cb46_*` (`BIT 0,(HL)`, `(HL)=0xD5`)
  isolates this by varying only the initial MEMPTR: MEMPTR-high `0x00 → F=0x10`,
  `0xFF → 0x38`, `0x08 → 0x18`, `0x20 → 0x30` (only bits 5/3 of `F` change). The
  `(IX+d)`/`(IY+d)` forms pass with the address-high rule because for them
  WZ = (IX+d); `BIT b,(HL)` is the form that requires WZ to be modeled directly.

### WZ (MEMPTR) output-update rules

WZ is loaded by a fixed set of instruction classes; every other instruction
leaves it unchanged (so `BIT n,(HL)` reads whatever the last WZ-updating
instruction left). These are the documented silicon update rules; per-case exact
values are witnessed by the FUSE MEMPTR column (now asserted on output, ADR-0020),
so the few NMOS corner quirks are pinned by the oracle, not guessed. All `&` are
modulo 2^16. The values in parentheses are FUSE witnesses (`out.memptr`).

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-WZ-UPDATE-001] WZ is **unchanged** by any instruction not listed
  in the rules below — in particular by all register-to-register and immediate
  operations, the `(HL)` (non-indexed) memory forms (`LD r,(HL)`, `LD (HL),r`,
  `INC/DEC (HL)`, `ALU A,(HL)`, the plain-CB `(HL)` rotate/bit ops), `INC/DEC`
  of an 8- or 16-bit register, `PUSH`/`POP`, `EX DE,HL`, `EXX`, `EX AF,AF'`,
  `JP (HL)`/`(IX)`/`(IY)`, `LD SP,HL`, `DI`/`EI`/`IM`/`NOP`/`HALT`/`NEG`/`CPL`,
  the accumulator rotates and `DAA`/`SCF`/`CCF`, and a **not-taken** conditional
  `JR`/`DJNZ`/`RET`. Conditional `JP cc`/`CALL cc`, by contrast, load WZ even when
  not taken (see Z80-EXEC-WZ-UPDATE-JUMP-001).

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-WZ-UPDATE-MEM8-001] 8-bit accumulator memory transfers set WZ from
  the accessed address. **Loads** `LD A,(BC)`/`LD A,(DE)`/`LD A,(nn)` set
  `WZ = addr + 1` (FUSE `0a` → `0002`, `3a` → `9953`). **Stores**
  `LD (BC),A`/`LD (DE),A`/`LD (nn),A` set `WZ_low = (addr + 1) & 0xFF` and the
  **high byte to A** — the NMOS quirk (FUSE `02` (`LD (BC),A`, `A=0x56`) → `5602`;
  `32` (`LD (nn),A`, `A=0x0E`) → `0EAD`). The same NMOS high-byte-from-`A` quirk
  governs `OUT (n),A` (Z80-EXEC-WZ-UPDATE-IO-001); it is the silicon split already
  pinned for `OUT (C),0` in R-W9-03, here authored for NMOS as FUSE witnesses.

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-WZ-UPDATE-MEM16-001] 16-bit memory and arithmetic forms set
  `WZ = nn + 1` for `LD (nn),HL/rp/IX/IY` and `LD HL/rp/IX/IY,(nn)` (base `22`/`2A`
  and the `ED` `43`/`4B`/`53`/`5B`/`63`/`6B`/`73`/`7B` forms; FUSE `22` → `C3B1`,
  `2a` → `AC46`, `ed43` → `54C7`). `ADD/ADC/SBC HL,rp` and `ADD IX/IY,rp` set
  `WZ = HL(or IX/IY) + 1` taken **before** the addition (FUSE `09` → `9ABD`,
  `ed42` → `315F`). `RRD`/`RLD` set `WZ = HL + 1` (FUSE `ed67` → `B9DF`).
  `EX (SP),HL/IX/IY` sets `WZ` to the value loaded into the register from `(SP)`
  (FUSE `e3` → `E18E`).

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-WZ-UPDATE-JUMP-001] Control transfers set WZ as follows. `JP nn`
  and `JP cc,nn` set `WZ = nn` whether or not the branch is taken (the operand is
  always latched; FUSE `c3` → `7CED`). `CALL nn` and `CALL cc,nn` likewise set
  `WZ = nn` taken or not (FUSE `cd` → `3A5D`). A **taken** `JR e`, `JR cc,e` or
  `DJNZ e` sets `WZ = destination` (the new `PC`; FUSE `18` → `0042`); a not-taken
  one leaves WZ unchanged. `RET`, a taken `RET cc`, `RETI` and `RETN` set
  `WZ = popped return address` (FUSE `c9` → `1136`, `ed45` → `221F`). `RST p` sets
  `WZ = p` (the destination vector; FUSE `c7` → `0000`).

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-WZ-UPDATE-IO-001] Port I/O sets WZ from the port address. `IN A,(n)`
  sets `WZ = ((A << 8) | n) + 1` using `A` **before** the input (FUSE `db`
  (`A=0xC1`) → `C1E3`). `OUT (n),A` sets `WZ_low = (n + 1) & 0xFF`, `WZ_high = A`
  (the NMOS quirk; FUSE `d3` (`A=0xA2`) → `A2ED`). `IN r,(C)` / `IN (C)` (the
  flags-only form) / `OUT (C),r` / `OUT (C),0` all set `WZ = BC + 1` (FUSE `ed40`
  → `296C`, `ed41` → `0882`).

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-WZ-UPDATE-BLOCK-001] The block instructions update WZ as follows.
  `CPI` sets `WZ = WZ + 1`, `CPD` sets `WZ = WZ - 1` (relative to the prior WZ;
  FUSE `eda1` (WZ=0) → `0001`, `eda9` (WZ=0) → `FFFF`). `LDI`/`LDD` leave WZ
  unchanged. For the **repeating** forms `LDIR`/`LDDR`/`CPIR`/`CPDR`, an iteration
  that will repeat sets `WZ = PC + 1` where `PC` is the address of the block
  instruction itself; the terminating iteration follows the `CPI`/`CPD` rule
  (`CPIR`/`CPDR`) or leaves WZ unchanged (`LDIR`/`LDDR`). The block I/O forms
  `INI`/`IND`/`OUTI`/`OUTD` (and their repeats) set `WZ = BC(used) ± 1` (`+1` for
  the I-forms `INI`/`OUTI`/`INIR`/`OTIR`, `−1` for the D-forms), where `BC(used)`
  is the port address driven: for the IN-forms the pre-decrement `BC`, for the
  OUT-forms the post-`B`-decrement `BC` (FUSE `eda2` → `9A83`, `eda3` → `6235`,
  `edaa` → `D790`, `edab` → `F233`). The exact `±1`/before-after form of every
  block case is pinned by the FUSE MEMPTR column.

### DAA (decimal adjust accumulator)

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-DAA-001] `DAA` (opcode `0x27`) conditionally adds or subtracts a
  BCD correction to `A` based on the current `H`, `C`, and `N` flags, so that a
  prior binary add/subtract of two BCD operands yields a BCD result. Let
  `lo = A & 0x0F`. Compute a correction and the output carry:
  - if `C == 1` **or** `A > 0x99`: `correction |= 0x60` and `Cout = 1`; otherwise
    `Cout = 0`;
  - if `H == 1` **or** `lo > 9`: `correction |= 0x06`.

  Then if `N == 0` set `A = (A + correction) & 0xFF`, else `A = (A - correction)
  & 0xFF`. Note `DAA` only ever sets `C` (it never clears an incoming `C == 1`).

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-DAA-FLAGS-001] After `DAA` the flags are: `C` = `Cout` above; `N`
  unchanged; `H` = (if `N == 0`) `lo > 9`, (if `N == 1`) `H == 1 && lo < 6`; `S`
  = bit 7 of the result; `Z` = 1 iff the result is 0; `P/V` = even parity of the
  result; and undocumented `5` / `3` = bit 5 / bit 3 of the result. T-states: 4,
  one M1 cycle. Corroborated by FUSE `27` (`A=0x1F,N=0 → 0x25`, `F=0x30`) and
  `27_1` (`A=0x9A,N=1 → 0x34`, `F=0x23`); full-range validation awaits the
  ADR-0006-blocked zexdoc/zexall suites.

### SCF / CCF (set / complement carry flag)

`SCF` (`0x37`) and `CCF` (`0x3F`) are single-byte accumulator-group operations
that act only on the flag register. Their documented `C`/`H`/`N` effects are in
UM0080; their undocumented `5`/`3` bits are the project's lone silicon-divergent
flag computation that was witnessed only by the FUSE/zexall oracles until now
(ADR-0018 sweep), and are pinned here.

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-SCF-001] `SCF` sets the carry: `C = 1`. It resets the half-carry
  and add/subtract flags: `H = 0`, `N = 0`. The sign, zero, and parity/overflow
  flags `S`, `Z`, `P/V` are **unchanged**, and the accumulator and all other
  registers are unchanged. Timing: one M1 opcode-fetch cycle, 4 T-states.

<!-- provenance: z80-spec -->
- [id: Z80-EXEC-CCF-001] `CCF` complements the carry: the new `C` is the logical
  negation of the old `C` (`C ← ¬C`). The half-carry flag takes the **previous**
  carry: `H = old C` (so the operation is reversible — a second `CCF` restores
  both). The add/subtract flag is reset (`N = 0`); `S`, `Z`, `P/V` are
  **unchanged**; the accumulator and other registers are unchanged. Timing: one
  M1 opcode-fetch cycle, 4 T-states.

<!-- provenance: fuse -->
- [id: Z80-EXEC-SCF-CCF-UNDOC-53-001] After **both** `SCF` and `CCF` the
  undocumented flags `5` and `3` are bit 5 and bit 3 of `(A | F)` — the bitwise
  OR of the accumulator `A` with the flag register `F` **as it was before the
  instruction** — not of `A` alone. Concretely the result keeps any `5`/`3` bit
  that was already set in `F` and additionally sets each from the corresponding
  bit of `A`. This is the model `@zx-vibes/cpu` implements
  (`packages/cpu/src/z80-step.mjs`, the `zc === 7` accumulator-op arm:
  `(reg.a | reg.f) & (F5 | F3)`); it is witnessed per opcode by the FUSE base
  group (`37`, `3f`) which `@zx-vibes/cpu` passes (`CPU-FUSE-BASE-001`) and
  corroborated end-to-end by the offline zexall acceptance (ADR-0006), which
  exercises many `A`/`F` inputs through the `<scf,ccf>`-style probes. (The
  refined Patrik-Rak `Q`-register model — `5`/`3` from `((Q ^ F) | A)`, where `Q`
  is the flags as last written — agrees with `(A | F)` whenever the preceding
  instruction wrote the flags, and diverges only for an `SCF`/`CCF` that
  immediately follows a non-flag-writing instruction; the project's conformance
  oracle is FUSE/zexall, which the `(A | F)` model passes, so `(A | F)` is the
  pinned rule.)

## Source References

- `z80-spec`: Zilog Z80 CPU User Manual UM0080, `INC r` instruction entry and the
  flag-effect / timing columns: https://www.zilog.com/docs/z80/um0080.pdf. For the
  WZ (MEMPTR) update rules: "The Undocumented Z80 Documented" (Sean Young / Patrik
  Rak) §MEMPTR and the boo_boo & V. Kladov `memptr_eng.txt` note — the documented
  silicon update behavior, including the NMOS `(addr)`-store / `OUT (n),A`
  high-byte-from-`A` quirk.
- `fuse`: FUSE Z80 test suite (`z80/tests/tests.in`, `z80/tests/tests.expected`),
  opcodes `04`, `0C`, `14`, `1C`, `24`, `2C`, `3C` (`INC r`); `cb46_*`
  (`BIT 0,(HL)` MEMPTR-high → flags 5/3); `27`, `27_1` (`DAA`); `37` (`SCF`),
  `3f` (`CCF`) (undocumented `5`/`3` from `(A | F)`); and the **MEMPTR (WZ) column
  of every case** (the 13th register word), now asserted on output and witnessing
  each WZ-update rule — e.g. `02`/`32` (NMOS store high=`A`), `09`/`ed42`
  (`ADD/SBC HL` → `HL+1`), `c3`/`cd` (`JP`/`CALL` → `nn`), `eda1`/`eda9`
  (`CPI`/`CPD` → `WZ±1`), `eda2`/`eda3` (block I/O → `BC(used)±1`). Pinned in
  `dna/conformance/external/fuse-z80-tests.manifest.json`.

## Acceptance Criteria

- `CPU-EXEC-INC-R-001` must prove that executing `INC r` for `r ∈
  {B,C,D,E,H,L,A}` on a CPU step yields, for each FUSE case, the witnessed result
  register, flag register `F` (all eight bits including `5`/`3`), refresh `R`,
  program counter, and 4 T-states, and that the spec-derived boundary cases
  (zero with carry preserved, mid-value half carry, `0x7F` overflow) match the
  flag-computation rule Z80-EXEC-INC-R-FLAGS-001.
- The `CPU-FUSE-*` rows must prove that, for every FUSE case, the post-instruction
  `memptr` (WZ) matches the oracle's MEMPTR column — exercising the
  Z80-EXEC-WZ-UPDATE-* rules across the whole ISA (loads/stores, 16-bit
  arithmetic, jumps/calls/returns, port I/O, and the block ops), with WZ left
  unchanged by every other instruction. This lifts the ADR-0009 G-2 relaxation.
