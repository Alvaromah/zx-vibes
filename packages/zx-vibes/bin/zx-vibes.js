#!/usr/bin/env node
// zx-vibes umbrella `zx-vibes` CLI alias — delegates to the @zx-vibes/toolkit v2 barrel.
import { runCli } from '@zx-vibes/toolkit';

runCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`fatal: ${error?.message ?? String(error)}\n`);
    process.exit(1);
  },
);
