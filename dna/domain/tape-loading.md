# Tape loading — ROM tape encoding (domain)

How the bytes of a tape block become the **EAR (tape-in) edge stream** a real 48K
ZX Spectrum reads while loading, and (later slices) how the ROM's `LD-BYTES`
routine turns that stream back into bytes. This is the *pulse-level* hardware layer
beneath the byte-level container formats in
[`file-formats.md`](file-formats.md): a `.tap` block body (`[flag][data…][checksum]`)
or a `.tzx` standard-speed (`0x10`) block carries exactly the bytes encoded here.

Self-contained (C2): every pulse length and the encoding algorithm is stated here.

> Authoring status: populated slice by slice (roadmap W10, Track D). **W10.9** authors
> the block → EAR pulse stream ("The EAR pulse stream", below). **W10.10** ("Edge loading")
> authors how the real ROM `LD-BYTES` routine turns that stream back into bytes. **W10.11**
> (this slice, "Instant / trap loading") authors the instant/trap convenience that reproduces
> the same result without running the ROM. The ROM itself is the opaque artifact pinned by
> [`memory-map.md`](memory-map.md) `MM-ROM-ARTIFACT-001` (only `LD-BYTES` `0x0556` is
> referenced).

## The EAR pulse stream

A tape block is transmitted as a sequence of **pulses**. A pulse is one half-period
during which the EAR/tape-in line ([`host-io-port-fe.md`](host-io-port-fe.md)
`HOST-IO-PORTFE-READ-BITS-001`, port `0xFE` **bit 6**) holds a constant level; the
level **toggles at every pulse boundary**. So a block is fully described by an
ordered list of pulse **durations** in Z80 T-states (at the 48K 3.5 MHz clock); the
absolute starting level is a convention (the loader detects *edges*, i.e. transitions,
and *periods*, not absolute polarity). Two pulses of equal length form one full
square-wave period.

A block is sent in three parts, in order: a **pilot tone**, a **sync** pair, then the
**data** (one group of pulses per bit, MSB first), for every byte of the block body
(`[flag][data…][checksum]`).

### Pulse timings (T-states)

<!-- provenance: hardware -->
- [id: TAPE-PULSE-TIMINGS-001] The standard 48K ROM tape encoding uses these fixed
  pulse durations, in Z80 T-states at 3.5 MHz (identical to the TZX v1.20 turbo-block
  defaults pinned in [`file-formats.md`](file-formats.md) `FMT-TZX-TURBO-0x11-001`):
  - **pilot pulse** = **2168** T (one pulse of the leader tone);
  - **sync 1** = **667** T, immediately followed by **sync 2** = **735** T (one pulse
    each, exactly one of each);
  - a **reset (`0`) bit** = **two** pulses of **855** T;
  - a **set (`1`) bit** = **two** pulses of **1710** T.
  A set bit's pulses are exactly twice a reset bit's (1710 = 2 × 855), and the loader
  distinguishes them by measuring the pulse length against a threshold between the two.

### Pilot tone length (chosen by the flag byte)

<!-- provenance: hardware -->
- [id: TAPE-PULSE-PILOT-001] The pilot tone is a run of **2168 T pulses** whose
  **count** depends on the block's **flag byte** (the first body byte): a **header**
  block (flag **< 0x80**, the de-facto `0x00`) uses **8063** pilot pulses (~5 s), and a
  **data** block (flag **≥ 0x80**, the de-facto `0xFF`) uses **3223** pilot pulses
  (~2 s). The threshold is the flag's top bit. The pilot tone lets the loader lock onto
  the carrier; its exact length is not load-bearing for the bytes, but it is pinned so
  a regeneration reproduces the real leader.

### Sync

<!-- provenance: hardware -->
- [id: TAPE-PULSE-SYNC-001] Immediately after the pilot tone come **exactly two** sync
  pulses — one of **667** T then one of **735** T, in that order — marking the end of
  the leader and the start of the data. There is no pilot pulse between the sync pair
  and the first data bit.

### Data bits

<!-- provenance: hardware -->
- [id: TAPE-PULSE-DATA-001] After the sync pair, **every byte of the block body**
  (`[flag][data…][checksum]`, in order) is transmitted **most-significant bit first**
  (bit 7 down to bit 0). Each bit is **two equal pulses**: `855` T each for a `0`,
  `1710` T each for a `1`. So a byte is 16 pulses and a body of `B` bytes is `16·B`
  data pulses. The bytes are taken verbatim; the checksum is just another body byte and
  is encoded the same way (its meaning — the XOR parity — belongs to the byte layer,
  [`file-formats.md`](file-formats.md) `FMT-TAP-CHECKSUM-001`). The block carries no
  trailing marker pulse in this model; the inter-block pause is a player/container
  concern (`.tzx` `0x20`, roadmap W10.10).

