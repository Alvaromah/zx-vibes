# AGENTS.md — Regenerate a playable ZX Spectrum 48K emulator from the DNA

You are building a **playable ZX Spectrum 48K emulator that runs in a browser**,
generated from the genome in `dna/`. This file is your contract. Read it fully
before writing any code, and re-read the relevant section at the start of every
session.

This is a **clean-room reconstruction experiment**. There is no prior code in this
repo and you must not look for any. The only inputs are `dna/` and this file.
Derive every structure, name, and API from the DNA's invariants — not from any
emulator you have seen. Inventing a behavior the DNA does not pin is a defect here.

## The goal (what "a complete emulator" means here)

A user must be able to, in a browser:

1. **Boot the ROM and use BASIC** — the machine starts at the 48K copyright screen,
   accepts typed keywords, and runs BASIC (`PRINT`, `BORDER`, `BEEP`, …).
2. **Hear sound** — the beeper produces audible, stable output (no drift, no clicks).
3. **Load and play games** — `.z80` snapshots **and** `.tap` / `.tzx` tapes load and
   run with correct graphics, colour, sound, and keyboard control.

Each goal maps onto the layers below. Goal 1 needs the core + ROM + keyboard +
raster; goal 2 needs the beeper-PCM path; goal 3 needs the `.z80` codec (DNA-proven)
and a tape loader (`.tap`/`.tzx`, shell work — see §"File loading").

---

## Three layers, three rules of truth (READ THIS FIRST)

Do not blur them. Knowing which layer you are in tells you what "correct" means and
whether you may invent anything.

### Layer 1 — the conformant core (judged by the DNA, area `emulator`)

`packages/cpu`, `packages/ula`, `packages/machine`: a cycle-correct Z80 CPU, ULA
timing, the integrated 48K machine, and the `.z80` snapshot codec.

- **The DNA is the source of truth, not any code.** This implementation is correct
  **iff** it passes the `emulator`-area conformance. The spec judges the code.
- **"Correct" is machine-checked:** `npm run conformance:emulator` is green and
  `npm run coverage:emulator` reports every `emulator` row covered.

### Layer 2 — the conformant host I/O (judged by the DNA, areas `emulator` + `gallery`)

The host-visible I/O the previous generation of this product could only *demonstrate*
is now **pinned and judged** by the DNA. These are the behaviors that make the screen,
sound, and keyboard *faithful*, and they have fixtures + reference models:

| Concern | DNA spec | Conformance |
| --- | --- | --- |
| Port `0xFE` border/beeper **event stream** + timestamps | `dna/domain/host-io-port-fe.md` | `dna/conformance/host-io/` |
| Keyboard **matrix** read, browser-key map, quick-tap **latch** | `dna/product/keyboard-input.md` | `dna/conformance/keyboard/` |
| Beeper **edge → PCM** (fractional resample, continuity, jitter) | `dna/product/beeper-output.md` | `dna/conformance/audio/` |
| **Raster** geometry + `SAVE` red/cyan border bands | `dna/product/raster-border.md` | `dna/conformance/raster/` |

- The DNA ships a **reference model** for each (e.g.
  `dna/conformance/audio/beeper-pcm-model.mjs`). That model **is the contract**: the
  runner imports it by default and it is already green. Your job is to build the same
  behavior into the shell and **prove your implementation** by pointing the runner at
  it: `--module <your file>` (see §"Proving the host I/O"). A shell whose audio /
  keyboard / raster logic passes its runner under `--module` is **proven**, not merely
  demonstrated.

### Layer 3 — the unjudged shell glue (NOT in the DNA — demonstrated only)

`web/`: the canvas/`requestAnimationFrame` wiring, the live `AudioContext` scheduling,
the `keydown`/`keyup` plumbing, the file picker, the `.tap`/`.tzx` tape loader, and the
page itself. Plus the **ROM binary** and any game files (host assets, not genome).

- **The DNA does not specify or judge this layer.** "Correct" here is **manual
  acceptance by observation** (the checklist below). **Never report Layer 3 as
  "proven" or "conformant."** Claiming a green DNA gate covers the live page is false —
  the gate never runs the page. Say "demonstrated", and say on which game/ROM.

> One sentence to keep straight: **Layers 1–2 are proven by the DNA; Layer 3 is
> demonstrated by observation.** Build them in that order — a shell on an unproven core
> or unproven host I/O is worthless.

---

## Target layout

