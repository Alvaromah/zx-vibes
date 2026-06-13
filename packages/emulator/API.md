# ZX Generation API Documentation

This document provides detailed information about the public APIs available in the ZXGeneration emulator.

## Table of Contents

- [ZXSpectrum Class](#zxspectrum-class)
- [CPU Class](#cpu-class)
- [Memory Class](#memory-class)
- [Display Class](#display-class)
- [ULA Class](#ula-class)
- [Tape Class](#tape-class)
- [Sound Class](#sound-class)
- [Snapshot Class](#snapshot-class)
- [Event System](#event-system)

## ZXSpectrum Class

The main emulator class that orchestrates all components.

### Constructor

```javascript
new ZXSpectrum(canvas, options = {})
```

**Parameters:**

- `canvas` (HTMLCanvasElement) - The canvas element for display output
- `options` (Object) - Configuration options
  - `scale` (Number) - Display scale factor (default: 2)
  - `border` (Boolean) - Show border area (default: true)
  - `sound` (Boolean) - Enable sound output (default: true)
  - `turbo` (Boolean) - Enable turbo mode (default: false)
  - `touchKeyboard` (Boolean) - Enable touch keyboard (default: false)

### Methods

#### `loadROM(data)`

Load ROM data into the emulator.

**Parameters:**

- `data` (Uint8Array) - ROM data (must be 16384 bytes)

**Returns:** void

**Example:**

```javascript
const response = await fetch('./rom/48k.rom');
const romData = await response.arrayBuffer();
spectrum.loadROM(new Uint8Array(romData));
```

#### `start()`

Start the emulation.

**Returns:** void

#### `stop()`

Stop the emulation.

**Returns:** void

#### `reset()`

Reset the emulator to initial state.

**Returns:** void

#### `loadTape(data)`

Load a TAP file for tape emulation.

**Parameters:**

- `data` (Uint8Array) - TAP file data

**Returns:** void

#### `playTape()`

Start tape playback.

**Returns:** void

#### `stopTape()`

Stop tape playback.

**Returns:** void

#### `rewindTape()`

Rewind tape to beginning.

**Returns:** void

#### `keyDown(key)`

Simulate a key press.

**Parameters:**

- `key` (String|Number) - Key code or character

**Returns:** void

#### `keyUp(key)`

Simulate a key release.

**Parameters:**

- `key` (String|Number) - Key code or character

**Returns:** void

#### `keyPress(key, duration = 50)`

Simulate a key press and release.

**Parameters:**

- `key` (String|Number) - Key code or character
- `duration` (Number) - Duration of key press in milliseconds (default: 50)

**Returns:** Promise

#### `typeText(text, options = {})`

Type text automatically with realistic timing.

**Parameters:**

- `text` (String) - Text to type
- `options` (Object) - Typing options
  - `keyDelay` (Number) - Delay between key presses in ms (default: 100)
  - `keyDuration` (Number) - Duration of each key press in ms (default: 50)

**Returns:** Promise

**Example:**

```javascript
await spectrum.typeText('LOAD""');
spectrum.keyPress(13); // Press Enter
```

#### `loadSnapshot(data)`

Load a Z80 snapshot file.

**Parameters:**

- `data` (Uint8Array) - Z80 snapshot data

**Returns:** void

#### `saveSnapshot()`

Save current state as Z80 snapshot.

**Returns:** Uint8Array - Snapshot data

#### `setSpeed(speed)`

Set emulation speed.

**Parameters:**

- `speed` (Number) - Speed multiplier (1.0 = normal, 2.0 = double speed)

**Returns:** void

### Properties

#### `running`

**Type:** Boolean (readonly)  
Whether the emulator is currently running.

#### `cpu`

**Type:** CPU (readonly)  
Direct access to the CPU instance.

#### `memory`

**Type:** Memory (readonly)  
Direct access to the memory instance.

#### `display`

**Type:** Display (readonly)  
Direct access to the display instance.

#### `tape`

**Type:** Tape (readonly)  
Direct access to the tape instance.

### Events

The ZXSpectrum class extends EventTarget and emits the following events:

- `ready` - Emitted when ROM is loaded and emulator is ready
- `frame` - Emitted after each frame is rendered
- `tapeloading` - Emitted when tape starts loading
- `tapeloaded` - Emitted when tape finishes loading
- `tapeerror` - Emitted on tape loading error

**Example:**

```javascript
spectrum.addEventListener('ready', () => {
    console.log('Emulator ready!');
    spectrum.start();
});

spectrum.addEventListener('frame', (event) => {
    console.log(`Frame rendered in ${event.detail.time}ms`);
});
```

## CPU Class

Z80 CPU emulation core.

### Methods

#### `execute(cycles)`

Execute instructions for specified cycles.

**Parameters:**

- `cycles` (Number) - Number of T-states to execute

**Returns:** Number - Actual cycles executed

#### `interrupt()`

Trigger a maskable interrupt.

**Returns:** void

#### `nmi()`

Trigger a non-maskable interrupt (Not currently implemented in this version).

**Returns:** void

### Properties

#### `registers`

**Type:** Registers  
Access to CPU registers (PC, SP, A, B, C, D, E, H, L, etc.)

**Note:** Use `cpu.getState()` and `cpu.setState()` for getting/setting complete CPU state.

#### `halted`

**Type:** Boolean  
Whether CPU is in HALT state.

#### `cycles`

**Type:** Number (readonly)  
Total T-states executed.

## Memory Class

Memory management (16K ROM + 48K RAM).

### Methods

#### `read(address)`

Read a byte from memory.

**Parameters:**

- `address` (Number) - Memory address (0x0000-0xFFFF)

**Returns:** Number - Byte value (0-255)

#### `write(address, value)`

Write a byte to memory.

**Parameters:**

- `address` (Number) - Memory address (0x0000-0xFFFF)
- `value` (Number) - Byte value (0-255)

**Returns:** void

#### `loadROM(data)`

Load ROM data.

**Parameters:**

- `data` (Uint8Array) - ROM data (must be 16384 bytes or less)

**Returns:** void

**Throws:** Error if ROM data is too large

## Display Class

Screen rendering (256×192 pixels + border).

### Methods

#### `renderFrame()`

Render a complete frame.

**Returns:** void

#### `setBorderColor(color)`

Set border color (Note: This method is not available in the Display class. Use `ula.borderColor` instead).

**Parameters:**

- `color` (Number) - Color index (0-7)

**Returns:** void

### Properties

#### `displayBuffer`

**Type:** Uint8Array (readonly)  
Raw display buffer data (RGBA format).

#### `totalWidth`

**Type:** Number (readonly)  
Total display width including border (352 pixels).

#### `totalHeight`

**Type:** Number (readonly)  
Total display height including border (296 pixels).

## ULA Class

ULA (Uncommitted Logic Array) chip emulation.

### Methods

#### `readPort(port)`

Read from I/O port.

**Parameters:**

- `port` (Number) - Port address

**Returns:** Number - Port value

#### `writePort(port, value)`

Write to I/O port.

**Parameters:**

- `port` (Number) - Port address
- `value` (Number) - Value to write

**Returns:** void

## Tape Class

TAP file loading support.

### Methods

#### `load(buffer, filename)`

Load TAP or TZX file data.

**Parameters:**

- `buffer` (ArrayBuffer|Uint8Array) - Tape file data
- `filename` (String) - Filename to determine format (.tap or .tzx)

**Returns:** void

#### `play()`

Start tape playback.

**Returns:** void

#### `stop()`

Stop tape playback.

**Returns:** void

#### `rewind()`

Rewind to beginning.

**Returns:** void

### Properties

#### `isPlaying`

**Type:** Boolean (readonly)  
Whether tape is currently playing.

#### `position`

**Type:** Number (readonly)  
Current tape position in bytes.

#### `length`

**Type:** Number (readonly)  
Total tape length in bytes.

## Sound Class

Beeper sound generation.

### Methods

#### `beep(speakerBit)`

Update beeper state (internal method for basic sound).

**Parameters:**

- `speakerBit` (Number) - Speaker bit value (0 or 1)

**Returns:** void

#### `setVolume(volume)`

Set sound volume.

**Parameters:**

- `volume` (Number) - Volume level (0.0-1.0)

**Returns:** void

#### `mute()`

Mute sound output.

**Returns:** void

#### `unmute()`

Unmute sound output.

**Returns:** void

## Snapshot Support

The emulator provides Z80 snapshot loading through the ZXSpectrum class methods:

### Methods

#### `loadZ80Snapshot(data)`

Load a Z80 version 1 snapshot (48K format).

**Parameters:**

- `data` (ArrayBuffer|Uint8Array) - Z80 snapshot data

**Returns:** void

#### `loadSnapshot(data)`

Load a snapshot from saved state data.

**Parameters:**

- `data` (Object) - Snapshot data
  - `ram` (Uint8Array) - RAM contents (49152 bytes)
  - `cpu` (Object) - CPU state
  - `ula` (Object) - ULA state

**Returns:** void

#### `saveSnapshot()`

Save current state as snapshot data.

**Returns:** Object - Snapshot data with ram, cpu, and ula state

## Event System

The emulator uses a custom event system for communication between components.

### Global Events

- `cpu:halt` - CPU entered HALT state
- `cpu:unhalt` - CPU exited HALT state
- `memory:write` - Memory write occurred
- `io:read` - I/O port read
- `io:write` - I/O port write
- `display:frame` - Frame rendered
- `tape:block` - Tape block loaded
- `key:down` - Key pressed
- `key:up` - Key released

### Subscribing to Events

```javascript
spectrum.addEventListener('cpu:halt', (event) => {
    console.log('CPU halted at PC:', event.detail.pc);
});

spectrum.addEventListener('memory:write', (event) => {
    const { address, value } = event.detail;
    console.log(`Memory write: ${address.toString(16)} = ${value}`);
});
```

## Error Handling

All methods that can fail will throw errors with descriptive messages:

```javascript
try {
    spectrum.loadROM(invalidData);
} catch (error) {
    console.error('Failed to load ROM:', error.message);
}
```

## Performance Considerations

- The emulator aims for cycle-accurate emulation at 3.5MHz
- Frame rate is locked at 50Hz (PAL standard)
- Use `turbo` mode for faster execution during development
- Sound generation may impact performance on slower devices

## Example: Complete Setup

```javascript
// Create and configure emulator
const canvas = document.getElementById('screen');
const spectrum = new ZXSpectrum(canvas, {
    scale: 2,
    border: true,
    sound: true,
    touchKeyboard: true
});

// Set up event handlers
spectrum.addEventListener('ready', () => {
    console.log('Emulator ready');
    spectrum.start();
});

spectrum.addEventListener('tapeloaded', () => {
    console.log('Tape loaded successfully');
});

// Load ROM
const romResponse = await fetch('./rom/48k.rom');
const romData = await romResponse.arrayBuffer();
spectrum.loadROM(new Uint8Array(romData));

// Load and play a game
const tapResponse = await fetch('./games/manic-miner.tap');
const tapData = await tapResponse.arrayBuffer();
spectrum.loadTape(new Uint8Array(tapData));

// Type LOAD command
await spectrum.typeText('LOAD""');
spectrum.keyPress(13);

// Start tape
spectrum.playTape();
```
