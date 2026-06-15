# reference-docs

Last updated: 2026-06-14

## Paths

- `docs/reference/`
- `docs/agents/skills/`
- `packages/toolkit/docs/reference/`
- `packages/toolkit/docs/agents/skills/`
- `packages/create-zx-vibes/docs/reference/`
- `packages/create-zx-vibes/docs/agents/skills/`

## Role

Shared Spectrum reference material and project-local agent skills for humans,
coding agents, toolkit docs, and generated projects.

## Owns

- Memory map, screen layout, ROM routines, keyboard input, interrupts/timing,
  color attributes, common bugs, embedded assembler syntax, and optional
  sjasmplus notes.
- Codex-style topic skills under `docs/agents/skills/`.
- Keeping generated-project docs accurate and aligned with starter/toolkit
  behavior.
- Copied doc assets shipped by toolkit and generator packages.

## Stack

- Language: Markdown.
- Package manager: pnpm for asset sync/build checks.

## Important commands

```bash
pnpm --filter create-zx-vibes run check:assets
pnpm --filter @zx-vibes/toolkit run check:docs
pnpm --filter create-zx-vibes build
```

Use root `pnpm run verify` if docs changes accompany code, starter, or package
behavior changes.

## Important files or directories

- `docs/reference/INDEX.md`
- `docs/reference/*.md`
- `docs/agents/skills/INDEX.md`
- `docs/agents/skills/*/SKILL.md`
- `packages/toolkit/docs/reference/`
- `packages/toolkit/docs/agents/skills/`
- `packages/create-zx-vibes/docs/reference/`
- `packages/create-zx-vibes/docs/agents/skills/`
- `packages/toolkit/scripts/sync-docs.js`
- `packages/create-zx-vibes/scripts/sync-assets.js`

## External dependencies

- No service dependencies.

## Known gotchas

- Root docs and package-copied docs can drift. Use the create package asset
  check after changing root `docs/`, and toolkit docs check after changing
  root `docs/reference/` or `docs/agents/skills/`.
- Some toolkit docs outside `docs/reference/` are Spanish-language guide pages;
  keep language intent deliberate when editing them.

## Validation expectations

- Docs-only root reference/skills changes: run `pnpm --filter create-zx-vibes
  run check:assets` and `pnpm --filter @zx-vibes/toolkit run check:docs`.
- If docs describe behavior changed in toolkit/assembler/emulator, validate the
  corresponding area too.

## Recent area notes

- 2026-06-15: T-20260615-01 added sound, testing assertion, and
  reverse-engineering references plus a reverse-engineering skill; synced
  toolkit and create-package copies.
- 2026-06-14: T-20260614-02 added project-local agent skills and
  `docs/reference/assembler-syntax.md`; sjasmplus notes now defer to the
  embedded assembler reference for normal zx-vibes work.
- Root harness initialized this area on 2026-06-14.
