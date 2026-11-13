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
| `tight-loop` | machine state frozen for ~a second | `zxs disasm PC --count 12 --state .zxs/state.zxstate` — which loop is it? |
| `sp-corrupt` | SP points into ROM/low memory | find the unbalanced push/pop or the `LD SP` you forgot |
| `pc-in-rom` | execution left the program into ROM and never came back | a wild `JP`/`RET` into ROM — check the stack; or a ROM routine that needs the system variables (such as `rst 0x10` printing), which are zero because `zxs` starts your program without the ROM's start-up |

The liveness fingerprint counts RAM changes, register changes, border/beeper
output, HALT-resume cadence, and whether any instruction ran in RAM each frame.
A healthy HALT-synced wait loop — even one that only cycles the border
([host-io-port-fe.md](../reference/host-io-port-fe.md)) while polling for a key
— reads as alive. A busy IM 1 game whose frame edge samples inside the ROM
keyboard scan is NOT flagged: `pc-in-rom` requires the whole frame to run in ROM
([machine-execution.md](../reference/machine-execution.md) has the frame/interrupt
model).

## The debugging loop

Run on a session: `run --state` saves the machine it ended with, hung or not, and the
inspection commands then read that machine. Without `--state` each of them boots the
program fresh and shows its entry state, not the machine that hung.

```
zxs state reset                                        # this build, fresh, into the session
zxs run --state .zxs/state.zxstate --json              # the verdict + PC + likelyCause
zxs regs --state .zxs/state.zxstate                    # where is SP? IM? IFF1?
zxs disasm PC --count 12 --state .zxs/state.zxstate    # what code is the PC actually in?
zxs break add <label|file.asm:line>                    # then: zxs state reset, and
zxs run --state .zxs/state.zxstate --until-break       #   run to the breakpoint
zxs step 10 --state .zxs/state.zxstate                 # single-step from that stop
zxs trace --frames 5 --profile                         # a fresh run: T-states by routine + HALT idle
zxs coverage                                           # a fresh run: which routines were ever reached?
```

Two limits of this loop. `zxs step` does not take the frame interrupt: from a `HALT` it
shows the same `HALT` again, so break on the instruction after it. And a breakpoint on
the address the session is already at (the entry, right after `state reset`) is passed,
not hit, until execution comes back to it.

`haltSynced: true` means the once-per-frame interrupt resumed `HALT` for a
majority of the run. It does **not** prove every deadline was met: inspect
`frameBudget.overrunFrames` (and assert it is zero) to catch intermittent
25/50-Hz degradation. Profiling attribution uses the nearest preceding SLD
function label and is explicitly heuristic; `<unmapped>` covers code without a
matching label.

## Escapes

- Test specs: `"detectHangs": false` for runs that legitimately freeze
  (e.g. asserting a deliberate `DI/HALT` end state).
- CLI: `zxs run --no-detect-hangs` — same escape when reproducing by hand.
  With the watchdog off, `status` can never be `hang` and `haltSynced` is
  meaningless; use it to observe, not to accept.
