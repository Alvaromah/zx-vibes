# Z80 Opcode Table

Status: partial authoring slice. This file and `z80-opcodes.yaml` are the
normative domain reference for assembler-visible Z80 instruction encodings. The
table grows toward the full base/CB/ED/DD/FD/DDCB/FDCB set; only entries present
in the machine-readable table are currently specified.

## Machine-Readable Table

`z80-opcodes.yaml` is the canonical tabular form, parsed as real YAML (via
`js-yaml`) by `conformance/domain/z80-opcodes-check.mjs`. It uses a compressed,
data-driven schema: one terse row per encoding that carries only what conformance
proves — `syntax`, `bytes`, timing (`t`/`m`, or `[taken, notTaken]` for
conditional forms), `conformance` ids, and a `flags` clause only on the rows that
change condition bits. Derived and default fields are filled by the loader's
`normalizeTable` step — length from the byte count, the default "no flags
changed", `caseInsensitive`/`provenance` defaults, and the hex-string→`value`/`hex`
byte split — rather than written per row. Families (`LD r,r'`, `LD (HL)` memory)
are templated row sets that the same loader expands. Operand semantics — roles,
register codes, operand widths, and cycle breakdowns — live in the prose below,
not in the table; re-add them to the table only when a real consumer needs them.
This Markdown file explains the authored slice.

### Authoring a new row or family (ADR-0007)

Add new encodings in the compressed schema. Byte tokens are quoted strings: a
two-hex-digit token (`"3E"`) becomes a literal byte, any other token (`"n"`,
`"nn-low"`, `"e"`) becomes a parameter. These parameter tokens — `n`, `nn-low`,
`nn-high`, `e` — are reserved **lowercase** identifiers, recognized
case-sensitively and kept distinct from register names (the register `E` is never
the slot `e`); see the reserved slot-token rule under *Authored Opcode Facts*.
Write `flags` only when condition bits change (otherwise the loader defaults to
"none changed"); put operand semantics in the prose above, not the table.

```yaml
# A single encoding (under `instructions:`)
- { id: Z80-OPC-LD-A-N-001, syntax: "LD A,n", bytes: ["3E", "n"], t: 7, m: 2, conformance: [ASM-EMIT-LD-R-N-001, ASM-EMIT-001] }
# A conditional-timing encoding: t/m as [taken, notTaken]
- { id: Z80-OPC-JR-NZ-E-001, syntax: "JR NZ,e", bytes: ["20", "e"], t: [12, 7], m: [3, 2], conformance: [ASM-EMIT-JR-CC-E-001] }
# A flag-changing encoding: affected ∪ unchanged must cover all 8 bits
- { id: Z80-OPC-LD-A-I-001, syntax: "LD A,I", bytes: ["ED", "57"], t: 9, m: 2, flags: { affected: [S, Z, "5", H, "3", PV, N], unchanged: [C] }, conformance: [ASM-EMIT-LD-A-I-R-001] }

# A templated family (under `families:`): {placeholders} in syntax/bytes filled per row
- id: Z80-OPC-LD-R-R-001
  syntax: "LD {d},{s}"
  bytes: ["{op}"]
  t: 4
  m: 1
  conformance: [ASM-EMIT-LD-R-R-001]
  rows:
    - { d: B, s: B, op: "40" }
# An explicit-variant family with an opcode exclusion
- id: Z80-OPC-LD-HL-MEM-001
  conformance: [ASM-EMIT-LD-HL-MEM-001]
  excludes: ["76"]
  variants:
    - { syntax: "LD (HL),n", bytes: ["36", "n"], t: 10, m: 3 }
```

## Authored Opcode Facts

