# zx-vibes emulator demos

A working ZX Spectrum, running on the reconstructed **`@zx-vibes/machine`** core —
the emulation engine as an importable library, not a closed binary.

## Just try it

**Open [`index.html`](./index.html) in a browser** (double-click it). No install,
no terminal, no build step. Pick a demo:

| Demo | File | What it does |
|------|------|--------------|
| **Basic** | [`basic.html`](./basic.html) | Boots the real BASIC ROM; start typing. The smallest embed. |
| **Medium** | [`medium.html`](./medium.html) | On-screen keyboard, load your program (auto-typed), pause/reset. |
| **Full** | [`full.html`](./full.html) | `LOAD ""` a `.tap`/`.tzx` for real (pilot tone, border stripes, **audible loading**) or fast-load it; open a `.z80` snapshot; sound, Kempston joystick. |

## Reuse it on your own page

The whole Basic embed is three lines:

```html
<canvas id="screen"></canvas>
<script src="zxspectrum.js"></script>
<script>
  ZXSpectrum.create().attach(document.getElementById('screen')).start();
</script>
```

`zxspectrum.js` is a single prebuilt bundle with the ROM embedded, so it runs from
a plain file — nothing to fetch.

The same instance also drives tape and a joystick — the machine loads a real `.tap`/`.tzx`
by streaming it onto the tape-in line, so you just `LOAD ""` as on hardware:

```js
const zx = ZXSpectrum.create().attach(canvas).start();
zx.insertTape(bytes);   // Uint8Array/ArrayBuffer of a .tap or .tzx (auto-detected)
zx.playTape();          // then type LOAD "" on the machine — you hear it load
await zx.fastLoadTape(bytes); // or fast-forward it (async: keeps the page painting)
zx.loadSnapshot(bytes); // or restore a .z80 snapshot instantly (no LOAD "")
zx.setJoystick({ up: true, fire: true }); // Kempston (port 0x1F)
// also: stopTape(), ejectTape(), isTapePlaying(), tapeProgress(), setSound(on), reset()
```

## The ROM

The demos embed the original 16 KB Sinclair 48K ROM — © Amstrad plc, redistributed
by permission (see [`NOTICE`](./NOTICE)). To supply your own, rebuild the bundle
(below) after replacing `tooling/48k.rom`.

## Rebuilding the bundle (optional)

Only needed if you change the emulator source under `tooling/`:

```
pnpm --filter @zx-vibes-examples/tooling run bundle   # regenerates zxspectrum.js
pnpm --filter @zx-vibes-examples/tooling test         # headless boot smoke
```
