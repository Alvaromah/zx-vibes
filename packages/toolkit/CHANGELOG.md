# @zx-vibes/toolkit

## 0.3.1

### Patch Changes

- 9b9fa51: Update generated project starters and toolkit templates to depend on the current
  `zx-vibes` 0.2 line, and add a root consistency check that keeps starter
  dependency floors and public package version docs aligned with package
  manifests.

## 0.3.0

### Minor Changes

- SCF/CCF undocumented-flag accuracy (Q register) and an opt-in INCLUDE/INCBIN sandbox.

  - **emulator:** model the Z80 "Q" latch so `SCF`/`CCF` derive their undocumented bits 3/5 as `((Q ^ F) | A)` — i.e. from `A` right after a flag-modifying instruction and from `F | A` otherwise.
  - **asm:** new opt-in `sandbox` assemble option (and `zxasm --sandbox`) that confines `INCLUDE`/`INCBIN`/`INSERT` reads to the project (cwd + include paths); absolute paths and `../` escapes are rejected. `SAVEBIN` output was already confined.
  - **toolkit:** `zxs build --sandbox`, and the MCP server sandboxes agent-driven builds by default (spectral backend).

### Patch Changes

- Security and correctness fixes from a full-codebase audit.

  - **emulator:** fix a crash on the undocumented `INC/DEC IXH/IXL/IYH/IYL` opcodes (`inc8`/`dec8` were missing); make `.tzx` `readDWord` unsigned and clamp unknown-block skips (prevents an infinite loop on crafted tapes); bounds-check the `.z80` RLE end marker; gate verbose tape logging behind a debug flag.
  - **toolkit:** validate `.zxstate` buffer lengths/shape on load (no more `RangeError`/silent corruption); cap `gfx` render regions to the 64KB address space; mask `disasm` reads to 16 bits; back up + merge `.mcp.json` in `setup` instead of overwriting; hash size+mtime in `preview --watch`; reject Windows reserved names and validate the template in `new`, with transactional rollback; clean up `zxs test` temp dirs; guard `package.json` reads.
  - **asm:** contain `SAVEBIN` artifact paths within the output directory; evaluate full `-D NAME=expr` expressions; cap `REPT`/`DUP` counts; flag division/modulo by zero in strict mode.
  - **create-zx-vibes:** reject Windows reserved names, validate the template, scaffold transactionally, and handle `CommanderError` cleanly.

- Updated dependencies
- Updated dependencies
  - @zx-vibes/emulator@0.2.0
  - @zx-vibes/asm@0.2.0

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