<!-- provenance: z80-spec -->
- [id: Z80-OPC-SLOT-TOKENS-001] Operand parameter slots in the table are the
  reserved **lowercase** tokens `n` (8-bit immediate), `nn` (16-bit immediate,
  emitted as the byte pair `nn-low` then `nn-high`), and `e` (signed 8-bit
  relative displacement). These slot tokens are recognized **case-sensitively**
  and are distinct from register identifiers: the register `E` (as in `LD B,E`)
  is never the displacement slot `e`. The table-level `caseInsensitive: true`
  default governs the spelling of user-facing mnemonics and register/condition
  operands only; it does **not** apply to slot-token recognition. A consumer that
  regenerates an encoder from this table must match slot tokens case-sensitively —
  folding case would conflate register `E` with slot `e` and silently drop every
  register-`E` encoding (ADR-0008).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-A-N-001] `LD A,n` is a base-opcode instruction that loads the
  unsigned 8-bit immediate operand `n` into register `A`; it encodes as opcode
  byte `0x3E` followed by the literal immediate byte, has length 2 bytes, uses 2
  machine cycles and 7 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-R-N-001] The base `LD r,n` register-immediate family for
  `r = B,C,D,E,H,L,A` loads unsigned 8-bit immediate `n` into the selected
  register; the register codes are `B=000`, `C=001`, `D=010`, `E=011`,
  `H=100`, `L=101`, and `A=111`; the opcode pattern is `00 r 110`, yielding
  opcodes `0x06`, `0x0E`, `0x16`, `0x1E`, `0x26`, `0x2E`, and `0x3E`
  respectively, followed by literal byte `n`; each instruction has length 2
  bytes, uses 2 machine cycles and 7 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-R-R-001] The base `LD r,r'` register-transfer family for
  `r,r' = B,C,D,E,H,L,A` copies the source register byte into the destination
  register; the destination and source register codes are `B=000`, `C=001`,
  `D=010`, `E=011`, `H=100`, `L=101`, and `A=111`. The opcode pattern is
  `01 destination source`, excluding code `110` because that slot denotes the
  `(HL)` memory operand and the `110,110` opcode is `HALT`; therefore this slice
  has 49 register-only opcodes. Each instruction has length 1 byte, uses
  1 machine cycle and 4 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-DD-NN-001] The base `LD dd,nn` register-pair immediate family
  for `dd = BC,DE,HL,SP` loads unsigned 16-bit immediate `nn` into the selected
  register pair; the register-pair codes are `BC=00`, `DE=01`, `HL=10`, and
  `SP=11`; the opcode pattern is `00 dd 0001`, yielding opcodes `0x01`,
  `0x11`, `0x21`, and `0x31` respectively, followed by the low byte of `nn` and
  then the high byte of `nn`; each instruction has length 3 bytes, uses 3
  machine cycles and 10 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-IXIY-NN-001] The indexed `LD IX,nn` and `LD IY,nn` forms load
  unsigned 16-bit immediate `nn` into the selected index register pair. They use
  the indexed prefix for the `HL` register-pair immediate opcode: `LD IX,nn`
  encodes as `0xDD 0x21 nn-low nn-high`, and `LD IY,nn` encodes as
  `0xFD 0x21 nn-low nn-high`. Each instruction has length 4 bytes, uses
  4 machine cycles and 14 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-ACC-BCDE-IND-001] The base accumulator indirect forms
  `LD A,(BC)`, `LD A,(DE)`, `LD (BC),A`, and `LD (DE),A` transfer one byte
  between accumulator `A` and the memory address held in register pair `BC` or
  `DE`; they encode as single opcode bytes `0x0A`, `0x1A`, `0x02`, and `0x12`
  respectively, each has length 1 byte, uses 2 machine cycles and 7 T-states,
  and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-ACC-NN-IND-001] The base absolute accumulator forms
  `LD A,(nn)` and `LD (nn),A` transfer one byte between accumulator `A` and
  unsigned 16-bit memory address `nn`; they encode as opcode bytes `0x3A` and
  `0x32` respectively, followed by the low byte of `nn` and then the high byte
  of `nn`, each has length 3 bytes, uses 4 machine cycles and 13 T-states, and
  changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-HL-NN-IND-001] The base absolute `HL` memory-transfer forms
  `LD HL,(nn)` and `LD (nn),HL` transfer a 16-bit word between register pair
  `HL` and unsigned 16-bit memory address `nn`. `LD HL,(nn)` loads `L` from
  `(nn)` and `H` from `(nn + 1)`; `LD (nn),HL` stores `L` to `(nn)` and `H` to
  `(nn + 1)`. They encode as opcode bytes `0x2A` and `0x22` respectively,
  followed by the low byte of `nn` and then the high byte of `nn`, each has
  length 3 bytes, uses 5 machine cycles and 16 T-states, and changes no
  condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-IXIY-NN-IND-001] The indexed absolute word-transfer forms
  `LD IX,(nn)`, `LD IY,(nn)`, `LD (nn),IX`, and `LD (nn),IY` transfer a 16-bit
  word between index register pair `IX` or `IY` and unsigned 16-bit memory
  address `nn`. Loads take the low byte from `(nn)` into `IXL` or `IYL` and the
  high byte from `(nn + 1)` into `IXH` or `IYH`; stores write the low index byte
  to `(nn)` and the high index byte to `(nn + 1)`. The load opcodes are
  `0xDD 0x2A` and `0xFD 0x2A`; the store opcodes are `0xDD 0x22` and
  `0xFD 0x22`. Each form is followed by the low byte of `nn` and then the high
  byte of `nn`, has length 4 bytes, uses 6 machine cycles and 20 T-states, and
  changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-SP-HL-001] The base `LD SP,HL` instruction loads the stack
  pointer register pair `SP` from register pair `HL`; it encodes as opcode byte
  `0xF9`, has length 1 byte, uses 1 machine cycle and 6 T-states, and changes no
  condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-SP-IXIY-001] The indexed `LD SP,IX` and `LD SP,IY` forms load
  stack pointer register pair `SP` from the selected index register pair. They
  use the indexed prefix for the `LD SP,HL` opcode: `LD SP,IX` encodes as
  `0xDD 0xF9`, and `LD SP,IY` encodes as `0xFD 0xF9`. Each instruction has
  length 2 bytes, uses 2 machine cycles and 10 T-states, and changes no
  condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-DD-NN-IND-001] The ED-prefixed absolute 16-bit register-pair
  memory-transfer forms `LD BC,(nn)`, `LD DE,(nn)`, `LD SP,(nn)`, `LD (nn),BC`,
  `LD (nn),DE`, and `LD (nn),SP` transfer a 16-bit word between `BC`, `DE`, or
  `SP` and unsigned 16-bit memory address `nn`. The `BC` low/high bytes are
  `C`/`B`, the `DE` low/high bytes are `E`/`D`, and the `SP` word is ordered low
  byte then high byte. The load opcodes are `0xED 0x4B`, `0xED 0x5B`, and
  `0xED 0x7B`; the store opcodes are `0xED 0x43`, `0xED 0x53`, and
  `0xED 0x73`. Each form is followed by the low byte of `nn` and then the high
  byte of `nn`, has length 4 bytes, uses 6 machine cycles and 20 T-states, and
  changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-INC-DEC-SS-001] The base 16-bit register-pair increment and
  decrement families operate on `ss = BC,DE,HL,SP` with register-pair codes
  `BC=00`, `DE=01`, `HL=10`, and `SP=11`. `INC ss` adds 1 modulo 65536 and uses
  opcode pattern `00 ss 0011`, yielding opcodes `0x03`, `0x13`, `0x23`, and
  `0x33`. `DEC ss` subtracts 1 modulo 65536 and uses opcode pattern
  `00 ss 1011`, yielding opcodes `0x0B`, `0x1B`, `0x2B`, and `0x3B`. Each
  instruction has length 1 byte, uses 1 machine cycle and 6 T-states, and
  changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-INC-DEC-IXIY-001] The indexed 16-bit register-pair increment and
  decrement forms operate on `IX` and `IY` as the indexed replacements for the
  `HL` register-pair code `10`. `INC IX` and `DEC IX` use prefix `0xDD`;
  `INC IY` and `DEC IY` use prefix `0xFD`. The increment opcode is the `INC HL`
  opcode `0x23`, and the decrement opcode is the `DEC HL` opcode `0x2B`.
  Therefore the encodings are `0xDD 0x23`, `0xFD 0x23`, `0xDD 0x2B`, and
  `0xFD 0x2B`. Each instruction has length 2 bytes, uses 2 machine cycles and
  10 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-PUSH-QQ-001] The base `PUSH qq` register-pair stack-transfer
  family for `qq = BC,DE,HL,AF` uses register-pair codes `BC=00`, `DE=01`,
  `HL=10`, and `AF=11`; opcode pattern `11 qq 0101` yields opcodes `0xC5`,
  `0xD5`, `0xE5`, and `0xF5` respectively. The instruction decrements the stack
  pointer by two, writes the high-order register byte to the old `SP - 1`, then
  writes the low-order register byte to the old `SP - 2`; after completion the
  final `SP` address contains the low-order byte and `SP + 1` contains the
  high-order byte. Each instruction has length 1 byte, uses 3 machine cycles and
  11 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-PUSH-IXIY-001] The indexed `PUSH IX` and `PUSH IY`
  stack-transfer forms push the selected index register pair using the indexed
  prefix for the `PUSH HL` opcode: `PUSH IX` encodes as `0xDD 0xE5`, and
  `PUSH IY` encodes as `0xFD 0xE5`. The instruction decrements the stack
  pointer by two, writes the high-order index byte (`IXH`/`IYH`) to the old
  `SP - 1`, then writes the low-order index byte (`IXL`/`IYL`) to the old
  `SP - 2`; after completion the final `SP` address contains the low-order byte
  and `SP + 1` contains the high-order byte. Each instruction has length 2
  bytes, uses 4 machine cycles and 15 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-POP-QQ-001] The base `POP qq` register-pair stack-transfer
  family for `qq = BC,DE,HL,AF` uses register-pair codes `BC=00`, `DE=01`,
  `HL=10`, and `AF=11`; opcode pattern `11 qq 0001` yields opcodes `0xC1`,
  `0xD1`, `0xE1`, and `0xF1` respectively. The instruction loads the low-order
  register byte from memory at `SP`, loads the high-order register byte from
  memory at `SP + 1`, then increments `SP` by two. `POP BC`, `POP DE`, and
  `POP HL` change no condition flags; `POP AF` loads the flags register `F`
  from the low stack byte. Each instruction has length 1 byte and uses 3 machine
  cycles and 10 T-states.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-POP-IXIY-001] The indexed `POP IX` and `POP IY` stack-transfer
  forms pop the selected index register pair using the indexed prefix for the
  `POP HL` opcode: `POP IX` encodes as `0xDD 0xE1`, and `POP IY` encodes as
  `0xFD 0xE1`. The instruction loads the low-order index byte (`IXL`/`IYL`)
  from memory at `SP`, loads the high-order index byte (`IXH`/`IYH`) from memory
  at `SP + 1`, then increments `SP` by two. Each instruction has length 2 bytes,
  uses 4 machine cycles and 14 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-HL-MEM-001] The base `LD (HL),n`, `LD r,(HL)`, and
  `LD (HL),r` memory-reference forms use register-code slot `110` for the byte
  stored at address `HL`. `LD (HL),n` encodes as `0x36 n`, has length 2 bytes,
  uses 3 machine cycles and 10 T-states, and changes no condition flags.
  For `r = B,C,D,E,H,L,A`, `LD r,(HL)` uses opcode pattern `01 r 110`, yielding
  opcodes `0x46`, `0x4E`, `0x56`, `0x5E`, `0x66`, `0x6E`, and `0x7E`; `LD
  (HL),r` uses opcode pattern `01 110 r`, yielding opcodes `0x70`, `0x71`,
  `0x72`, `0x73`, `0x74`, `0x75`, and `0x77`; each one-byte register/memory form
  uses 2 machine cycles and 7 T-states and changes no condition flags. The
  register-code slot `110` is the `(HL)` memory operand, so opcode `0x76` is not
  `LD (HL),(HL)` and is outside this `LD` family.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-JP-NN-001] The base unconditional `JP nn` instruction loads the
  program counter with the unsigned 16-bit absolute address `nn`; it encodes as
  opcode byte `0xC3` followed by the low byte of `nn` and then the high byte of
  `nn`, has length 3 bytes, uses 3 machine cycles and 10 T-states, and changes
  no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-JP-CC-NN-001] The base conditional absolute jumps `JP NZ,nn`,
  `JP Z,nn`, `JP NC,nn`, `JP C,nn`, `JP PO,nn`, `JP PE,nn`, `JP P,nn`, and
  `JP M,nn` test the current Z, C, P/V, or S flag and load the program counter
  with the unsigned 16-bit absolute address `nn` only when the condition is
  true; otherwise execution continues after the instruction. Their opcode bytes
  are `0xC2`, `0xCA`, `0xD2`, `0xDA`, `0xE2`, `0xEA`, `0xF2`, and `0xFA`
  respectively, followed by the low byte of `nn` and then the high byte of
  `nn`. Each instruction has length 3 bytes, uses 3 machine cycles and
  10 T-states regardless of whether the branch is taken, and changes no
  condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-JP-HL-001] The base indirect jump `JP (HL)` loads the program
  counter from register pair `HL`; it encodes as single opcode byte `0xE9`, has
  length 1 byte, uses 1 machine cycle and 4 T-states, and changes no condition
  flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-JP-IXIY-001] The indexed indirect jumps `JP (IX)` and `JP (IY)`
  load the program counter from the selected index register pair. They use the
  indexed prefix for the `JP (HL)` opcode: `JP (IX)` encodes as `0xDD 0xE9`,
  and `JP (IY)` encodes as `0xFD 0xE9`. Each instruction has length 2 bytes,
  uses 2 machine cycles and 8 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-EX-AF-AF-PRIME-001] The base exchange instruction
  `EX AF,AF'` swaps the 16-bit accumulator/flags register pair `AF` with its
  shadow pair `AF'`; the primary flags register `F` is exchanged with shadow
  `F'`. It encodes as single opcode byte `0x08`, has length 1 byte, uses
  1 machine cycle and 4 T-states.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-EX-DE-HL-001] The base exchange instruction `EX DE,HL` swaps
  the 16-bit contents of register pairs `DE` and `HL`; it encodes as single
  opcode byte `0xEB`, has length 1 byte, uses 1 machine cycle and 4 T-states,
  and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-EXX-001] The base exchange instruction `EXX` swaps the 16-bit
  contents of register pairs `BC`, `DE`, and `HL` with their shadow register
  pairs `BC'`, `DE'`, and `HL'`; it encodes as single opcode byte `0xD9`, has
  length 1 byte, uses 1 machine cycle and 4 T-states, and changes no condition
  flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-EX-SP-HL-IXIY-001] The stack exchange instructions
  `EX (SP),HL`, `EX (SP),IX`, and `EX (SP),IY` exchange the low byte of the
  register pair with memory at `SP`, exchange the high byte with memory at
  `SP + 1`, leave `SP` unchanged, and change no condition flags. `EX (SP),HL`
  encodes as `0xE3`, has length 1 byte, uses 5 machine cycles and 19 T-states.
  The indexed forms use the same opcode with an index prefix: `EX (SP),IX`
  encodes as `0xDD 0xE3`, and `EX (SP),IY` encodes as `0xFD 0xE3`; each indexed
  form has length 2 bytes, uses 6 machine cycles and 23 T-states.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-CALL-NN-001] The base unconditional `CALL nn` instruction pushes
  the address of the instruction after the call onto the stack, with the return
  low byte at the final `SP` address and the return high byte at `SP + 1`, then
  loads the program counter with unsigned 16-bit absolute address `nn`; it
  encodes as opcode byte `0xCD` followed by the low byte of `nn` and then the
  high byte of `nn`, has length 3 bytes, uses 5 machine cycles and 17 T-states,
  and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-CALL-CC-NN-001] The base conditional absolute calls
  `CALL NZ,nn`, `CALL Z,nn`, `CALL NC,nn`, `CALL C,nn`, `CALL PO,nn`,
  `CALL PE,nn`, `CALL P,nn`, and `CALL M,nn` test the current Z, C, P/V, or S
  flag and perform the call only when the condition is true. On a taken call,
  the instruction pushes the address after the call onto the stack, with the
  return low byte at the final `SP` address and the return high byte at
  `SP + 1`, then loads the program counter with unsigned 16-bit absolute address
  `nn`; when not taken, execution continues after the instruction and the stack
  is unchanged. Their opcode bytes are `0xC4`, `0xCC`, `0xD4`, `0xDC`, `0xE4`,
  `0xEC`, `0xF4`, and `0xFC` respectively, followed by the low byte of `nn` and
  then the high byte of `nn`. Each instruction has length 3 bytes, uses
  5 machine cycles and 17 T-states when taken and 3 machine cycles and
  10 T-states when not taken, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-RET-001] The base unconditional `RET` instruction loads the low
  byte of the program counter from memory at `SP`, loads the high byte from
  memory at `SP + 1`, increments `SP` by 2, encodes as single opcode byte
  `0xC9`, has length 1 byte, uses 3 machine cycles and 10 T-states, and changes
  no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-RET-CC-001] The base conditional returns `RET NZ`, `RET Z`,
  `RET NC`, `RET C`, `RET PO`, `RET PE`, `RET P`, and `RET M` test the current
  Z, C, P/V, or S flag and perform the return only when the condition is true.
  On a taken return, the instruction loads the low byte of the program counter
  from memory at `SP`, loads the high byte from memory at `SP + 1`, and
  increments `SP` by 2; when not taken, execution continues after the instruction
  and the stack is unchanged. Their single opcode bytes are `0xC0`, `0xC8`,
  `0xD0`, `0xD8`, `0xE0`, `0xE8`, `0xF0`, and `0xF8` respectively. Each
  instruction has length 1 byte, uses 3 machine cycles and 11 T-states when
  taken and 1 machine cycle and 5 T-states when not taken, and changes no
  condition flags.

