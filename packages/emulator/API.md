# @zx-vibes/emulator API

This package exposes a browser-oriented `ZXSpectrum` facade plus lower-level
ZX Spectrum 48K components. The emulator is plain JavaScript ESM.

## ZXSpectrum

```js
import { ZXSpectrum } from '@zx-vibes/emulator';

const spectrum = new ZXSpectrum('#screen', {
  rom: './rom/48k.rom',
  scale: 2,
  sound: true,
  onReady: (machine) => machine.start(),
  onError: (error) => console.error(error),
});
```

### Constructor

```js
new ZXSpectrum(canvasOrSelector, options = {})
```

- `canvasOrSelector`: an `HTMLCanvasElement` or CSS selector.
- `options.rom`: ROM bytes or URL. Defaults to
  `https://cdn.jsdelivr.net/npm/@zx-vibes/emulator@latest/rom/48k.rom`.
- `options.autoStart`: start automatically after ROM load, default `true`.
- `options.sound`: enable sound, default `true`.
- `options.useAudioWorklet`: use AudioWorklet when available, default `true`.
- `options.scale`: number or `'auto'`, default `'auto'`.
- `options.handleKeyboard`: attach browser keyboard handlers, default `true`.
- `options.touchKeyboard`: `true`, `false`, `'auto'`, element, or selector.
- `options.fps`: PAL frame rate, default `50`.
- `options.onReady`: callback invoked with the `ZXSpectrum` instance.
- `options.onError`: callback invoked with an `Error`.

`ZXSpectrum` does not currently extend `EventTarget`; use the callback options
above for lifecycle hooks.

### Control

- `start(): Promise<void>`
- `stop(): void`
- `reset(): void`
- `destroy(): void`
- `setTurboMode(enabled: boolean): void`

`setTurboMode` records the flag for compatibility. The current public browser
loop remains frame-paced; there is no supported `setSpeed(speed)` method.

### ROM

- `loadROM(data: Uint8Array): void`
- `loadROMFromURL(url: string): Promise<void>`

### Tape

- `loadTape(data: ArrayBuffer | Uint8Array, filename: string): void`
- `loadTapeFromURL(url: string): Promise<void>`
- `playTape(): void`
- `pauseTape(): void`
- `stopTape(): void`
- `rewindTape(): void`
- `getTapeStatus(): { status: string; position: number; playing: boolean; paused: boolean }`

`filename` is required for `loadTape` because the tape parser selects TAP or
TZX behavior from the `.tap` or `.tzx` extension.

```js
const tape = await fetch('./game.tzx').then((r) => r.arrayBuffer());
spectrum.loadTape(tape, 'game.tzx');
spectrum.playTape();
```

### Keyboard

- `keyDown(keyOrEvent: string | KeyboardEvent): void`
- `keyUp(keyOrEvent: string | KeyboardEvent): void`
- `keyPress(keyOrEvent: string | KeyboardEvent, duration?: number): Promise<void>`
- `typeText(text: string, options?: { keyDelay?: number; keyDuration?: number }): Promise<void>`
- `setKeyMapping(pcKey: string, spectrumKey: string | { keys: string[] }): void`
- `setKeyMappings(mappings: Record<string, string | { keys: string[] }>): void`
- `clearCustomKeyMappings(): void`

### Snapshots

- `loadZ80Snapshot(data: ArrayBuffer | Uint8Array): void`
- `loadSnapshot(data: { ram: Uint8Array; cpu: object; ula: { borderColor: number } }): void`
- `saveSnapshot(): { ram: Uint8Array; cpu: object; ula: { borderColor: number } }`

`loadZ80Snapshot` supports `.z80` v1 48K snapshots and 48K-compatible `.z80`
v2/v3 snapshots using standard pages 8, 4, and 5. 128K paging is not supported.
`saveSnapshot` returns the emulator's internal state object, not a `.z80` file.

### Memory And Audio

- `poke(address: number, value: number): void`
- `peek(address: number): number`
- `setVolume(volume: number): void`
- `setMuted(muted: boolean): void`
- `setAudioDebugMode(enabled: boolean): void`
- `getStats(): { fps: number; frameCount: number; cpuCycles: number; running: boolean; turboMode: boolean }`

## Lower-Level Components

The package also exports CPU, memory, display, ULA, tape, sound, snapshot, and
keyboard classes from `src/index.js`. These are useful for toolkit integration
and focused tests, but the browser facade above is the stable user-facing API.
