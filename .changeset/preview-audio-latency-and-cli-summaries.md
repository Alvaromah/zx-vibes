---
"@zx-vibes/toolkit": minor
"zx-vibes": minor
---

Halve the preview's audio delay, and make human CLI output readable.

- **Preview audio latency**: the AudioWorklet's queue ceiling was 100 ms, and
  because the producer slightly outpaces the audio hardware clock the queue
  always settled just under it — the ceiling *was* the delay. Lowered to 40 ms,
  and the excess is now shed by advancing the read cursor (a few milliseconds)
  instead of dropping whole ~20 ms buffers (a frame-sized discontinuity).
  Measured standing queue: **~70 ms → ~18 ms**, stable across a 90-second run and
  a hidden-tab excursion. The remaining delay is the output device's own latency,
  which the page cannot change (34–74 ms here; Bluetooth output adds far more).
- **Human CLI output**: `formatHuman` dumped every envelope field verbatim, so
  `zxs setup --agent codex` printed 27 absolute paths on one line and `zxs verify`
  printed three truncated JSON envelopes. Bulk lists now summarize to a count,
  lists whose items carry `ok` report the verdict, and nested envelopes collapse
  to pass/fail. `--json` is byte-identical — only the human line changed, whose
  wording is Incidental (CLI-PROD-FREE-001).

```
setup: agent=codex mcpServer=zx-vibes global=false installed=27 skipped=1 deferred=1 next=2
doctor: checks=4/4 ok
test:   total=3 passed=3 failed=0 results=3/3 ok
verify: build=ok run=ok tests=ok screenshot=.zxs/verify-screen.png
```
