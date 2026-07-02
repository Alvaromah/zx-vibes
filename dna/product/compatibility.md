# Compatibility & Public Surface

The frozen npm/runtime surface of zx-vibes: published package names, bins,
runtime requirements, and the hard compatibility constraints. Contract-tier —
these are the names consumers depend on.

## Runtime

- [id: COMPAT-RUNTIME-001] All published packages are ESM (`"type": "module"`) and require Node.js >= 20. [provenance: contract]

## Published packages & bins

- [id: COMPAT-PKG-EMU-001] The emulator ships as a library family: `@zx-vibes/cpu` (Z80 core), `@zx-vibes/ula` (ULA timing), and `@zx-vibes/machine` (the integrated 48K face); `machine` is the integrated entry consuming `cpu` + `ula`. No bin. [provenance: decision:ADR-0014]
- [id: COMPAT-PKG-ASM-001] `@zx-vibes/asm` is the assembler/disassembler; it exposes `zxasm` as the canonical bin and `spectral-asm` as a compatibility alias (both the same entry). [provenance: contract]
- [id: COMPAT-PKG-TOOLKIT-001] `@zx-vibes/toolkit` is the orchestration toolkit; it exposes the bins `zxs`, `zxs-mcp`, and `zx-vibes`. [provenance: contract]
- [id: COMPAT-PKG-CREATE-001] `create-zx-vibes` is the scaffolder; it exposes the `create-zx-vibes` bin (used as `npm create zx-vibes`). [provenance: contract]
- [id: COMPAT-PKG-UMBRELLA-001] `zx-vibes` is the umbrella package aggregating the toolkit bins: `zx-vibes`, `zxs`, `zxs-mcp`, and `zxasm` (the assembler bin delegates to `@zx-vibes/asm`). [provenance: contract]
- [id: COMPAT-PKG-LEGACY-001] `@zx-vibes/emulator` is the **legacy** monolithic emulator package, superseded by the `cpu`/`ula`/`machine` family and scheduled for deletion at the Phase-5 cutover; it is not part of the frozen forward surface. [provenance: decision:ADR-0014]

## Version surface

- [id: COMPAT-VER-001] The public version surface is kept consistent across the umbrella and its bins/packages by the `check:versions` gate (`scripts/check-version-consistency.js`); individual library versions may differ but the advertised `zx-vibes` surface is unified. [provenance: contract]

## Hard constraints

- [id: COMPAT-Z80-001] Snapshot support targets the **48K** machine only: `.z80` v1/v2/v3 are read/written under the 48K page constraint (`snapshot-z80.md`); 128K-only snapshots are out of scope. [provenance: contract]
- [id: COMPAT-ASM-001] The embedded `spectral` assembler is the default and needs no external tool; `sjasmplus` is an **optional** external backend, required only for projects that intentionally use syntax outside the embedded assembler. [provenance: contract]
- [id: COMPAT-ROM-001] The 48K ROM is shipped as licensed binary data (16384 bytes), not specified byte-for-byte by the DNA; `doctor` checks its presence and size. [provenance: contract]

## Degrees of freedom

- [id: COMPAT-FREE-001] Exact published version numbers, changeset cadence, and internal (non-`@zx-vibes`-public) module paths are Incidental; only the package names, bins, runtime floor, and the constraints above are frozen. [provenance: decision:ADR-0001]

## Provenance

- Package/bin names and the runtime floor are `contract` (grounded in the
  workspace `package.json` surface); the emulator lib-family and legacy-package
  status are `decision:ADR-0014`. No `UNKNOWN`. Cross-references: `overview.md`
  (products), `cli.md` / `assembler.md` (the bins' surfaces), `snapshot-z80.md`
  (the 48K `.z80` constraint).
