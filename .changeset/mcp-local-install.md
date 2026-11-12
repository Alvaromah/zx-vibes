---
"@zx-vibes/toolkit": minor
"zx-vibes": minor
---

Make the MCP server start for a project-local install, and let `doctor` catch a
registration that cannot.

- `zxs setup` registers the server for the install that runs it. A global install
  keeps the bare `zxs-mcp`. A project-local install (the six tarballs, or
  `npm install zx-vibes` in the project) has its bins only in `node_modules/.bin`,
  which an agent's PATH lacks, so it now registers
  `node node_modules/@zx-vibes/toolkit/bin/zxs-mcp.js` (`.mcp.json` and the Codex
  `config.toml`; the global Codex config gets an absolute path). The `setup`
  envelope reports it as `mcpCommand`.
- An existing `zx-vibes` entry is still kept without `--force`; when it starts
  something else, `setup` now leads its `next` steps with the `--force` command.
- `zxs doctor` has a new `mcp-command` check: it resolves the project's registration
  against the PATH an agent sees (without npx's `node_modules/.bin`) and fails with the
  fix, `zxs setup --agent <agent> --force`. A project with no registration passes.
  Before, `npx zxs doctor` passed while the agent could not start `zxs-mcp`.
