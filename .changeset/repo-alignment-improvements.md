---
"create-zx-vibes": minor
"@zx-vibes/toolkit": patch
"@zx-vibes/asm": patch
"@zx-vibes/emulator": patch
"zx-vibes": patch
---

Align generated project contracts and public package surfaces across the repo.

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
