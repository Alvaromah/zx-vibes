# Migration Notes

Date: 2026-06-13

This repository was created as a clean source import. Git history from the
source repositories was intentionally not preserved.

## Sources

- `D:\ZXSpectrum\season-01\spectral` -> `packages/toolkit`
  - Git HEAD: `caf7075ea6de01b6899e0c7bb26d962a18e863fe`
  - Working tree had tracked and untracked changes at import time.
  - Imported source snapshot excludes `.git`, `node_modules`, `dist`, `build`,
    `.zxs`, coverage, caches, `.harness`, `.github`, logs, and lockfiles.

- `D:\ZXSpectrum\season-01\asm` -> `packages/asm`
  - Git HEAD: unavailable; repository appears to have no committed `HEAD`.
  - Working tree consisted of untracked source/package files at import time.
  - Imported source snapshot excludes `.git`, `node_modules`, `dist`, `build`,
    coverage, caches, logs, and lockfiles.

- `D:\ZXSpectrum\season-01\zx-generation` -> `packages/emulator`
  - Git HEAD: `706d8ad1a76085fe41a76bd0f090b8e17dbe959e`
  - Working tree was clean at import time.
  - Imported source snapshot excludes `.git`, `node_modules`, `dist`, `build`,
    coverage, caches, `.github`, logs, and lockfiles.

## Scope

The old repositories were not modified or deleted. This monorepo uses new
package names under `@zx-vibes/*` and adds the `zx-vibes` and
`create-zx-vibes` public packages.