<!-- provenance: hardware -->
- [id: Z80-OPC-RETN-RETI-001] The interrupt-return instructions `RETN` and
  `RETI` load the low byte of the program counter from memory at `SP`, load the
  high byte from memory at `SP + 1`, and increment `SP` by 2. Both also restore
  the maskable-interrupt flip-flop `IFF1` from `IFF2`: `RETN` does so by its
  documented definition, and `RETI` does so as well on real Z80 silicon (the
  official Zilog manual documents the `IFF1` restore only for `RETN`, but `RETI`
  behaves identically on hardware, as confirmed by the FUSE and zexall oracles).
  `RETI` additionally signals interrupt completion to a Z80 interrupting
  peripheral. `RETN` encodes as `0xED 0x45`, and `RETI` encodes as `0xED 0x4D`.
  Each instruction has length 2 bytes, uses 4 machine cycles and 14 T-states,
  and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-RST-P-001] The base restart instructions `RST 00H`, `RST 08H`,
  `RST 10H`, `RST 18H`, `RST 20H`, `RST 28H`, `RST 30H`, and `RST 38H` push the
  address after the instruction onto the stack, with the return low byte at the
  final `SP` address and the return high byte at `SP + 1`, then load the program
  counter with the corresponding restart vector `0x00`, `0x08`, `0x10`, `0x18`,
  `0x20`, `0x28`, `0x30`, or `0x38`. Their single opcode bytes are `0xC7`,
  `0xCF`, `0xD7`, `0xDF`, `0xE7`, `0xEF`, `0xF7`, and `0xFF` respectively. Each
  instruction has length 1 byte, uses 3 machine cycles and 11 T-states, and
  changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-NOP-001] The base `NOP` instruction performs no register, memory,
  or flag update; it encodes as single opcode byte `0x00`, has length 1 byte,
  uses 1 machine cycle and 4 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-HALT-001] The base `HALT` instruction enters the CPU halt state
  until an interrupt or reset resumes execution; it encodes as single opcode byte
  `0x76`, has length 1 byte, uses 1 machine cycle and 4 T-states for the opcode
  fetch, and changes no condition flags. This byte is not an `LD (HL),(HL)`
  encoding.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-DI-EI-001] The base interrupt-enable control instructions have
  no operands and do not change condition flags. `DI` immediately resets the
  maskable-interrupt flip-flops `IFF1` and `IFF2`; it encodes as single opcode
  byte `0xF3`. `EI` sets `IFF1` and `IFF2` so maskable interrupts become enabled
  after the instruction following `EI`; it encodes as single opcode byte `0xFB`.
  Each instruction has length 1 byte, uses 1 machine cycle and 4 T-states.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-IM-001] The interrupt-mode control instructions `IM 0`, `IM 1`,
  and `IM 2` set the Z80 maskable-interrupt mode to 0, 1, or 2 respectively and
  do not change condition flags. They use ED-prefixed opcodes: `IM 0` encodes as
  `0xED 0x46`, `IM 1` as `0xED 0x56`, and `IM 2` as `0xED 0x5E`. Each
  instruction has length 2 bytes, uses 2 machine cycles and 8 T-states.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-I-R-A-001] The special-register load instructions `LD I,A`
  and `LD R,A` copy the accumulator into the interrupt-vector register `I` or
  memory-refresh register `R` respectively and do not change condition flags.
  They use ED-prefixed opcodes: `LD I,A` encodes as `0xED 0x47`, and `LD R,A`
  encodes as `0xED 0x4F`. Each instruction has length 2 bytes, uses 2 machine
  cycles and 9 T-states.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-A-I-R-001] The special-register read instructions `LD A,I`
  and `LD A,R` copy the interrupt-vector register `I` or memory-refresh register
  `R` respectively into the accumulator. They use ED-prefixed opcodes: `LD A,I`
  encodes as `0xED 0x57`, and `LD A,R` encodes as `0xED 0x5F`. Each instruction
  has length 2 bytes and uses 2 machine cycles and 9 T-states. After the load,
  `S`, `Z`, and undocumented flags `5` and `3` reflect the loaded accumulator
  bits; `H` and `N` are reset; `P/V` is loaded from `IFF2`; and `C` is
  unchanged.

<!-- provenance: decision:ADR-0018 -->
- [id: Z80-OPC-LD-A-I-R-INT-PV-001] **Interrupted `LD A,I` / `LD A,R` → `P/V = 0`
  (boundary, out of single-step scope).** On real Z80 silicon there is a
  documented race: if a maskable interrupt is accepted at the instruction
  boundary *during* the `LD A,I` / `LD A,R` whose final M-cycle would latch
  `IFF2` into `P/V`, the interrupt-acknowledge clears `IFF1`/`IFF2` first, so
  `P/V` is loaded as `0` instead of the pre-interrupt `IFF2`. This is a known
  hardware corner that lets careful code observe a missed interrupt. It is a
  **boundary behavior between instruction execution and interrupt acceptance**,
  not a property of the instruction in isolation: the single-step CPU contract
  (`dna/conformance/cpu/`) executes one instruction with no `INT` sampling, so it
  is **not expressible there** and the FUSE `ed57`/`ed5f` cases (no interrupt)
  correctly load `P/V ← IFF2`. Interrupt acceptance is the **machine layer's**
  job (`machine-execution.md`, `MACHINE-INT-*`); modeling this race is therefore
  an optional machine-layer follow-up, recorded here as **explicitly out of scope
  for the single-step fixtures** (per the ADR-0018 silicon-vs-prose sweep, which
  enumerated this case). No coverage row; `@zx-vibes/cpu` is unaffected (it never
  samples `INT` mid-instruction).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-IO-N-A-001] The immediate-port accumulator I/O instructions use
  an 8-bit immediate port value `n` as the low half of the 16-bit I/O address
  and the current accumulator value as the high half. `OUT (n),A` writes the
  accumulator to port address `(A << 8) | n`, uses opcode `0xD3`, and then the
  immediate byte. `IN A,(n)` reads from port address `(A << 8) | n` into the
  accumulator, uses opcode `0xDB`, and then the immediate byte. Each instruction
  has length 2 bytes, uses 3 machine cycles and 11 T-states, and does not change
  condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-OUT-C-R-001] The register-port output instructions `OUT (C),B`,
  `OUT (C),C`, `OUT (C),D`, `OUT (C),E`, `OUT (C),H`, `OUT (C),L`, and
  `OUT (C),A` write the named register to the 16-bit I/O port address in `BC`,
  where `C` supplies the low address byte and `B` supplies the high address byte.
  They use ED-prefixed opcodes `0xED 0x41`, `0xED 0x49`, `0xED 0x51`,
  `0xED 0x59`, `0xED 0x61`, `0xED 0x69`, and `0xED 0x79` respectively. Each
  instruction has length 2 bytes, uses 3 machine cycles and 12 T-states, and
  changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-IN-R-C-001] The register-port input instructions `IN B,(C)`,
  `IN C,(C)`, `IN D,(C)`, `IN E,(C)`, `IN H,(C)`, `IN L,(C)`, and `IN A,(C)`
  read one byte from the 16-bit I/O port address in `BC`, where `C` supplies the
  low address byte and `B` supplies the high address byte, then store the byte in
  the named register. They use ED-prefixed opcodes `0xED 0x40`, `0xED 0x48`,
  `0xED 0x50`, `0xED 0x58`, `0xED 0x60`, `0xED 0x68`, and `0xED 0x78`
  respectively. Each instruction has length 2 bytes and uses 3 machine cycles
  and 12 T-states. After the input, `S`, `Z`, and undocumented flags `5` and
  `3` reflect the input byte; `H` and `N` are reset; `P/V` is the parity of the
  input byte; and `C` is unchanged.

<!-- provenance: fuse -->
- [id: Z80-OPC-IN-F-C-001] The ED-prefixed register-port input family has an
  eighth encoding at **register code 6** (the `(HL)` slot in other families):
  `0xED 0x70`. It is the input that **discards its result** — variously written
  `IN (C)`, `IN F,(C)`, or `IN (C),(C)`. It reads one byte from the 16-bit I/O
  port address in `BC` (low byte `C`, high byte `B`) and sets the condition flags
  **exactly as `IN r,(C)`** (Z80-OPC-IN-R-C-001): `S`, `Z`, and undocumented `5`
  and `3` from the input byte; `H` and `N` reset; `P/V` the parity of the input
  byte; `C` unchanged. Unlike the seven `IN r,(C)` forms it **stores the input
  byte in no register** — only the flags change. Length 2 bytes, 3 machine
  cycles, 12 T-states. The **canonical project syntax (D5) is `IN (C)`** — the
  form the disassembler emits and the assembler re-encodes byte-for-byte (it also
  accepts the synonym `IN F,(C)`). Promoted from prose to a first-class table row
  in `z80-opcodes.yaml` (Phase C bijection prerequisite, ADR-0025/D1): witnessed
  by the FUSE ED block (`ed70`), covered by the CPU-execution row `CPU-FUSE-ED-001`
  **and** the assembler row `ASM-EMIT-IN-C-001`.

