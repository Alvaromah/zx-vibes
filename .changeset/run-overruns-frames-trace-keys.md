---
"@zx-vibes/toolkit": minor
"zx-vibes": minor
---

Find late frames and stop keyed runs where you ask. One behaviour change: an explicit
`zxs run --frames N` now stops at frame N even when the `--keys`/`--joy` plan is longer.

- `run --json` (and `verify`, MCP `zx_run`/`zx_keys`) lists the overrun frames:
  `frameBudget.overruns` holds the first 32 as `{ frame, busyTStates }`, numbered like
  `worstFrame.frame`, and `frameBudget.overrunsTruncated` says there were more. A
  failing `frameBudget` assertion names them
  (`frameBudget: 2 overrun frame(s) exceeds max 0 (frames 10, 21)`), and the human
  `run` line shows them (`frameBudget={measured=40 overruns=2 frames=10,21 …}`).
- `zxs run --frames 100 --keys "0:SPACE*500"` used to run 500 frames silently. An
  explicit `--frames` is now a hard stop: the plan is cut and the report says so
  (`input.truncated: true`, `input.planFrames: 500`). Without `--frames` the run still
  lasts until the plan ends, and test specs, `verify`, `key`/`type`, `coverage`,
  `trace` and the MCP tools keep extending to the plan's end.
- `zxs trace` takes `--keys` and `--joy`, like `coverage`, so a keyed scenario can be
  traced directly.
