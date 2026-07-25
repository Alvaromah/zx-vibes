#!/usr/bin/env node
// `zxs` (and its `zx-vibes` alias) CLI entry — cli.md CLI-PROD-PKG-002.
async function loadCli() {
  try {
    return await import('../dist/cli.js');
  } catch (error) {
    const reason = error?.message ?? String(error);
    throw new Error(
      'zxs runtime is incomplete: could not load dist/cli.js. ' +
        'Rebuild this checkout or reinstall @zx-vibes/toolkit. ' +
        `Original error: ${reason}`,
      { cause: error },
    );
  }
}

loadCli().then(
  ({ runCli }) => runCli(process.argv.slice(2)),
).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`fatal: ${error?.message ?? String(error)}\n`);
    process.exit(1);
  },
);
