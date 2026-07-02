# Host I/O — ULA port `0xFE` (48K ZX Spectrum)

The normative reference for the **host-visible I/O surface** the ULA exposes on
port `0xFE`: what an `OUT (0xFE)` write does (border colour, the MIC/tape-out bit,
the beeper/speaker level) and what an `IN (0xFE)` read returns (the keyboard
half-row and the EAR/tape-in bit). It is the emulator product's *event surface*:
the hardware-truth, observable result of port-`0xFE` traffic, expressed as a
**timed event stream**.

This is distinct from the timing and CPU references:

- [`z80-cpu-execution.md`](z80-cpu-execution.md) / `@zx-vibes/cpu` already decode
  the I/O opcodes (`OUT (n),A`, `IN A,(n)`, `IN r,(C)`, `OUT (C),r`,
  `INI/OUTI/IND/OUTD`) and report each port write/read to the machine through the
  `io` interface of `step({ registers, memory, io, clock })` **at the I/O bus
  cycle**, not at instruction start.
- [`machine-execution.md`](machine-execution.md) / `@zx-vibes/machine` thread the
  frame T-state clock and the memory-contention model, so each reported I/O write
  already carries the contended-machine frame T-state at which it occurred.

This file specifies how those already-timed port-`0xFE` writes become the
**border** and **beeper** event streams a host renderer consumes, and the read
model for the keyboard/EAR. It is the domain oracle for
`dna/conformance/host-io/`. It is authored from documented ZX Spectrum hardware
(the Sinclair/Amstrad 48K ULA, the Z80 I/O bus) and the consumer-verified findings
C1/C2/C5 (`.harness/intake-consumer-2026-06-28.md` §C); the legacy emulator/shell
is **not** an authority here (ADR-0002). The split between this hardware-truth
event surface (emulator) and the gallery's *rendering policy* (raster geometry,
audio resampling) is pinned by ADR-0016.

## Scope