<!-- provenance: fuse -->
- [id: Z80-OPC-OUT-C-0-001] The ED-prefixed register-port output family has the
  matching eighth encoding at **register code 6**: `0xED 0x71`, written
  `OUT (C),0`. On the **NMOS Z80** of the 48K Spectrum it writes the constant
  byte `0x00` to the 16-bit I/O port address in `BC` (low byte `C`, high byte
  `B`); it changes no condition flags. Length 2 bytes, 3 machine cycles, 12
  T-states. (The CMOS Z84C00 instead writes `0xFF`; the project models the NMOS
  part, the byte the FUSE ED block (`ed71`) pins and `@zx-vibes/cpu` writes —
  `z80-step.mjs` `(eop & 0xc7) === 0x41` arm, `r === 6 ? 0`.) The **canonical
  project syntax (D5) is `OUT (C),0`** — the form the disassembler emits and the
  assembler re-encodes byte-for-byte. Promoted from prose to a first-class table
  row in `z80-opcodes.yaml` (Phase C bijection prerequisite, ADR-0025/D1): covered
  by `CPU-FUSE-ED-001` **and** the assembler row `ASM-EMIT-OUT-C-0-001`.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-JR-E-001] The base unconditional `JR e` instruction loads the
  program counter with the address after the instruction plus signed 8-bit
  displacement `e`; displacement `e` is encoded as one two's-complement byte in
  range -128 through +127, opcode byte `0x18` precedes it, length is 2 bytes,
  timing is 3 machine cycles and 12 T-states, and condition flags are unchanged.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-JR-CC-E-001] The base conditional relative jumps `JR NZ,e`,
  `JR Z,e`, `JR NC,e`, and `JR C,e` branch using the same signed 8-bit
  displacement rule as `JR e`; their opcode bytes are `0x20`, `0x28`, `0x30`,
  and `0x38` respectively. The conditions test the current Z flag reset, Z flag
  set, C flag reset, or C flag set; when the condition is true, timing is
  3 machine cycles and 12 T-states, and when false, timing is 2 machine cycles
  and 7 T-states. The instruction length is 2 bytes and condition flags are
  unchanged.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-DJNZ-E-001] The base `DJNZ e` instruction decrements register `B`
  modulo 256 before testing it; if the decremented value is nonzero, it loads the
  program counter with the address after the instruction plus signed 8-bit
  displacement `e`, otherwise execution continues at the address after the
  instruction. Displacement `e` is encoded as one two's-complement byte in range
  -128 through +127, opcode byte `0x10` precedes it, length is 2 bytes, timing is
  3 machine cycles and 13 T-states when the branch is taken and 2 machine cycles
  and 8 T-states when it is not taken, and condition flags are unchanged.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-INC-R-001] The base 8-bit register increment instructions
  `INC B`, `INC C`, `INC D`, `INC E`, `INC H`, `INC L`, and `INC A` use opcode
  pattern `00 r 100`, where `r` is the register code `B=000`, `C=001`, `D=010`,
  `E=011`, `H=100`, `L=101`, `A=111`; this yields opcodes `0x04`, `0x0C`,
  `0x14`, `0x1C`, `0x24`, `0x2C`, and `0x3C` respectively. Each has length 1
  byte and uses 1 machine cycle and 4 T-states. Unlike the 16-bit `INC ss`
  forms, these 8-bit increments change the condition flags `S`, `Z`, `H`,
  `P/V`, and `N` (and the undocumented `5`/`3`) while preserving `C`; the
  flag-value computation is specified in the INC r section of
  `z80-cpu-execution.md`.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-DEC-R-001] The base 8-bit register decrement instructions
  `DEC B`, `DEC C`, `DEC D`, `DEC E`, `DEC H`, `DEC L`, and `DEC A` use opcode
  pattern `00 r 101`, where `r` is the register code `B=000`, `C=001`, `D=010`,
  `E=011`, `H=100`, `L=101`, `A=111`; this yields opcodes `0x05`, `0x0D`,
  `0x15`, `0x1D`, `0x25`, `0x2D`, and `0x3D` respectively. Each has length 1
  byte and uses 1 machine cycle and 4 T-states. These 8-bit decrements change
  `S`, `Z`, `H`, `P/V`, and `N` (and the undocumented `5`/`3`) while preserving
  `C`; `N` is set to 1 for subtraction and `P/V` records signed overflow. The
  `(HL)` memory slot `110` is carried by `Z80-OPC-DEC-HL-IND-001`, not this
  register family.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-INC-DEC-HL-IND-001] The base `(HL)` memory increment and
  decrement instructions `INC (HL)` and `DEC (HL)` read the byte at the address
  in register pair `HL`, add or subtract 1 modulo 256, and write the result
  back. They use register-code slot `110` in the `INC`/`DEC` patterns:
  `INC (HL)` encodes as `0x34` and `DEC (HL)` encodes as `0x35`. Each has length
  1 byte and uses 3 machine cycles and 11 T-states. Both change `S`, `Z`, `H`,
  `P/V`, and `N` (and undocumented `5`/`3`) from the result while preserving
  `C`; `INC (HL)` sets `N=0` and `DEC (HL)` sets `N=1`, and `P/V` records signed
  overflow.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ROT-A-001] The accumulator rotate instructions rotate the eight
  bits of `A` by one position: `RLCA` (`0x07`) rotates left circular, `RRCA`
  (`0x0F`) rotates right circular, `RLA` (`0x17`) rotates left through carry,
  and `RRA` (`0x1F`) rotates right through carry. Each has length 1 byte and
  uses 1 machine cycle and 4 T-states. They set `C` from the bit rotated out of
  `A`, reset `H` and `N` to 0, and copy undocumented `5`/`3` from the result
  `A`; `S`, `Z`, and `P/V` are unchanged.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-DAA-CPL-SCF-CCF-001] The accumulator/flag-adjust instructions are
  single-byte, 1 machine cycle, 4 T-states. `DAA` (`0x27`) decimal-adjusts `A`
  after an add or subtract using the `H`, `N`, and `C` flags; it sets `S`, `Z`,
  `H`, `P/V` (parity), `C`, and undocumented `5`/`3` from the result and leaves
  `N` unchanged. `CPL` (`0x2F`) one's-complements `A`; per the Zilog manual
  (UM0080) it sets `H=1` and `N=1` and leaves `S`, `Z`, `P/V`, `C` unchanged,
  and on NMOS silicon it also copies the undocumented `5`/`3` from the
  complemented `A` — the same FUSE-witnessed undocumented-bit behaviour the
  regenerated CPU already passes (and that `SCF`/`CCF`/`DAA`/the accumulator
  rotates track), so the table marks `5`, `H`, `3`, `N` as affected. `SCF`
  (`0x37`) sets `C=1`, resets `H` and `N`, and copies
  undocumented `5`/`3` from `A`; `S`, `Z`, `P/V` are unchanged. `CCF` (`0x3F`)
  complements `C` (the previous carry moves into `H`), resets `N`, and copies
  undocumented `5`/`3` from `A`; `S`, `Z`, `P/V` are unchanged.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ADD-HL-SS-001] The base 16-bit add instructions `ADD HL,BC`,
  `ADD HL,DE`, `ADD HL,HL`, and `ADD HL,SP` add the selected register pair to
  `HL` using opcode pattern `00 ss 1001` with register-pair codes `BC=00`,
  `DE=01`, `HL=10`, `SP=11`; this yields opcodes `0x09`, `0x19`, `0x29`, and
  `0x39`. Each has length 1 byte and uses 3 machine cycles and 11 T-states. They
  set `C` from the carry out of bit 15, set `H` from the carry out of bit 11,
  reset `N` to 0, and copy undocumented `5`/`3` from the high byte of the
  result; `S`, `Z`, and `P/V` are unchanged.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ALU-A-R-001] The base 8-bit ALU group operates on accumulator
  `A` and an operand that is a register `r = B,C,D,E,H,L,A`, the memory byte
  `(HL)`, or an 8-bit immediate `n`. The register/`(HL)` forms use opcode
  pattern `10 op r` (`r` = `B=000`…`A=111`, `(HL)=110`); the immediate forms use
  a dedicated opcode `11 op 110` followed by the literal byte `n`. The eight
  operations, their YAML family ids, and opcode bases are: `ADD A`
  (`Z80-OPC-ALU-ADD-001`, `0x80`/imm `0xC6`), `ADC A` (`Z80-OPC-ALU-ADC-001`,
  `0x88`/imm `0xCE`), `SUB` (`Z80-OPC-ALU-SUB-001`, `0x90`/imm `0xD6`), `SBC A`
  (`Z80-OPC-ALU-SBC-001`, `0x98`/imm `0xDE`), `AND` (`Z80-OPC-ALU-AND-001`,
  `0xA0`/imm `0xE6`), `XOR` (`Z80-OPC-ALU-XOR-001`, `0xA8`/imm `0xEE`), `OR`
  (`Z80-OPC-ALU-OR-001`, `0xB0`/imm `0xF6`), and `CP` (`Z80-OPC-ALU-CP-001`,
  `0xB8`/imm `0xFE`). In canonical syntax `ADD`, `ADC`, and `SBC` carry the
  explicit `A,` accumulator operand (`ADD A,B`); `SUB`, `AND`, `XOR`, `OR`, and
  `CP` take a single operand (`SUB B`). The register form is 1 byte, 1 machine
  cycle, 4 T-states; the `(HL)` and immediate forms are 2 bytes (1 then the
  operand byte), 2 machine cycles, 7 T-states. All eight operations change the
  full condition-flag set `S`, `Z`, `5`, `H`, `3`, `P/V`, `N`, `C`:
  `ADD`/`ADC`/`SUB`/`SBC`/`CP` set `P/V` from signed overflow and `N` from the
  operation (`0` for add, `1` for subtract/compare); the logical
  `AND`/`XOR`/`OR` set `P/V` from result parity, `N=0`, and `C=0`, with `H=1`
  for `AND` and `H=0` for `OR`/`XOR`.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-CB-ROT-001] The `CB`-prefixed rotate and shift group operates on
  an operand that is a register `r = B,C,D,E,H,L,A` or the memory byte `(HL)`,
  selected by register code `B=000`…`A=111` with `(HL)=110`. Each instruction is
  the prefix byte `0xCB` followed by opcode `op-base + r`, where the eight
  operations and their YAML family ids / opcode bases are: `RLC`
  (`Z80-OPC-CB-RLC-001`, `0x00`) rotate left circular; `RRC`
  (`Z80-OPC-CB-RRC-001`, `0x08`) rotate right circular; `RL`
  (`Z80-OPC-CB-RL-001`, `0x10`) rotate left through carry; `RR`
  (`Z80-OPC-CB-RR-001`, `0x18`) rotate right through carry; `SLA`
  (`Z80-OPC-CB-SLA-001`, `0x20`) shift left arithmetic (a `0` into bit 0); `SRA`
  (`Z80-OPC-CB-SRA-001`, `0x28`) shift right arithmetic (bit 7 preserved); `SLL`
  (`Z80-OPC-CB-SLL-001`, `0x30`); and `SRL` (`Z80-OPC-CB-SRL-001`, `0x38`) shift
  right logical (a `0` into bit 7). `SLL` (`CB 30`–`CB 37`, also called `SLI`,
  "shift left logical/inverted") is undocumented — it shifts left and feeds a
  `1` into bit 0 — and is given the canonical project syntax `SLL r` so it
  round-trips, per the ratified bijection decision (D1). The register forms are
  2 bytes, 2 machine cycles, 8 T-states; the `(HL)` forms are 2 bytes, 4 machine
  cycles, 15 T-states. All rotate/shift forms set `S`, `Z`, `P/V` (parity), and
  `C` (the bit shifted out) from the result, reset `H` and `N` to 0, and copy
  the undocumented `5`/`3` bits from the result.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-CB-BIT-001] The `CB`-prefixed `BIT b,r` group tests bit `b`
  (`0`–`7`) of an operand that is a register `r = B,C,D,E,H,L,A` or the memory
  byte `(HL)`. Each instruction is the prefix byte `0xCB` followed by opcode
  `01 b r` (base `0x40` + `b`×8 + register code), spanning `CB 40`–`CB 7F`. The
  register forms are 2 bytes, 2 machine cycles, 8 T-states; the `BIT b,(HL)`
  forms are 2 bytes, 3 machine cycles, **12 T-states** (not 15). `BIT` sets `Z`
  to the complement of the tested bit, sets `H=1`, resets `N=0`, mirrors `P/V`
  from `Z`, and sets `S` only when bit 7 is tested and set; `C` is unchanged. The
  undocumented `5`/`3` flags come from the operand register, or for the `(HL)`
  form from the high byte of the internal `WZ`/`MEMPTR` register — exactly the
  source the regenerated CPU already models (`Z80-EXEC-BIT-UNDOC-53-001`) and
  passes via FUSE; the table records `5`, `3` as affected and leaves the exact
  source to the CPU.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-CB-RES-SET-001] The `CB`-prefixed `RES b,r` and `SET b,r` groups
  reset (clear) or set bit `b` (`0`–`7`) of an operand that is a register
  `r = B,C,D,E,H,L,A` or the memory byte `(HL)`. Each instruction is the prefix
  byte `0xCB` followed by an opcode: `RES` (`Z80-OPC-CB-RES-001`) uses pattern
  `10 b r` (base `0x80`, spanning `CB 80`–`CB BF`) and `SET`
  (`Z80-OPC-CB-SET-001`) uses pattern `11 b r` (base `0xC0`, spanning
  `CB C0`–`CB FF`), with register code `B=000`…`A=111`, `(HL)=110`. The register
  forms are 2 bytes, 2 machine cycles, 8 T-states; the `(HL)` forms are 2 bytes,
  4 machine cycles, 15 T-states. `RES` and `SET` affect no condition flags (the
  loader default leaves all eight bits unchanged).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ED-ADC-SBC-HL-SS-001] The `ED`-prefixed 16-bit add/subtract-with-carry
  instructions `ADC HL,ss` (family `Z80-OPC-ED-ADC-HL-SS-001`) and `SBC HL,ss`
  (family `Z80-OPC-ED-SBC-HL-SS-001`) add or subtract a register pair
  `ss = BC,DE,HL,SP` and the carry flag to/from `HL`. Each is the prefix byte
  `0xED` followed by an opcode: `ADC HL,ss` uses pattern `01 ss 1010` (`ED 4A`,
  `ED 5A`, `ED 6A`, `ED 7A`) and `SBC HL,ss` uses pattern `01 ss 0010` (`ED 42`,
  `ED 52`, `ED 62`, `ED 72`), with register-pair codes `BC=00`, `DE=01`, `HL=10`,
  `SP=11`. Each has length 2 bytes and uses 4 machine cycles and 15 T-states.
  Both change the full condition-flag set `S`, `Z`, `5`, `H`, `3`, `P/V`, `N`,
  `C`: `S`/`Z`/`5`/`H`/`3` from the 16-bit result, `P/V` from signed overflow,
  `C` from the carry/borrow out of bit 15, and `N` reset to `0` for `ADC` but set
  to `1` for `SBC`. The table records only the affected partition (all eight
  bits), not the `N` value, which the CPU computes per operation.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ED-NEG-001] The `ED`-prefixed `NEG` instruction
  (`Z80-OPC-ED-NEG-001`) replaces the accumulator `A` with its two's complement
  (`0 - A`). Its canonical encoding is `0xED 0x44`; length 2 bytes, 2 machine
  cycles, 8 T-states. `NEG` changes every condition flag `S`, `Z`, `5`, `H`, `3`,
  `P/V`, `N`, `C`: `S`/`Z`/`5`/`H`/`3` from the result, `P/V` set only when `A`
  was `0x80` (the single value whose negation overflows), `N` set to `1`, and `C`
  set when `A` was non-zero (a borrow occurred). The NMOS Z80 also decodes seven
  **undocumented duplicate** opcodes `ED 4C`, `ED 54`, `ED 5C`, `ED 64`, `ED 6C`,
  `ED 74`, and `ED 7C` as `NEG`; these are **decode-only aliases** of the
  canonical `ED 44` row (see `Z80-OPC-ED-DECODE-ALIASES-001`), not separate table
  rows — the assembler emits only `ED 44`.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ED-RRD-RLD-001] The `ED`-prefixed BCD rotate-digit instructions
  `RRD` (`Z80-OPC-ED-RRD-001`, `0xED 0x67`) and `RLD` (`Z80-OPC-ED-RLD-001`,
  `0xED 0x6F`) rotate one 4-bit nibble between the low nibble of `A` and the byte
  at `(HL)`: `RRD` rotates right (the `(HL)` low nibble into `A`'s low nibble),
  `RLD` rotates left. Each has length 2 bytes and uses 5 machine cycles and 18
  T-states. Both set `S`, `Z`, `5`, `3` from the resulting `A`, set `P/V` from the
  parity of `A`, reset `H` and `N` to `0`, and leave `C` unchanged.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ED-BLOCK-TRANSFER-001] The `ED`-prefixed block-transfer
  instructions (family `Z80-OPC-ED-BLOCK-TRANSFER-001`) copy the byte at `(HL)`
  to `(DE)`, adjust `HL`/`DE`, and decrement the byte counter `BC`. `LDI`
  (`ED A0`) increments the pointers; `LDD` (`ED A8`) decrements them; both are
  single-step, 4 machine cycles, 16 T-states. `LDIR` (`ED B0`) and `LDDR`
  (`ED B8`) repeat automatically until `BC = 0`: while `BC != 0` after the step
  they re-execute, taking 5 machine cycles and 21 T-states; on the final step
  (`BC = 0`) they take 4 machine cycles and 16 T-states — the `[taken, notTaken]`
  conditional-timing pair, written like `JR cc,e`. All four reset `H` and `N` to
  `0`, set `P/V` to `(BC != 0)` after the step, and copy the undocumented `5`/`3`
  bits from the value `A + (HL)` (CPU-derived, FUSE-witnessed); `S`, `Z`, and `C`
  are preserved. **FUSE seed gap:** `LDIR`/`LDDR` (`ED B0`/`ED B8`) are not in the
  FUSE single-step suite, so their rows are `z80-spec`-authored and proven by the
  assembler and disassembler (they round-trip) but not FUSE-execution-witnessed —
  the same recorded gap class as `DJNZ e` (Phase A1 finding 1).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ED-BLOCK-COMPARE-001] The `ED`-prefixed block-compare instructions
  (family `Z80-OPC-ED-BLOCK-COMPARE-001`) compare `A` with the byte at `(HL)`,
  adjust `HL`, and decrement `BC`, without storing the result. `CPI` (`ED A1`)
  increments `HL`; `CPD` (`ED A9`) decrements it; both are single-step, 4 machine
  cycles, 16 T-states. `CPIR` (`ED B1`) and `CPDR` (`ED B9`) repeat until `BC = 0`
  or a match (`A = (HL)`): while repeating they take 5 machine cycles and 21
  T-states, else 4 machine cycles and 16 T-states (the `[taken, notTaken]` pair).
  All four set `S`, `Z`, `H`, and the undocumented `5`/`3` from the comparison
  `A - (HL)` (`5`/`3` CPU-derived), set `P/V` to `(BC != 0)` after the step, set
  `N` to `1`, and leave `C` unchanged. **FUSE seed gap:** `CPIR`/`CPDR`
  (`ED B1`/`ED B9`) are not in the FUSE single-step suite (see
  `Z80-OPC-ED-BLOCK-TRANSFER-001`).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ED-BLOCK-IO-001] The `ED`-prefixed block-I/O instructions (family
  `Z80-OPC-ED-BLOCK-IO-001`) move one byte between the I/O port in `(C)` and the
  memory byte at `(HL)`, adjust `HL`, and decrement the byte counter `B`. `INI`
  (`ED A2`)/`IND` (`ED AA`) input and increment/decrement `HL`; `OUTI`
  (`ED A3`)/`OUTD` (`ED AB`) output and increment/decrement `HL`; all four are
  single-step, 4 machine cycles, 16 T-states. The repeating forms `INIR`
  (`ED B2`), `INDR` (`ED BA`), `OTIR` (`ED B3`), and `OTDR` (`ED BB`) repeat until
  `B = 0`: while repeating, 5 machine cycles and 21 T-states; on the final step, 4
  machine cycles and 16 T-states (the `[taken, notTaken]` pair). Block I/O changes
  **all eight** condition flags (the affected partition is all of `S`, `Z`, `5`,
  `H`, `3`, `P/V`, `N`, `C`): `Z = (B - 1 == 0)` after the step and `N` = bit 7 of
  the transferred byte are documented, and `S`/`5`/`3` follow the decremented `B`;
  but `H`, `C`, and `P/V` have **intricate undocumented definitions** (functions
  of the transferred byte, `C`, and `B`) that the regenerated CPU implements
  exactly and FUSE witnesses — the same "CPU owns the undocumented values, the
  table owns only the affected partition" rule used for the `BIT` `5`/`3` bits
  (`Z80-EXEC-BIT-UNDOC-53-001`). **FUSE seed gap:** the repeating forms
  `INIR`/`INDR`/`OTIR`/`OTDR` (`ED B2`/`BA`/`B3`/`BB`) are not in the FUSE
  single-step suite (see `Z80-OPC-ED-BLOCK-TRANSFER-001`).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ED-DECODE-ALIASES-001] Several `ED`-prefixed mnemonics have more
  than one byte encoding on the NMOS Z80; the table carries exactly **one
  canonical row per mnemonic** and treats the undocumented duplicates as
  **decode-only aliases** (the disassembler decodes them; the assembler never
  emits them). The canonical encoding wins: `NEG` → `ED 44` (aliases `ED 4C`,
  `54`, `5C`, `64`, `6C`, `74`, `7C`); `RETN` → `ED 45`
  (`Z80-OPC-RETN-001`; aliases `ED 55`, `5D`, `65`, `6D`, `75`, `7D`); `IM 0` →
  `ED 46`, `IM 1` → `ED 56`, `IM 2` → `ED 5E` (`Z80-OPC-IM-*`; aliases `ED 4E`/`66`/`6E`,
  `ED 76`, `ED 7E`); and the 16-bit memory loads `LD (nn),HL` → base `0x22` and
  `LD HL,(nn)` → base `0x2A` (`Z80-OPC-LD-NN-IND-HL-001`/`Z80-OPC-LD-HL-NN-IND-001`)
  rather than the ED duplicates `ED 63`/`ED 6B`. Enforcing one canonical
  encoding per mnemonic is the `OPCODE-DECODE-UNIQUE` rule wired in Phase C; until
  then these alias bytes remain on the generator's worklist by design (the
  generator keys on bytes, not mnemonics).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ADD-IXIY-PP-001] The indexed 16-bit add instructions
  `ADD IX,pp` (family `Z80-OPC-ADD-IXIY-PP-001`) add register pair
  `pp = BC,DE,IX,SP` to `IX`, and `ADD IY,pp` for `pp = BC,DE,IY,SP` to `IY`.
  They are the `DD`/`FD`-prefixed forms of `ADD HL,ss` (`00 ss 1001`): `ADD IX,pp`
  encodes as `0xDD` then `0x09`/`0x19`/`0x29`/`0x39`, and `ADD IY,pp` as `0xFD`
  then the same opcodes (`0x29` is the `IX,IX`/`IY,IY` self-add). Each has length
  2 bytes and uses 4 machine cycles and 15 T-states (the prefix adds one machine
  cycle and 4 T-states to the 11-T-state base). The condition-bit effect matches
  `ADD HL,ss`: `C` from the carry out of bit 15, `H` from the carry out of bit 11,
  `N` reset, undocumented `5`/`3` from the high byte of the result; `S`, `Z`,
  `P/V` are unchanged.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-SLOT-TOKENS-D] The signed 8-bit **index displacement** byte in the
  `(IX+d)` / `(IY+d)` indexed operand is the reserved **lowercase** slot token
  `d` (z80-spec). Like the relative-displacement token `e`, it contributes exactly
  one immediate byte to the encoding and is recognized **case-sensitively**: the
  register `D` (as in `LD (IX+d),D`) is never the displacement slot `d`. The slot
  appears inside the indexed memory operand after the index register (canonical
  spelling `(IX+d)` / `(IY+d)`, always written `+d` regardless of the concrete
  displacement's sign), and its byte position in the template is the single `d`
  parameter byte. See `Z80-OPC-SLOT-TOKENS-001` for the shared slot-token rule;
  `d` is added to that grammar in `z80-opcodes-check.mjs`'s `SLOT_TOKEN_PARAMS`.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-INC-DEC-IDXHALF-001] The undocumented index-half register
  increment and decrement instructions (family `Z80-OPC-INC-DEC-IDXHALF-001`)
  operate on the high and low bytes of `IX`/`IY` — `IXH`/`IXL`/`IYH`/`IYL` — as
  the `DD`/`FD`-prefixed forms of `INC r`/`DEC r` at register codes `100`/`101`.
  `INC IXH`/`DEC IXH`/`INC IXL`/`DEC IXL` encode as `0xDD` then
  `0x24`/`0x25`/`0x2C`/`0x2D`; the `IY` forms use `0xFD` and the same opcodes.
  Each has length 2 bytes and uses 2 machine cycles and 8 T-states. The
  condition-bit effect matches `INC r`/`DEC r`: `S`, `Z`, `H`, `P/V`, `N` and the
  undocumented `5`/`3` are set from the result/operand while `C` is preserved.
  These index-half forms are undocumented but are given canonical project syntax
  (`IXH`/`IXL`/`IYH`/`IYL`) so they round-trip, per the ratified bijection
  decision (D1).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-IDXHALF-N-001] The undocumented index-half immediate loads
  (family `Z80-OPC-LD-IDXHALF-N-001`) load 8-bit immediate `n` into an index-half
  register: `LD IXH,n`/`LD IXL,n` encode as `0xDD 0x26 n`/`0xDD 0x2E n`, and the
  `IY` forms as `0xFD 0x26 n`/`0xFD 0x2E n` (the `DD`/`FD` forms of `LD H,n`/
  `LD L,n`). Each has length 3 bytes, uses 3 machine cycles and 11 T-states, and
  changes no condition flags. Canonical project syntax per D1.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-INC-DEC-IDX-IND-001] The indexed-memory increment and decrement
  instructions (family `Z80-OPC-INC-DEC-IDX-IND-001`) read the byte at the
  effective address `IX + d` (or `IY + d`) with signed displacement `d`, add or
  subtract 1 modulo 256, and write the result back. `INC (IX+d)`/`DEC (IX+d)`
  encode as `0xDD 0x34 d`/`0xDD 0x35 d`, and the `IY` forms as `0xFD 0x34 d`/
  `0xFD 0x35 d`. Each has length 3 bytes (prefix, opcode, displacement) and uses
  6 machine cycles and 23 T-states. The condition-bit effect matches `INC (HL)`/
  `DEC (HL)`: `S`, `Z`, `H`, `P/V`, `N` and undocumented `5`/`3` are set from the
  result, `C` is preserved, `INC` sets `N=0` and `DEC` sets `N=1`, and `P/V`
  records signed overflow.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-IDX-IND-N-001] The indexed-memory immediate stores (family
  `Z80-OPC-LD-IDX-IND-N-001`) store 8-bit immediate `n` to the effective address
  `IX + d` (or `IY + d`). `LD (IX+d),n` encodes as `0xDD 0x36 d n` and
  `LD (IY+d),n` as `0xFD 0x36 d n` — the displacement byte `d` precedes the
  immediate byte `n`. Each has length 4 bytes, uses 5 machine cycles and 19
  T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-R-IDX-IND-001] The indexed-memory register loads (family
  `Z80-OPC-LD-R-IDX-IND-001`) load register `r = B,C,D,E,H,L,A` from the byte at
  `IX + d` (or `IY + d`). `LD r,(IX+d)` uses `0xDD` then the `LD r,(HL)` opcode
  `01 r 110` (`0x46`, `0x4E`, `0x56`, `0x5E`, `0x66`, `0x6E`, `0x7E`) followed by
  displacement `d`; the `IY` forms use `0xFD`. Note that under the index prefix
  these opcodes always denote the memory operand, so `H`/`L` here are the real
  registers `H`/`L` (not `IXH`/`IXL`). Each has length 3 bytes, uses 5 machine
  cycles and 19 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-IDX-IND-R-001] The indexed-memory register stores (family
  `Z80-OPC-LD-IDX-IND-R-001`) store register `r = B,C,D,E,H,L,A` to the byte at
  `IX + d` (or `IY + d`). `LD (IX+d),r` uses `0xDD` then the `LD (HL),r` opcode
  `01 110 r` (`0x70`–`0x77`, excluding `0x76` which is `HALT`) followed by
  displacement `d`; the `IY` forms use `0xFD`. Each has length 3 bytes, uses 5
  machine cycles and 19 T-states, and changes no condition flags.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ALU-IDX-IND-001] The indexed-memory ALU group (family
  `Z80-OPC-ALU-IDX-IND-001`) operates accumulator `A` against the byte at
  `IX + d` (or `IY + d`) for all eight operations `ADD A`, `ADC A`, `SUB`,
  `SBC A`, `AND`, `XOR`, `OR`, `CP`. Each is `0xDD` (or `0xFD`) then the
  corresponding `ALU A,(HL)` opcode `10 op 110` (`0x86`, `0x8E`, `0x96`, `0x9E`,
  `0xA6`, `0xAE`, `0xB6`, `0xBE`) followed by displacement `d`. Each has length 3
  bytes, uses 5 machine cycles and 19 T-states, and changes the full condition-bit
  set exactly as the base `ALU A,(HL)` forms (`Z80-OPC-ALU-A-R-001`).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-LD-IDXHALF-R-001] The undocumented index-half register transfers
  (family `Z80-OPC-LD-IDXHALF-R-001`) copy a byte between an 8-bit register and an
  index-half register, taking the `DD`/`FD`-prefixed `LD r,r'` block (`01 dst src`)
  in which register codes `100`/`101` denote `IXH`/`IXL` (`IYH`/`IYL` under `FD`)
  rather than `H`/`L` — but only when the other operand is **not** the `(IX+d)`
  memory column (code `110`). This covers `LD r,IXH`/`LD r,IXL` for
  `r = B,C,D,E,A`, `LD IXH,r`/`LD IXL,r` for `r = B,C,D,E,A`, and the four
  half-to-half moves `LD IXH,IXH`, `LD IXH,IXL`, `LD IXL,IXH`, `LD IXL,IXL` (24
  encodings under `DD`, 24 under `FD`). Pairs that would mix an index half with
  `(IX+d)` or with plain `H`/`L` are not encodable and are not in this family. Each
  has length 2 bytes, uses 2 machine cycles and 8 T-states, and changes no
  condition flags. Canonical project syntax per D1.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-ALU-IDXHALF-001] The undocumented index-half ALU group (family
  `Z80-OPC-ALU-IDXHALF-001`) operates accumulator `A` against an index-half
  register `IXH`/`IXL`/`IYH`/`IYL` for all eight operations `ADD A`, `ADC A`,
  `SUB`, `SBC A`, `AND`, `XOR`, `OR`, `CP`. Each is `0xDD` (or `0xFD`) then the
  corresponding `ALU A,r` opcode `10 op r` with `r = 100`/`101` for the high/low
  index half (`0x84`/`0x85`, `0x8C`/`0x8D`, `0x94`/`0x95`, `0x9C`/`0x9D`,
  `0xA4`/`0xA5`, `0xAC`/`0xAD`, `0xB4`/`0xB5`, `0xBC`/`0xBD`). Each has length 2
  bytes, uses 2 machine cycles and 8 T-states, and changes the full condition-bit
  set exactly as the base `ALU A,r` forms. Canonical project syntax per D1.

