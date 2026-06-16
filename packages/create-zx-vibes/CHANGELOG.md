# create-zx-vibes

## 0.1.3

### Patch Changes

- 7cb76cd: Add feedback-driven toolkit improvements for read-only investigation workflows,
  snapshot and memory export, graphics decoding, scan/xref helpers, audio WAV and
  timing metadata, preview server lifecycle tracking, direct browser playback,
  expanded test assertions, and updated generated-project docs/playbooks.
- a606951: Make generated projects runnable immediately by having `zxs new` install the
  local `zx-vibes` dependency by default, adding a `--no-install` escape hatch,
  and updating starter guidance for project-local `zxs` usage.

## 0.1.2

### Patch Changes

- ec3167d: Avoid Node's Windows shell-argument deprecation warning when `--install` runs `pnpm install`, and make the post-create guidance reflect whether dependencies were installed.

## 0.1.1

### Patch Changes

- 5af5826: Expose headless beeper activity in run/verify/test reports, resume browser audio from user gestures, and add watched preview rebuilds with visible build hashes.