Grown one behavior at a time alongside its conformance fixture, like the CPU and
ULA-timing DNA. S1 (R-W8-01) authors the port-`0xFE` **write** event model — the
border and beeper event streams — plus the **read** model for the keyboard/EAR.
S2 (R-W8-02) authors the **event timestamp semantics** — the chronological
frame-relative ordering across the frame wrap (C7) and the contended-machine
timestamp base (the section "Event timestamp semantics" below).
Port-`0xFE` **I/O-port contention** remains **out of scope** here (consistent with
`ula-timing.md` / ADR-0011 / ADR-0012 / ADR-0016 §4): the event time is the
I/O-cycle frame T-state the machine already reports, which includes *memory*
contention accumulated before the I/O cycle but no I/O-port contention. The
**floating bus** is an `IN` from an *odd*, undriven port — not port `0xFE` (which
the ULA drives, so it never floats) — and is modelled in `ula-timing.md` ("Floating
bus", ULA-FLOATBUS-*), scoped per ADR-0026: the port-decode + idle-`0xFF` facts are
pinned, the timing-exact in-window byte is deferred with A5.

## Port decoding

<!-- provenance: hardware -->
- [id: HOST-IO-PORTFE-ADDR-001] The ULA responds to any I/O port whose address bit
  `A0 = 0` (an even port address); `0xFE` is the canonical address used by the ROM
  and by convention. An `OUT` to that port drives the border, MIC, and speaker; an
  `IN` from it reads the keyboard matrix and the EAR input. The remaining address
  bits select which keyboard half-rows a read returns (HOST-IO-PORTFE-READ-001).
  Higher decodings (`0x7FFD`, AY at `0xFFFD`/`0xBFFD`) are not part of the 48K ULA
  port and are out of scope here.

## Write model — `OUT (0xFE),A`

<!-- provenance: hardware -->
- [id: HOST-IO-PORTFE-WRITE-BITS-001] The byte written to port `0xFE` has this bit
  layout (only bits 0–4 have a hardware effect on a 48K machine):
  - **b0–b2** — border colour, an index `0..7` into the standard palette
    (`0` black, `1` blue, `2` red, `3` magenta, `4` green, `5` cyan, `6` yellow,
    `7` white).
  - **b3** — MIC / tape-out (cassette save signal).
  - **b4** — speaker / beeper output **level** (the EAR-out line that drives the
    internal speaker): `0` or `1`.
  - **b5–b7** — unused on write; they have no effect on the 48K ULA and the model
    ignores them.

<!-- provenance: hardware -->
- [id: HOST-IO-PORTFE-BORDER-001] **Border is a timed event stream, not one colour
  per frame** (C1). Each `OUT (0xFE)` write sets the border to its `b0–b2` colour
  for the span that begins at the write's I/O-cycle frame T-state and lasts until
  the next border-changing write. The event model emits a **border event**
  `{ tFrame, kind: "border", value: colour }` for every write whose `b0–b2`
  colour **differs** from the border colour currently in effect; a write that
  repeats the current colour emits no event (the span is unchanged). The running
  border colour starts **unset** (no power-on default is assumed), so the first
  port-`0xFE` write of a sequence always emits its colour as the opening span. A
  renderer that records only the last colour written in a frame is wrong: a single
  frame routinely carries several distinct border spans (e.g. the red/cyan bands a
  `SAVE` writes during tape output — colours `2` and `5`).

<!-- provenance: hardware -->
- [id: HOST-IO-PORTFE-BEEPER-001] **Beeper is an edge stream keyed on `b4`** (C5).
  The speaker level is bit `b4` of the written byte. The model emits a **beeper
  event** `{ tFrame, kind: "beeper", level }` only when `b4` **changes** from the
  level currently driving the speaker; a write that leaves `b4` unchanged emits no
  edge. The speaker's rest level is `0` at power-on, so a first write with `b4 = 0`
  emits no edge and a first write with `b4 = 1` emits the rising edge `0 → 1`.
  These edges are the raw 1-bit hardware-beeper signal; turning them into PCM
  (resampling, conditioning, capture) is the gallery's policy (S3,
  `beeper-output.md`), not part of this hardware-truth stream.

<!-- provenance: hardware -->
- [id: HOST-IO-PORTFE-EVENT-TIME-001] Each event's `tFrame` is the **frame T-state
  of the I/O write cycle** — the moment the side effect fires on the bus, which is
  the I/O cycle and **not** instruction start (C2: an `OUT (n),A` reports its write
  partway through the 11 T-state instruction). `@zx-vibes/cpu` already reports the
  write at that cycle via `io.write`, and `@zx-vibes/machine` already supplies the
  contended-machine frame clock; this model consumes that timestamp, it does not
  re-derive it. The precise base and the chronological-ordering rule across the
  frame wrap are pinned in S2 (`HOST-IO-PORTFE-EVENT-CHRONO-001`).

<!-- provenance: decision:ADR-0016 -->
- [id: HOST-IO-PORTFE-EVENT-ORDER-001] Within a single extraction the events are
  ordered by `tFrame`. When **one** write changes both the border and the beeper
  level (so two events share the same `tFrame`), the **border event precedes the
  beeper event**. This tie-break is a representation choice (both side effects
  occur at the same I/O cycle in hardware), pinned as `decision:ADR-0016` so the
  event order is deterministic.

## Event timestamp semantics

This section (S2, R-W8-02) pins **when** each event happens — the timestamp every
border/beeper event carries. It builds on the running machine: `@zx-vibes/machine`
threads the frame T-state clock and the memory-contention model, and reports each
port write at its I/O cycle (HOST-IO-PORTFE-EVENT-TIME-001).