```
{{PROJECT_NAME}}/
  dna/                         # the genome + the conformance judge (NEVER edit)
  packages/                    # Layer 1 — YOU create these
    cpu/src/z80-step.mjs
    ula/src/index.mjs
    machine/src/index.mjs
  web/                         # Layers 2–3 — YOU create these
    index.html
    main.mjs                   # wires shell -> core
    display.mjs audio.mjs keyboard.mjs hostio.mjs loaders.mjs   # (suggested split)
  rom/48.rom                   # host asset you must supply — see rom/README.md
  tapes/                       # host assets (test .z80/.tap/.tzx) — see tapes/README.md
  package.json                 # gate scripts (already present)
  AGENTS.md  README.md
  NOTES.md                     # YOU create — running log, gaps, decisions
```

**Never edit anything under `dna/`.** It is the judge. If you believe a fixture is
wrong, that is a `NOTES.md` entry and a STOP, not an edit.

---

## Layer 1 — the conformant core

### The import surface the runners expect (this is the precise contract)

Each runner **dynamically imports a fixed module path** and exits non-zero
(module-not-found / exit 2) if your module is missing or mis-shaped — so the gate
genuinely fails when the code is absent. **The runner source is the exact contract**:
open the runner you are implementing against and satisfy the calls it makes. Any path
is overridable with `--module <path>`.

| Runner | Imports (default) | Your module must export |
| --- | --- | --- |
| `cpu/run-cpu-exec-fixtures.mjs`, `cpu/run-fuse-suite.mjs` | `packages/cpu/src/z80-step.mjs` | `step({ registers, memory, io?, clock? })` → next CPU state |
| `timing/run-timing-fixtures.mjs` | `packages/ula/src/index.mjs` | the ULA timing API the runner invokes |
| `machine/run-machine-fixtures.mjs` | `packages/machine/src/index.mjs` | `createMachine(...)` → `{ stepInstruction(), runFrame(...) }`; `acceptInterrupt(...)` |
| `formats/run-format-fixtures.mjs` | `packages/machine/src/index.mjs` | `readZ80`, `writeZ80` (the `.z80` codec) |

Read each runner's argument parsing and its calls before implementing — the DNA puts
the surface *in the runner on purpose*, so there is nothing to guess about API shape.

### Authority to read for the core (and only this)

- `dna/QUICKSTART.md` — the regeneration recipe (this file extends it).
- `dna/domain/z80-cpu-execution.md`, `dna/domain/z80-opcodes.md` + `z80-opcodes.yaml`
- `dna/domain/ula-timing.md`, `dna/domain/machine-execution.md`
- `dna/domain/snapshot-z80.md` (the `.z80` byte layout)
- `dna/appendix/` — non-normative aids. Pseudocode is "one correct realization"; the
  **data tables** (DAA flags, contention, opcode tables, ROM addresses) are normative.

### The core gate

```bash
npm run conformance:self-test    # passes NOW — proves the copied genome is intact
npm run conformance:emulator     # green only once cpu+ula+machine exist
npm run coverage:emulator        # the emulator-area ledger is fully covered
```

`conformance:self-test` passing today proves the genome copy is good. The
`conformance:emulator` gate exits non-zero until you write the three packages — that
failure *is* the spec doing its job. **Green = a faithful core, not "it ran."**

### Optional deep-fidelity belt (not required for "done")

zexdoc/zexall + FUSE-timing against external references are an extra belt. The runner
is `dna/conformance/cpu/run-zex.mjs` driving `dna/conformance/cpu/zex-cpm-cpu-adapter.mjs`
(which drives `packages/cpu`). Not part of the core gate.

---

## Layer 2 — the conformant host I/O

Build these against the **core you made green**, then prove each against its DNA
reference model. The flow for every concern is the same:

1. Read the DNA spec (the table in Layer 2 above) — it is normative and names every
   rule by `[id: ...]`.
2. Open the **reference model** (e.g. `dna/conformance/keyboard/keyboard-model.mjs`).
   **Its exported functions are the surface the runner calls** — that is the contract
   your own module must satisfy.
3. Implement the same behavior in your shell module.
4. **Prove it** with `--module` (see below). Then wire the proven module into the page.

### Proving the host I/O (`--module`)

The host-shell runners default to the DNA reference model (so `npm run
conformance:host-shell` is green today — it checks the genome). To prove **your** code,
point each runner at your module, which must export the same names the model does:

```bash
node dna/conformance/audio/run-audio-fixtures.mjs    --module web/audio.mjs    --quiet
node dna/conformance/keyboard/run-keyboard-fixtures.mjs --module web/keyboard.mjs --quiet
node dna/conformance/raster/run-raster-fixtures.mjs  --module web/display.mjs  --quiet
node dna/conformance/host-io/run-host-io-fixtures.mjs --module web/hostio.mjs   --quiet
```

