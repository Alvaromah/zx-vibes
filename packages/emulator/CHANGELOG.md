# @zx-vibes/emulator

## 0.1.3

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

## 0.1.2

### Patch Changes

- Support 48K-compatible `.z80` v2/v3 snapshots in the emulator loader and
  toolkit snapshot inspection paths, including compressed 16K RAM page blocks.

## 0.1.1

### Patch Changes

- 5af5826: Expose headless beeper activity in run/verify/test reports, resume browser audio from user gestures, and add watched preview rebuilds with visible build hashes.
