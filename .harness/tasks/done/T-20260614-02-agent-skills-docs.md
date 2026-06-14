---
id: T-20260614-02
title: Project-local agent skills documentation
status: done
areas: [toolkit, assembler, emulator, scaffolding, reference-docs, distribution]
created: 2026-06-14
---

# Project-local agent skills documentation

## Goal

Add project-local Codex-style skills that help coding agents build ZX Spectrum
48K Z80 assembly projects with `zx-vibes`, and ship those skills through both
project generators.

## Source

Delegated user request from thread `019ec758-80bb-7800-871c-da379a0573ad`.

## Plan

- Add canonical skill assets under `docs/agents/skills/` with a router index
  and selective topic skills.
- Add `docs/reference/assembler-syntax.md` for the embedded `@zx-vibes/asm`
  assembler and narrow `sjasmplus-cheatsheet.md` to optional external usage.
- Route generated starter playbooks through the skills index while preserving
  the build/run/look feedback loop.
- Ensure `@zx-vibes/toolkit`, `zxs new`, and `create-zx-vibes` ship/copy the
  skills and have drift checks for copied docs.
- Update scaffold coverage and run focused package validation.

## Validation

- `pnpm --filter @zx-vibes/toolkit run check:docs`
- `pnpm --filter create-zx-vibes run check:assets`
- `pnpm --filter @zx-vibes/toolkit typecheck`
- `pnpm --filter @zx-vibes/toolkit lint` (exit 0; existing warnings in
  `src/cli/output.ts`)
- `pnpm --filter @zx-vibes/toolkit test` (19 files, 126 tests)
- `pnpm --filter create-zx-vibes typecheck`
- `pnpm --filter create-zx-vibes lint` (exit 0; existing generator console
  warnings)
- `pnpm --filter create-zx-vibes build`
- `pnpm --filter create-zx-vibes test`
- `pnpm --filter @zx-vibes/asm test` (67 tests)
- Temp `create-zx-vibes` scaffold smoke verified generated
  `docs/agents/skills/INDEX.md`, assembler/screen skills, assembler reference,
  and `AGENTS.md` router reference.

## Result

Added project-local skill docs under `docs/agents/skills/`, including the
router index plus assembler, hardware/core, rendering, genre, and debug skills.
Added `docs/reference/assembler-syntax.md`, updated the reference index, and
narrowed the sjasmplus cheatsheet to optional external sjasmplus use.

Both scaffold generators now copy `docs/agents/skills` into generated projects,
starter/template playbooks route agents through the skills index while
preserving the build/run/look loop, and `@zx-vibes/toolkit` ships
`docs/agents`. A toolkit docs sync/check script now prevents drift for copied
reference docs and skills; `create-zx-vibes` assets were synced from root docs.
