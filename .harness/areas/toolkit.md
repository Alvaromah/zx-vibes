# toolkit

Last updated: 2026-06-14

## Paths

- `packages/toolkit/`

## Role

Main implementation package for the `zxs` CLI, `zxs-mcp` MCP server, and
agent feedback loop.

## Owns

- CLI entrypoints and command implementations.
- MCP server tools and stdio behavior.
- Core runtime/session state, machine wrapper, run loop, debug, input, screen,
  symbol, trace, and detection logic.
- Recipes, examples, preview server behavior, toolkit docs, toolkit gallery
  assets, and package tests.

## Stack

- Language: TypeScript.
- Package manager: pnpm.
- Build: tsup.
- Tests: Vitest.
- Important dependencies: `@zx-vibes/asm`, `@zx-vibes/emulator`,
  `@modelcontextprotocol/sdk`, `commander`, `pngjs`, `zod`.

## Important commands

```bash
pnpm --filter @zx-vibes/toolkit build
pnpm --filter @zx-vibes/toolkit typecheck
pnpm --filter @zx-vibes/toolkit lint
pnpm --filter @zx-vibes/toolkit test
```

Use root `pnpm run verify` when toolkit changes alter package contracts,
generated assets, CLI bins, MCP behavior, emulator integration, or assembler
integration.

## Important files or directories

- `packages/toolkit/src/cli/index.ts`
- `packages/toolkit/src/cli/commands/`
- `packages/toolkit/src/mcp/server.ts`
- `packages/toolkit/src/core/machine.ts`
- `packages/toolkit/src/core/run-loop.ts`
- `packages/toolkit/src/types/zx-generation.d.ts`
- `packages/toolkit/tests/`
- `packages/toolkit/recipes/`
- `packages/toolkit/examples/`
- `packages/toolkit/templates/`
- `packages/toolkit/gallery/`

## External dependencies

- Local workspace packages: `@zx-vibes/asm` and `@zx-vibes/emulator`.
- MCP protocol surface through `@modelcontextprotocol/sdk`.
- Optional external `sjasmplus` binary for compatibility workflows.

## Known gotchas

- Read root `AGENTS.md`, `.harness/state.md`, `.harness/map.md`, and this area
  file before editing this area.
- Deep emulator imports are intentional but sensitive; see local instructions
  before changing `machine.ts` or type declarations.
- CLI commands should preserve one JSON document under `--json` and stable exit
  codes.
- Runtime determinism matters; avoid wall-clock time or randomness in core loop
  code.
- Golden PNG updates are deliberate: use `UPDATE_GOLDEN=1` only when expected.

## Validation expectations

- Small command change: run the focused toolkit test or `pnpm --filter
  @zx-vibes/toolkit test`.
- Core runtime, MCP, assembler integration, or package contract change: run
  toolkit build/typecheck/lint/test and consider root `pnpm run verify`.
- Template/docs/gallery changes in this package may also involve
  `scaffolding`, `reference-docs`, or `gallery`.

## Recent area notes

- 2026-06-14: P1-1 updated `zxs new` to install generated project
  dependencies by default, added `--no-install`, and adjusted scaffold tests.
- Root harness initialized this area on 2026-06-14.
