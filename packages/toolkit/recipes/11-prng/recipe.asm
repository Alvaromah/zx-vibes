; ── recipe: 16-bit xorshift PRNG ─────────────────────────────────────
; John Metcalf's Z80 xorshift: period 65535, every 16-bit value except 0,
; 11 bytes of state-free code. The Spectrum has no entropy source under
; zxs (runs are deterministic by design) — a fixed seed gives a fixed,
; replayable sequence, which is exactly what agent tests want.
;
; You define the state (NEVER seed it with 0 — 0 maps to 0 forever):
;     prng_seed: dw 0xACE1
; For ranges: AND a power-of-two mask (e.g. `and 0x1F` → 0-31) and retry
; or clamp; avoid the modulo-by-division rabbit hole.

; prng — next pseudorandom value
; out:      HL = 16-bit pseudorandom value (also stored back to prng_seed)
; clobbers: AF
prng:
    ld hl, (prng_seed)
    ld a, h
    rra
    ld a, l
    rra
    xor h
    ld h, a
    ld a, l
    rra
    ld a, h
    rra
    xor l
    ld l, a
    xor h
    ld h, a
    ld (prng_seed), hl
    ret
