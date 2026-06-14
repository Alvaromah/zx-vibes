# Recent Changes

This file summarizes the latest meaningful changes.
Keep 5-10 useful entries, or roughly the last 30 days.
Older details should live in task files under `tasks/done/` or
`tasks/archive/`, or in git history.

## 2026-06-14 - Project-local agent skills docs added

Areas: toolkit, assembler, emulator, scaffolding, reference-docs, distribution

Summary:
Added canonical Codex-style skills under `docs/agents/skills/` for embedded
assembler syntax, ZX screen/keyboard/attributes/timing/sound/ROM/debug topics,
rendering patterns, and platformer/arcade/text-adventure genres. Added
`docs/reference/assembler-syntax.md`, updated the reference index, and narrowed
the sjasmplus cheatsheet to optional external sjasmplus usage.

Files touched:

- `docs/agents/skills/`
- `docs/reference/assembler-syntax.md`
- `docs/reference/INDEX.md`
- `docs/reference/sjasmplus-cheatsheet.md`
- `packages/toolkit/scripts/sync-docs.js`
- `packages/toolkit/package.json`
- `packages/toolkit/src/cli/commands/new.ts`
- `packages/create-zx-vibes/src/index.ts`
- `starters/*/AGENT_PLAYBOOK.md`
- `packages/toolkit/templates/*/AGENT_PLAYBOOK.md`
- `packages/create-zx-vibes/starters/*/AGENT_PLAYBOOK.md`
- synced docs under `packages/toolkit/docs/` and `packages/create-zx-vibes/docs/`

Validation:

- `pnpm --filter @zx-vibes/toolkit run check:docs`
- `pnpm --filter create-zx-vibes run check:assets`
- `pnpm --filter @zx-vibes/toolkit typecheck`
- `pnpm --filter @zx-vibes/toolkit lint` (exit 0; existing warnings only)
- `pnpm --filter @zx-vibes/toolkit test`
- `pnpm --filter create-zx-vibes typecheck`
- `pnpm --filter create-zx-vibes lint` (exit 0; existing warnings only)
- `pnpm --filter create-zx-vibes build`
- `pnpm --filter create-zx-vibes test`
- `pnpm --filter @zx-vibes/asm test`
- Temp `create-zx-vibes` scaffold smoke verified generated skills/reference
  files and `AGENTS.md` router reference.

Follow-ups:

- None.

Task file:
`.harness/tasks/done/T-20260614-02-agent-skills-docs.md`

## 2026-06-14 - P1-1 generated projects run without global zxs

Areas: toolkit, scaffolding, distribution

Summary:
Updated `zxs new` so generated projects install dependencies by default and
then work through project-local npm scripts. Added `--no-install` for local
checkout/offline workflows, updated starter Makefiles to use
`npx --no-install zxs`, and added generated-playbook recovery guidance for a
missing local `zxs` bin.

Files touched:

- `packages/toolkit/src/cli/commands/new.ts`
- `packages/toolkit/src/cli/index.ts`
- `starters/*/`
- `packages/toolkit/templates/*/`
- `packages/create-zx-vibes/starters/*/`
- `packages/toolkit/tests/cli/scaffold-e2e.test.ts`
- `.changeset/runnable-zxs-new.md`

Validation:

- `pnpm --filter @zx-vibes/toolkit typecheck`
- `pnpm --filter @zx-vibes/toolkit lint` (exit 0; existing warnings only)
- `pnpm --filter @zx-vibes/toolkit test`
- `pnpm --filter create-zx-vibes typecheck`
- `pnpm --filter create-zx-vibes lint` (exit 0; existing warnings only)
- `pnpm --filter create-zx-vibes test`
- `pnpm --filter create-zx-vibes run check:assets`
- `pnpm --filter @zx-vibes/emulator lint` (exit 0; existing warnings only)
- `pnpm --filter @zx-vibes/emulator test` (342 passed)
- Fresh generated-project smoke: default `zxs new`, `npm run build`, and
  `npm test` all passed.

