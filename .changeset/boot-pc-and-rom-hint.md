---
"@zx-vibes/toolkit": minor
"zx-vibes": minor
---

`boot` means one thing everywhere, and the `pc-in-rom` verdict names the usual cause at
entry.

- `boot.org` is now always a program's load origin, and appears only for sources that
  have one (`build`, `--bin`, a CODE `--tap`). A `--state` session, a `.z80` snapshot,
  a fresh boot and the MCP hot session report `boot.pc`, the PC the command starts at,
  instead. Before, the same session gave `org: 16384` in `run` (an internal hang-watchdog
  floor) and `org: <session PC>` in `regs`/`mem`. Scripts that read `boot.org` for those
  sources should read `boot.pc`.
- A `pc-in-rom` hang's `likelyCause` now also names a ROM routine that needs the system
  variables, such as `rst 0x10` printing: `zxs` starts a program without the ROM's
  start-up, so they are zero. The `debug-hangs` skill and `docs/recipes.md` say the same.
