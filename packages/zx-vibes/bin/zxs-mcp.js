#!/usr/bin/env node
// zx-vibes umbrella `zxs-mcp` MCP stdio entry — delegates to the @zx-vibes/toolkit v2 barrel.
import { runMcp } from '@zx-vibes/toolkit';

runMcp().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