<!-- provenance: z80-spec -->
- [id: Z80-OPC-DDCB-ROT-001] The double-prefixed indexed rotate/shift group
  (families `Z80-OPC-DDCB-ROT-001` for `IX+d` and `Z80-OPC-FDCB-ROT-001` for
  `IY+d`) applies `RLC`/`RRC`/`RL`/`RR`/`SLA`/`SRA`/`SLL`/`SRL` to the byte at the
  effective address `IX + d` (or `IY + d`). Every form is a **4-byte** encoding:
  the index prefix `0xDD` (or `0xFD`), then `0xCB`, then the signed displacement
  byte `d`, then the opcode byte (the displacement precedes the opcode — unlike
  every other instruction where the opcode comes first). The opcode byte is the
  same `00 op z` octal layout as the `CB`-prefixed rotates, where the low three
  bits `z` are normally the register selector. For `z = 6` the operation acts only
  on `(IX+d)` — the canonical `(HL)`-equivalent form, e.g. `RLC (IX+d)` → `DD CB d
  06`. For the **other seven** values `z = 0..5,7` (registers `B,C,D,E,H,L,A`) the
  NMOS Z80 *also* copies the rotated/shifted result into that register while still
  writing it back to `(IX+d)`: these are the **undocumented result-copy** forms,
  given canonical project syntax `RLC (IX+d),B` … `RLC (IX+d),A` per the ratified
  bijection decision (D1) so they round-trip. All eight `z` values per operation
  are distinct rows (8 operations × 8 `z` = 64 rows per prefix). Each uses 6
  machine cycles and 23 T-states and changes the full condition-bit set exactly as
  the `CB` rotate/shift it extends (`H = 0`, `N = 0`, `P/V = parity`, `C` = the
  bit shifted out, undocumented `5`/`3` from the result); the result-copy variant
  has identical flags. Every T-state was cross-checked against the FUSE `ddcb`/
  `fdcb` end-state (256 cases each, zero disagreements).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-DDCB-BIT-001] The double-prefixed indexed bit-test group (families
  `Z80-OPC-DDCB-BIT-001` for `IX+d` and `Z80-OPC-FDCB-BIT-001` for `IY+d`) tests
  bit `b = 0..7` of the byte at `IX + d` (or `IY + d`). `BIT b,(IX+d)` encodes as
  `DD CB d` then the `BIT b,(HL)` opcode `01 b 110` (`0x46`, `0x4E`, `0x56`,
  `0x5E`, `0x66`, `0x6E`, `0x76`, `0x7E`). **`BIT` ignores the low three bits**
  `z` of the opcode, so all eight `z` values decode to the same mnemonic; the
  table carries only the canonical `z = 6` row per bit (the `(HL)`-equivalent),
  and the other seven encodings per bit are **decode-only aliases**
  (`Z80-OPC-DDCB-DECODE-ALIASES-001`). Each canonical form uses 5 machine cycles
  and **20 T-states** (note: 20, not the 23 of the read-modify-write rotate and
  RES/SET forms — `BIT` performs no write-back). The condition-bit effect matches
  `BIT b,(HL)`: `Z` from the tested bit, `H = 1`, `N = 0`, `S`/`P/V` from the
  result, `C` preserved. The undocumented `5`/`3` are taken from the **high byte
  of the effective address** (the internal `WZ`/`MEMPTR` register, `= IX + d`),
  not from the tested operand — a CPU-owned source recorded the same way as the
  `CB` `BIT` `5`/`3` bits (`Z80-EXEC-BIT-UNDOC-53-001`). All T-states were
  cross-checked against the FUSE `ddcb`/`fdcb` end-state (zero disagreements).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-DDCB-RES-SET-001] The double-prefixed indexed bit reset/set group
  (families `Z80-OPC-DDCB-RES-SET-001` for `IX+d` and `Z80-OPC-FDCB-RES-SET-001`
  for `IY+d`) resets (`RES`) or sets (`SET`) bit `b = 0..7` of the byte at
  `IX + d` (or `IY + d`) and writes it back. The 4-byte encoding is `DD CB d`
  (or `FD CB d`) then the opcode byte `10 b z` (`RES`, `0x80`–`0xBF`) or `11 b z`
  (`SET`, `0xC0`–`0xFF`). As with the rotates, `z = 6` is the canonical form
  acting only on `(IX+d)` (e.g. `SET 7,(IX+d)` → `DD CB d FE`), and the other
  seven `z` values are the **undocumented result-copy** forms that also store the
  modified byte into register `r = B,C,D,E,H,L,A`, given canonical syntax
  `RES b,(IX+d),r` / `SET b,(IX+d),r` per D1. All eight `z` are distinct rows
  (8 bits × 8 `z` × 2 operations = 128 rows per prefix). Each uses 6 machine
  cycles and 23 T-states and changes **no** condition flags. Every T-state was
  cross-checked against the FUSE `ddcb`/`fdcb` end-state (zero disagreements).