### Whole-block stream

<!-- provenance: hardware -->
- [id: TAPE-PULSE-BLOCK-001] The full pulse list for a block body of `B` bytes is, in
  order: `P` pilot pulses of `2168` T (`P` = `8063` if `body[0] < 0x80` else `3223`),
  then `667` T, then `735` T, then for each body byte its 16 data pulses (MSB first,
  `855`/`1710` per bit as above). The total pulse count is therefore
  `P + 2 + 16·B`. Worked points: a header body (flag `0x00`) of `B` bytes has
  `8063 + 2 + 16·B` pulses, the first `8063` of them `2168` T; pulse index `8063` is
  `667` (sync 1), index `8064` is `735` (sync 2), and index `8065` is the first pulse
  of body byte 0's bit 7. A loader that emits the pilot count for the wrong flag, that
  swaps the `0`/`1` bit lengths, that encodes bits LSB-first, or that drops a sync pulse
  produces a stream the ROM cannot load.

### Model contract (the regeneration target)

The encoding is modeled in `@zx-vibes/machine`
(`packages/machine/src/tape-pulses.mjs`, re-exported from the package index) —
beside the `.tap`/`.tzx` codecs, since the same machine loads the tape:

```text
export const PILOT_PULSE_T = 2168
export const PILOT_PULSES_HEADER = 8063     // flag < 0x80
export const PILOT_PULSES_DATA   = 3223     // flag >= 0x80
export const SYNC1_T = 667
export const SYNC2_T = 735
export const BIT0_PULSE_T = 855
export const BIT1_PULSE_T = 1710

export function bytePulses(byte) -> number[]            // 16 pulses, MSB first (855/1710 per bit)
export function blockToPulses(bytes) -> number[]        // bytes = full block body [flag, ...data, checksum]
                                                        // pilot (by bytes[0]) + sync1 + sync2 + per-byte data pulses
```

Acceptance: `dna/conformance/tape/tape-pulses.json` (`TAPE-PULSE-*`,
`TAPE-EAR-PULSES-001`) via `dna/conformance/tape/run-tape-pulses-fixtures.mjs` against
the shipped `@zx-vibes/machine`. Because the encoding has **genuine fidelity content**
(the pilot-by-flag count, the bit lengths and bit order, the exact pulse sequence —
fidelity-tier per the harness method calibration), the self-test runs the full
machinery: the real fixtures are validated against an **independent reference**
re-derived from this spec, and adversarial broken models — a **flag-independent pilot
count**, a **0/1 bit-length swap**, an **LSB-first** bit order, and a **missing sync
pulse** — are each rejected. Two blind regenerations from this spec agreed pulse-for-pulse
(no DNA gap).

## Edge loading — the ROM `LD-BYTES` routine reads the pulse stream

W10.10 closes the loop: the **real, opaque 48K ROM** `LD-BYTES` routine consumes the EAR
pulse stream above and loads a tape block **byte-for-byte into RAM**. The ROM is the
artifact pinned by [`memory-map.md`](memory-map.md) `MM-ROM-ARTIFACT-001` (ADR-0024);
this section references **only** its `LD-BYTES` entry (`0x0556`) and the documented
register contract of that entry — no other ROM routine is described (the ROM stays
opaque).

### Reading the edge stream

<!-- provenance: hardware -->
- [id: TAPE-EDGE-EARIN-001] The loader reads the tape by sampling **port `0xFE` bit 6**
  (the EAR/tape-in line, [`host-io-port-fe.md`](host-io-port-fe.md)
  `HOST-IO-PORTFE-READ-BITS-001`) with repeated `IN (0xFE)` reads. The line **toggles at
  every pulse boundary** (the W10.9 stream), so the loader sees **edges** (level
  transitions) and measures the **time between consecutive edges**; it never relies on the
  absolute starting polarity. The pulse *durations* — not the levels — carry the data.

<!-- provenance: hardware -->
- [id: TAPE-EDGE-CLASSIFY-001] The loader classifies each measured half-period against
  thresholds, exactly inverting the W10.9 encoding: a long run of **~2168 T** pilot pulses
  lets it lock onto the carrier; the **667 T + 735 T** sync pair (a pulse pair markedly
  shorter than a pilot pulse) marks the end of the leader and the start of the data; then
  every body byte is read **most-significant bit first**, each bit being **two equal
  pulses**, a `0` ≈ **855 T** and a `1` ≈ **1710 T**, told apart by a threshold **between**
  855 and 1710. The classification thresholds are the loader's view of the same constants
  pinned in `TAPE-PULSE-TIMINGS-001`.

