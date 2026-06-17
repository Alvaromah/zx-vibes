# Create a Project

Create a small game project from npm:

```bash
pnpm create zx-vibes my-game --template game
cd my-game
```

Use the `platformer` template when you want a larger starting point with more
game structure:

```bash
pnpm create zx-vibes my-platformer --template platformer
cd my-platformer
```

## Templates

- `game`: a compact starter for arcade games, experiments, and small programs.
- `platformer`: a larger starter with more game-shaped structure.

Both templates are designed to work with the embedded `@zx-vibes/asm`
assembler by default.

## Generated Files

Both templates create the same project contract:

- `src/main.asm` is the main Z80 assembly entry point.
- `lib/` contains helper routines for screen, attributes, sprites, and input.
- `tests/smoke.test.json` contains declarative verification checks.
- `zx.config.json` tells `zxs build` what to assemble and where to output it.
- `package.json` contains shortcuts such as `npm run build`,
  `npm run screen`, `npm run verify`, and `npm run preview`.
- `AGENTS.md` and `CLAUDE.md` contain the project-local agent playbook.
- `.mcp.json` contains Claude-compatible MCP configuration.
- `docs/agents/codex-mcp.toml` contains Codex MCP configuration.
- `docs/reference/` contains local ZX Spectrum implementation notes.
- `docs/agents/skills/` contains local topic skills for coding agents.

The starter package metadata uses a `zx-vibes` dev dependency floor that
resolves to the current compatible patch release during normal installs.

## Install Behavior

Dependencies install by default. For offline work or local package testing,
skip installation:

```bash
pnpm create zx-vibes my-game --template game --no-install
cd my-game
npm install
```

The CLI also accepts `--install` explicitly, but install is already the
default.

## First Health Check

After dependencies are installed, run:

```bash
npm run doctor
```

If you installed `zxs` globally, this direct form is also fine:

```bash
zxs doctor
```

Fix missing dependency or environment issues before writing game code. A clean
doctor run makes later build and MCP errors much easier to interpret.
