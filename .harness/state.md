# Current State

Last updated: 2026-06-14

## Solution summary

`zx-vibes` is a pnpm monorepo for a ZX Spectrum 48K coding-agent toolchain. It
packages an embedded TypeScript Z80 assembler, a JavaScript Spectrum emulator,
the `zxs` CLI, an MCP server, starter projects, reference docs, and a playable
gallery.

The primary users are humans and coding agents building small ZX Spectrum
projects with a closed feedback loop: assemble, run headless, inspect screen
state, debug, iterate, and verify.

The public package surface is split across publishable workspace packages under
`packages/*`, with root docs/starters copied into generated projects and package
artifacts during builds.

## Main areas

- `toolkit` (`packages/toolkit/`): `zxs` CLI, MCP server, runtime loop,
  command implementations, recipes, examples, preview, and Vitest coverage.
- `assembler` (`packages/asm/`): embedded Z80 assembler/disassembler and
  `zxasm`/`spectral-asm` CLI used by the toolkit by default.
- `emulator` (`packages/emulator/`): JavaScript ZX Spectrum emulator, CPU,
  memory, ULA/display, tape/snapshot, ROM handling, Rollup bundle, Jest tests.
- `scaffolding` (`packages/create-zx-vibes/`, `starters/`,
  `packages/toolkit/templates/`): project generator and source starter/template
  assets.
- `reference-docs` (`docs/reference/` plus copied package docs): Spectrum
  reference docs copied into generated projects and toolkit docs.
- `gallery` (`gallery/`, `packages/toolkit/gallery/`): static GitHub Pages
  gallery with playable generated game artifacts.
- `distribution` (repo root, `.github/`, `.changeset/`, `packages/zx-vibes/`):
  workspace scripts, CI/release, changesets, umbrella package and bin shims.

## Current architecture

The root workspace uses pnpm and publishes packages from `packages/*`.
`@zx-vibes/toolkit` depends on `@zx-vibes/asm` and `@zx-vibes/emulator`; the
umbrella `zx-vibes` package exposes bin shims that delegate to toolkit and asm.

`create-zx-vibes` builds a generator package and syncs root `starters/` and
`docs/` into `packages/create-zx-vibes/` through
`packages/create-zx-vibes/scripts/sync-assets.js`. The toolkit separately ships
templates, recipes, docs, examples, and gallery assets.

CI builds, typechecks, lints, and tests across Node 20/22 and major OSes.
GitHub Pages deploys the root `gallery/` directory. Release validation uses the
same root checks, and npm publishing is gated by the release workflow and
changesets.

## Current focus

- The root harness has just been created. Keep it current as future work lands.
- No queued implementation tasks are currently recorded; see
  `.harness/tasks/queue.md`.

## Stable constraints

- The codebase is the source of truth.
- Keep the harness lightweight and current.
- Do not store raw chat logs or secrets.
- Runtime support is Node.js 20 or newer.
- pnpm is the repository package manager; root verification is
  `pnpm run verify`.
- Keep starter projects compatible with the embedded `@zx-vibes/asm` assembler
  unless the change is explicitly about optional `sjasmplus` support.
- If root `starters/` or `docs/` change, check copied assets for
  `create-zx-vibes`.
- Keep a single canonical `AGENTS.md` at the repository root. Area-specific
  guidance belongs in `.harness/areas/*.md`, not package-level `AGENTS.md`
  files.

## Known facts

- Root scripts: `build`, `typecheck`, `lint`, `test`, `pack`, and `verify`.
- `pnpm-workspace.yaml` includes `packages/*` only; root `starters/`,
  `docs/`, and `gallery/` are product assets but not workspace packages.
- `packages/toolkit` imports emulator internals through deep exports and wraps
  the agent feedback loop.
- `packages/zx-vibes` is a thin umbrella package, not the main implementation.
- The repository includes a ZX Spectrum 48K ROM under emulator/package gallery
  paths; license notices are separate from the MIT source license.

## Open questions

- None recorded in the harness yet.
