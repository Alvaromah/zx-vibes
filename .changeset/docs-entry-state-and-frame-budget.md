---
"@zx-vibes/toolkit": patch
"zx-vibes": patch
---

Document how a program is entered and what `frameBudget` measures. The agent playbook
(`zxs new`, `zxs setup`) and the knowledge pack now say:

- A built program starts at its `ORG` from the power-on state, without the ROM's
  start-up. The system variables are zero, so the ROM keyboard scan is unusable (no key
  for the first 256 frames, then keyword-mode codes) and ROM routines that need the
  system variables, such as `rst 0x10` printing, crash. Read the keyboard ports and print
  with your own routine (`interrupts-im1-im2` skill).
- `frameBudget` starts measuring at the first `HALT` an interrupt resumes, and every
  later frame counts, one-off set-up included. Do slow set-up before the first `HALT`,
  split it across frames, or anchor the spec with `waitFor`.
- During `SAVE`, the border is red/cyan for the pilot tone and blue/yellow for the data
  (`reference/raster-border.md`).