<!-- provenance: z80-spec -->
- [id: Z80-OPC-DDCB-DECODE-ALIASES-001] Unlike the rotate/shift and `RES`/`SET`
  groups (whose `z ≠ 6` forms are *distinct* result-copy mnemonics with their own
  rows), `BIT b,(IX+d)` / `BIT b,(IY+d)` **ignores** the opcode's low three bits
  `z`, so all eight encodings per bit decode to the identical mnemonic. The table
  carries exactly **one canonical row per `(prefix, bit)`** — the `z = 6` form
  (`…46`, `…4E`, `…56`, `…5E`, `…66`, `…6E`, `…76`, `…7E`) — and treats the other
  seven `z` values (`z = 0..5,7`) as **decode-only aliases**: the disassembler
  decodes them to `BIT b,(IX+d)`, but the assembler emits only the canonical `z=6`
  byte. That is **56 alias encodings per prefix** (8 bits × 7 non-canonical `z`),
  **112 in total** across `DDCB` + `FDCB`. Enforcing one canonical encoding per
  mnemonic is the `OPCODE-DECODE-UNIQUE` rule wired in Phase C; until then these
  alias bytes remain on the generator's worklist by design (it keys on bytes, not
  mnemonics), exactly as the `ED` decode aliases (`Z80-OPC-ED-DECODE-ALIASES-001`).