<!-- provenance: hardware -->
- [id: HOST-IO-PORTFE-EVENT-CHRONO-001] The event timestamp is a **chronological
  frame-relative offset from the start of the `runFrame` call** — a monotonically
  increasing value equal to the absolute contended-machine clock at the I/O cycle
  minus the machine clock at the start of `runFrame`. It is **NOT** the ULA-frame
  modulo position (`clock mod FRAME_T_STATES`). The two diverge once the machine
  clock has drifted off zero and a `runFrame` straddles the frame wrap: the
  modulo position of a late write is large and of an early-next write is small, so
  **sorting the event stream by the modulo T-state reorders edges across the wrap**
  — the root cause of long-run audio deterioration the consumer observed (C7). The
  **display** raster renderer keeps the modulo ULA-frame T-state (it is a position
  on the raster, S4); the **audio / event** stream must use the chronological
  offset and stay monotonically ordered. A model that timestamps or sorts events by
  the ULA-frame modulo fails the chronological-order fixture.

<!-- provenance: decision:ADR-0016 -->
- [id: HOST-IO-PORTFE-EVENT-BASE-001] The absolute clock from which the offset is
  taken is the **contended-machine time at the I/O cycle** — the machine clock
  **including the memory contention accumulated before the I/O cycle** (what
  `@zx-vibes/machine` produces with `exactContention`), **not** the uncontended CPU
  T-state count. This is the accepted default base (ADR-0016 §4): it matches a
  working shell and the existing exact-contention machine. It is provisional and
  revisable: a different base changes only this slice's fixtures.

<!-- provenance: decision:ADR-0016 -->
- [id: HOST-IO-PORTFE-IO-CONTENTION-001] Port-`0xFE` **I/O-port contention is out of
  scope** (consistent with `ula-timing.md` / ADR-0011 / ADR-0012): no I/O-port
  stall is added to the event time. An `OUT (0xFE),A` executing in contended RAM
  costs `11 T` plus the ULA **memory** contention on its opcode/operand fetches and
  nothing more — e.g. at frame T-state `14335` with the instruction in contended
  RAM, the exact-contention machine charges `10 T` of memory contention (total
  `21 T`), versus `0` and `11 T` in uncontended RAM. A model that adds an I/O-port
  stall to the port write fails the contended-time fixture. This is the accepted
  default (ADR-0016 §4), provisional and revisable.

<!-- provenance: decision:ADR-0016 -->
- [id: HOST-IO-PORTFE-IO-OFFSET-001] The precise **intra-instruction offset** of the
  I/O cycle within each port-I/O opcode (so that, e.g., `OUT (n),A` is timestamped a
  few T-states into its 11 T duration rather than at instruction start — C2) is a
  **tracked refinement, not pinned by this slice**. This slice pins the timestamp
  **base** (the contended-machine clock, I/O-port contention out) and the
  chronological-ordering rule; the per-opcode I/O-cycle offset is a follow-up (it
  needs the CPU to report the I/O cycle's in-instruction T-offset, which the current
  `step()`/`io.write` contract does not expose). Recorded here so the omission is
  explicit, not silent debt (C5).

## Read model — `IN (0xFE),A`

<!-- provenance: hardware -->
- [id: HOST-IO-PORTFE-READ-001] An `IN` from port `0xFE` reads the keyboard matrix.
  The **high byte of the port address** (`A8–A15`) selects the half-row(s): the
  keyboard is wired as eight half-rows of five keys, each half-row enabled by one
  high-address line held **low**. A `0` bit in the high byte selects that half-row;
  reading with several address lines low ANDs the selected rows together. The
  half-row ↔ key matrix and the browser-key mapping are the keyboard input
  contract (S5, R-W8-05); this file pins only the bit semantics of the returned
  byte.

<!-- provenance: hardware -->
- [id: HOST-IO-PORTFE-READ-BITS-001] The byte returned by `IN (0xFE)` has this bit
  layout:
  - **b0–b4** — the five key states of the selected half-row(s), **active-low**:
    a `0` means the key is **pressed**, a `1` means released. With multiple rows
    selected the bits are the logical AND across rows (a key pressed in any
    selected row reads `0`).
  - **b5** — unused; reads as `1`.
  - **b6** — EAR / tape-in input level (cassette load signal). While a tape signal is
    present, `b6` follows the tape's EAR edge stream
    ([`tape-loading.md`](tape-loading.md) `TAPE-EDGE-EARIN-001`); its **idle** level (no
    tape driving the line) is pinned by `HOST-IO-PORTFE-EARIN-IDLE-001`.
  - **b7** — unused; reads as `1`.