(Record the proving commands you actually ran in `NOTES.md`, and add a
`conformance:host-shell:mine` script once your module paths are stable.) The
`host-io` runner additionally drives your `packages/machine` for the contended-time
fixture, so `npm run conformance:host-io` exercises the real machine.

### What the DNA pins for the host I/O (do not re-derive — cite these)

The facts you would otherwise be tempted to invent are already in the DNA, verified
and fixture-backed. Read them there; do not hardcode your own version:

- **Border/beeper events** — port `0xFE` write bits, the border **event stream** (not
  one colour per frame), the beeper **edge** on `b4` change, and the **chronological**
  (not ULA-modulo) timestamp that prevents long-run audio reordering:
  `dna/domain/host-io-port-fe.md`.
- **Keyboard** — the 8×5 active-low matrix and half-row select, the `event.key →
  Spectrum key(s)` map (incl. CAPS-SHIFT cursor/edit combos), and the **quick-tap
  latch** (a tap is visible for exactly one 50 Hz scan; a release with no live press is
  a no-op): `dna/product/keyboard-input.md`.
- **Beeper PCM** — fractional sample accounting (no rounded samples/frame), the global
  sample grid, continuity across frame boundaries (no 50 Hz reset/click), and the
  deterministic-capture conformance route: `dna/product/beeper-output.md`.
- **Raster** — the 320×240 canvas (256×192 + 32 px / 24 line border), the
  `pixelTState(x,y)` mapping, the 205-level palette, and the `SAVE "pp"` red/cyan band
  acceptance: `dna/product/raster-border.md`.

> Some host-I/O rules are tagged `decision:ADR-0016` and **FLAGGED for user
> confirmation** (e.g. the exact 320×240 / 32-px-border geometry, palette level 205).
> They are the DNA's accepted *default*, provisional and revisable. Treat them as the
> contract; if the user later supplies exact shell constants, only that slice's
> fixtures change. Do not silently pick different values.

---

## Layer 3 — the shell glue (demonstrated, not judged)

Wire the proven core + host-I/O modules into a page. The DNA does not judge this, so
verify by observation.

### The frame loop

1. **Load `rom/48.rom`** (16 KB) into machine memory `0x0000–0x3FFF` before the first
   frame. Fetch it over HTTP (`fetch('rom/48.rom')`) — so the page must be **served**,
   not opened as `file://`. Any one-line static server works (`npx serve`,
   `python -m http.server`, a tiny `node:http` script).
2. **Run one machine frame per display frame (~50 Hz).** A 48K frame is **69888
   T-states**; the maskable interrupt is asserted at frame start (IM1 vector `0x0038`)
   — see `dna/domain/machine-execution.md`. After each frame: render the screen from
   display memory + attributes, flush the captured port-`0xFE` border/beeper events
   into the raster + beeper-PCM paths (Layer 2), and feed the current keyboard matrix
   in for the next frame's `IN` reads.
3. Drive the loop with `requestAnimationFrame` or a fixed-step accumulator at ~50.08 Hz.

The screen bitmap/attribute layout and the memory map (ROM `0x0000–0x3FFF` read-only,
RAM `0x4000–0xFFFF`, screen at the bottom of RAM) are documented ZX Spectrum 48K
hardware; cross-check anything against `dna/domain/ula-timing.md` /
`machine-execution.md`, and if they conflict, the DNA wins and you log it in `NOTES.md`.

### File loading

- **`.z80` snapshots — the DNA-proven path.** Use the core's `readZ80` (covered by the
  `formats` conformance). This is the reliable way to "load a game": decode the
  snapshot into machine state and run. The `.z80` byte layout is authoritative in
  `dna/domain/snapshot-z80.md`.
- **`.tap` / `.tzx` tapes — loader-defined shell work.** The DNA marks `.tap`/`.tzx` as
  *loader-defined* with **no byte-layout spec and no fixture** (`dna/product/file-formats.md`
  FF-TAPE-001). You implement them from public ZX Spectrum knowledge — either feed the
  tape blocks through the ROM loader by trapping the ROM load routine, or flash-load
  blocks into memory. This is **Layer 3**: not DNA-judged. Verify by observation and
  document the approach (and any per-format quirks) in `NOTES.md`. Do **not** invent a
  `.tap`/`.tzx` spec into the DNA.

### Shell acceptance checklist (manual — this is "done" for Layer 3)

