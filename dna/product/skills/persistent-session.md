# Persistent sessions — reading and injecting live game state

`zxs` is stateless by default: every `run` boots fresh. That is what you want
for reproducible tests — and NOT what you want when you are asking "what is the
player's Y velocity right now?". For that, opt into a persistent session with
`--state`.

## The observe pattern

```
zxs state save .zxs/dbg.zxstate                       # fresh machine, program loaded
zxs run --frames 140 --keys "60:SPACE*4" --state .zxs/dbg.zxstate
zxs mem read 0xE400 --len 16 --state .zxs/dbg.zxstate --read-only
zxs regs --state .zxs/dbg.zxstate
```

Keep an `EQU` block with every variable address in one include so the `mem read`
offsets are self-documenting; `zxs symbols get <label>` resolves any label from
the last build's SLD.

## The inject pattern — reach a scenario without playing to it

```
zxs mem write 0xE40D "00" --state .zxs/dbg.zxstate    # e.g. zero the gem counter
zxs regs set pc 0x8100 --state .zxs/dbg.zxstate
zxs run --frames 3 --state .zxs/dbg.zxstate           # let the game react
zxs mem read 0xE40E --len 1 --state .zxs/dbg.zxstate --read-only
```

Memory writes to plain RAM addresses take effect immediately; the next frames
run the game's own logic against the injected state. This is the fastest way to
test "door opens when the last gem is taken" without scripting the whole route.

## Three rules that save an afternoon

1. **`run --state` RESUMES.** The envelope's `boot.source` says `"state"` when a
   session was resumed. Re-running the same command continues from where the
   last one stopped — it does not replay it.
2. **Fresh scenario = fresh reset.** `zxs state reset` reloads the built program
   into the session (PC back at the entry, RAM re-initialised), so
   `reset -> run --state -> mem read` sees the program again. `--blank` gives a
   bare clean-ROM boot with nothing loaded, if you really want empty RAM.
3. **Observation should not mutate.** Add `--read-only` (or `--no-save`) to
   `mem read`/`regs` calls against a session you plan to keep replaying.

## Snapshots out

```
zxs state export --z80 take.z80 --state .zxs/dbg.zxstate
zxs screen --z80 take.z80 --png take.png --scale 4
```

Exports a `.z80` v1 snapshot ([file-formats.md](../reference/file-formats.md))
any emulator loads — useful for handing a failing moment to a human, or for
rendering a big screenshot of a saved instant.
