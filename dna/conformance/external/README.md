# External Suite Registry

This directory contains pinned manifests for third-party conformance suites.
They are not fixture JSON files and are intentionally outside `cpu/` and
`timing/` so the bootstrap fixture runner does not confuse source metadata with
executable conformance fixtures.

The manifests record source repository, commit, license, artifact path, byte
size, SHA-256, and current execution status. A manifest with
`execution.status: "manifest-only"` proves source identity only. It does not
cover CPU or timing fidelity rows until an executable adapter runs the suite and
reports pass/fail.

The adapter runners live outside this directory:

- `../cpu/run-zex.mjs` runs `zexdoc` / `zexall` manifests through a CPU adapter.
- `../timing/run-fuse-z80.mjs` runs the FUSE Z80 test manifest through a timing
  adapter.

Both runners report pass/fail/not-run with stable exit codes. They still depend
on a real reference adapter and suite payload resolver before their candidate
fidelity rows can move to `covered`.

`../external-payloads.mjs` resolves non-vendored artifacts into the untracked
repo cache `.cache/external-suites/` from the pinned git commit and verifies
their byte size and SHA-256. The runners pass those verified local paths to
adapters only when invoked with `--resolve-payloads`.

The FUSE Z80 manifest has a reference adapter at
`../timing/fuse-z80-reference-adapter.mjs`. It validates the external
`tests.in` / `tests.expected` transcript as executable reference data. CPU
zexdoc/zexall still need a CP/M/Z80 reference adapter before their manifests are
executable.

The CPU side has a CP/M monitor at `../cpu/zex-cpm-cpu-adapter.mjs`, driven by
the regenerated `@zx-vibes/cpu` core (the legacy-oracle variant was removed with
the legacy emulator package). It proves the runner can execute COM-style zex
payloads and classify the zex console transcript, but it is not enough by itself
to move zexdoc/zexall fidelity rows to `covered`; those rows require a completed
run through an accepted CPU reference.
