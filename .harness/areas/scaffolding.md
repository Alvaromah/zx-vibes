# scaffolding

Last updated: 2026-06-14

## Paths

- `packages/create-zx-vibes/`
- `starters/`
- `packages/toolkit/templates/`

## Role

Project generator and source starter/template assets for generated ZX Spectrum
projects.

## Owns

- `create-zx-vibes` CLI behavior.
- Root starter projects copied into generated projects.
- Template packages used by toolkit/new-project flows.
- Sync of root docs/starters into `packages/create-zx-vibes/`.

## Stack

- Languages: TypeScript, JavaScript, Z80 assembly, JSON, Makefile.
- Package manager: pnpm.
- Build: tsup for generator.
- Generator dependency: `commander`.

## Important commands

```bash
pnpm --filter create-zx-vibes build
pnpm --filter create-zx-vibes typecheck
pnpm --filter create-zx-vibes lint
pnpm --filter create-zx-vibes test
pnpm --filter create-zx-vibes run check:assets
```

## Important files or directories

- `packages/create-zx-vibes/src/index.ts`
- `packages/create-zx-vibes/scripts/sync-assets.js`
- `starters/game/`
- `starters/platformer/`
- `packages/create-zx-vibes/starters/`
- `packages/create-zx-vibes/docs/`
- `packages/toolkit/templates/game/`
- `packages/toolkit/templates/platformer/`

## External dependencies

- No service dependencies.
- Generated projects depend on published `zx-vibes` package versions unless
  testing local clone workflows explicitly.

## Known gotchas

- Root `starters/` and `docs/` are source assets for
  `packages/create-zx-vibes`; copied package assets can drift.
- `check:assets` is the drift detector.
- Keep starter projects compatible with embedded `@zx-vibes/asm` unless the
  task is explicitly about optional `sjasmplus` support.

## Validation expectations

- For generator code: run create package build/typecheck/lint/test.
- For root starter or docs changes: run `pnpm --filter create-zx-vibes run
  check:assets`; if stale, run the generator build/sync workflow intentionally.
- For starter behavior changes, also validate with toolkit `zxs verify` style
  workflows where practical.

## Recent area notes

- 2026-06-15: T-20260615-01 updated starter/template playbooks for `zxs doctor`,
  `preview --json`/detach/list/stop, read-only inspection, and reverse
  engineering docs; relaxed the game smoke test `cellsNonBlank` upper bound.
- 2026-06-14: T-20260614-02 updated starter/template playbooks to route agents
  through `docs/agents/skills/INDEX.md` and both generators now copy
  `docs/agents/skills` into generated projects.
- 2026-06-14: P1-1 updated starter/template Makefiles for project-local
  `zxs`, added local-bin recovery guidance to generated playbooks, and synced
  `packages/create-zx-vibes/starters/`.
- Root harness initialized this area on 2026-06-14.
