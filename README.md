# zx-vibes

ZX Spectrum vibe coding in one monorepo: emulator, Z80 assembler/disassembler,
agent toolkit, MCP server, starters, and a create package.

## Quick Start

```bash
pnpm create zx-vibes my-platformer --template platformer
cd my-platformer
codex
```

Then ask Codex:

```text
Create a platform game
Show it in the browser
```

## Packages

- `@zx-vibes/emulator` - JavaScript ZX Spectrum 48K emulator.
- `@zx-vibes/asm` - TypeScript Z80 assembler/disassembler.
- `@zx-vibes/toolkit` - `zxs` CLI and `zxs-mcp` MCP server.
- `zx-vibes` - umbrella package that exposes the user-facing bins.
- `create-zx-vibes` - `pnpm create zx-vibes` project generator.

## Development

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
```
