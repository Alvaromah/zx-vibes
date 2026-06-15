# distribution

Last updated: 2026-06-14

## Paths

- Repository root
- `.github/`
- `.changeset/`
- `scripts/`
- `packages/zx-vibes/`

## Role

Workspace orchestration, package metadata, CI/release automation, and umbrella
package/bin shims.

## Owns

- Root pnpm scripts and workspace layout.
- Lockfile and package manager metadata.
- GitHub Actions for CI, Pages, and release.
- Changesets and npm publish flow.
- `zx-vibes` umbrella package that exposes user-facing bin names.
- Shared repo tooling such as ESLint and shebang repair.

## Stack

- Languages: TypeScript, JavaScript, YAML.
- Package manager: pnpm 10.34.3 in root metadata.
- Runtime target: Node.js >=20.
- Release tooling: changesets.

## Important commands

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run pack
pnpm run verify
```

## Important files or directories

- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `eslint.config.mjs`
- `.github/workflows/ci.yml`
- `.github/workflows/pages.yml`
- `.github/workflows/release.yml`
- `.changeset/`
- `scripts/ensure-shebang.js`
- `packages/zx-vibes/package.json`
- `packages/zx-vibes/bin/`

## External dependencies

- GitHub Actions.
- GitHub Pages.
- npm registry and `NPM_TOKEN` for publish workflows.

## Known gotchas

- `pnpm-workspace.yaml` includes only `packages/*`; root assets still matter
  for generator, docs, and gallery workflows.
- `pnpm run pack` writes tarballs to `.packs/`; packed `workspace:*`
  dependencies resolve like normal registry dependencies.
- `packages/zx-vibes` is mostly bin shims over toolkit/asm, not the main
  implementation.
- Windows CI is part of the matrix; avoid shell-specific assumptions in scripts.

## Validation expectations

- For root workflow/package/script changes, run the narrow affected command and
  prefer root `pnpm run verify` before closure.
- For release or package metadata changes, consider `pnpm run pack`.
- For bin shim changes, validate `packages/zx-vibes` plus the package it
  delegates to.

## Recent area notes

- 2026-06-15: T-20260615-01 added changeset
  `.changeset/feedback-toolkit-improvements.md`; root `pnpm run verify`
  passed after cross-package toolkit/docs/scaffold changes.
- 2026-06-14: T-20260614-02 updated toolkit package metadata so
  `@zx-vibes/toolkit` ships `docs/agents` and added package-level docs
  sync/check scripts.
- 2026-06-14: P1-1 added `.changeset/runnable-zxs-new.md` for the
  user-facing scaffold behavior change and documented local checkout smoke
  usage in the root README.
- Root harness initialized this area on 2026-06-14.