## Source References

- `z80-spec`: Zilog Z80 CPU User Manual UM0080, instruction table entries for
  the current `NOP`, `HALT`, `DI`, `EI`, `LD r,r'`, `LD IX,nn`, `LD IY,nn`,
  `LD`, `LD HL,(nn)`, `LD (nn),HL`, `LD IX,(nn)`, `LD IY,(nn)`,
  `LD (nn),IX`, `LD (nn),IY`,
  `LD dd,(nn)`, `LD (nn),dd`, `LD SP,HL`, `LD SP,IX`, `LD SP,IY`, `INC ss`,
  `DEC ss`, `INC IX`, `INC IY`, `DEC IX`, `DEC IY`, `PUSH qq`, `POP qq`,
  `JP nn`, `JP cc,nn`, `JP (HL)`, `JP (IX)`, `JP (IY)`, `JR e`,
  `JR cc,e`, `DJNZ e`, `EX AF,AF'`, `EX DE,HL`, `EXX`, `CALL nn`, `CALL cc,nn`,
  `RET`, `RET cc`, and `RST p` slices;
  `LD I,A`, `LD R,A`, `LD A,I`, `LD A,R`, `OUT (n),A`, `IN A,(n)`,
  `OUT (C),r`, and `IN r,(C)` slices;
  the `INC r` 8-bit register increment slice;
  the base-completion slices `DEC r`, `INC (HL)`/`DEC (HL)`, accumulator rotates
  `RLCA`/`RRCA`/`RLA`/`RRA`, `DAA`/`CPL`/`SCF`/`CCF`, `ADD HL,ss`, and the 8-bit
  ALU group `ADD`/`ADC`/`SUB`/`SBC`/`AND`/`XOR`/`OR`/`CP` over `A,r`/`A,(HL)`/`A,n`;
  the `CB`-prefixed group rotates/shifts
  `RLC`/`RRC`/`RL`/`RR`/`SLA`/`SRA`/`SLL`/`SRL` and `BIT`/`RES`/`SET b,r` over
  `B,C,D,E,H,L,(HL),A` (including the undocumented `SLL`);
  the `ED`-completion slice `ADC HL,ss`, `SBC HL,ss`, `NEG`, `RRD`, `RLD`, the
  block-transfer `LDI`/`LDD`/`LDIR`/`LDDR`, block-compare
  `CPI`/`CPD`/`CPIR`/`CPDR`, and block-I/O
  `INI`/`IND`/`OUTI`/`OUTD`/`INIR`/`INDR`/`OTIR`/`OTDR` slices;
  the `DD`/`FD` index slice — `ADD IX,pp`/`ADD IY,pp`, `LD r,(IX+d)`/`(IY+d)`,
  `LD (IX+d)`/`(IY+d),r`, `LD (IX+d)`/`(IY+d),n`, `ALU A,(IX+d)`/`(IY+d)`,
  `INC`/`DEC (IX+d)`/`(IY+d)` — and the undocumented index-half registers
  `IXH`/`IXL`/`IYH`/`IYL` (`INC`/`DEC`, `LD reg,n`, register transfers, and the
  `ALU A,` group), given canonical project syntax per the D1 bijection decision;
  register code table; and timing/condition-bit columns:
  https://www.zilog.com/docs/z80/um0080.pdf
- `fuse`: FUSE Z80 test suite (`z80/tests/tests.in`, `z80/tests/tests.expected`),
  the register-code-6 ED I/O slots `ed70` (`IN (C)`/`IN F,(C)`: flags-only, no
  register store) and `ed71` (`OUT (C),0`: NMOS writes `0x00`); covered by
  `CPU-FUSE-ED-001` and pinned in
  `dna/conformance/external/fuse-z80-tests.manifest.json`.

## Acceptance Criteria

- `ASM-EMIT-001` must prove that source `LD A,n` assembles to bytes `0x3E nn`.
- `ASM-EMIT-LD-R-N-001` must prove that source `LD r,n` for
  `r = B,C,D,E,H,L,A` assembles to the base opcode-pattern bytes `00 r 110 nn`.
- `ASM-EMIT-LD-R-R-001` must prove that source `LD r,r'` for every
  register-only pair in `B,C,D,E,H,L,A` assembles to the base opcode-pattern
  bytes `01 destination source`, excluding the `(HL)` memory slot.
- `ASM-EMIT-LD-DD-NN-001` must prove that source `LD dd,nn` for
  `dd = BC,DE,HL,SP` assembles to opcode bytes `0x01`, `0x11`, `0x21`, and
  `0x31` with the 16-bit immediate emitted low byte first.
- `ASM-EMIT-LD-IXIY-NN-001` must prove that source `LD IX,nn` and `LD IY,nn`
  assemble to `0xDD 0x21 nn-low nn-high` and
  `0xFD 0x21 nn-low nn-high`.
- `ASM-EMIT-LD-ACC-BCDE-IND-001` must prove that source `LD A,(BC)`,
  `LD A,(DE)`, `LD (BC),A`, and `LD (DE),A` assembles to `0x0A`, `0x1A`,
  `0x02`, and `0x12`.
- `ASM-EMIT-INC-R-001` must prove that source `INC r` for `r = B,C,D,E,H,L,A`
  assembles to the base opcode-pattern bytes `00 r 100` (`0x04`, `0x0C`, `0x14`,
  `0x1C`, `0x24`, `0x2C`, `0x3C`).
- `ASM-EMIT-LD-ACC-NN-IND-001` must prove that source `LD A,(nn)` and
  `LD (nn),A` assemble to `0x3A nn-low nn-high` and
  `0x32 nn-low nn-high`.
- `ASM-EMIT-LD-HL-NN-IND-001` must prove that source `LD HL,(nn)` and
  `LD (nn),HL` assemble to `0x2A nn-low nn-high` and
  `0x22 nn-low nn-high`.
- `ASM-EMIT-LD-IXIY-NN-IND-001` must prove that source `LD IX,(nn)`,
  `LD IY,(nn)`, `LD (nn),IX`, and `LD (nn),IY` assemble to the indexed-prefix
  absolute word-transfer opcodes with the 16-bit address emitted low byte first.
- `ASM-EMIT-LD-DD-NN-IND-001` must prove that source `LD dd,(nn)` and
  `LD (nn),dd` for `dd = BC,DE,SP` assemble to the ED-prefixed absolute
  word-transfer opcodes with the 16-bit address emitted low byte first.
- `ASM-EMIT-LD-SP-HL-001` must prove that source `LD SP,HL` assembles to single
  byte `0xF9`.
- `ASM-EMIT-LD-SP-IXIY-001` must prove that source `LD SP,IX` and `LD SP,IY`
  assemble to `0xDD 0xF9` and `0xFD 0xF9`.
- `ASM-EMIT-INC-DEC-SS-001` must prove that source `INC ss` and `DEC ss` for
  `ss = BC,DE,HL,SP` assemble to `0x03`, `0x13`, `0x23`, `0x33`, `0x0B`,
  `0x1B`, `0x2B`, and `0x3B`.
- `ASM-EMIT-INC-DEC-IXIY-001` must prove that source `INC IX`, `INC IY`,
  `DEC IX`, and `DEC IY` assemble to `0xDD 0x23`, `0xFD 0x23`, `0xDD 0x2B`,
  and `0xFD 0x2B`.
- `ASM-EMIT-PUSH-QQ-001` must prove that source `PUSH qq` for
  `qq = BC,DE,HL,AF` assembles to `0xC5`, `0xD5`, `0xE5`, and `0xF5`.
- `ASM-EMIT-PUSH-IXIY-001` must prove that source `PUSH IX` and `PUSH IY`
  assemble to `0xDD 0xE5` and `0xFD 0xE5`.
- `ASM-EMIT-POP-QQ-001` must prove that source `POP qq` for
  `qq = BC,DE,HL,AF` assembles to `0xC1`, `0xD1`, `0xE1`, and `0xF1`.
- `ASM-EMIT-POP-IXIY-001` must prove that source `POP IX` and `POP IY`
  assemble to `0xDD 0xE1` and `0xFD 0xE1`.
- `ASM-EMIT-LD-HL-MEM-001` must prove that source `LD (HL),n`, `LD r,(HL)`, and
  `LD (HL),r` for `r = B,C,D,E,H,L,A` assembles to the specified bytes without
  producing an `LD (HL),(HL)` form.
- `ASM-EMIT-JP-NN-001` must prove that source `JP nn` assembles to `0xC3`
  followed by the 16-bit address low byte first.
- `ASM-EMIT-JP-CC-NN-001` must prove that source `JP cc,nn` for
  `cc = NZ,Z,NC,C,PO,PE,P,M` assembles to the condition opcodes followed by the
  16-bit address low byte first.
- `ASM-EMIT-JP-HL-001` must prove that source `JP (HL)` assembles to single byte
  `0xE9`.
- `ASM-EMIT-JP-IXIY-001` must prove that source `JP (IX)` and `JP (IY)`
  assemble to `0xDD 0xE9` and `0xFD 0xE9`.
- `ASM-EMIT-EX-AF-AF-PRIME-001` must prove that source `EX AF,AF'` assembles to
  single byte `0x08`.
- `ASM-EMIT-EX-DE-HL-001` must prove that source `EX DE,HL` assembles to single
  byte `0xEB`.
- `ASM-EMIT-EXX-001` must prove that source `EXX` assembles to single byte
  `0xD9`.
- `ASM-EMIT-EX-SP-HL-IXIY-001` must prove that sources `EX (SP),HL`,
  `EX (SP),IX`, and `EX (SP),IY` assemble to `0xE3`, `0xDD 0xE3`, and
  `0xFD 0xE3`.
- `ASM-EMIT-CALL-NN-001` must prove that source `CALL nn` assembles to `0xCD`
  followed by the 16-bit address low byte first.
- `ASM-EMIT-CALL-CC-NN-001` must prove that source `CALL cc,nn` for
  `cc = NZ,Z,NC,C,PO,PE,P,M` assembles to the condition opcodes followed by the
  16-bit address low byte first.
- `ASM-EMIT-RET-001` must prove that source `RET` assembles to single byte
  `0xC9`.
- `ASM-EMIT-RET-CC-001` must prove that source `RET cc` for
  `cc = NZ,Z,NC,C,PO,PE,P,M` assembles to the corresponding single-byte
  condition opcodes.
- `ASM-EMIT-RETN-RETI-001` must prove that sources `RETN` and `RETI` assemble to
  `0xED 0x45` and `0xED 0x4D`.
- `ASM-EMIT-RST-P-001` must prove that source `RST p` for
  `p = 00H,08H,10H,18H,20H,28H,30H,38H` assembles to the corresponding
  single-byte restart opcodes.
- `ASM-EMIT-NOP-001` must prove that source `NOP` assembles to single byte
  `0x00`.
- `ASM-EMIT-HALT-001` must prove that source `HALT` assembles to single byte
  `0x76`.
- `ASM-EMIT-DI-EI-001` must prove that sources `DI` and `EI` assemble to single
  bytes `0xF3` and `0xFB`.
- `ASM-EMIT-IM-001` must prove that sources `IM 0`, `IM 1`, and `IM 2` assemble
  to `0xED 0x46`, `0xED 0x56`, and `0xED 0x5E`.
- `ASM-EMIT-LD-I-R-A-001` must prove that sources `LD I,A` and `LD R,A` assemble
  to `0xED 0x47` and `0xED 0x4F`.
- `ASM-EMIT-LD-A-I-R-001` must prove that sources `LD A,I` and `LD A,R` assemble
  to `0xED 0x57` and `0xED 0x5F`.
