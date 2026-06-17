# create-zx-vibes

Project generator for zx-vibes ZX Spectrum 48K agent projects.

Current package version in this repository: `0.2.0`.

## Usage

```bash
pnpm create zx-vibes my-game --template game
cd my-game
npm run build
npm run verify
npm run preview
```

Available templates:

- `game`
- `platformer`

Dependencies install by default. Use `--no-install` for offline work or when
testing an unpublished local checkout:

```bash
pnpm create zx-vibes my-platformer --template platformer --no-install
```

The CLI also accepts `--install` explicitly, but it is already the default.

## Generated Project Contract

Generated projects include:

- `src/main.asm` as the assembler entry point.
- `lib/` helpers for screen and keyboard routines.
- `tests/smoke.test.json` declarative verification.
- `zx.config.json` build configuration.
- npm scripts for `build`, `run`, `test`, `verify`, and `preview`.
- `AGENTS.md` and `CLAUDE.md` generated from the shared agent playbook.
- `.mcp.json` for Claude-compatible MCP clients.
- `docs/agents/codex-mcp.toml` for Codex MCP configuration.
- local `docs/reference/` and `docs/agents/skills/` copies.

Starter package metadata currently uses a `zx-vibes` dev dependency floor of
`^0.1.3`, which resolves to the latest compatible patch release during normal
installs.

## Relationship To `zxs new`

`create-zx-vibes` and `zxs new` intentionally create the same project contract:
default install, `--no-install`, MCP config files, local reference docs, local
agent skills, and the same starter templates.

## Development

From the repository root:

```bash
pnpm --filter create-zx-vibes build
pnpm --filter create-zx-vibes typecheck
pnpm --filter create-zx-vibes lint
pnpm --filter create-zx-vibes test
pnpm --filter create-zx-vibes run check:assets
```

`check:assets` verifies that the package copy of root `starters/` and `docs/`
has not drifted.

## License

MIT. Generated projects depend on `zx-vibes`, whose emulator dependency includes
a ZX Spectrum 48K ROM under the separate notice in the emulator package's
`rom/README.md`.
