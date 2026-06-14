# assembler

Last updated: 2026-06-14

## Paths

- `packages/asm/`

## Role

Embedded TypeScript Z80 assembler/disassembler package used by `zx-vibes`
tooling by default.

## Owns

- Assembly parsing and byte emission.
- Disassembly and CLI behavior for `zxasm` / `spectral-asm`.
- Labels, expressions, directives, includes, macros, conditionals, and SLD-like
  symbol output.
- Compatibility with the current toolkit templates, recipes, and examples.

## Stack

- Language: TypeScript.
- Package manager: pnpm.
- Build: tsup.
- Tests: Vitest.
- Important dependency: `commander`.

## Important commands

```bash
pnpm --filter @zx-vibes/asm build
pnpm --filter @zx-vibes/asm typecheck
pnpm --filter @zx-vibes/asm lint
pnpm --filter @zx-vibes/asm test
```

## Important files or directories

- `packages/asm/src/assembler.ts`
- `packages/asm/src/disasm.ts`
- `packages/asm/src/cli.ts`
- `packages/asm/src/index.ts`
- `packages/asm/tests/`

## External dependencies

- No runtime service dependencies.
- `sjasmplus` may be present on PATH for compatibility comparison workflows,
  but unsupported syntax should fail clearly rather than silently misassemble.

## Known gotchas

- Read root `AGENTS.md`, `.harness/state.md`, `.harness/map.md`, and this area
  file before editing this area.
- Do not claim broad sjasmplus compatibility unless tests or fixtures prove it.
- The assembler is intentionally focused on the current zx-vibes/Spectral
  corpus before full sjasmplus coverage.
- Diagnostics are part of product behavior; prefer clear user-facing errors.

## Validation expectations

- Run `pnpm --filter @zx-vibes/asm test` for assembler behavior changes.
- If emitted output affects toolkit recipes/templates/examples, also run the
  relevant toolkit tests and consider root `pnpm run verify`.

## Recent area notes

- Root harness initialized this area on 2026-06-14.
