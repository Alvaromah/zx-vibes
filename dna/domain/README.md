# Domain

Self-contained, normative technical reference for the hardware and standard
formats. Truth comes from external standards, **rewritten by us** so no normative
claim depends on an external PDF (constraint C2).

Authoring rules (`../../specs-plan.md` §5.1):

- MUST be self-contained and normative.
- MUST be machine-readable where tabular (`.yaml` next to `.md`).
- MUST tag every claim with `provenance`.
- MUST NOT be considered done until a `conformance/` fixture covers it.
- MAY mine the oracle code as a curation cross-check; resolved ambiguities become
  `decision:<id>` or `UNKNOWN`, never silent defaults.

Planned files:

```text
z80-cpu.md            registers, flags, interrupt modes, timing model
z80-opcodes.{md,yaml} full table: base/CB/ED/DD/FD/DDCB/FDCB, T-states, flags
z80-undocumented.md   undocumented opcodes/flags, MEMPTR/WZ, Q, R behavior
ula-timing.{md,yaml}  frame=69888T, 224T/line x 312 lines, ~50.08Hz, INT=32T
contention.{md,yaml}  contention table + contended range + first-contended T
memory-map.md         ROM/RAM layout, screen + attribute address mapping
rom-entry-points.md   addresses + register contracts for used ROM routines
file-formats.md       byte-level .sna / .z80 v1-v3 / .tap / .tzx layouts
```

Realized: `memory-map.md` (W10.1/W10.2), and `file-formats.md` — being authored slice
by slice (W10.4 added `.scr`, W10.6 added `.tap`; `.tzx` joins in W10.7; `.z80`/`.sna`
byte layouts live in `snapshot-z80.md`).
