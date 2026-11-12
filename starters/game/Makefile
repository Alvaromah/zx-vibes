# __NAME__ - zx-vibes shortcuts

ZXS ?= npm run zxs --

build:
	$(ZXS) build

run: build
	$(ZXS) run --bin build/main.bin --org 0x8000 --frames 300 --screenshot screen.png

test:
	$(ZXS) verify

screen:
	$(ZXS) state reset && $(ZXS) run --state .zxs/state.zxstate && $(ZXS) screen --text --state .zxs/state.zxstate

.PHONY: build run test screen
