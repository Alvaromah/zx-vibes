#!/usr/bin/env node
// `zxs` (and its `zx-vibes` alias) CLI entry — cli.md CLI-PROD-PKG-002.
import { runCli } from '../dist/cli.js';

runCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`fatal: ${error?.message ?? String(error)}\n`);
    process.exit(1);
  },
);