Map directly onto the user's three goals. Record what you **observed** (and on which
ROM/game), not "tests pass":

- [ ] **ROM / BASIC** — boots to the `© 1982 Sinclair Research Ltd` screen; typing
      works (`PRINT "HI"` + `ENTER`); CAPS / SYMBOL shift behave; `BORDER 2` changes
      the border.
- [ ] **Sound** — `BEEP 1,0` is audible; a longer tone stays stable (no drift, no
      periodic click). A `SAVE` shows the red/cyan border bands.
- [ ] **Games** — a known `.z80` snapshot loads and runs with correct graphics; a
      `.tap` and a `.tzx` tape load and become playable; colour, FLASH, and BRIGHT
      render correctly.
- [ ] Frame rate is stable ~50 Hz and audio has no constant crackle.

---

## Host assets (outside the DNA)

These are **not** in the genome and you must not fabricate them:

- **`rom/48.rom`** — the 16 KB 48K BASIC ROM. Required to boot BASIC. It is a host
  asset (its addresses are documented in the DNA; the binary is not). See
  `rom/README.md` for what to place and its provenance/copyright note.
- **`tapes/`** — sample `.z80` / `.tap` / `.tzx` files to exercise game loading. See
  `tapes/README.md`.

If an asset is missing, say so plainly — do not stub a fake ROM or a fake game.

---

## Out of scope / known DNA boundaries (do not silently fill these)

- **No `dna/product/emulator.md`** — there is no single normative product API for the
  emulator (frame/screen/audio/snapshot bundle). The machine *conformance* defines the
  frame/step API; anything product-shaped you add beyond it is Layer 3.
- **`.tap`/`.tzx` byte layout is not pinned** (loader-defined).
- **48K only** — no 128K/+2/+3, no AY sound chip, no `.sna`/`.szx` unless you add them
  as explicit Layer-3 work with a `NOTES.md` entry.
- Port-`0xFE` I/O-port contention, floating-bus reads, and the intra-instruction I/O
  offset are **out of scope** by DNA decision (ADR-0016); do not model them.

---

## Provenance & stop-on-ambiguity discipline

Every normative claim in the DNA is tagged
(`hardware | z80-spec | zexall | zexdoc | fuse | contract | manual | decision:<id> |
UNKNOWN`). A behavior the DNA marks `UNKNOWN` is a backlog item, never a shipped
default. **On any ambiguity or contradiction in Layers 1–2, STOP and record the gap in
`NOTES.md` — do not guess a behavior into existence.** (Layer 3 you may design freely,
but still record decisions.)

---

## Session protocol (multi-session work)

1. **Orient.** Read `NOTES.md` (your running log) and `git log` / `git status` to see
   where the last session stopped.
2. **One layer per change, in order.** Land Layer 1 (core) green, then Layer 2
   (host I/O) proven, then Layer 3 (shell) demonstrated.
3. **Stop on ambiguity (Layers 1–2).** Record the gap in `NOTES.md`; never guess a
   behavior the DNA does not pin.
4. **Verify before claiming.** Layers 1–2: paste the conformance / coverage / `--module`
   output. Layer 3: state what you observed against the checklist and on which ROM/game.
5. **Commit coherent units.** The message says what changed and which layer; e.g.
   `feat(core): Z80 base opcodes — emulator gate green`, `feat(hostio): beeper PCM
   (audio runner green under --module)`, or `feat(shell): .tzx loader (manual: Manic
   Miner plays)`.
6. **Keep `NOTES.md` current** — it is the only durable memory across sessions: the
   `.tap`/`.tzx` approach, every DNA gap, every flagged-default you accepted.

## Quick commands

```bash
npm run conformance:self-test    # genome intact (works before any packages)
npm run conformance:emulator     # Layer 1 + host-io gate (target: all green)
npm run coverage:emulator        # emulator-area ledger fully covered
npm run conformance:host-shell   # Layer 2 host-shell runners (DNA models; add --module for yours)
npm run coverage:gallery         # gallery-area ledger (audio/keyboard/raster)
# serve the page over http, then open it (any static server):
npx serve .                      # or: python -m http.server 8080
```

## Definition of done

- **Core (Layer 1):** `npm run conformance:emulator` green and `coverage:emulator`
  fully covered — a real, machine-checked claim.
- **Host I/O (Layer 2):** each of audio / keyboard / raster / host-io runners green
  **under `--module` pointing at your own code** — proven, not just demonstrated.
- **Shell (Layer 3):** every checklist box observed and recorded, with the honest
  caveat that the shell is demonstrated, not DNA-proven, and stating the ROM/games used.