<!-- provenance: decision:ADR-0024 -->
- [id: HOST-IO-PORTFE-EARIN-IDLE-001] When **no tape signal** is driving the EAR-in line,
  the **idle level of b6** tracks the **last value written to b4** (the speaker / EAR-out
  bit, `HOST-IO-PORTFE-WRITE-BITS-001`) of port `0xFE`. This is the **issue-3** 48K
  behaviour (the common later board), the accepted default (`decision:ADR-0024`): a
  consumer that writes `b4 = 1` then reads `IN (0xFE)` with no tape sees `b6 = 1`, and
  `b4 = 0` reads back `b6 = 0`. The **issue-2** variant — idle `b6` tracks the last
  **b3** (MIC) write instead — is recorded as the known hardware alternative and is **not**
  modeled. The ROM tape loader never depends on the idle level mid-block (it locks onto the
  carrier and finishes at the block's closing edge), so this rule matters only for an
  *undriven* line; it is exercised by the tape edge-load
  ([`tape-loading.md`](tape-loading.md) `TAPE-EDGE-IDLE-001`).

## Acceptance criteria

A host-I/O event surface satisfies the **write** model iff, through
`dna/conformance/host-io/run-host-io-fixtures.mjs`, it reproduces the ordered
event stream of `dna/conformance/host-io/port-fe-events.json` from each case's
`OUT (0xFE)` write sequence (HOST-IO-PORTFE-WRITE-BITS-001 / -BORDER-001 /
-BEEPER-001 / -EVENT-ORDER-001). The fixtures pin: a frame carrying several
distinct border spans and interleaved beeper edges; that redundant writes (same
colour, same level) coalesce to no event; and the red/cyan tape-band pattern a
`SAVE` produces. The runner's reference model is
`dna/conformance/host-io/port-fe-event-model.mjs` (the conformance model until a
host-I/O package is regenerated); the fixture is the authority. The runner's
self-test independently re-derives the expected events from the rules above **and**
proves the gate's teeth: a renderer that collapses a frame's writes to one final
colour (or drops the beeper edges) **fails** the fixtures — the host-visible
behavior the core CPU/ULA/machine gate does not cover (C1).

The **event timestamp semantics** are decided by two further fixtures through the
same runner:

- `dna/conformance/host-io/port-fe-event-time.json` (HOST-IO-PORTFE-EVENT-CHRONO-001):
  a write sequence whose absolute machine clock crosses the frame wrap must yield
  events in monotonic **chronological** order with chronological-offset timestamps;
  the self-test proves a model that timestamps/sorts by the ULA-frame **modulo**
  reorders the edges and fails.
- `dna/conformance/host-io/port-fe-iotime.json` (HOST-IO-PORTFE-EVENT-BASE-001 /
  -IO-CONTENTION-001): an `OUT (0xFE),A` run through `@zx-vibes/machine` in
  contended vs uncontended RAM — the captured ULA-port write and the
  contended-machine duration (`21 T` contended / `11 T` uncontended at frame T
  `14335`, exact contention) pin that the event-time base includes memory
  contention and that no I/O-port contention is added.

The **read** model (HOST-IO-PORTFE-READ-001 / -READ-BITS-001) is exercised by the
keyboard input contract in S5 (R-W8-05); this slice authors its bit semantics only. The
**EAR/tape-in** read — `b6` following the tape edge stream and its issue-3 idle level
(HOST-IO-PORTFE-EARIN-IDLE-001) — is exercised by the tape edge-load at W10.10
(`dna/conformance/tape/`, [`tape-loading.md`](tape-loading.md) `TAPE-EDGE-*`).
