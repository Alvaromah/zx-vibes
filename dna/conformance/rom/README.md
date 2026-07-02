# ROM artifact registry

This directory pins the canonical **ZX Spectrum 48K ROM** as an *opaque* artifact
(ADR-0024). It is intentionally outside the fixture directories (`cpu/`, `formats/`,
…) so the bootstrap fixture runner does not treat the manifest or the binary blob as
an executable conformance fixture.

## Contents

- `spectrum-48k.rom` — the 16384-byte ROM blob, mapped by the machine at
  `0x0000`–`0x3FFF`. DNA-owned copy (so the conformance layer does not depend on the
  legacy `packages/emulator` or any product), `binary` per `.gitattributes`.
- `spectrum-48k-rom.manifest.json` — pins the artifact's identity: size, sha256,
  license/source, the `0x0000`–`0x3FFF` mapping, and the only referenced entry point
  (`LD-BYTES` `0x0556`, used by the tape edge-load slice W10.10). Provenance
  `decision:ADR-0024`.

## Checking

`run-rom-fixtures.mjs` loads the manifest, re-hashes the vendored blob and asserts its
size + sha256 match, that the mapping spans exactly `bytes` addresses, and that the
referenced entry point lies inside the ROM. This is what flips `ROM-ARTIFACT-001` to
`covered`. `run-rom-fixtures-self-test.mjs` is the guard: it confirms the real
manifest passes and that a tampered blob, a wrong declared size, or a missing blob are
each rejected.

## Opacity and licensing

The ROM is **opaque**: the DNA pins *which* ROM (so a regeneration is byte-identical)
but specifies **no** ROM-routine behaviour — there is no `rom-entry-points.md`, and the
machine simply maps and executes the blob (ADR-0024). The ROM is copyright Amstrad plc,
redistributed by their kind permission; the notice in the manifest must be retained.
Per ADR-0024, published package tarballs should resolve the ROM from a user path rather
than vendoring it — this copy exists for the conformance layer (the W10.10 tape
edge-load integration oracle) and this identity check only.
