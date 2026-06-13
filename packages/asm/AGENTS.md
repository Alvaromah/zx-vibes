# Agent Instructions - @zx-vibes/asm

This repository owns the Spectral-oriented Z80 assembler/disassembler package.

## Scope

- Keep the MVP focused on Spectral templates, recipes, examples, and generated
  48K game projects.
- Do not claim full sjasmplus compatibility unless a fixture proves it.
- Unsupported syntax should produce a clear diagnostic instead of silently
  emitting bytes.
- Preserve byte-for-byte compatibility with sjasmplus for the current Spectral
  corpus.

## Commands

```bash
npm run build
npm run typecheck
npm test
npm audit --audit-level=high
```

## Validation

For assembler changes, run `npm test`. The compatibility test compares the
current Spectral corpus against `sjasmplus` when it is available on PATH.
