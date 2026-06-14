# Decisions

Important accepted, rejected, superseded, or reverted decisions that should not
be rediscovered repeatedly.

Use this file for architecture decisions, rejected approaches, reverted
implementations, chosen libraries or patterns, and important trade-offs.

## 2026-06-14 - Root harness uses package/product boundaries

Status: accepted

Areas:

- distribution
- toolkit
- assembler
- emulator
- scaffolding
- reference-docs
- gallery

Context:
The bundled inspector only scans top-level directories. For this repository it
initially classified `gallery/` and `packages/` as the only areas, with
`packages/` normalized to `shared`.

Decision:
The root harness uses seven operational areas based on publishable packages and
product surfaces: `toolkit`, `assembler`, `emulator`, `scaffolding`,
`reference-docs`, `gallery`, and `distribution`.

Reason:
The real maintenance boundaries are the pnpm packages and copied product
assets. Collapsing `packages/*` into one area hides ownership, commands,
dependencies, and validation requirements.

Consequences:

- Future harness refreshes should preserve this custom map unless the monorepo
  structure changes materially.
- `gallery/`, `docs/`, and `starters/` remain product surfaces even though only
  `packages/*` is in `pnpm-workspace.yaml`.

Supersedes:
- Raw top-level inspector output for area selection.

Superseded by:
- None.

Related tasks:
- None.

## 2026-06-14 - Preserve toolkit runtime invariants in root harness

Status: accepted

Areas:

- toolkit
- emulator
- assembler

Context:
The toolkit has local runtime constraints around the run loop, deep imports,
exit codes, JSON output, frame boundaries, and optional sjasmplus compatibility.
Package-level `AGENTS.md` files were removed so the repository has a single root
agent entry point.

Decision:
Record durable toolkit constraints in the root harness, especially
`.harness/areas/toolkit.md` and this decision log.

Reason:
The toolkit is the integration point between assembler, emulator, CLI, MCP, and
agent feedback loops. Small changes can break determinism or machine-readable
tool behavior.

Consequences:

- Read `.harness/areas/toolkit.md` before toolkit work.
- Prefer focused package validation plus root verification when behavior crosses
  package boundaries.
- Keep any future expanded rationale in the root harness rather than
  package-level `AGENTS.md` files.

Supersedes:
- None.

Superseded by:
- None.

Related tasks:
- None.
