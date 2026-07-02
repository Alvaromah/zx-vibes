# Machine Execution (48K ZX Spectrum)

The normative reference for the **machine layer** that joins the Z80 CPU
([`z80-cpu-execution.md`](z80-cpu-execution.md), implemented by `@zx-vibes/cpu`)
to the ULA timing model ([`ula-timing.md`](ula-timing.md), implemented by
`@zx-vibes/ula`) into a running 48K machine. It specifies the two behaviors that
live **between and around** single-instruction execution and therefore cannot be
expressed by the isolated single-step CPU contract:

1. **Interrupt acceptance** — how the CPU honors the maskable `INT` the ULA
   raises once per frame: when it is sampled, the interrupt-response sequence, and
   the IM 0/1/2 dispatch.
2. **Memory contention threaded onto the executed stream** — how the ULA's
   per-access contention delay (`contentionDelay`) is added to each *contended*
   memory access the running program makes, instead of being a pure function
   queried in isolation.

It is the domain oracle for the emulator's machine-level rows
(`dna/conformance/machine/`). The CPU interrupt-response sequence is authored from
the documented Z80 standard (Zilog UM0080); the 48K-specific values (the frame
interrupt window, the data-bus value during interrupt acknowledge, the canonical
contention geometry) are documented hardware behavior. Where a documented value
has machine variants, the canonical 48K value is pinned and recorded in
`.harness/decisions.md` (ADR-0011). The legacy emulator is **not** an authority
here (ADR-0002); it was consulted only as a curation cross-check.

## Scope

This is grown one behavior at a time alongside its conformance fixture, like the
CPU-execution and ULA-timing DNA. The machine owns the CPU register file, the
64 KB memory image, the I/O port interface, and a running **frame T-state clock**
(taken modulo `FRAME_T_STATES`, per ULA-TIME-FRAME-001). Per-access I/O-port
contention and floating-bus reads remain out of scope here (only memory
contention is modeled, consistent with `ula-timing.md`).

## Reset / power-on state

The state the 48K machine holds the instant before it begins executing — what
`reset()` (and a fresh power-on) establishes. The Z80 `RESET` line defines only a
small subset of the register file; the rest, and the RAM pattern, are pinned to a
deterministic default (there is no hardware oracle for an uninitialised machine —
a real 48K powers up pseudo-random).

<!-- provenance: z80-spec -->
- [id: MACHINE-RESET-CONTROL-001] The Z80 `RESET` clears the control state: program
  counter `PC = 0x0000`, the interrupt-vector register `I = 0x00` and the memory-
  refresh register `R = 0x00`, interrupt mode `IM = 0`, and both interrupt flip-flops
  disabled `IFF1 = 0`, `IFF2 = 0`. So after reset the CPU begins executing at
  `0x0000` (the ROM) with maskable interrupts off, in IM 0. (These are the only
  registers the Z80 `RESET` is documented to define.)

<!-- provenance: decision:ADR-0021 -->
- [id: MACHINE-RESET-REGISTERS-001] The Z80 `RESET` leaves the stack pointer, the
  accumulator/flags, and the general-purpose, alternate, and index registers
  **undefined**. The 48K machine models them at power-on as all-bits-set —
  `SP = 0xFFFF`, `AF = 0xFFFF`, `BC = DE = HL = 0xFFFF`, the alternates
  `AF' = BC' = DE' = HL' = 0xFFFF`, and `IX = IY = 0xFFFF` — the convention reference
  48K emulators use (`decision:ADR-0021`; `AF`/`SP = 0xFFFF` are named there and the
  same all-bits-set default is applied to the rest of the uninitialised register
  file). This is a deterministic default, **not** a hardware-truth claim. The
  internal `MEMPTR`/`WZ` register is not part of the reset contract (it is overwritten
  by the first memory-addressing instruction).

