# __NAME__ — Spectral shortcuts

ZXS ?= npx --no-install zxs

build:
	$(ZXS) build

run: build
	$(ZXS) run --bin build/main.bin --org 0x8000 --frames 300 --screenshot screen.png

test:
	$(ZXS) verify

screen:
	$(ZXS) screen --text

.PHONY: build run test screen
