---
"@zx-vibes/toolkit": minor
"zx-vibes": minor
---

Make the documented run-and-look loop work and stop reporting false hangs. Several
exit codes change, so scripts that relied on the old ones need a look.

- `screen`, `step`, `disasm`, `trace`, `symbols` and `coverage` accept
  `--state <file>` (plus `--no-save` / `--read-only`), so `zxs state reset`,
  `zxs run --state .zxs/state.zxstate`, then `zxs screen --text --state
  .zxs/state.zxstate` shows what the run drew. A missing session file is an error,
  never a fresh boot. `step`, `trace` and `coverage` save the advanced session.
- A machine idling in the ROM's BASIC editor (a fresh boot, a BASIC program that has
  finished, an ordinary BASIC error report such as "2 Variable not found") is no
  longer a hang: these exit 0 instead of 2. A program that resets the machine, or
  `di` + `jr $`, still exits 2.
- `key` and `type` report a hang (exit 2, `status: "hang"`) instead of exiting 0
  over a hung machine.
- Every command loads a built program at its first `ORG`; only a source without an
  `ORG` uses the configured `org`. `run`, `verify` and `preview` used to load an
  `ORG 0x9000` program at `0x8000`.
- An `h`-suffixed hex address must start with a digit (`0FFh`); `break add each`
  now means the label `each`, not address `0x0EAC`, and `FFh` is an error.
- A write watchpoint fires on a write of the value already stored there.
- `doctor` really assembles a probe, so a broken assembler fails the check (exit 3).
- Human (non-`--json`) output prints the details of a failure (diagnostics with the
  source line, failing specs, the hang verdict) and one line per instruction for
  `disasm`/`step`/`trace`.
- `setup --agent codex` adds the knowledge-pack section to an existing `AGENTS.md`
  (such as the one `zxs new` writes) instead of skipping the file.
