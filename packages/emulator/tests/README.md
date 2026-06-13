# ZXGeneration Test Suite

This directory contains the test suite for the ZXGeneration ZX Spectrum emulator.

## Test Structure

### Unit Tests

#### Core Components
- **cpu.test.js** - Tests for the Z80 CPU emulation including initialization, reset, memory operations, interrupts, and instruction execution
- **registers.test.js** - Tests for register operations (TODO)
- **memory.test.js** - Tests for memory management (TODO)
- **flags.test.js** - Tests for flag calculations (TODO)

#### Instruction Tests
- **arithmetic.test.js** - Tests for arithmetic instructions (ADD, SUB, INC, DEC, etc.)
- **logical.test.js** - Tests for logical operations (AND, OR, XOR, CPL, etc.)
- **bit.test.js** - Tests for bit manipulation instructions (BIT, SET, RES, rotations, shifts)
- **load.test.js** - Tests for load/transfer operations (LD, PUSH, POP, etc.)
- **jump.test.js** - Tests for jump and control flow instructions (JP, JR, CALL, RET, etc.)
- **extended.test.js** - Tests for extended instructions (TODO)
- **indexed.test.js** - Tests for IX/IY indexed operations (TODO)
- **misc.test.js** - Tests for miscellaneous instructions (TODO)

### Integration Tests (TODO)
- ROM loading tests
- Basic program execution tests
- Snapshot loading tests
- Full system integration tests

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/core/cpu.test.js

# Run tests with coverage
npm test -- --coverage

# Run tests in watch mode
npm test -- --watch
```

## Test Coverage

The project has a minimum coverage threshold of 80% for:
- Branches
- Functions
- Lines
- Statements

## Known Issues

1. The Z80 CPU class has duplicate `getState()` methods with different return structures
2. The second `getState()` method incorrectly uses `registers.get()` for 16-bit registers (PC, SP)
3. Some instruction tests assume a different CPU interface than the actual implementation

## Test Implementation Notes

- Tests use Jest with jsdom environment for browser API simulation
- Babel is configured to transform ES modules for Jest compatibility
- Mock implementations are provided for Memory and ULA interfaces
- The Z80 class is imported as CPU in tests for consistency

## Contributing

When adding new tests:
1. Follow the existing test structure and naming conventions
2. Mock external dependencies appropriately
3. Test both success and error cases
4. Ensure tests are independent and can run in any order
5. Add descriptive test names that explain what is being tested