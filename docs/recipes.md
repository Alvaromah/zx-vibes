# Agent Recipes

Task-shaped recipes for driving `zx-vibes` from a coding agent (or by hand). Every
command supports `--json` for a single machine-readable envelope. The golden rule from the
generated `AGENTS.md`/`CLAUDE.md` playbook still governs everything:

> **Never report success without running and looking.**

- [Create a game](#create-a-game)
- [Inspect the screen](#inspect-the-screen)
- [Assert beeper (sound) output](#assert-beeper-sound-output)
- [Debug hangs](#debug-hangs)
- [IM1 vs IM2 for games](#im1-vs-im2-for-games)

## Create a game

`zxs new` scaffolds a **playable** project — a moving, keyboard-driven sprite that passes
`zxs verify` out of the box, not just a valid loop.

```bash
zxs new my-game                      # default template: a QAOP-driven ship
zxs new my-game --template platformer # O/P to move, SPACE to jump
cd my-game
zxs verify                           # build → run → screenshot → tests, all green
zxs preview --watch                  # play it in the browser, live-reload on edits
```

What you get:

- `src/main.asm` — the game (edit this).
- `lib/screen.asm`, `lib/keys.asm` — shared screen + input primitives it `INCLUDE`s.
- `tests/smoke.test.json` — a smoke suite that **builds and asserts the actual game**
  (`../src/main.asm`), so editing `src/main.asm` and re-running `zxs verify` is a genuine
  regression check.

The tight loop for iterating (each step observes, never assumes):

```bash
zxs build --json        # assemble src/main.asm → build/
zxs run --json          # run 300 frames under the hang watchdog
zxs screen --text       # read the screen back as text (cheap eyes)
zxs verify --json       # the single acceptance gate
```

## Inspect the screen

```bash
# Text OCR of the 32×24 character grid (fast, diff-friendly):
zxs screen --text

# PNG snapshot of the current session, and a raw 256×192 bitmap render:
zxs screen --png screen.png
zxs gfx screen --out screen.png
zxs gfx attrs --out attrs.png       # attribute (colour) map

# Run and capture a screenshot in one shot, driving input on the way:
zxs run --frames 120 --keys "5:P*40" --screenshot screen.png
```

The `run` JSON reports what changed without opening the image:

```jsonc
{
  "screen": { "nonBlankCells": 40, "attrNonBlank": 0, "border": 7, "hash": "335e3185" }
}
```

Declarative screen assertions in a `tests/*.test.json` spec:

```jsonc
{ "type": "screenChanged", "equals": true }
{ "type": "cellsNonBlank", "min": 1 }
{ "type": "pixelAt", "x": 251, "y": 99, "set": true }   // x 0–255, y 0–191
{ "type": "borderColor", "equals": 2 }
```

## Assert beeper (sound) output

The emulator counts speaker edges (port `0xFE` bit 4). After a run, the JSON carries them
under `audio`:

```bash
zxs run --json         # → { "audio": { "beeperEdges": 128, "portFEWrites": 130, ... } }
```

Turn that into a gate with a declarative assertion (`min`/`max` both optional):

```jsonc
{ "type": "beeperEdges", "min": 1 }     // fails if the program made no sound
```

If `beeperEdges` is `0`, the program never toggled the speaker — check that you `out (0xFE), a`
with bit 4 flipping, and that you actually reach that code.

## Debug hangs

`zxs run` reports `status: "ok" | "hang" | "breakpoint" | "watchpoint"`. A `hang` verdict
carries a `kind` so you know *why*:

| `kind`        | Meaning |
| ------------- | ------- |
| `di-halt`     | `HALT` with interrupts disabled — nothing will ever wake it. |
| `tight-loop`  | Spinning on a small PC range with no forward progress. |
| `pc-in-rom`   | Execution parked in ROM (often an IM1 game spending most frames in the ROM interrupt handler). |
| `sp-corrupt`  | The stack pointer walked into an implausible place. |
| `rom-error`   | Dropped into a ROM error routine. |

Tools for the diagnosis:

```bash
zxs run --json                 # status + hang.kind + final registers
zxs regs                       # PC/SP/flags right now
zxs disasm PC --count 12       # what is it about to execute?
zxs trace --frames 5           # per-frame PC hotspots — where time is spent
zxs break add 0x8000           # stop at a PC and inspect
zxs step 10                    # single-step out of a suspicious spot
```

A `haltSynced: true` run is the healthy shape for a 50 Hz game: the loop is `halt`ing once
per frame and the interrupt is releasing it. `haltSynced: false` with `status: ok` usually
means the loop is free-running (no `halt`) or interrupts are off.

## IM1 vs IM2 for games

The default ZX Spectrum interrupt mode is **IM1**: every 50 Hz interrupt jumps to the ROM
handler at `0x0038`, which scans the keyboard, updates `FRAMES`, etc., then returns. That is
perfectly fine for most small games — the scaffolded starters use it (`ei` + `halt`).

The catch for **larger** HALT-based games: because IM1 spends part of every frame executing
**ROM** code, a game that also idles a lot can trip the `pc-in-rom` hang heuristic — the
watchdog sees the PC in ROM too often and suspects a hang. The fix is **IM2** with your own
tiny handler in RAM: you own the whole frame, spend zero time in ROM, and hang detection sees
only your code.

A minimal, self-contained IM2 setup (verified: `status: ok`, `haltSynced: true`, `im: 2`, PC
stays in your code, and the counter increments once per frame):

```z80asm
        DEVICE ZXSPECTRUM48
        ORG 0x8000

TABLE   equ 0xFE00          ; 257-byte vector table, page 0xFE
VECTOR  equ 0xFDFD          ; the word 0xFDFD sits in the table → CPU dispatches here
COUNTER equ 0xBF00          ; frames the ISR has serviced (proof it runs)

start:
        di
        ; Fill 257 bytes at 0xFE00 with 0xFD. Because every byte is identical, the
        ; 16-bit vector the CPU reads is 0xFDFD no matter which byte the bus presents
        ; during interrupt acknowledge — robust across emulators and real hardware.
        ld hl, TABLE
        ld (hl), 0xFD
        ld de, TABLE + 1
        ld bc, 256
        ldir
        ; Plant `JP isr` at 0xFDFD, where IM2 will jump.
        ld a, 0xC3          ; JP opcode
        ld (VECTOR), a
        ld hl, isr
        ld (VECTOR + 1), hl
        xor a
        ld (COUNTER), a
        ld a, 0xFE          ; I = table page → vectors resolve inside 0xFE00..0xFF00
        ld i, a
        im 2
        ei
main:
        halt                ; released by YOUR interrupt, not the ROM's
        ; ... your per-frame game logic here ...
        jr main

isr:
        push af
        ld a, (COUNTER)
        inc a
        ld (COUNTER), a     ; do your frame work here; keep it short
        pop af
        ei
        reti
```

Rule of thumb: start in IM1 (the scaffold default). Reach for IM2 only when you want the
whole frame to yourself — smooth raster effects, tight timing, or to keep a mostly-idle game
out of the `pc-in-rom` heuristic.
