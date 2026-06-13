; Prints "HELLO ZX" on the upper screen via ROM routines, then spins.
; The canonical Phase-0 end-to-end fixture.
    DEVICE ZXSPECTRUM48
    ORG 0x8000
start:
    ld a, 2             ; channel 2 = upper screen
    call 0x1601         ; CHAN-OPEN
    ld hl, msg
print_loop:
    ld a, (hl)
    or a
    jr z, done
    rst 0x10            ; PRINT A
    inc hl
    jr print_loop
done:
    jr done
msg:
    db "HELLO ZX", 0
