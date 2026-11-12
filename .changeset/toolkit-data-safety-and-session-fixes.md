---
"@zx-vibes/toolkit": patch
"zx-vibes": patch
---

Fix data-loss bugs, silent mis-loads and session-continuity bugs found in a
full-repository review.

**Data safety**

- `zxs build --tap main.asm` (the optional `--tap/--scr/--z80 [path]` value
  swallowing the entry) overwrote the source with tape bytes and reported ok. A
  format target that is the entry or any `.asm` file is now refused.
- `zxs clean` deleted whatever `outDir` named, so `"outDir": "."` deleted the whole
  project. It now refuses a target that is not strictly inside the project or that
  contains the entry source, before removing anything.
- `zxs setup --agent codex` merges the `zx-vibes` server into an existing
  `config.toml` (global or project) instead of skipping it, and `--force` refreshes
  only that table; it used to replace the whole file, wiping the user's model,
  profiles and other MCP servers.

**Fail loud instead of half-loading** (errors.md ERR-PROD-EMU-001 /
ERR-PROD-NOSILENT-001)

- A `.z80` that is empty, truncated, from a non-48K machine, or missing a 48K page
  is a user error (exit 1); it used to boot a zeroed machine and report a hang.
- A `.zxstate` with an unknown version or a corrupt snapshot is rejected.
- A `.tap` CODE block with the wrong flag, too few bytes or a bad checksum is
  rejected instead of booting a partial program.
- `zx.config.json` fields `entry`, `org`, `assembler`, `outDir` and `tests` must be
  strings: `"org": 32768` crashed, and a list-valued `tests` made `verify` skip the
  suite and pass.

**Sessions**

- `run --state --until-break` (and the MCP hot session) continues past the
  breakpoint it stopped at instead of stopping again at once with zero T-states.
- Continued runs (`run --state`, `key`/`type --state`, MCP `zx_run`/`zx_keys`/trace)
  keep the session's border instead of reporting and saving the power-on 7.
- `zxs type` and MCP `typeText` release a key before pressing it again, so "11"
  types `11` instead of `1`.

**Other**

- Human-mode `zxs screen` prints the 24-row text grid again (0.8.0 truncated it to
  a few blank lines).
- `coverage` counts code labels only (EQU constants were reported as routines);
  `trace --last 0` returns no instructions.
- The preview player reads an idle Kempston (port 0x1F) as 0x00 like `zxs run`;
  0xFF made Kempston games move and fire non-stop in preview.
- The preview server record is written atomically (temp file + rename).
- Selecting `--assembler sjasmplus` says the backend is not implemented instead of
  telling users to install sjasmplus.
