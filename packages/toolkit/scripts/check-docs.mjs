#!/usr/bin/env node
// Documentation-drift check for @zx-vibes/toolkit.
//
// The repo-root `check:drift` aggregate invokes
// `pnpm --filter @zx-vibes/toolkit run check:docs`, so this entry MUST exist and
// exit 0 for the root drift gate to pass.
//
// TODO(slice-11+): once the generated AGENTS.md/CLAUDE.md playbook and the CLI
// reference docs land (zxs init / setup), assert here that the committed docs
// match the live command surface (no drift). For now it is an intentional
// placeholder that always passes.
process.exit(0);