### The `LD-BYTES` register contract (`0x0556`)

<!-- provenance: hardware -->
- [id: TAPE-EDGE-LDBYTES-001] The ROM tape-load routine `LD-BYTES` (`0x0556`) is driven by
  this register contract. **On entry:** `IX` = the RAM destination address, `DE` = the
  number of **data** bytes to read, `A` = the **expected flag byte** (`0x00` for a header,
  `0xFF` for a data block — `LD-BYTES` moves the entry `AF` into `AF'` with `EX AF,AF'`),
  and the **carry flag** = **set for LOAD**, reset for VERIFY. The routine reads, from the
  edge stream, the **flag byte + `DE` data bytes + the checksum byte** (the full block body
  `[flag][data…][checksum]`, `FMT-TAP-*`); it stores the **`DE` data bytes** to
  `[IX, IX+DE)` (the flag and the checksum are **not** stored), accumulating the running
  **XOR parity** ([`file-formats.md`](file-formats.md) `FMT-TAP-CHECKSUM-001`). **On
  return** the **carry flag is set** iff the flag matched, every byte was read, and the
  final parity is zero (the checksum verified); carry is **reset** on a flag mismatch, a
  checksum mismatch, or a lost/timed-out edge. A consumer calls it by stacking a **sentinel
  return address**, setting these registers, and running the machine until `PC` returns to
  the sentinel **or a T-state budget is exceeded** (a wrong setup or a broken signal must
  never hang — exceeding the budget is a load failure).

<!-- provenance: hardware -->
- [id: TAPE-EDGE-TRAILING-001] Because each bit is **one full period (two edges)**, the
  **final** bit of the checksum byte needs a **closing edge after its last pulse**, which
  the block's own pulse list does not contain (it ends on the second pulse of that bit). On
  a real tape this edge is the **leading transition of the inter-block pause** (a `.tzx`
  `0x20` pause, or the gap before the next block). The model therefore appends **one
  trailing transition** after the block (a ~1 ms pause segment, `3500 T`); without it the
  loader **times out on the final bit and reports failure even though the data bytes already
  reached RAM**. The exact pause length is **not load-bearing** — only that the transition
  occurs.

<!-- provenance: decision:ADR-0024 -->
- [id: TAPE-EDGE-IDLE-001] When the tape is **not** driving the EAR-in line (no signal
  present), the **idle level of bit 6** tracks the **last value written to bit 4** (the
  speaker/EAR-out bit) of port `0xFE` — the **issue-3** 48K behaviour (the common later
  board; [`host-io-port-fe.md`](host-io-port-fe.md) `HOST-IO-PORTFE-EARIN-IDLE-001`,
  `decision:ADR-0024`). The loader **never depends on this** while a block plays — it locks
  onto the carrier and finishes at the closing edge (`TAPE-EDGE-TRAILING-001`) — so the
  **issue-2** variant (idle `b6` tracks the last bit-3 / MIC write) is recorded as the known
  hardware alternative, **not** modeled this round.

<!-- provenance: hardware -->
- [id: TAPE-EDGE-CLOCK-001] The tape clock is a **monotonic T-state cursor** that advances
  with the machine's **executed** T-states and is sampled at each `IN (0xFE)`. A whole-block
  load spans **many ULA frames** (a data block's ~2 s leader alone is ~30 frames at
  69888 T/frame), so the cursor must **not** be the ULA-frame-modulo position
  (`clock mod FRAME_T_STATES`): a frame-modulo cursor jumps **backwards** at every frame
  wrap and so loses or duplicates edges, breaking the load. This mirrors the chronological
  event clock the audio/event surface uses across the frame wrap
  ([`host-io-port-fe.md`](host-io-port-fe.md) `HOST-IO-PORTFE-EVENT-CHRONO-001`).

### Model contract (the regeneration target) — edge loading

Edge loading is modeled in `@zx-vibes/machine`
(`packages/machine/src/tape-edge-load.mjs`, re-exported from the package index) — beside
the pulse encoder and the `.tap`/`.tzx` codecs, since the same machine loads the tape. It
reuses `blockToPulses` (W10.9), the ROM blob mapped at `0x0000` (W10.8), and runs on the
shipped `Machine` exec surface (`stepInstruction()`, the `io` `{ read(port),
write(port, value) }` contract):

