# MCP

MCP is optional. Without MCP, Codex or Claude Code can still run the local CLI
commands in a terminal.

Use MCP when you want the agent to call structured build, run, screen, inspect,
debug, keyboard, and state tools over stdio.

## Generated Configuration

Generated projects already include MCP snippets:

- Claude-compatible clients: `.mcp.json`
- Codex: `docs/agents/codex-mcp.toml`

The generated config runs the MCP server through the project-local install:

```bash
pnpm exec zxs-mcp
```

You normally do not type that command during regular use. It is there so MCP
clients start the same server version that the project installed.

For Claude-compatible clients, the generated `.mcp.json` shape is:

```json
{
  "mcpServers": {
    "zx_vibes": {
      "command": "pnpm",
      "args": ["exec", "zxs-mcp"]
    }
  }
}
```

For Codex, the generated TOML shape is:

```toml
[mcp_servers.zx_vibes]
command = "pnpm"
args = ["exec", "zxs-mcp"]
startup_timeout_sec = 30
tool_timeout_sec = 300
```

## Regenerate Snippets

You can regenerate snippets from inside a project:

```bash
zxs setup --agent codex
zxs setup --agent claude
```

Codex users can ask `zxs` to append the global config with a backup:

```bash
zxs setup --agent codex --write-global
```

Start the agent from the generated project root so `pnpm exec zxs-mcp` resolves
the local `zx-vibes` dependency and the MCP tools operate on the right project.

If you did not install `zxs` globally, regenerate snippets with the project
script instead:

```bash
npm run zxs -- setup --agent codex
```

## When MCP Fails to Start

Check the server directly before debugging the agent:

```bash
pnpm exec zxs-mcp
```

If that command is not found, install dependencies in the generated project. If
it starts from the terminal but not from the agent, check that the agent was
opened in the project root and that the config snippet still uses `pnpm exec`.
