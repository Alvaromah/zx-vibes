# zx-vibes

## 0.2.1

### Patch Changes

- Updated dependencies [9b9fa51]
  - @zx-vibes/toolkit@0.3.1

## 0.2.0

### Minor Changes

- SCF/CCF undocumented-flag accuracy (Q register) and an opt-in INCLUDE/INCBIN sandbox.

  - **emulator:** model the Z80 "Q" latch so `SCF`/`CCF` derive their undocumented bits 3/5 as `((Q ^ F) | A)` — i.e. from `A` right after a flag-modifying instruction and from `F | A` otherwise.
  - **asm:** new opt-in `sandbox` assemble option (and `zxasm --sandbox`) that confines `INCLUDE`/`INCBIN`/`INSERT` reads to the project (cwd + include paths); absolute paths and `../` escapes are rejected. `SAVEBIN` output was already confined.
  - **toolkit:** `zxs build --sandbox`, and the MCP server sandboxes agent-driven builds by default (spectral backend).

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @zx-vibes/asm@0.2.0
  - @zx-vibes/toolkit@0.3.0

## 0.1.4

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
  - @zx-vibes/toolkit@0.2.1
  - @zx-vibes/asm@0.1.2

## 0.1.3

### Patch Changes

- a606951: Make generated projects runnable immediately by having `zxs new` install the
  local `zx-vibes` dependency by default, adding a `--no-install` escape hatch,
  and updating starter guidance for project-local `zxs` usage.
- Updated dependencies [ea0a2b7]
- Updated dependencies
- Updated dependencies [7cb76cd]
- Updated dependencies [a606951]
  - @zx-vibes/toolkit@0.2.0

## 0.1.2

### Patch Changes

- c813e18: Keep `zxs --version` synced with package metadata, document preview options in CLI regression tests, and let `zxs preview` fall forward to the next available port unless `--strict-port` is used.
- Updated dependencies [c813e18]
  - @zx-vibes/toolkit@0.1.2

## 0.1.1

### Patch Changes

- cf30399: Use source-controlled bin wrappers for CLI entrypoints so fresh workspace installs can create package shims before built `dist/` files exist, and document local clone and tarball workflows.
- Updated dependencies [5af5826]
- Updated dependencies [cf30399]
  - @zx-vibes/toolkit@0.1.1
  - @zx-vibes/asm@0.1.1