```text
export const LD_BYTES_ENTRY = 0x0556

// A "tape deck" implementing the machine io contract; b6 = tape level at the monotonic
// tape cursor `clock()`; past the last pulse, b6 idles at the last b4 written (issue 3).
export function createTapeDeck(pulses, { clock, startLevel = 0, keyboard = 0x1f })
  -> { read(port), write(port, value), levelAt(t), total }

// Set up the LD-BYTES register contract on `machine`, push the sentinel, and run to the
// sentinel or the T-state budget. Returns { ok, reason, bytesLoaded, tStates }.
export function edgeLoadWithDeck(machine, deck, { ix, de, flag, load = true, tStateBudget, sentinel })
  -> { ok, reason, bytesLoaded, tStates }

// Convenience: build the standard monotonic deck over `pulses` (+ the trailing closing
// edge, TAPE-EDGE-TRAILING-001) and drive LD-BYTES. `de` = data byte count = body length
// minus the flag and checksum.
export function edgeLoad(machine, pulses, { ix, de, flag, ... })
  -> { ok, reason, bytesLoaded, tStates }
```

Acceptance: the **CI smoke** `dna/conformance/tape/edge-load.json`
(`kind: "tape-edge-load-query"`, `TAPE-EDGE-LOAD-001`) edge-loads a short data block
through the real ROM via `dna/conformance/tape/run-tape-edge-load-fixtures.mjs` and asserts
the loaded RAM is **byte-identical to the source**, that `LD-BYTES` returns **success**
(carry set), and that it finishes **within a fixed T-state budget**. Because edge loading
has **genuine fidelity content** (the edge-stream reading, the LD-BYTES contract, the
closing edge, the monotonic clock — fidelity-tier per the harness method calibration), the
self-test runs the full machinery: the real fixture passes, and adversarial broken models —
a deck that **never toggles** `b6` (no edges → never locks), a **0/1 bit-length swap**
(mis-read bits), a **dropped sync** (never locks), and a **frame-modulo tape clock** (loses
edges across the wrap) — are each rejected, plus a unit check that the issue-3 idle level
follows the last `b4` written. The **offline acceptance** harness assembles a real program
with the conformed `@zx-vibes/asm`, wraps it to a `.tap` with the conformed writer, and
edge-loads it back to a **byte-identical** RAM image (`TAPE-EDGE-LOAD-ACCEPT-001`, a closed,
fabrication-free integration oracle; documented offline like the zexdoc/zexall rows). Two
blind regenerations from this spec agreed on RAM-identity (no DNA gap).

## Instant / trap loading — the same result without running the ROM

W10.11 adds the **instant** (a.k.a. **trap** / **flash**) loader: the consumer convenience
that loads a tape block **without** simulating the pulse stream or executing the ROM. Where
edge loading (above) plays the EAR edge stream into the real `LD-BYTES` for tens of millions
of T-states, an instant load **traps** the load and writes the block's data bytes straight to
RAM in **zero machine time**. It is the fast path real emulators offer; its **only** reason to
exist is to be **indistinguishable** from the real ROM load, so its correctness is defined
entirely by agreement with edge loading.

<!-- provenance: decision:ADR-0024 -->
- [id: TAPE-INSTANT-CONCEPT-001] An **instant/trap load** is a software shortcut over the same
  byte-level contract as `LD-BYTES` (`TAPE-EDGE-LDBYTES-001`): given a tape block body
  (`[flag][data…][checksum]`, `FMT-TAP-*`) and the same register contract — `IX` = RAM
  destination, `DE` = data byte count, `A` = expected flag, **carry** = LOAD — it produces the
  load result **directly**, with **no** pulse stream, **no** edge timing, and **no** ROM
  execution, in **zero** elapsed machine T-states (`tStates = 0`). Instant/trap load is the
  ratified tape scope item **B5** (ADR-0021 "tape = FULL", ADR-0024). It is **not** a hardware
  behaviour of its own — the real machine has no instant load — so the *mechanism* is a
  `decision`; what it must **produce** is the hardware result below.

<!-- provenance: hardware -->
- [id: TAPE-INSTANT-RESULT-001] An instant load produces the **same observable result** as the
  ROM `LD-BYTES` (`TAPE-EDGE-LDBYTES-001`): it stores the **`DE` data bytes** to `[IX, IX+DE)`
  (the flag and checksum are **not** stored), accumulating the running **XOR parity** over the
  flag byte, those data bytes, and the checksum byte that follows them
  ([`file-formats.md`](file-formats.md) `FMT-TAP-CHECKSUM-001`); the result is **success**
  (carry set) iff the flag matched **and** the final parity is zero, and `bytesLoaded` is the
  number of data bytes stored. For a well-formed block whose `DE` equals the block's data
  length, every data byte reaches RAM byte-identically and the parity is zero, so the load
  succeeds — exactly the edge-load result.