<!-- provenance: decision:ADR-0021 -->
- [id: MACHINE-RESET-RAM-001] The 48K RAM (`0x0000`–`0xFFFF`, all of it for this
  model's purposes) is pinned to **all `0x00`** at power-on/reset. A real 48K powers
  up with a pseudo-random RAM pattern, so there is no oracle; all-zero is the
  deterministic, reproducible default (`decision:ADR-0021`), explicitly not a hardware
  claim. (On a real machine the ROM and the loaded program overwrite RAM before it is
  read; the deterministic base keeps regeneration byte-reproducible.)

The model contract (the regeneration target, `@zx-vibes/machine`): `machine.reset()`
sets `machine.registers` to the state above, zeroes `machine.memory`, sets the frame
clock `machine.clock = 0`, and clears `machine.halted`. `RESET_REGISTERS` exports the
register table. Acceptance: `dna/conformance/machine/machine-reset.json`
(`MACHINE-RESET-001`, kind `machine-reset`) via `run-machine-fixtures.mjs` — it dirties
a machine (arbitrary registers + memory), calls `reset()`, and asserts the documented
registers, RAM-all-zero, clock `0`, and not-halted.

## Interrupt acceptance

The ULA asserts the maskable `INT` line for the first `32` T-states of every
frame (ULA-TIME-INT-001). Whether and how the CPU acts on it is specified here.

<!-- provenance: z80-spec -->
- [id: MACHINE-INT-SAMPLE-001] The CPU samples `INT` only at an **instruction
  boundary** (never mid-instruction). The maskable interrupt is accepted at a
  boundary iff (a) interrupt flip-flop `IFF1 = 1`, and (b) `INT` is asserted at
  that boundary (the machine clock lies in the interrupt window, i.e.
  `interruptActive(clock)` per ULA-TIME-INT-001). If a boundary while `INT` is
  asserted does not satisfy `IFF1 = 1` (interrupts masked), the interrupt is
  **lost** for that frame: `INT` is level-asserted for only `32` T-states, so a
  masked window, or an instruction long enough that the next boundary falls
  beyond the window, simply misses it. At most one maskable interrupt is accepted
  per frame.

<!-- provenance: z80-spec -->
- [id: MACHINE-INT-EI-DELAY-001] Acceptance is **delayed by one instruction after
  `EI`**. `EI` sets `IFF1 = IFF2 = 1`, but the CPU does not sample `INT` at the
  boundary immediately following the `EI`; it executes the next instruction first
  and may accept only at the boundary after that. This makes the canonical
  `EI; RET` / `EI; RETI` and `EI; HALT` idioms return (or halt) before an
  interrupt can re-enter. `DI` takes effect immediately (it clears `IFF1` so the
  very next boundary cannot accept).

<!-- provenance: z80-spec -->
- [id: MACHINE-INT-ACCEPT-001] On acceptance the CPU performs, in order: (1) if it
  was in the `HALT` state, leave it (the return address is the instruction *after*
  the `HALT`, i.e. `PC + 1` relative to the frozen `HALT` opcode); (2) clear both
  interrupt flip-flops `IFF1 = IFF2 = 0` (so the handler runs with interrupts
  disabled until it re-enables them); (3) increment the memory-refresh register
  `R` by one (the interrupt-acknowledge cycle is an M1-like cycle, low 7 bits
  only, bit 7 fixed); (4) push the (post-HALT-adjustment) `PC` to the stack
  high-byte first (`SP ← SP − 2`, `mem[SP] = PC_low`, `mem[SP+1] = PC_high`); (5)
  load the new `PC` per the interrupt mode below.

<!-- provenance: z80-spec -->
- [id: MACHINE-INT-IM-001] The interrupt mode register `IM` selects the dispatch:
  - **IM 1** loads `PC ← 0x0038` (a fixed restart). Total cost `13` T-states.
  - **IM 2** forms a 16-bit vector address `V = (I << 8) | databus`, reads the
    16-bit little-endian handler address from memory at `V`, and loads `PC` with
    it. Total cost `19` T-states.
  - **IM 0** executes the instruction the interrupting device places on the data
    bus. On the 48K Spectrum that bus value is `0xFF` (see MACHINE-INT-DATABUS-001),
    i.e. `RST 38h`, so IM 0 behaves identically to IM 1: `PC ← 0x0038`, `13`
    T-states.

<!-- provenance: decision:ADR-0011 -->
- [id: MACHINE-INT-DATABUS-001] On the 48K ZX Spectrum nothing drives the data bus
  during an interrupt-acknowledge cycle, so it floats to `0xFF`. The machine pins
  the interrupt-acknowledge data-bus value to `0xFF`: this makes IM 0 = `RST 38h`
  and makes the IM 2 vector low byte `0xFF` (so a robust IM 2 table is the
  documented 257-byte page filled with one value). This is the canonical 48K value
  (ADR-0011); a machine that drives the bus differently is a separate decision.

## Non-maskable interrupt (NMI) acceptance

The Z80 also has a **non-maskable** interrupt line, `NMI`, with its own fixed
restart vector at `0x0066`. The 48K Spectrum does not wire `NMI` to the ULA's
50 Hz frame interrupt (that is the maskable `INT` above), but the CPU honors an
`NMI` edge whenever one is asserted, so the machine layer models its acceptance
for completeness (ADR-0019, Option B). Like the maskable interrupt this lives at
an instruction boundary and so is not expressible by the single-step CPU
contract.

<!-- provenance: z80-spec -->
- [id: MACHINE-NMI-SAMPLE-001] `NMI` is **edge-triggered** and **non-maskable**.
  The CPU samples it only at an **instruction boundary** (never mid-instruction),
  and — unlike the maskable `INT` — it is accepted **regardless of `IFF1`**: a
  falling edge on `NMI` is latched and serviced at the next boundary even with
  interrupts disabled (`IFF1 = 0`). It has **priority over** a simultaneously
  pending maskable `INT`.

<!-- provenance: hardware -->
- [id: MACHINE-NMI-ACCEPT-001] On acceptance the CPU performs, in order: (1) if it
  was in the `HALT` state, leave it (the return address is the instruction *after*
  the `HALT`, i.e. `PC + 1` relative to the frozen `HALT` opcode, exactly as for
  the maskable interrupt); (2) set `IFF1 = 0` to disable maskable interrupts for
  the duration of the NMI handler, but **preserve `IFF2`** — `IFF2` retains the
  pre-NMI value of `IFF1`, so a later `RETN` can restore the maskable-interrupt
  enable state the NMI suspended (MACHINE-NMI-RETN-001); (3) increment the
  memory-refresh register `R` by one (low 7 bits only, bit 7 fixed), the
  acknowledge being an M1-like cycle; (4) push the (post-HALT-adjustment) `PC` to
  the stack high-byte first (`SP ← SP − 2`, `mem[SP] = PC_low`,
  `mem[SP+1] = PC_high`); (5) load `PC ← 0x0066` (the fixed NMI restart vector).
  The whole sequence costs **11 T-states** (a 5 T-state acknowledge M1 cycle plus
  the two 3 T-state stack-write cycles, `5 + 3 + 3`). The interrupt mode `IM` is
  irrelevant — NMI always vectors to `0x0066`. Because `NMI` is non-maskable the
  acceptance always occurs; there is no masked no-accept case.

<!-- provenance: z80-spec -->
- [id: MACHINE-NMI-RETN-001] The NMI handler returns with `RETN` (`RETI` behaves
  identically on silicon, ADR-0018): it pops the return address and copies
  `IFF2 → IFF1`, restoring the maskable-interrupt enable state that held before
  the NMI. Because acceptance preserved `IFF2` (MACHINE-NMI-ACCEPT-001 step 2),
  `RETN` re-enables maskable interrupts iff they were enabled when the NMI was
  taken. The `RETN`/`RETI` execution itself is in the single-step CPU contract
  (`Z80-OPC-RETN-RETI-001`, `CPU-RETI-IFF-001`); the machine layer supplies only
  the acceptance half.

## Memory contention on the executed stream

`ula-timing.md` defines `contentionDelay(t)` and `isContendedAddress(addr)` as
pure functions (ULA-TIME-CONTENDED-ADDR-001 / -PATTERN / -WINDOW). This section
specifies how those are applied to a *running* program.

<!-- provenance: hardware -->
- [id: MACHINE-CONTENTION-ACCESS-001] Every memory bus access the executing
  instruction makes — the opcode fetch(es), operand-byte fetches, data reads, and
  data writes, in execution order — is a contention point. For an access to a
  contended address (`isContendedAddress(addr)`, i.e. `0x4000`–`0x7FFF` on a 48K
  machine) the ULA adds `contentionDelay(t)` extra T-states, where `t` is the
  frame T-state at the moment of that access; accesses to uncontended memory add
  nothing. The extra T-states are added to the instruction's uncontended cost to
  give its real duration, and the machine clock advances by that real duration.
  This is why the same opcode is slower when its operands live in contended RAM
  and slower again when the program counter itself runs in contended RAM.

<!-- provenance: decision:ADR-0011 -->
- [id: MACHINE-CONTENTION-CLOCK-001] The frame T-state `t` at which each access
  samples `contentionDelay` is the **instruction-start clock plus the contention
  already accumulated within the current instruction**: `t = (t0 + extra) mod
  FRAME_T_STATES`, where `t0` is the machine clock at the start of the
  instruction and `extra` is the sum of contention added by this instruction's
  earlier accesses. Equivalently, the machine threads one running clock through
  the instruction's bus accesses in order, advancing it past each contention
  stall as it is applied. This is the canonical per-access contention model used
  by reference 48K emulators (ADR-0011); it pins per-access contention to the
  already-conformed `@zx-vibes/ula` functions without requiring the CPU core to
  expose a per-M-cycle base-T schedule. The fully M-cycle-exact refinement (which
  also charges contention on internal no-MREQ cycles and offsets each access by its
  exact in-instruction base T-state) is specified below
  (MACHINE-CONTENTION-MCYCLE-001) and is the default once `exactContention` is set;
  this per-access model remains the default and the fallback.

<!-- provenance: hardware -->
- [id: MACHINE-CONTENTION-CPU-CONTRACT-001] The CPU core exposes its bus accesses
  to the machine through the optional `clock` interface of
  `step({ registers, memory, io, clock })`: when a `clock` is supplied, `step`
  invokes `clock.access(address)` for each memory access (via the shared read/write
  path) in execution order, and the machine's `clock` object accumulates the
  contention per MACHINE-CONTENTION-CLOCK-001. The uncontended T-states `step`
  returns are unchanged by the presence of a `clock`; the machine adds the
  accumulated contention separately. This keeps the single-step CPU oracle
  (FUSE / zex) independent of the machine layer.

## M-cycle-exact memory contention

The per-access model above (MACHINE-CONTENTION-CLOCK-001) approximates the
instruction as a flat run of memory accesses sampled from its start. The real ULA
contends every bus *cycle* at its exact T-offset, including the internal (no-MREQ)
cycles a Z80 instruction spends with an address held on the bus but no memory
request — e.g. `ADD HL,rr`'s seven IR cycles, the read-modify-write cycle of
`INC (HL)`/`INC (IX+d)`, the relative-jump cycles of `JR`. This section specifies
the exact model; it is selected by `createMachine({ exactContention: true })` and
decided by `dna/conformance/machine/contention-mcycle.json`.

<!-- provenance: hardware -->
- [id: MACHINE-CONTENTION-MCYCLE-001] An instruction's contention is the sum, over
  its bus cycles in execution order, of `contentionDelay(t)` for each cycle whose
  bus address is contended, where `t = (t0 + base + extra) mod FRAME_T_STATES`:
  `t0` is the machine clock at the instruction start, `base` is the uncontended
  T-states elapsed since the instruction start up to this cycle, and `extra` is the
  contention accumulated by this instruction's earlier cycles. A memory M-cycle is
  an opcode fetch (`4` T) or an operand/data read or write (`3` T); an internal
  no-MREQ cycle is `1` T. The contention point is the *start* of each cycle. This is
  the canonical exact 48K model (the behaviour of FUSE's
  `contend_read`/`contend_read_no_mreq`): an opcode in uncontended code that reads
  contended RAM is sampled at offset `4`, not `0`, and an `ADD HL,rr` whose `I`
  register points into contended RAM pays contention for all seven IR cycles — both
  of which the per-access model misses.

<!-- provenance: fuse -->
- [id: MACHINE-CONTENTION-SCHEDULE-001] The CPU core exposes its exact bus-cycle
  schedule through three optional `clock` hooks of `step(...)`, invoked in execution
  order: `clock.mcycle(address, tStates)` for each memory M-cycle and its length;
  `clock.internal(address, n)` for `n` internal no-MREQ cycles holding `address` on
  the bus; and `clock.inexact()` to signal that the instruction's emitted schedule
  is not yet M-cycle-complete. The emitted schedule is validated against the pinned
  FUSE per-instruction memory timeline by
  `dna/conformance/cpu/validate-mcycle-schedule.mjs`: every single-step FUSE case is
  either schedule-identical to FUSE (same contention-point offsets and bus addresses)
  or flagged `inexact()`. The legacy per-access hook `clock.access(address)` is still
  emitted, so a clock that implements only `access` is the per-access model unchanged
  (MACHINE-CONTENTION-CLOCK-001) and the `1366` FUSE/zex single-step cases, which pass
  no clock, are byte-for-byte identical.

<!-- provenance: decision:ADR-0012 -->
- [id: MACHINE-CONTENTION-MCYCLE-SCOPE-001] The exact model is complete for every
  instruction with no internal cycles (its memory M-cycles carry the whole schedule)
  and for these internal-cycle classes: `ADD/ADC/SBC HL,ss`, `ADD IX/IY,rr`,
  `INC/DEC ss`, `LD SP,HL/IX/IY`, `INC/DEC (HL)`, `INC/DEC (IX+d)`, the
  `RLC..SRL`/`RES`/`SET`/`BIT` `(HL)` and `(IX+d)` forms, `RRD`/`RLD`, `LD I,A`/`LD R,A`,
  `LD A,I`/`LD A,R`, `LDI/LDD/CPI/CPD` (and the repeating `LDIR/LDDR/CPIR/CPDR`),
  `RET cc`, `CALL`/`CALL cc`, `PUSH`, `RST`, and `JR`/`JR cc`. The remaining
  internal-cycle forms — `EX (SP),HL/IX/IY`, the `(IX+d)` operand index-calc cycles
  of the general load/ALU group, `LD (IX+d),n`, `DJNZ`, and block I/O
  `INI/OUTI/IND/OUTD` (and repeats) — are flagged `inexact()` and fall back to the
  conformed per-access value, so no instruction is silently mis-timed (C5).
  I/O-port contention and floating-bus reads remain out of scope (ADR-0012).

## The frame loop

<!-- provenance: hardware -->
- [id: MACHINE-FRAME-LOOP-001] Running a frame advances the machine clock from the
  frame start to `FRAME_T_STATES` (ULA-TIME-FRAME-001) by executing whole
  instructions with contention threaded (MACHINE-CONTENTION-ACCESS-001), sampling
  `INT` at each instruction boundary (MACHINE-INT-SAMPLE-001), and accepting at
  most one maskable interrupt per frame (MACHINE-INT-ACCEPT-001). When the clock
  reaches the frame length it wraps modulo `FRAME_T_STATES` (carrying any overrun
  from the final instruction into the next frame), so a continuously running
  machine accepts one interrupt near the top of each frame whenever interrupts are
  enabled — the substrate of the HALT-synced 50 Hz game loop. A `HALT` reached
  with interrupts disabled advances the clock 4 T-states per step and never leaves
  the `HALT` within the frame (the documented `di-halt` hang).

## Acceptance criteria

A regenerated machine layer satisfies these facts iff it passes, through
`dna/conformance/machine/run-machine-fixtures.mjs`:

- `dna/conformance/machine/interrupt-accept.json` (MACHINE-INT-SAMPLE-001 /
  -EI-DELAY-001 / -ACCEPT-001 / -IM-001 / -DATABUS-001) — the interrupt-response
  sequence and IM 0/1/2 dispatch, including the masked (`IFF1 = 0`) no-accept case
  and the HALT-exit return address.
- `dna/conformance/machine/nmi-accept.json` (MACHINE-NMI-SAMPLE-001 /
  -ACCEPT-001 / -RETN-001) — non-maskable interrupt acceptance: accepts with
  `IFF1 = 1` and with `IFF1 = 0` (non-maskable), clears `IFF1` while preserving
  `IFF2` (including when `IFF2 ≠ IFF1`), bumps `R`, leaves `HALT` with the
  post-HALT return address, pushes `PC` high-byte first, vectors to `0x0066`, and
  costs 11 T-states.
- `dna/conformance/machine/contention.json` (MACHINE-CONTENTION-ACCESS-001 /
  -CLOCK-001 / -CPU-CONTRACT-001) — per-access contention added to the executed
  stream at representative frame T-states and contended/uncontended addresses,
  with the expected delays derived from the `@zx-vibes/ula` functions.
- `dna/conformance/machine/contention-mcycle.json` (MACHINE-CONTENTION-MCYCLE-001 /
  -SCHEDULE-001 / -MCYCLE-SCOPE-001) — M-cycle-exact contention (`exactContention`):
  exact in-instruction access offsets, internal no-MREQ cycles charged (the IR
  cycles of `ADD HL,rr`, the read-modify-write cycle of `INC (HL)`/`INC (IX+d)`,
  the `LDI` destination cycles), and the per-access fallback for an `inexact`
  instruction. Expected delays come from `@zx-vibes/ula` replayed over the
  FUSE-validated schedule.
- `dna/conformance/machine/frame-loop.json` (MACHINE-FRAME-LOOP-001) — one frame
  of a HALT-synced loop accepts exactly one interrupt, pushes the correct return
  address, and ends in the documented state.
