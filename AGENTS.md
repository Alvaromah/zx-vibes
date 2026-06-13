# Agent Instructions - zx-vibes

Technical content, code, comments, identifiers, and debugging notes should be
written in English by default.

This is a pnpm monorepo. Keep package boundaries clear:

- `packages/emulator` owns ZX Spectrum emulation internals.
- `packages/asm` owns Z80 assembly/disassembly.
- `packages/toolkit` owns the `zxs` CLI, `zxs-mcp`, MCP tools, headless
  machine loop, scaffolding, verification, and preview.
- `packages/create-zx-vibes` owns `pnpm create zx-vibes`.
- `packages/zx-vibes` owns the umbrella package and wrapper bins.

Prefer workspace dependencies (`workspace:*`) for internal packages. Generated
projects should default to the embedded assembler (`spectral`) and keep
`sjasmplus` available as an advanced backend.

Validation for broad changes:

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
```
