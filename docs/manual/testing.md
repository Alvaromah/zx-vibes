# Testing

The starter project includes `tests/smoke.test.json`. Keep it small but useful:

- Assert the program reaches a stable run state.
- Assert expected screen text, screen hashes, or non-blank regions.
- Assert keyboard-driven changes for controls.
- Assert `beeperEdges` when sound is part of the feature.
- Add a new test file when one scenario becomes too large.

Run:

```bash
npm test
npm run verify
```

List supported assertions:

```bash
zxs test tests --list-assertions
```

## What to Test

Prefer tests that describe gameplay behavior instead of implementation details:

- The title or prompt appears after boot.
- The player sprite moves after scheduled input.
- A collision changes score, lives, or screen state.
- Sound-producing actions produce beeper edges.
- The program keeps running without a hang report.

Tests are the handoff between humans and agents. They let an agent change code
without relying only on screenshots or subjective visual inspection.

## Completion Checklist

Before calling a project task done:

- `npm run build` passes.
- A targeted `zxs run --json` reports `status: "ok"`.
- The screen was inspected with `zxs screen --text`, a PNG screenshot, or the
  browser preview.
- `npm test` passes.
- `npm run verify` passes.
- New mechanics have tests or assertions.
- Any agent handoff describes what changed, how it was verified, and what
  remains.

That checklist is the same for humans and agents. It is the reason zx-vibes can
support fast iteration without losing the constraints of a real ZX Spectrum
program.
