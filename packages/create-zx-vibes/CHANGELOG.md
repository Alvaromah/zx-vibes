# create-zx-vibes

## 0.2.1

### Patch Changes

- Security and correctness fixes from a full-codebase audit.

  - **emulator:** fix a crash on the undocumented `INC/DEC IXH/IXL/IYH/IYL` opcodes (`inc8`/`dec8` were missing); make `.tzx` `readDWord` unsigned and clamp unknown-block skips (prevents an infinite loop on crafted tapes); bounds-check the `.z80` RLE end marker; gate verbose tape logging behind a debug flag.
  - **toolkit:** validate `.zxstate` buffer lengths/shape on load (no more `RangeError`/silent corruption); cap `gfx` render regions to the 64KB address space; mask `disasm` reads to 16 bits; back up + merge `.mcp.json` in `setup` instead of overwriting; hash size+mtime in `preview --watch`; reject Windows reserved names and validate the template in `new`, with transactional rollback; clean up `zxs test` temp dirs; guard `package.json` reads.
  - **asm:** contain `SAVEBIN` artifact paths within the output directory; evaluate full `-D NAME=expr` expressions; cap `REPT`/`DUP` counts; flag division/modulo by zero in strict mode.
  - **create-zx-vibes:** reject Windows reserved names, validate the template, scaffold transactionally, and handle `CommanderError` cleanly.

## 0.2.0

### Minor Changes

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
