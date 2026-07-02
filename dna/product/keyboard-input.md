# Keyboard Input — matrix read + browser mapping + quick-tap latch

The normative reference for the **keyboard input contract** at the emulator/gallery
seam (S5, R-W8-05): the 48K keyboard **matrix** read through port `0xFE` (the
hardware-truth half-row read the emulator owns,
[`../domain/host-io-port-fe.md`](../domain/host-io-port-fe.md)
HOST-IO-PORTFE-READ-001/-READ-BITS-001), the **browser-key → matrix** mapping the
gallery shell applies (host input policy), and the **quick-tap latch** that keeps a
brief key press visible across at least one 50 Hz scan — the behaviour a consumer's
shell relied on.

Per ADR-0016 the matrix read is `hardware` (the emulator's observable surface); the
browser-key map and the latch are the gallery's host input **policy**
(`decision:ADR-0016`), cross-checked against the oracle (`SPECTRUM_KEYS` /
`PC_KEY_MAP`) but authored from documented behaviour, not copied. It is the domain
oracle for `dna/conformance/keyboard/`.

## The matrix (hardware)

<!-- provenance: hardware -->
- [id: KBD-MATRIX-001] The 48K keyboard is an 8×5 matrix. `IN (0xFE)` reads the
  half-rows selected by the port **high** byte: bit `r` of the high byte LOW selects
  row `r` (`A8`→row 0 … `A15`→row 7). The five key bits are **active-low** (`0` =
  pressed) on bits 0–4, outermost key = bit 0; bits 5 and 7 read `1` and bit 6 is the
  EAR input (HOST-IO-PORTFE-READ-BITS-001). When several rows are selected at once
  (several high-byte bits LOW, e.g. `0x00FE` = "any key") the key bits are the logical
  **AND** across the selected rows, so a key pressed in any selected row reads `0`.
  The matrix:

  | high byte | bit 0 | bit 1 | bit 2 | bit 3 | bit 4 |
  | --- | --- | --- | --- | --- | --- |
  | `0xFE` (row 0) | CAPS SHIFT | Z | X | C | V |
  | `0xFD` (row 1) | A | S | D | F | G |
  | `0xFB` (row 2) | Q | W | E | R | T |
  | `0xF7` (row 3) | 1 | 2 | 3 | 4 | 5 |
  | `0xEF` (row 4) | 0 | 9 | 8 | 7 | 6 |
  | `0xDF` (row 5) | P | O | I | U | Y |
  | `0xBF` (row 6) | ENTER | L | K | J | H |
  | `0x7F` (row 7) | SPACE | SYM SHIFT | M | N | B |

  Reading a row with no key pressed (EAR = 1) returns `0xFF`; pressing CAPS SHIFT and
  reading `0xFE` returns `0xFE`; pressing Z and reading `0xFE` returns `0xFD`. A key
  pressed in a row that is **not** selected does not appear (e.g. Z pressed, reading
  `0xFD`, returns `0xFF`).

## Browser-key mapping (host policy)

<!-- provenance: decision:ADR-0016 -->
- [id: KBD-BROWSERMAP-001] The gallery shell maps a browser `KeyboardEvent.key` to one
  or more Spectrum matrix keys. **Letters and digits** map directly and
  case-insensitively (`"z"` / `"Z"` → Z; `"5"` → the `5` key). **Named keys** map per
  the host policy: `Enter` → ENTER, `" "` (space) → SPACE, `Shift` → CAPS SHIFT,
  `Control` → SYMBOL SHIFT. **Combinations** use CAPS SHIFT + a digit, matching the
  Spectrum's own shifted keys: the **cursor keys** `ArrowLeft/Down/Up/Right` →
  CAPS SHIFT + `5/6/7/8`, `Backspace`/`Delete` → CAPS SHIFT + `0` (DELETE),
  `Escape` → CAPS SHIFT + SPACE (BREAK). An unmapped key maps to no Spectrum key. This
  is a host input choice (`decision:ADR-0016`), cross-checked against the oracle
  `PC_KEY_MAP`; a shell may rebind it, but this is the conformed default.

## Quick-tap latch (host policy)

<!-- provenance: decision:ADR-0016 -->
- [id: KBD-LATCH-001] The ROM (and most games) scan the keyboard **once per 50 Hz
  frame**. A key that is pressed **and released between two scans** would be missed if
  the matrix simply followed the live up/down events. The contract: a key released
  **before any scan has observed it pressed** is **latched** as pressed for **exactly
  one** subsequent scan, then released — so a quick tap is always seen by at least one
  keyboard scan. A key **held across a scan** is released immediately on key-up (it has
  already been seen). Two quick taps before a scan are both latched and both visible on
  that one scan. **A `keyUp` only latches a key that was actually pressed (a matching
  live `keyDown`) and not yet observed by a scan; a release with no matching live press —
  a key that is not currently down — has NO effect and must not register a phantom
  press.** This is the host input-timing policy (`decision:ADR-0016`) the consumer relied
  on; a renderer that follows live key state without the latch drops fast taps, and one
  that latches every release registers ghost keys.

## Acceptance criteria

A keyboard contract satisfies these facts iff, through
`dna/conformance/keyboard/run-keyboard-fixtures.mjs` against the reference model
`dna/conformance/keyboard/keyboard-model.mjs`:

- `keyboard-matrix.json` (KBD-MATRIX-001) — pressed keys + a port high byte produce
  the documented `IN (0xFE)` byte (active-low, half-row select, AND across rows);
  the self-test proves a read that ignores the half-row select fails.
- `keyboard-browsermap.json` (KBD-BROWSERMAP-001) — each browser key maps to the
  right Spectrum key(s) and matrix positions, including the CAPS-SHIFT cursor combos;
  the self-test proves a map that drops combinations fails.
- `keyboard-latch.json` (KBD-LATCH-001) — a quick tap is visible for exactly one
  scan, a held key for every scan it spans; the self-test proves a latch-less
  keyboard loses the quick tap.
