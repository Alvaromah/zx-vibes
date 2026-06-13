# Keyboard input

Read this when keys don't respond, respond inverted, or seem always pressed.

## The matrix: 8 half-rows × 5 keys

Read port `0xFE` with the half-row select in the HIGH byte of the port
address. **Bits are ACTIVE-LOW: 0 = pressed.** Bits 0-4 = keys, outermost
key is bit 0.

| Port (BC) | bit 0 | bit 1 | bit 2 | bit 3 | bit 4 |
|---|---|---|---|---|---|
| `0xFEFE` | CAPS | Z | X | C | V |
| `0xFDFE` | A | S | D | F | G |
| `0xFBFE` | Q | W | E | R | T |
| `0xF7FE` | 1 | 2 | 3 | 4 | 5 |
| `0xEFFE` | 0 | 9 | 8 | 7 | 6 |
| `0xDFFE` | P | O | I | U | Y |
| `0xBFFE` | ENTER | L | K | J | H |
| `0x7FFE` | SPACE | SYM | M | N | B |

Note the mirror symmetry: number rows count outward-in.

## The canonical read

```asm
    ld bc, 0xDFFE      ; P/O/I/U/Y half-row
    in a, (c)
    cpl                ; ← ACTIVE-LOW: invert so 1 = pressed
    and 0x1F           ; keep the 5 key bits
    ; now: bit 0 = P, bit 1 = O...
```

`IN A,(0xFE)` also works **but takes the half-row from A**: you must
`LD A, 0xDF` first — forgetting that reads a half-row you didn't intend.
Prefer `LD BC, rowFE` + `IN A,(C)`.

Multiple rows OR together when you clear several high-byte bits:
`LD BC,0x00FE / IN A,(C)` reads ALL rows at once ("any key?").

A complete QAOP+Space routine: recipes/06-keyboard-qaop.

## Via the ROM (lazy mode)

With interrupts enabled (IM 1), the ROM ISR scans the keyboard into sysvar
`LAST-K (0x5C08)`. `LD A,(0x5C08)` gives the last ASCII-ish code; write 0
there after consuming. Fine for menus; poll the matrix for gameplay.

## Gotchas

- **Forgot `CPL`** → controls inverted: ship moves only while NOT pressing.
  The #1 input bug.
- **Forgot `AND 0x1F`** → bits 5-7 are bus noise/EAR; comparing the raw byte
  with 0xFF/0 misfires.
- Kempston joystick (port 0x1F, active-HIGH) is **not emulated by Spectral**
  — unselected ports read 0xFF, which a Kempston routine reads as
  "everything pressed". Use the keyboard.
- Testing under `zxs`: schedule keys by frame —
  `zxs run --keys "10:O*20"` or the `zx_keys` MCP tool. A poll loop with no
  scheduled key is correctly flagged as `tight-loop` by the watchdog.
