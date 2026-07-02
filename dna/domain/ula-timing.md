# ULA Timing (48K ZX Spectrum)

The normative reference for the **machine-level timing** the ULA (Uncommitted
Logic Array) imposes on a 48K ZX Spectrum: the video frame length, the maskable
interrupt the ULA raises once per frame, and the memory-contention delays the
ULA adds when the CPU touches the lower 16K of RAM while the ULA is fetching
display data.

This is distinct from [`z80-cpu-execution.md`](z80-cpu-execution.md), which
specifies what one Z80 instruction does in isolation (registers, flags, and the
*uncontended* T-states an instruction takes). ULA timing is a property of the
**host machine**, not the CPU: the same opcode costs more T-states when its
memory access collides with the ULA's display fetch.

It is the domain oracle for the emulator's timing-fidelity rows
(`dna/conformance/timing/`). It is authored from documented ZX Spectrum hardware
behavior (Sinclair/Amstrad 48K ULA; the contention pattern is the canonical
early-timing model used by reference emulators); the legacy emulator is not an
authority here (ADR-0002). Where a documented value has known machine variants
(notably the exact frame T-state at which contention starts), the canonical 48K
value is pinned and the choice is recorded in `.harness/decisions.md` (ADR-0010).

## Scope

This is grown one behavior at a time alongside its conformance fixture, like the
CPU-execution DNA. The first authored behaviors are the frame/interrupt timing
and the 48K memory-contention pattern, modeled as **pure timing functions** of a
frame T-state and a memory address. Integrating contention into the executed
instruction stream and modeling interrupt *acceptance* (the CPU honoring INT) is
a later slice and must not be assumed here.

## Frame and interrupt timing

<!-- provenance: hardware -->
- [id: ULA-TIME-FRAME-001] A 48K ZX Spectrum video frame is `312` scan lines of
  `224` T-states each, so one frame is `312 × 224 = 69888` T-states. The CPU runs
  continuously across the frame boundary; T-state counters are taken modulo the
  frame length.

<!-- provenance: hardware -->
- [id: ULA-TIME-INT-001] The ULA raises one maskable interrupt (`INT`) per frame.
  `INT` is asserted (held LOW) at the very start of the frame and stays asserted
  for `32` T-states — i.e. for frame T-states `0 ≤ t < 32`, and inactive for
  `32 ≤ t < 69888`. Across frames this repeats: `INT` is active iff `t mod 69888
  < 32`. (Whether the CPU *accepts* the interrupt — finishing the current
  instruction, then taking 13/19 T-states for IM 1/IM 2 — is CPU behavior modeled
  separately and is out of scope here.)

## Memory contention

<!-- provenance: hardware -->
- [id: ULA-TIME-CONTENDED-ADDR-001] On a 48K machine, only the lower 16K RAM is
  contended: addresses `0x4000`–`0x7FFF` inclusive. Accesses to ROM
  (`0x0000`–`0x3FFF`) and to the upper 32K (`0x8000`–`0xFFFF`) are never delayed
  by the ULA. (I/O-port contention — a stall on the `IN`/`OUT` I/O cycle by port
  range/parity — is a related but separate behavior and is **out of scope**: the
  opt-in model was investigated at W10.14 and **deferred**, tracked as
  `UNKNOWN:emulator:IO-CONTENTION-001` (ADR-0023; no within-repo per-case oracle and
  the only legacy discriminator uses the rejected 14384 geometry). The shipped default
  adds no I/O stall — see `host-io-port-fe.md` HOST-IO-PORTFE-IO-CONTENTION-001.)

