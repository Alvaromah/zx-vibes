# ZX Spectrum Test ROMs

This directory contains test ROMs for validating the ZX Spectrum emulator implementation. These ROMs test various aspects of the emulator including CPU instructions, memory operations, display output, and sound generation.

## Test ROMs

All test ROMs are defined in `test-roms.js` as hex-encoded machine code that can run independently without requiring the Spectrum ROM.

### 1. Memory Write Test (`memoryWrite`)
- **Purpose**: Basic memory write operations
- **Load Address**: 0x8000 (32768)
- **Description**: Writes test values (0x42, 0x55, 0xAA) to RAM addresses 0x9000-0x9002
- **Expected Result**: Memory locations should contain the written values

### 2. Arithmetic Test (`arithmeticTest`)
- **Purpose**: Tests basic arithmetic operations
- **Load Address**: 0x8000 (32768)
- **Description**: Performs ADD operation (5 + 3)
- **Expected Result**: Address 0xA000 should contain 8, 0xA001 should contain 0xFF

### 3. Memory Test (`memoryTest`)
- **Purpose**: Comprehensive RAM read/write test
- **Load Address**: 0x8000 (32768)
- **Description**: Writes pattern to RAM and verifies it, displays pass/fail message
- **Tests**: RAM from 0x8100 to 0xFFFF using address low byte as test pattern
- **Expected Result**: Displays "MEMORY TEST PASSED" or "MEMORY TEST FAILED" with address

### 4. Screen Test (`screenTest`)
- **Purpose**: Tests display output with various patterns
- **Load Address**: 0x8000 (32768)
- **Patterns**:
  1. Clear screen with black background
  2. Vertical line pattern (0xAA bytes)
  3. Horizontal line pattern
  4. Color attribute bars
- **Expected Result**: Various patterns should display correctly with "SCREEN TEST" message

### 5. Sound Test (`soundTest`)
- **Purpose**: Tests beeper sound generation
- **Load Address**: 0x8000 (32768)
- **Description**: Plays a musical scale followed by a simple melody
- **Expected Result**: Clear beeper tones should be audible

## Using the Test ROMs

### In JavaScript Tests
```javascript
import { testROMs, loadTestROM, runTestROM } from './test-roms.js';

// Load and run a test ROM
const result = runTestROM(spectrum, 'memoryWrite');
console.log(`Test completed: ${result.completed}`);

// Or manually load a test ROM
loadTestROM(spectrum.memory, testROMs.arithmeticTest);
spectrum.cpu.registers.PC = testROMs.arithmeticTest.startAddress;
```

### Test ROM Format

All test ROMs follow these conventions:
- Start address: 0x8000 (32768)
- End with infinite loop: `JR $` (0x18 0xFE)
- Use direct memory writes for output (no ROM routine dependencies)
- Self-contained machine code that doesn't require Spectrum ROM

## Adding New Test ROMs

To add a new test ROM:

1. Add the ROM definition to `test-roms.js`:
```javascript
newTest: {
    name: 'New Test',
    description: 'What this test does',
    loadAddress: 0x8000,
    startAddress: 0x8000,
    data: hexToBytes(`
        // Hex bytes here
    `)
}
```

2. Use only self-contained Z80 instructions (no ROM calls)
3. End with an infinite loop (0x18 0xFE)
4. Add corresponding test cases to `test-rom-execution.test.js`
5. Update this README with the new test description

## Helper Functions

### `hexToBytes(hex)`
Converts a hex string to Uint8Array for ROM data.

### `loadTestROM(memory, rom)`
Loads a test ROM into memory at the specified address.

### `runTestROM(spectrum, romName)`
Loads and runs a test ROM, returning execution statistics.

## License

These test ROMs are part of the ZXGeneration project and are released under the MIT License.