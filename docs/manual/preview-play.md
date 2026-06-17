# Preview and Play

Open a browser preview from a generated project:

```bash
npm run preview
```

Or call the CLI directly:

```bash
zxs preview --port 5173 --watch
```

`zxs preview --watch` rebuilds and reloads when source files change. If the
requested port is busy, preview tries later ports and prints the URL it
actually selected. Add `--strict-port` when a busy `--port` should be an error.

## Detached Preview

Use detached mode when you want the preview server to keep running outside the
current command:

```bash
zxs preview --detach --watch
zxs preview --list
zxs preview --stop
```

Detached server records include a local ownership token, so `--stop` only stops
the tracked zx-vibes preview server.

## Boot and Play

`zxs boot` opens a clean ZX Spectrum 48K boot screen in the same browser player.

```bash
zxs boot
```

`zxs play <file>` opens `.z80`, `.sna`, `.tap`, and `.tzx` files without
creating a project first:

```bash
zxs play game.z80
zxs play game.tap
zxs play game.tzx
```

Tape playback preserves `.tap` and `.tzx` filenames so the emulator can select
the correct parser. The emulator supports `.z80` v1 snapshots plus
48K-compatible `.z80` v2/v3 snapshots; 128K paging is not supported.

## Public Gallery

The public gallery is separate from the manual and remains available at:

<https://alvaromah.github.io/zx-vibes/>

The manual is published below that same Pages site at:

<https://alvaromah.github.io/zx-vibes/manual/>
