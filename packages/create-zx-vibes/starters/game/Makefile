# __NAME__ — Spectral shortcuts (zxs must be on PATH)

build:
	zxs build

run: build
	zxs run --bin build/main.bin --org 0x8000 --frames 300 --screenshot screen.png

test:
	zxs verify

screen:
	zxs screen --text

.PHONY: build run test screen
