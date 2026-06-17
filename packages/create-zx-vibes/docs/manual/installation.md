# Installation

Install these before creating a project:

- Node.js 20 or newer.
- pnpm, recommended for project creation and MCP server execution.
- A terminal in the directory where you want to create the project.
- Optional: Codex, Claude Code, or another coding agent.

Check the basics:

```bash
node --version
pnpm --version
```

The generator installs dependencies inside new projects by default. The
generated package scripts use npm, so you can keep using npm after creation even
if you used pnpm to scaffold the project.

## The Simple Mental Model

`zxs` is the program. It is the zx-vibes command-line tool.

In a generated project, the common commands are already saved as project
scripts:

```bash
npm run doctor
npm run build
npm run run
npm run screen
npm test
npm run verify
npm run preview
```

Those scripts call the project's own copy of `zxs`, so you do not need to type
a long prefix for the normal loop.

If you prefer the classic "install a program once and call it from the shell"
model, install zx-vibes globally:

```bash
npm install -g zx-vibes
```

Then you can type direct commands:

```bash
zxs doctor
zxs build
zxs verify
zxs preview
```

The trade-off is simple: global `zxs` is convenient, project scripts are more
reproducible. If both are installed, `npm run build` still uses the project's
own copy.

For an advanced one-off command where there is no script, use direct `zxs ...`
if you installed it globally, or this project-local form:

```bash
npm run zxs -- regs
npm run zxs -- trace --frames 5
```

## Create Command

The recommended create command is:

```bash
pnpm create zx-vibes my-game --template game
```

## Optional Agent Setup

No agent is required. zx-vibes works as a normal command-line toolkit.

If you plan to use Codex or Claude Code, start the agent from the generated
project root. That lets the agent read the project-local `AGENTS.md`,
`CLAUDE.md`, `docs/reference/`, and `docs/agents/skills/` files, and it lets
local commands resolve the installed `zx-vibes` dependency.