<!-- provenance: hardware -->
- [id: ULA-TIME-CONTENTION-PATTERN-001] While the ULA is fetching display bytes
  it stalls the CPU on a contended access by a number of extra T-states that
  follows the repeating period-8 pattern `6, 5, 4, 3, 2, 1, 0, 0` (indexed by the
  T-state's position within the 8-cycle fetch group). The delay is added to the
  T-state cost of a contended-RAM access that *begins* at that frame T-state.

<!-- provenance: hardware -->
- [id: ULA-TIME-CONTENTION-WINDOW-001] The contended fetch window covers the
  `192` displayed pixel lines. It begins at frame T-state `14335` (the canonical
  48K early-timing value; pinned per ADR-0010) and, for each of the `192` lines
  (`224` T-states apart), the first `128` T-states are contended and follow the
  pattern above; the remaining `96` T-states of the line (border + horizontal
  retrace) and the entire top/bottom border and vertical retrace are uncontended
  (delay `0`). A contended-RAM access outside this window adds no delay.

## Floating bus

When the CPU reads an I/O port that **no device drives**, the data bus is left
floating and the value read reflects whatever the ULA is doing on the bus at that
instant — the "floating bus." This is the same display-fetch activity that drives
memory contention (above), observed from the I/O side. It is modeled here to the
extent the pinned timing permits; the **timing-exact in-window byte depends on the
deferred active-area pixel timing (A5)** and is therefore not pinned (see
ULA-FLOATBUS-DEFER-001). This is a scoped slice (`decision:ADR-0026`, refining the
ADR-0021 assumption that E2 was a no-ADR hardware fact).

<!-- provenance: hardware -->
- [id: ULA-FLOATBUS-PORT-001] The ULA decodes I/O on address line `A0`: it owns
  (drives) every **even** port (`A0 = 0`) — that is where `IN` reads the keyboard /
  EAR half-rows (`host-io-port-fe.md`). An `IN` from a port with `A0 = 1` (**odd**)
  that no other device decodes is undriven and reads the **floating bus**. (At the
  48K base nothing decodes odd ports, so every odd port floats; a later peripheral
  that decodes an odd port — e.g. the Kempston joystick at `0x1F` (`peripherals.md`
  JOY-KEMPSTON-PORT-001) — carves out its own port and stops it floating.) The
  canonical floating-bus port is the odd `0xFF`.
  Note: this corrects the imprecise "unmapped *even*-port" phrasing in the seeded
  roadmap — even ports are ULA-driven; it is the *odd*, undriven ports that float.

<!-- provenance: hardware -->
- [id: ULA-FLOATBUS-IDLE-001] Outside the active display-fetch window — the top and
  bottom border, the horizontal border + retrace of each line, and the vertical
  blanking interval — the ULA is not fetching display data, nothing drives the bus,
  and a floating read returns **`0xFF`** (the bus floats high). The active
  display-fetch window is exactly the contended window of
  ULA-TIME-CONTENTION-WINDOW-001: the `192` display lines, `224` T apart, each
  beginning at frame T-state `14335` (`ULA-TIME-CONTENTION-PATTERN-001`'s anchor)
  for the first `128` T-states. Any frame T-state not in that window is idle → `0xFF`.

<!-- provenance: hardware -->
- [id: ULA-FLOATBUS-FETCH-001] Inside the active display-fetch window the floating
  read reflects the **byte the ULA is currently fetching** — a display-file or
  attribute byte at the address `memory-map.md` decodes for the pixel being drawn
  (MM-SCREEN-ADDR-001 / MM-ATTR-ADDR-001). This is what lets a program sync to the
  raster by reading an odd port (the classic 48K "floating-bus" technique).

<!-- provenance: decision:ADR-0026 -->
- [id: ULA-FLOATBUS-DEFER-001] The **exact** frame-T-state → fetched-byte mapping
  inside the window — which of the four T-states of a character-cell fetch carries
  the display byte, which carries the attribute byte, and which are idle, plus the
  precise sub-window phase offset — is the **deferred active-area pixel timing (A5,
  ADR-0021)**. It is therefore **not pinned here**: a conformant model reports the
  in-window value as **unmodeled** (rather than fabricating a byte). This deferral
  rests on two facts: (1) there is no documented-hardware authority in the repo for
  the phase mapping (the most machine-variant detail in ULA timing), and (2) the
  only in-repo code that computes it (legacy `floatingBusAddressForTstate`) anchors
  the display at frame T `14384` — the legacy display-latch geometry that
  ADR-0010/0011 **rejected** in favour of `14335` — so it is both non-authoritative
  (ADR-0002) and inconsistent with this file's pinned timing. The window anchor used
  above is therefore the DNA's `14335`, never the legacy `14384`. Modelling the
  timing-exact in-window byte is unblocked when A5 is taken up; until then the
  scoped facts (ULA-FLOATBUS-PORT-001 / -IDLE-001 / -FETCH-001) are what ship.

## Acceptance criteria

A regenerated timing model satisfies these facts iff it passes
`dna/conformance/timing/frame-length.json` (ULA-TIME-FRAME-001 / -INT-001) and
`dna/conformance/timing/contention.json` (ULA-TIME-CONTENDED-ADDR-001 /
-CONTENTION-PATTERN-001 / -CONTENTION-WINDOW-001) through
`dna/conformance/timing/run-timing-fixtures.mjs`. The fixtures assert the frame
length, the interrupt-active boundary T-states, the contended address range, and
the contention delay at representative frame T-states demonstrating the
`6,5,4,3,2,1,0,0` pattern and the zero-delay regions.

The floating-bus facts (ULA-FLOATBUS-PORT-001 / -IDLE-001 / -DEFER-001) are
satisfied iff the model passes `dna/conformance/timing/floating-bus.json` through
`dna/conformance/timing/run-floating-bus-fixtures.mjs`: odd ports float and even
ports do not (`portFloats`), every frame T-state outside the display-fetch window
reads `0xFF` with `modeled = true`, and every in-window frame T-state is reported
`modeled = false` (the timing-exact byte deferred to A5, not fabricated).
