# File Formats (cross-link)

The index of every file format zx-vibes reads or writes, pointing to its
authoritative spec and stating its tier. This file fixes the *map*; the byte-level
detail lives in the cited specs (it does not restate them).

## Snapshot & tape (domain byte layouts)

- [id: FF-Z80-001] `.z80` (v1/v2/v3, 48K) — byte layout, header offsets, the PC=0 v2/v3 marker, page blocks + RLE: authoritative in `../domain/snapshot-z80.md`; round-trip + decode fixtures in `../conformance/formats/`. Tier contract/fidelity. [provenance: contract]
- [id: FF-SNA-001] `.sna` (48K) — registers + 48K RAM image: `../domain/snapshot-z80.md` (snapshot family). Tier contract. [provenance: contract]
- [id: FF-TAPE-001] `.tap` — tape image the toolkit inserts/plays (`run --tap`, `play`): byte layout authoritative in `../domain/file-formats.md` (`FMT-TAP-*` — block stream `[len:2 LE][flag][data][XOR checksum]`); parse/serialize/round-trip + malformed-rejection fixtures in `../conformance/formats/tap-format.json` (`FORMAT-TAP-001`). Product behavior in `cli.md`. Tier contract. [provenance: contract]
- [id: FF-TZX-001] `.tzx` — tape image with typed blocks (timing, pauses): product behavior in `cli.md`; byte layout authored next (`../domain/file-formats.md`, roadmap W10.7, `FORMAT-TZX-001`). Tier contract for the load/play surface. [provenance: contract]
- [id: FF-SCR-001] `.scr` (6912-byte raw screen dump) — a headerless copy of memory `0x4000`–`0x5AFF` (6144 display + 768 attribute): byte layout authoritative in `../domain/file-formats.md` (`FMT-SCR-*`); load/save + round-trip fixtures in `../conformance/formats/scr-format.json` (`FORMAT-SCR-001`). It is byte-identical to the `SCREEN-FRAMEBUFFER-001` screen image (`screen-render.md`). Tier contract. [provenance: hardware]

## Build artifacts (assembler)

- [id: FF-BIN-001] Raw assembled binary (`.bin`) + `SAVEBIN` artifacts: produced by `@zx-vibes/asm` (`assembler.md` ASM-PROD-OUTPUT-*, SAVEBIN-*). Tier contract. [provenance: contract]
- [id: FF-SLD-001] SLD source-level-debug data (`|SLD.data.version|1`, symbol + source-line records, 48K page metadata): `assembler.md` (ASM-PROD-OUTPUT-002..004); consumed by `zxs` `break`/`disasm`/`trace`. Tier contract. [provenance: contract]

## Toolkit / project (product files)

- [id: FF-CONFIG-001] `zx.config.json` — the project config: authoritative in `config-schema.md` (7 fields, defaults, precedence). Tier contract. [provenance: contract]
- [id: FF-ZXSTATE-001] `.zxstate` (the session machine at `.zxs/state.zxstate`) — persisted/restored by `zxs state` and shared with `zxs-mcp`: the *interop* (CLI↔MCP, round-trip, `.z80` export) is contract (`cli.md` CLI-PROD-STATE-001, `mcp-tools.md` MCP-PROD-RULE-INTEROP-001); the **on-disk byte layout is Incidental** (implementer's choice) unless a consumer needs it pinned, in which case author `zxstate-format.md`. [provenance: contract]
- [id: FF-PREVIEW-001] `.zxs/preview-server.json` — the preview server record (`{ pid, port, url, token, owner }`): the owned fields are contract (`toolkit-runtime.md` RT-PROD-PREVIEW-003); the full byte layout is Incidental. [provenance: contract]

## Rules

- [id: FF-RULE-001] A format's authority is exactly one spec; this index never restates byte layouts, so it cannot drift from them. Snapshot/tape/binary layouts are domain/assembler authority; project files (`zx.config.json`, `.zxstate`) are product authority. [provenance: contract]

## Provenance

- All entries are `contract` (the format map / tier assignment). Byte-level
  provenance is carried by the cited specs (`../domain/file-formats.md` for
  `.scr`/`.tap`, `../domain/snapshot-z80.md`, `assembler.md`, `config-schema.md`).
  The `.zxstate`/`preview-server.json` byte layouts are explicitly Incidental. No
  `UNKNOWN`.
