---
"@zx-vibes/toolkit": patch
"zx-vibes": patch
---

`zxs setup` names the step each client needs before it starts a project-level server.

- `--agent codex` without `--write-global`: Codex reads `.codex/config.toml` only for a
  trusted project, so `next` says to trust the project in Codex (or rerun with
  `--write-global`). Before, it only said to restart Codex, and `codex mcp list` kept
  showing no `zx-vibes`.
- `--agent claude`: `next` says Claude Code asks you to approve a project MCP server.
