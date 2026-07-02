#!/usr/bin/env node
// `zxs-mcp` MCP stdio server entry (mcp-tools.md MCP-PROD-SERVER-001/002).
// Starts the persistent in-memory ZX Spectrum session and serves the seven tools
// (`zx_build`, `zx_run`, `zx_screen`, `zx_inspect`, `zx_debug`, `zx_keys`, `zx_state`)
// over stdio. The transport keeps the process alive on stdin and exits cleanly when
// the client disconnects; a failure to start surfaces on stderr (errors.md
// ERR-PROD-NOSILENT-001), never on stdout (which is the protocol channel).
import { runMcp } from '../dist/mcp.js';

runMcp().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
