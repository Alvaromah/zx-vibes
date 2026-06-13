# arkanoid — Spectral shortcuts (zxs must be on PATH)

build:
	zxs build src/main.asm

run: build
	zxs run --bin build/main.bin --org 0x8000 --frames 300 --screenshot screen.png

test:
	zxs test tests

screen:
	zxs screen --text

.PHONY: build run test screen
