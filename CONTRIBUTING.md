# Contributing to zx-vibes

Thanks for your interest in contributing! The project is still early, and
contributions are welcome.

## Prerequisites

- Node.js 20 or newer
- [pnpm](https://pnpm.io) 10 (the repo pins `pnpm@10.34.3` via `packageManager`)

## Getting started

```bash
git clone https://github.com/Alvaromah/zx-vibes.git
cd zx-vibes
pnpm install
pnpm run verify
```

`pnpm run verify` is the full local gate: drift checks, the executable
conformance suite (`dna/`), build, typecheck, lint, and tests. CI runs the same
gate on Ubuntu, macOS, and Windows across Node 20 and 22 — if `verify` is green
locally, CI should be green too.

## Making changes

- **Behavior is pinned by `dna/`.** The conformance suite is the source of
  truth: a change that alters emulator/assembler/CLI behavior needs a matching
  fixture or spec update in `dna/`, with `tier` and `provenance` metadata.
  See [`dna/README.md`](dna/README.md).
- **Generated files are drift-checked.** If you touch
  `dna/domain/z80-opcodes.yaml`, regenerate with
  `pnpm run gen:opcode-table`; `check:drift` fails on any mismatch.
- Keep starter projects compatible with the embedded assembler unless the
  change is explicitly about optional `sjasmplus` support.
- Match the surrounding code style; `pnpm run lint` must pass with no warnings.

## Submitting a pull request

1. Fork and create a topic branch from `main`.
2. Run `pnpm run verify` and `pnpm run pack` before opening the PR.
3. If your change affects a published package, add a changeset:
   `pnpm changeset` (releases are made with Changesets from `main`).
4. Describe *what* changed and *why*; link any related issue.

## Reporting bugs

Open an issue with reproduction steps. For emulator fidelity issues, an exact
program (assembly or `.tap`/`.z80` produced by the toolkit) plus expected vs.
actual behavior is ideal. Please don't attach copyrighted commercial software.

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities privately.
