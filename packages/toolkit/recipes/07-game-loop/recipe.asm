; ── recipe: HALT-synced game loop ────────────────────────────────────
; The canonical Spectrum game-loop shape. Not an includable routine but a
; structure to copy — see demo.asm for it running with real input/drawing:
;
;     ei                      ; interrupts ON before any HALT
; main_loop:
;     halt                    ; frame sync: one HALT = one frame = 50fps
;     call read_input         ; sample keys
;     call update             ; game logic (positions, collisions, score)
;     call redraw             ; XOR-erase old → XOR-draw new (no trails)
;     jr main_loop
;
; Speed control: a second HALT halves the rate; or act every Nth frame
; with a counter. Everything between two HALTs must fit in 69,888 T-states
; (docs/reference/interrupts-and-timing.md).
