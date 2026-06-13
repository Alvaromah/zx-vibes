# Common bugs: symptom → cause → fix

The triage table. Spectral's hang reports deep-link here via anchors.

## <a id="busy-wait"></a>Watchdog says `tight-loop`

PC spinning in a few addresses, screen static. Three possibilities:

1. **Keyboard wait with no key coming** — intentional code, but under zxs
   nothing presses keys unless you schedule them: rerun with
   `--keys "10:SPACE*5"`.
2. **Real infinite loop** — check the loop's exit condition flags
   (`JR Z` vs `JR NZ` inverted is the classic).
3. **Forgot the HALT** — a game loop without HALT spins thousands of
   iterations per frame; add `EI` + `HALT` at the top.

## <a id="di-halt"></a>Watchdog says `di-halt`

`HALT` executed with interrupts disabled — the CPU can never wake. You did
`DI` (or never `EI`) before a HALT-synced loop. Fix: `EI` immediately before
the loop. If you DI'd for an atomic section, re-EI when leaving it.

## <a id="pc-in-rom"></a>Watchdog says `pc-in-rom`

Your program ran from RAM, then the PC moved into ROM (0x0000-0x3FFF) and
never came back. Almost always a crash into the BASIC editor: a wild jump or
a bad `RET` handed control to the ROM, which settles in its key-wait loop
(halt-synced, screen mostly intact — check `zxs screen --text` for the ©
prompt or a report line like `B Integer out of range`).

Usual culprits:

1. **Stack imbalance** — a leaked PUSH/POP or CALL/RET pair makes the final
   `RET` pop garbage (see [stack drift](#stack-drift)).
2. **Fell off the end** — execution ran past your last instruction into
   uninitialized memory and bounced into ROM. End standalone loops with
   `JR loop`, not a `RET` to nowhere.
3. **Wild jump** — a computed JP/JR with a corrupted vector.

False positive: a deliberately long ROM call (BEEP holds the CPU in ROM for
the whole note). If that's you, raise `--frames`.

## <a id="screen-garbage"></a>Garbage stripes / scrambled drawing

Wrong bitmap math — the screen is interleaved (screen-layout.md):

- Stripes repeating every 8 pixel lines → you used `+32` for "next line";
  it's `INC H` within a cell.
- Drawing fine at top, breaks at y=64 or y=128 → linear math crossing a
  third boundary; use the formula or cell_addr.
- Diagonal smearing → x and y swapped somewhere in the address calc.

## <a id="inverted-keys"></a>Keys inverted / always pressed / dead

- Moves only when NOT pressing → forgot `CPL` (matrix is active-low).
- "Everything pressed at once" → reading port 0x1F (Kempston, not
  emulated) or comparing without `AND 0x1F`.
- One specific key dead → wrong half-row (check the table; number rows
  mirror!).

## <a id="sprite-trails"></a>Sprite leaves trails / flickers

- Trails → you drew the new position without erasing the old one. Order
  per frame: erase(old) → update(pos) → draw(new). XOR drawing erases by
  redrawing at the SAME old position — make sure the erase uses the old
  coordinates, not the updated ones.
- Flicker → erase and redraw straddling the frame interrupt: do all drawing
  right after HALT (beam at top, your 0x8000+ drawing races ahead of it).

## <a id="stack-drift"></a>Works, then crashes after seconds

Unbalanced stack — each loop iteration leaks a push or a CALL's return:

- A code path that `JR`s out of a routine past its `POP`s.
- `PUSH` inside a loop with the `POP` outside (or vice versa).
- RET removed by a fallthrough into the next routine.

Diagnose: `zxs regs` after increasing `--frames`; SP marching down (or the
watchdog's `sp-corrupt`) confirms it. Find the culprit with
`zxs watch add --write <just-below-your-lowest-expected-SP>`.

## <a id="wrong-colours"></a>Colours wrong / bleeding between objects

- Whole cell changes colour when two objects overlap → attribute clash;
  that's physics, design around it (attributes-and-colour.md).
- Colour 8px off from the pixels → attr math: `0x5800 + row*32 + col`,
  row = y>>3 (NOT the bitmap interleave — attrs are linear).
- Printed text invisible → INK == PAPER in the attr you cleared to.

## <a id="im2-crash"></a>Crashes the moment interrupts are enabled

IM2 setup incomplete — ALL of: 257-byte table, page-aligned, uniformly
filled, `I` = table page, ISR preserves all registers, `EI` before `RETI`.
Any one missing = random crash at the next frame interrupt.
(interrupts-and-timing.md has the full ritual.)

## <a id="rom-call-crash"></a>Crash inside a ROM call

`IY` ≠ 0x5C3A, interrupts off, or sysvars trampled. Restore IY, EI, and
check nothing of yours writes 0x5C00-0x5CBF. Or skip the ROM and use the
recipes' own routines.
