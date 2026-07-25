# Debugging hangs — what the watchdog verdicts mean

`zxs run` watches for programs that stopped making progress. Two verdicts are
**definite** (checked per instruction, the run stops immediately):

| Kind | Meaning | Usual cause |
| --- | --- | --- |
| `di-halt` | `HALT` with interrupts disabled — nothing can ever resume it | forgot `EI`, or `DI` left on after a critical section |
| `rom-error` | PC reached the ROM error restart (RST $08) | bad `CALL`/`RET` pairing, stack imbalance, jumped through a corrupt vector |

Three are **probable** (decided from per-frame statistics at budget exhaustion):

| Kind | Meaning | First move |
| --- | --- | --- |
| `tight-loop` | machine state frozen for ~a second | `zxs disasm PC --count 12` — which loop is it? |
| `sp-corrupt` | SP points into ROM/low memory | find the unbalanced push/pop or the `LD SP` you forgot |
| `pc-in-rom` | execution left the program into ROM and never came back | a wild `JP`/`RET` into ROM — check the stack |

The liveness fingerprint counts RAM changes, register changes, border/beeper
output, HALT-resume cadence, and whether any instruction ran in RAM each frame.
A healthy HALT-synced wait loop — even one that only cycles the border
([host-io-port-fe.md](../reference/host-io-port-fe.md)) while polling for a key
— reads as alive. A busy IM 1 game whose frame edge samples inside the ROM
keyboard scan is NOT flagged: `pc-in-rom` requires the whole frame to run in ROM
([machine-execution.md](../reference/machine-execution.md) has the frame/interrupt
model).

## The debugging loop

```
zxs run --json                        # the verdict + PC + likelyCause
zxs regs                              # where is SP? IM? IFF1?
zxs disasm PC --count 12              # what code is the PC actually in?
zxs break add <label|file.asm:line>   # then: zxs run --until-break
zxs step 10                           # single-step from a stop
zxs trace --frames 5                  # instruction log + hot spots
zxs coverage                          # which routines were ever reached?
```

`haltSynced: true` in the run report is the healthiest signal there is: the
once-per-frame interrupt is resuming your HALT — a 50 Hz loop doing its job.

## Escapes

- Test specs: `"detectHangs": false` for runs that legitimately freeze
  (e.g. asserting a deliberate `DI/HALT` end state).
- CLI: `zxs run --no-detect-hangs` — same escape when reproducing by hand.
  With the watchdog off, `status` can never be `hang` and `haltSynced` is
  meaningless; use it to observe, not to accept.