<!-- provenance: hardware -->
- [id: TAPE-INSTANT-FLAG-001] The **flag byte is checked first**, before any data is stored: on
  a **flag mismatch** (`body[0] ≠ A`) the load **fails** (carry reset) with **nothing written**
  to the destination and `bytesLoaded = 0`. This matches the real ROM, which compares the flag
  before its store loop — a mismatched edge-load leaves the destination RAM untouched and
  returns carry reset (verified against the ROM, not assumed).

<!-- provenance: hardware -->
- [id: TAPE-INSTANT-EQUIV-001] **The equivalence is the oracle:** for the **same** tape block
  and the **same** `IX`/`DE`/`A`/carry contract, an instant load and an edge load
  (`TAPE-EDGE-LOAD-001`, the real ROM) produce the **identical observable result** — the same
  carry (`ok`), the same `bytesLoaded`, and the **byte-identical** RAM image. This is a
  **mutual cross-check against the real ROM**, fabrication-free: the expected value is whatever
  the real ROM produces, never a hand-authored constant. Only this observable triplet is the
  contract; the loaders' **internal failure diagnosis is not** — on a mismatched or corrupt
  block the real ROM may run out the T-state budget or report a generic load error where the
  instant loader can name the cause directly, but both agree that the load **failed** and that
  the bytes that did (or did not) reach RAM are the same.

### Model contract (the regeneration target) — instant loading

Instant loading is modeled in `@zx-vibes/machine`
(`packages/machine/src/tape-edge-load.mjs`, beside `edgeLoad`, re-exported from the package
index — it is the instant counterpart of the same routine):

```text
// Reproduce the observable LD-BYTES result for `body` ([flag, ...data, checksum]) WITHOUT
// running the ROM. ix/de/flag are the LD-BYTES register contract. Returns the same
// { ok, reason, bytesLoaded, tStates } shape as edgeLoad, with tStates = 0.
export function instantLoad(machine, body, { ix, de, flag, load = true })
  -> { ok, reason, bytesLoaded, tStates }
```

Acceptance: `dna/conformance/tape/instant-load.json`
(`kind: "tape-instant-load-query"`, `TAPE-INSTANT-LOAD-001`) runs **both** `instantLoad` and
`edgeLoad` on the same block via `dna/conformance/tape/run-tape-instant-load-fixtures.mjs` and
asserts they agree on the observable result **and** that both equal the source bytes
(fabrication-free, `expected.ram` **is** the source). Because the slice's content is exactly
the equivalence to the already-fidelity-verified real ROM, the self-test runs the differential
at scale — `instant == edge` over a battery of flags (header **and** data, across the
`0x80` boundary), sizes, and the flag-mismatch rejection — and rejects adversarial broken
instant models (one that **ignores a flag mismatch**, one that **skips the checksum**, one that
**stores the flag/checksum**, one that **loads the wrong byte count**): each diverges from the
real ROM and is caught. Two blind regenerations from this spec agreed with the shipped model
and the real ROM on every battery case (no DNA gap).

## Provenance

The pulse timings and the encoding algorithm are `hardware`: they are the documented
48K ROM tape encoding (`SA-BYTES`/`LD-BYTES`), and the exact T-state values are the
same constants pinned (with a version + URL) as the TZX v1.20 turbo-block defaults in
[`file-formats.md`](file-formats.md). The **edge-loading** claims (`TAPE-EDGE-*`) are
likewise `hardware` — the documented `LD-BYTES` register contract and the edge-reading
behaviour of the 48K ROM — except the **issue-3 idle level** (`TAPE-EDGE-IDLE-001`), which
is the accepted default `decision:ADR-0024` (issue 2 recorded as the alternative). The
**instant/trap-load** claims (`TAPE-INSTANT-*`) split the same way: the *mechanism* (a software
shortcut that loads in zero machine time, `TAPE-INSTANT-CONCEPT-001`) is the ratified
`decision:ADR-0024` convenience (B5), while what it must **produce**
(`TAPE-INSTANT-RESULT-001` / `-FLAG-001` / `-EQUIV-001`) is the **hardware** `LD-BYTES` result —
pinned by the equivalence to the real ROM, never an invented constant. This is
the hardware layer that grounds the byte *container* claims authored at W10.6/W10.7: a
`.tap` block body, or a `.tzx` `0x10` standard block, carries exactly these bytes, and they
reach RAM through this pulse stream and the ROM `LD-BYTES` routine (or, instantly, its trap).
No invented values, no `UNKNOWN`.
