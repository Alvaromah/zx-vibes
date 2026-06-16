# @zx-vibes/toolkit

## 0.2.1

### Patch Changes

- 9ace69d: Align generated project contracts and public package surfaces across the repo.

  `create-zx-vibes` now creates the same MCP-ready project files as `zxs new`,
  installs dependencies by default with npm, and supports `--no-install`.
  Starter/template dependency floors now target the current `zx-vibes` release.

  `zxs play` now preserves `.tzx` filenames for browser tape parsing, preview
  records are written only by listening servers and stopped through an ownership
  token, and embedded assembler `SAVEBIN` artifact paths propagate through
  toolkit build output.

  Package metadata/version surfaces now derive from package manifests, gallery
  emulator bundles and starter/template drift are checked explicitly, and emulator
  README/API docs now describe the current `@zx-vibes/emulator` package, tape,
  snapshot, and callback APIs.

- Updated dependencies [9ace69d]
  - @zx-vibes/asm@0.1.2
  - @zx-vibes/emulator@0.1.3

## 0.2.0

### Minor Changes

- ea0a2b7: Add `zxs boot` to open a clean ZX Spectrum 48K boot screen in the browser
  player without requiring a project build or external snapshot file.
- 7cb76cd: Add feedback-driven toolkit improvements for read-only investigation workflows,
  snapshot and memory export, graphics decoding, scan/xref helpers, audio WAV and
  timing metadata, preview server lifecycle tracking, direct browser playback,
  expanded test assertions, and updated generated-project docs/playbooks.

### Patch Changes

- Support 48K-compatible `.z80` v2/v3 snapshots in the emulator loader and
  toolkit snapshot inspection paths, including compressed 16K RAM page blocks.
- a606951: Make generated projects runnable immediately by having `zxs new` install the
  local `zx-vibes` dependency by default, adding a `--no-install` escape hatch,
  and updating starter guidance for project-local `zxs` usage.
- Updated dependencies
  - @zx-vibes/emulator@0.1.2

## 0.1.2

### Patch Changes

- c813e18: Keep `zxs --version` synced with package metadata, document preview options in CLI regression tests, and let `zxs preview` fall forward to the next available port unless `--strict-port` is used.

## 0.1.1

### Patch Changes

- 5af5826: Expose headless beeper activity in run/verify/test reports, resume browser audio from user gestures, and add watched preview rebuilds with visible build hashes.
- cf30399: Use source-controlled bin wrappers for CLI entrypoints so fresh workspace installs can create package shims before built `dist/` files exist, and document local clone and tarball workflows.
- Updated dependencies [5af5826]
- Updated dependencies [cf30399]
  - @zx-vibes/emulator@0.1.1
  - @zx-vibes/asm@0.1.1
