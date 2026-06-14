---
name: z80-asm-zx-vibes
description: Work with the embedded @zx-vibes/asm Z80 assembler syntax used by zx-vibes ZX Spectrum 48K projects.
---

# z80-asm-zx-vibes

Use this skill when editing, debugging, reviewing, or generating `.asm` sources
for zx-vibes projects that should assemble with the embedded `@zx-vibes/asm`
backend.

## Key Rules

- Treat `packages/asm/README.md` and the current assembler tests as the source
  of truth.
- Target the embedded assembler first. Do not assume full sjasmplus
  compatibility.
- Use `DEVICE ZXSPECTRUM48` and `ORG` in normal Spectrum 48K programs.
- Keep instructions indented unless the line is meant to define a label.
- Prefer embedded-supported output: raw binary plus SLD symbols. Use sjasmplus
  only for sjasmplus-only features such as `SAVESNA`, tape/snapshot output, or
  advanced features outside the embedded subset.
- When porting from sjasmplus, check directives, macros, modules, conditionals,
  include paths, and output directives against the local reference before
  editing code.

## Load Before Acting

- `packages/asm/README.md` for the supported assembler surface.
- `docs/reference/assembler-syntax.md` for syntax details and limitations.
- `docs/reference/sjasmplus-cheatsheet.md` only when migrating external
  sjasmplus material or explaining sjasmplus-specific behavior.
- Relevant files under `packages/asm/tests/` when behavior is unclear.

## Validation

- For assembler source changes in a zx-vibes project, run the project build or
  `zxs build <entry.asm>`.
- For repository assembler behavior changes, run
  `pnpm --filter @zx-vibes/asm test`.
- For docs-only syntax changes, inspect the rendered Markdown or at least run a
  focused Markdown/readability check if available.
