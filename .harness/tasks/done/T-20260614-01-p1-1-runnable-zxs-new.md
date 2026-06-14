---
id: T-20260614-01
title: P1-1 runnable zxs new projects
status: done
areas: [toolkit, scaffolding, distribution]
created: 2026-06-14
---

# P1-1 runnable zxs new projects

## Goal

Make a brand-new project created by `zxs new` runnable without manual PATH
surgery. `npm run build` and `npm test` should work immediately after project
creation.

## Source

`FEEDBACK.md` P1-1: generated projects assume a bare `zxs` binary, but fresh
projects have no global bin and no installed local dependencies.

## Plan

- Make `zxs new` install generated project dependencies by default, with an
  explicit opt-out for offline or test workflows.
- Keep generated npm scripts using the local `zxs` bin and update Makefiles to
  avoid relying on a global `zxs`.
- Align root starters, toolkit templates, and copied create-package assets.
- Update scaffold tests and add a changeset for the user-visible generator
  behavior.

## Validation

- `pnpm --filter @zx-vibes/toolkit typecheck`
- `pnpm --filter @zx-vibes/toolkit lint` (exit 0; existing warnings in
  `src/cli/output.ts`)
- `pnpm --filter @zx-vibes/toolkit test`
- `pnpm --filter create-zx-vibes typecheck`
- `pnpm --filter create-zx-vibes lint` (exit 0; existing generator console
  warnings)
- `pnpm --filter create-zx-vibes test`
- `pnpm --filter create-zx-vibes run check:assets`
- `pnpm --filter @zx-vibes/emulator lint` (exit 0; existing warnings only)
- `pnpm --filter @zx-vibes/emulator test` (342 passed)
- Literal `pnpm --filter @zx-vibes/emulator lint test` was attempted but pnpm
  forwards `test` as an ESLint path, so it fails before Jest with "No files
  matching the pattern \"test\" were found"; lint and test were run separately.
- Fresh temp-project acceptance smoke: `zxs new smoke --template game --json`
  installed dependencies, then `npm run build` and `npm test` both passed.

## Result

`zxs new` now installs generated project dependencies by default using `npm
install`, offers `--no-install` for offline/local checkout workflows, prints
`npm run build` / `npm test` next steps, and writes starters that recover via
`npm install` / `npx zxs` if the local bin is missing.
