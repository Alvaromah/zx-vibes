#!/usr/bin/env node
// Documentation-drift check for @zx-vibes/toolkit.
//
// The repo-root `check:drift` aggregate invokes
// `pnpm --filter @zx-vibes/toolkit run check:docs`, so this entry MUST exist and
// exit 0 for the root drift gate to pass.
//
// TODO(W11, knowledge-pack slice): once the generated AGENTS.md/CLAUDE.md
// playbook and the CLI reference docs land (the `setup` knowledge pack tracked
// as DEFERRED_PACK_CONTENT in src/setup/setup.ts), assert here that the
// committed docs match the live command surface (no drift). Until that slice
// this is an intentional placeholder that always passes — it performs no
// checking, so it must not be read as doc-sync confidence.
process.exit(0);
