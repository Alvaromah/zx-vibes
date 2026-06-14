# reference-docs

Last updated: 2026-06-14

## Paths

- `docs/reference/`
- `packages/toolkit/docs/reference/`
- `packages/create-zx-vibes/docs/reference/`

## Role

Shared Spectrum reference material for humans, coding agents, toolkit docs, and
generated projects.

## Owns

- Memory map, screen layout, ROM routines, keyboard input, interrupts/timing,
  color attributes, common bugs, and sjasmplus cheatsheet.
- Keeping generated-project docs accurate and aligned with starter/toolkit
  behavior.
- Copied doc assets shipped by toolkit and generator packages.

## Stack

- Language: Markdown.
- Package manager: pnpm for asset sync/build checks.

## Important commands

```bash
pnpm --filter create-zx-vibes run check:assets
pnpm --filter create-zx-vibes build
```

Use root `pnpm run verify` if docs changes accompany code, starter, or package
behavior changes.

## Important files or directories

- `docs/reference/INDEX.md`
- `docs/reference/*.md`
- `packages/toolkit/docs/reference/`
- `packages/create-zx-vibes/docs/reference/`
- `packages/create-zx-vibes/scripts/sync-assets.js`

## External dependencies

- No service dependencies.

## Known gotchas

- Root docs and package-copied docs can drift. Use the create package asset
  check after changing root `docs/reference/`.
- Some toolkit docs outside `docs/reference/` are Spanish-language guide pages;
  keep language intent deliberate when editing them.

## Validation expectations

- Docs-only root reference changes: run `pnpm --filter create-zx-vibes run
  check:assets`.
- If docs describe behavior changed in toolkit/assembler/emulator, validate the
  corresponding area too.

## Recent area notes

- Root harness initialized this area on 2026-06-14.
