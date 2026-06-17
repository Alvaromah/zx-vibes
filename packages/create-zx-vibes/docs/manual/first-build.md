# First Build

Validate the fresh project before changing it:

```bash
npm run doctor
npm run build
npm test
npm run verify
```

If you installed `zxs` globally, the direct program form also works:

```bash
zxs doctor
zxs build
zxs verify
```

## The Feedback Loop

zx-vibes is built around a short loop:

1. Edit Z80 assembly.
2. Build the binary.
3. Run it in a ZX Spectrum 48K emulator.
4. Inspect the screen, machine state, and run report.
5. Add or update tests.
6. Verify the whole project.

The generated scripts wrap the common path:

```bash
npm run doctor
npm run build
npm run run
npm run screen
npm test
npm run verify
```

The lower-level commands are useful when you need more control:

```bash
zxs build
zxs run --bin build/main.bin --org 0x8000 --frames 300 --json
zxs run --bin build/main.bin --org 0x8000 --frames 300 --screenshot screen.png
zxs screen --text --png screen.png
zxs verify
```

If you did not install `zxs` globally, keep using the scripts for the common
path. For one-off advanced commands, use `npm run zxs -- <command>`.

## Read the Run JSON

For normal frame-synced game loops, the important fields are:

- `status` should be `ok`.
- `loop.haltSynced` should usually be `true`.
- `audio.beeperEdges` should increase when sound is expected.
- Hang reports should be treated as real bugs, not ignored.

Do not stop at successful assembly. A Spectrum program can assemble cleanly and
still draw garbage, hang in ROM, miss keyboard input, corrupt the stack, or run
too fast.
