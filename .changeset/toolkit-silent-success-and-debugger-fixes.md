---
"@zx-vibes/toolkit": minor
"zx-vibes": minor
---

Stop reporting success for things that did not happen, and fix the debugger paths that
looked at the wrong machine. Several commands that used to exit 0 now exit 1, so scripts
that relied on them need a look.

**Now an error instead of a silent success**

- `zxs mem write` / `mem load` below `0x4000`: a session keeps only RAM, so the write was
  reported `persisted: true` and was gone on the next command.
- `zxs state export --state <file>` when that session does not exist: it exported a fresh
  boot under the name of the session you meant. (`state save` still creates one.)
- `zxs setup --agent claude` when `.mcp.json` is not a JSON object: the file is never
  overwritten, not even with `--force`, which used to replace it with one that registered
  `zx-vibes` alone and dropped your other servers. A leading byte order mark is no longer a
  parse error. `doctor` names the unreadable file instead of prescribing `--force`.
- A test spec with a mistyped field: `"frames": "ten"` ran zero frames and passed;
  `"detectHangs": "false"` left the watchdog on. `regEquals` with a value the register cannot
  hold and an `addr` past `0xFFFF` were masked to fit and could pass by accident.
- `zxs --verison` (an unknown flag and no command) printed the help and exited 0.
- `zxs regs set` accepted `constructor`, `__proto__` and `im 3`; `screen --max-diff ten`
  became NaN and failed every diff with a misleading message.

**Debugger and run report**

- `zxs regs set pc` and MCP `zx_run { pc }` on a machine waiting on a `HALT` resumed one
  byte past the address: the machine stayed halted and the next interrupt returned to
  `pc + 1`. Writing PC now clears the halt.
- `exit.pc` of a run that used up its frame budget is the PC it ended at. It used to be
  the PC the run was entered at, unlike every other exit reason.
- `sp-corrupt` no longer fires for an empty stack at `0x0000` (`ld sp,0`).
- `zxs type` releases a key before pressing it again even with other keys in between:
  `type 101` reached the ROM as `10`.
- A malformed `--keys`/`--joy` plan, a bad `--frames` and an unknown key are reported under
  the command that received them (`trace`, `coverage`, `key`, `type`), not as `run`.

**Preview, MCP and output**

- One request for `//` ended the `zxs preview` server (the URL parser threw inside the
  request listener); any page could send it. It is now a 400. An oversized control request
  is no longer buffered past its limit.
- The MCP tool descriptions say that `zx_build` does not load the program: after it, call
  `zx_state` with `action: "reset"`, then `zx_run`. A bare `zx_run` runs the live machine,
  which starts as a ROM boot.
- The screen text read-back uses the Spectrum character set: the boot line is
  `© 1982 Sinclair Research Ltd` instead of starting with a raw DEL control character, and
  `↑` and `£` are no longer `^` and a backtick. `screenIncludes` accepts both spellings.
- Human-mode `zxs build` prints the assembler warnings (`DISPLAY` output) instead of
  only counting them.
- `setup --agent codex` and `doctor` no longer exit with "Bad escaped character in JSON" on
  a Codex `config.toml` they cannot decode, read literal `'…'` strings, and a commented-out
  line that mentions `zx-vibes` no longer counts as a registration.
- Reverse-engineering add-on: `xref` finds `RST n`; `scan --imm` no longer reports an index
  displacement and the following opcode as a 16-bit immediate (`LD A,(IX+5)` as `0x057E`);
  the add-on's `gfx find` is not served after `ZXS_REVENG` is turned off in the same process.
- The debugging sequences in the knowledge pack (`debug-hangs`) pass `--state`; without it,
  `regs`, `disasm` and `step` showed a fresh boot, not the machine that hung. The skill also
  states two limits of that loop: `step` does not take the frame interrupt, so it cannot
  leave a `HALT`, and a breakpoint on the address the session is already at is passed.