- `ASM-EMIT-IO-N-A-001` must prove that sources `OUT (n),A` and `IN A,(n)`
  assemble to `0xD3 n` and `0xDB n`.
- `ASM-EMIT-OUT-C-R-001` must prove that sources `OUT (C),r` for
  `r = B,C,D,E,H,L,A` assemble to the ED-prefixed register-port output opcodes.
- `ASM-EMIT-IN-R-C-001` must prove that sources `IN r,(C)` for
  `r = B,C,D,E,H,L,A` assemble to the ED-prefixed register-port input opcodes.
- `ASM-EMIT-JR-E-001` must prove that source `JR e` assembles to `0x18` followed
  by the signed 8-bit displacement from the address after the instruction.
- `ASM-EMIT-JR-CC-E-001` must prove that source `JR NZ,e`, `JR Z,e`,
  `JR NC,e`, and `JR C,e` assemble to their condition opcodes followed by the
  signed 8-bit displacement from the address after the instruction.
- `ASM-EMIT-DJNZ-E-001` must prove that source `DJNZ e` assembles to `0x10`
  followed by the signed 8-bit displacement from the address after the
  instruction.
- `ASM-EMIT-ALU-ADD-001` must prove that source `ADD A,r` for
  `r = B,C,D,E,H,L,A`, `ADD A,(HL)`, and `ADD A,n` assemble to opcodes
  `0x80`–`0x87` and immediate `0xC6 n`.
- `ASM-EMIT-ALU-ADC-001` must prove that source `ADC A,r` for
  `r = B,C,D,E,H,L,A`, `ADC A,(HL)`, and `ADC A,n` assemble to opcodes
  `0x88`–`0x8F` and immediate `0xCE n`.
- `ASM-EMIT-ALU-SUB-001` must prove that source `SUB r` for
  `r = B,C,D,E,H,L,A`, `SUB (HL)`, and `SUB n` assemble to opcodes
  `0x90`–`0x97` and immediate `0xD6 n`.
- `ASM-EMIT-ALU-SBC-001` must prove that source `SBC A,r` for
  `r = B,C,D,E,H,L,A`, `SBC A,(HL)`, and `SBC A,n` assemble to opcodes
  `0x98`–`0x9F` and immediate `0xDE n`.
- `ASM-EMIT-ALU-AND-001` must prove that source `AND r` for
  `r = B,C,D,E,H,L,A`, `AND (HL)`, and `AND n` assemble to opcodes
  `0xA0`–`0xA7` and immediate `0xE6 n`.
- `ASM-EMIT-ALU-XOR-001` must prove that source `XOR r` for
  `r = B,C,D,E,H,L,A`, `XOR (HL)`, and `XOR n` assemble to opcodes
  `0xA8`–`0xAF` and immediate `0xEE n`.
- `ASM-EMIT-ALU-OR-001` must prove that source `OR r` for
  `r = B,C,D,E,H,L,A`, `OR (HL)`, and `OR n` assemble to opcodes
  `0xB0`–`0xB7` and immediate `0xF6 n`.
- `ASM-EMIT-ALU-CP-001` must prove that source `CP r` for
  `r = B,C,D,E,H,L,A`, `CP (HL)`, and `CP n` assemble to opcodes
  `0xB8`–`0xBF` and immediate `0xFE n`.
- `ASM-EMIT-DEC-R-001` must prove that source `DEC r` for `r = B,C,D,E,H,L,A`
  assembles to the base opcode-pattern bytes `00 r 101` (`0x05`, `0x0D`, `0x15`,
  `0x1D`, `0x25`, `0x2D`, `0x3D`).
- `ASM-EMIT-INC-DEC-HL-IND-001` must prove that source `INC (HL)` and `DEC (HL)`
  assemble to `0x34` and `0x35`.
- `ASM-EMIT-ROT-A-001` must prove that source `RLCA`, `RRCA`, `RLA`, and `RRA`
  assemble to `0x07`, `0x0F`, `0x17`, and `0x1F`.
- `ASM-EMIT-DAA-CPL-SCF-CCF-001` must prove that source `DAA`, `CPL`, `SCF`, and
  `CCF` assemble to `0x27`, `0x2F`, `0x37`, and `0x3F`.
- `ASM-EMIT-ADD-HL-SS-001` must prove that source `ADD HL,ss` for
  `ss = BC,DE,HL,SP` assembles to `0x09`, `0x19`, `0x29`, and `0x39`.
- `ASM-EMIT-CB-ROT-001` must prove that source `RLC`/`RRC`/`RL`/`RR`/`SLA`/`SRA`/
  `SLL`/`SRL r` for `r = B,C,D,E,H,L,(HL),A` assembles to `CB 00`–`CB 3F` (the
  prefix `0xCB` followed by `op-base + r`, including the undocumented `SLL`).
- `ASM-EMIT-CB-BIT-001` must prove that source `BIT b,r` for `b = 0..7` and
  `r = B,C,D,E,H,L,(HL),A` assembles to `CB 40`–`CB 7F` (`0xCB` then `01 b r`).
- `ASM-EMIT-CB-RES-SET-001` must prove that source `RES b,r` and `SET b,r` for
  `b = 0..7` and `r = B,C,D,E,H,L,(HL),A` assemble to `CB 80`–`CB BF` (`RES`,
  `0xCB` then `10 b r`) and `CB C0`–`CB FF` (`SET`, `0xCB` then `11 b r`).
- `ASM-EMIT-ED-ADC-SBC-HL-SS-001` must prove that source `ADC HL,ss` and
  `SBC HL,ss` for `ss = BC,DE,HL,SP` assemble to `ED 4A`/`5A`/`6A`/`7A` and
  `ED 42`/`52`/`62`/`72`.
- `ASM-EMIT-ED-NEG-001` must prove that source `NEG` assembles to the canonical
  `0xED 0x44`.
- `ASM-EMIT-ED-RRD-RLD-001` must prove that source `RRD` and `RLD` assemble to
  `0xED 0x67` and `0xED 0x6F`.
- `ASM-EMIT-ED-BLOCK-TRANSFER-001` must prove that source `LDI`, `LDD`, `LDIR`,
  and `LDDR` assemble to `ED A0`, `ED A8`, `ED B0`, and `ED B8`.
- `ASM-EMIT-ED-BLOCK-COMPARE-001` must prove that source `CPI`, `CPD`, `CPIR`,
  and `CPDR` assemble to `ED A1`, `ED A9`, `ED B1`, and `ED B9`.
- `ASM-EMIT-ED-BLOCK-IO-001` must prove that source `INI`, `IND`, `OUTI`,
  `OUTD`, `INIR`, `INDR`, `OTIR`, and `OTDR` assemble to `ED A2`, `ED AA`,
  `ED A3`, `ED AB`, `ED B2`, `ED BA`, `ED B3`, and `ED BB`.
- `ASM-EMIT-INDEX-ADD-001` must prove that source `ADD IX,pp` and `ADD IY,pp`
  for the four register pairs assemble to the `DD`/`FD`-prefixed `0x09`/`0x19`/
  `0x29`/`0x39` opcodes.
- `ASM-EMIT-INDEX-LD-R-001` must prove that source `LD r,(IX+d)` and
  `LD r,(IY+d)` for `r = B,C,D,E,H,L,A` assemble to the `DD`/`FD` prefix, the
  `LD r,(HL)` opcode, and the displacement byte.
- `ASM-EMIT-INDEX-LD-MEM-R-001` must prove that source `LD (IX+d),r` and
  `LD (IY+d),r` for `r = B,C,D,E,H,L,A` assemble to the `DD`/`FD` prefix, the
  `LD (HL),r` opcode, and the displacement byte.
- `ASM-EMIT-INDEX-LD-MEM-N-001` must prove that source `LD (IX+d),n` and
  `LD (IY+d),n` assemble to `DD 36 d n` and `FD 36 d n` (displacement before
  immediate).
- `ASM-EMIT-INDEX-ALU-001` must prove that source `ADD A,(IX+d)`, `ADC A,(IX+d)`,
  `SUB (IX+d)`, `SBC A,(IX+d)`, `AND (IX+d)`, `XOR (IX+d)`, `OR (IX+d)`,
  `CP (IX+d)` (and the `IY` forms) assemble to the `DD`/`FD` prefix, the
  `ALU A,(HL)` opcode, and the displacement byte.
- `ASM-EMIT-INDEX-INC-DEC-001` must prove that source `INC (IX+d)`, `DEC (IX+d)`,
  `INC (IY+d)`, `DEC (IY+d)` assemble to `DD`/`FD` `0x34`/`0x35` and the
  displacement byte.
- `ASM-EMIT-INDEX-HALF-LD-N-001` must prove that source `LD IXH,n`, `LD IXL,n`,
  `LD IYH,n`, `LD IYL,n` assemble to `DD`/`FD` `0x26`/`0x2E` and the immediate.
- `ASM-EMIT-INDEX-HALF-INC-DEC-001` must prove that source `INC`/`DEC` of
  `IXH`/`IXL`/`IYH`/`IYL` assemble to `DD`/`FD` `0x24`/`0x25`/`0x2C`/`0x2D`.
- `ASM-EMIT-INDEX-HALF-LD-R-001` must prove that source `LD r,IXH`/`LD IXH,r`
  and the `IXL`/`IYH`/`IYL` variants assemble to the `DD`/`FD`-prefixed
  `LD r,r'` opcodes with register codes `100`/`101` denoting the index halves.
- `ASM-EMIT-INDEX-HALF-ALU-001` must prove that source `ADD A,IXH` and the
  other seven ALU operations over `IXH`/`IXL`/`IYH`/`IYL` assemble to the
  `DD`/`FD`-prefixed `ALU A,r` opcodes with register codes `100`/`101`.
- `ASM-EMIT-DDCB-ROT-001` / `ASM-EMIT-FDCB-ROT-001` must prove that source
  `RLC (IX+d)` … `SRL (IX+d)` (and the `IY` forms) plus their undocumented
  result-copy variants `RLC (IX+d),B` … `SRL (IX+d),A` assemble to the 4-byte
  `DD`/`FD` `CB` `d` `<opcode>` encoding (64 forms per prefix).
- `ASM-EMIT-DDCB-BIT-001` / `ASM-EMIT-FDCB-BIT-001` must prove that source
  `BIT b,(IX+d)` / `BIT b,(IY+d)` for `b = 0..7` assembles to the canonical
  `z = 6` opcode `DD`/`FD` `CB` `d` `46`/`4E`/`56`/`5E`/`66`/`6E`/`76`/`7E`.
- `ASM-EMIT-DDCB-RES-SET-001` / `ASM-EMIT-FDCB-RES-SET-001` must prove that source
  `RES b,(IX+d)` / `SET b,(IX+d)` (and the `IY` forms) plus their undocumented
  result-copy variants `RES b,(IX+d),r` / `SET b,(IX+d),r` assemble to the 4-byte
  `DD`/`FD` `CB` `d` `<opcode>` encoding (128 forms per prefix).
- `conformance/domain/z80-opcodes-check.mjs` validates the structural integrity
  of the machine-readable rows — byte structure (each byte is exactly one literal
  hex value or one parameter), loader-derived length, timing shape, the
  eight-flag partition, conformance references, and the `LD (HL)` `0x76`
  exclusion. The exact opcode and immediate byte *values* are proven against
  source by the `ASM-EMIT-*` assembler fixtures listed above (source → bytes),
  which exercise the assembler rather than reading this table.
