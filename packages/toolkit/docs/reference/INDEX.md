# Spectral reference docs — index

Read the file that matches your symptom or task. Each doc is short, dense and
example-led; the **Gotchas** sections list the mistakes LLMs (and 1983
beginners) actually make.

| Symptom / task | Read |
|---|---|
| Where do I put my code? Where is the stack? | [memory-map.md](memory-map.md) |
| Garbage stripes / picture scrambled when drawing | [screen-layout.md](screen-layout.md) |
| Wrong colours, colour "bleeding" between sprites | [attributes-and-colour.md](attributes-and-colour.md) |
| Keys don't respond / respond inverted / always pressed | [keyboard-input.md](keyboard-input.md) |
| Game too fast/slow, flicker, IM2, frame sync | [interrupts-and-timing.md](interrupts-and-timing.md) |
| Printing text, CLS, beep via ROM calls | [rom-routines.md](rom-routines.md) |
| Beeper sound, port `0xFE`, WAV/audio assertions | [sound.md](sound.md) |
| Declarative tests and assertion fields | [testing-assertions.md](testing-assertions.md) |
| Snapshot triage, asset ripping, gfx/disasm/scan workflows | [reverse-engineering.md](reverse-engineering.md) |
| Embedded assembler syntax, directives, error messages | [assembler-syntax.md](assembler-syntax.md) |
| Optional external sjasmplus usage or migration notes | [sjasmplus-cheatsheet.md](sjasmplus-cheatsheet.md) |
| It crashes / hangs / works for 30s then dies | [common-bugs.md](common-bugs.md) |

Working code for all of this lives in `recipes/` — every recipe assembles and
is asserted in CI (`zxs test recipes`). Prefer copying a recipe over writing
a primitive from scratch.