Follow-ups:

- Continue with `FEEDBACK.md` P1-2 (`docs/reference/sound.md`) when requested.

Task file:
`.harness/tasks/done/T-20260614-01-p1-1-runnable-zxs-new.md`

## 2026-06-14 - Root operational harness created

Areas: distribution, toolkit, assembler, emulator, scaffolding, reference-docs,
gallery

Summary:
Created the root `AGENTS.md` and `.harness/` operational memory for the
`zx-vibes` monorepo. The area map intentionally uses package/product
boundaries, not the raw top-level inspector output.

Files touched:

- `AGENTS.md`
- `.harness/README.md`
- `.harness/state.md`
- `.harness/map.md`
- `.harness/handoff.md`
- `.harness/decisions.md`
- `.harness/areas/*.md`
- `.harness/tasks/**`
- `packages/toolkit/AGENTS.md`

Validation:

- Generated with the bundled `harness-builder` scripts using a custom
  monorepo report.
- Reviewed generated markdown and package-local harness pointers.

Follow-ups:

- Keep area files current as real implementation work lands.
- Create task files only when work is non-trivial or multi-session.

Task file:
None; harness bootstrap task was completed in-session.

## 2026-06-14 - Consolidated AGENTS.md at root

Areas: distribution, toolkit, assembler

Summary:
Removed package-level `AGENTS.md` files and made the root `AGENTS.md` the only
canonical agent instruction entry point. Updated local harness notes and the
toolkit Claude pointer so future sessions do not look for deleted files.

Files touched:

- `packages/asm/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/CLAUDE.md`
- `AGENTS.md`
- `.harness/state.md`
- `.harness/handoff.md`
- `.harness/decisions.md`
- `.harness/areas/toolkit.md`
- `.harness/areas/assembler.md`

Validation:

- Re-scanned for `AGENTS.md` files outside dependency/build directories.
- Re-scanned for stale package-local `AGENTS.md` references.

Follow-ups:

- None.

Task file:
None; policy cleanup was completed in-session.

## 2026-06-14 - Removed non-root CLAUDE.md files

Areas: distribution, toolkit, scaffolding

Summary:
Removed all `CLAUDE.md` files outside the repository root. Starter and template
playbook source now lives in `AGENT_PLAYBOOK.md`, and both scaffold generators
write generated-project `AGENTS.md` from that source.

Files touched:

- `starters/*/AGENT_PLAYBOOK.md`
- `packages/create-zx-vibes/starters/*/AGENT_PLAYBOOK.md`
- `packages/toolkit/templates/*/AGENT_PLAYBOOK.md`
- `packages/toolkit/src/cli/commands/new.ts`
- `packages/create-zx-vibes/src/index.ts`
- `packages/toolkit/tests/cli/scaffold-e2e.test.ts`
- docs and gallery metadata that referenced `CLAUDE.md`

Validation:

- Re-scanned for non-root `CLAUDE.md` files.
- Re-scanned for `CLAUDE.md` text references.

Follow-ups:

- None.

Task file:
None; policy cleanup was completed in-session.

## 2026-06-14 - Generated projects write CLAUDE.md from shared playbook

Areas: toolkit, scaffolding

Summary:
Updated both scaffold generators so newly created projects receive `AGENTS.md`
and `CLAUDE.md` from the same rendered `AGENT_PLAYBOOK.md` template. The source
repository still keeps no `CLAUDE.md` files outside generated outputs.

Files touched:

- `packages/toolkit/src/cli/commands/new.ts`
- `packages/create-zx-vibes/src/index.ts`
- `packages/toolkit/tests/cli/scaffold-e2e.test.ts`
- docs and gallery metadata that describe generated playbooks

Validation:

- Re-run scaffold tests after this change.

Follow-ups:

- None.

Task file:
None; policy cleanup was completed in-session.
