# @zx-vibes/emulator

JavaScript ZX Spectrum 48K emulator package used by zx-vibes.

Current package version in this repository: `0.2.0`.

The package provides a browser-oriented `ZXSpectrum` facade, lower-level CPU and
Spectrum components, a distributable browser bundle, examples, and the 48K ROM
asset used by toolkit preview/playback flows.

## Install

```bash
pnpm add @zx-vibes/emulator
```

Node.js 20 or newer is required for package development and tests. Browser use
depends on standard Canvas and Web Audio APIs.

## Browser Quick Start

```html
<canvas id="screen"></canvas>
<script type="module">
  import { ZXSpectrum } from 'https://cdn.jsdelivr.net/npm/@zx-vibes/emulator@latest/dist/zxgeneration.esm.js';

  new ZXSpectrum('#screen', {
    rom: 'https://cdn.jsdelivr.net/npm/@zx-vibes/emulator@latest/rom/48k.rom',
    scale: 2,
    sound: true,
  });
</script>
```

Package import:

```js
import { ZXSpectrum } from '@zx-vibes/emulator';

const spectrum = new ZXSpectrum('#screen', {
  rom: './rom/48k.rom',
  scale: 2,
  sound: true,
  onReady: (machine) => machine.start(),
});
```

## Features

- ZX Spectrum 48K CPU, memory, ULA/display, keyboard, beeper, tape, and
  snapshot support.
- Browser facade for canvas rendering, keyboard input, touch keyboard, and
  Web Audio playback.
- TAP and TZX tape loading. `loadTape(data, filename)` requires a filename so
  the parser can select `.tap` or `.tzx` behavior.
- `.z80` v1 snapshot loading plus 48K-compatible `.z80` v2/v3 loading using
  standard pages 8, 4, and 5.
- Internal state snapshot save/load for emulator sessions.
- Low-level component exports used by `@zx-vibes/toolkit` tests and runtime
  integration.

Current limitations:

- 128K `.z80` paging is not supported.
- `setTurboMode(enabled)` records a compatibility flag; the public browser loop
  remains frame-paced.
- `saveSnapshot()` returns the emulator's internal state object, not a `.z80`
  file.

## Loading Tape And Snapshots

```js
const tape = await fetch('./game.tzx').then((response) => response.arrayBuffer());
spectrum.loadTape(tape, 'game.tzx');
spectrum.playTape();
```

```js
const snapshot = await fetch('./game.z80').then((response) => response.arrayBuffer());
spectrum.loadZ80Snapshot(snapshot);
```

See `API.md` for the current facade and lower-level API reference.

## Package Exports

- `.`: browser facade and lower-level exports from `src/index.js`.
- `./src/*`: source modules.
- `./dist/*`: Rollup browser bundles.
- `./rom/*`: ROM assets.
- `./package.json`: package metadata.

Published files include `src`, `dist`, `rom`, `examples`, `README.md`,
`API.md`, and `LICENSE`.

## Development

From the repository root:

```bash
pnpm --filter @zx-vibes/emulator build
pnpm --filter @zx-vibes/emulator typecheck
pnpm --filter @zx-vibes/emulator lint
pnpm --filter @zx-vibes/emulator test
pnpm --filter @zx-vibes/emulator start
```

Root gallery browser bundles are checked against
`packages/emulator/dist/zxgeneration.esm.js` by:

```bash
pnpm run check:gallery-bundles
```

## ROM Notice

The package includes a ZX Spectrum 48K ROM for emulator use. The ROM is
copyrighted material distributed under the permission described in
`rom/README.md`; that notice is separate from the MIT license covering the
source code.

## License

MIT for the package source. See `rom/README.md` for the separate ROM notice.
