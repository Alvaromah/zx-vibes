import { describe, test, expect, beforeEach } from '@jest/globals';
import { Z80 } from '../../src/core/cpu.js';
import { SpectrumMemory } from '../../src/spectrum/memory.js';
import { testROMs, loadTestROM } from '../roms/test-roms.js';

// Helper function from test-roms.js
function hexToBytes(hex) {
    const bytes = [];
    const cleanHex = hex.replace(/\s/g, '');
    for (let i = 0; i < cleanHex.length; i += 2) {
        bytes.push(parseInt(cleanHex.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
}

describe('Test ROM Execution', () => {
    let cpu;
    let memory;
    let memoryInterface;

    beforeEach(() => {
        memory = new SpectrumMemory();
        
        cpu = new Z80(memory, {
            readPort: () => 0xFF,
            writePort: () => {}
        });
    });

    test('Memory Write ROM should write values to RAM', () => {
        // Load Memory Write ROM
        loadTestROM(memory, testROMs.memoryWrite);
        cpu.registers.setPC(testROMs.memoryWrite.startAddress);

        // Run for enough cycles to complete
        const startCycles = cpu.cycles;
        const maxCycles = 1000;
        let instructionCount = 0;
        
        while ((cpu.cycles - startCycles) < maxCycles && instructionCount < 100) {
            cpu.execute();
            instructionCount++;
            
            // Check for infinite loop
            if (memory.read(cpu.registers.getPC()) === 0x18 &&
                memory.read(cpu.registers.getPC() + 1) === 0xFE) {
                break;
            }
        }
        
        // Check that values were written correctly
        expect(memory.read(0x9000)).toBe(0x42);
        expect(memory.read(0x9001)).toBe(0x55);
        expect(memory.read(0x9002)).toBe(0xAA);
    });

    test('Arithmetic Test ROM should perform ADD correctly', () => {
        // Load Arithmetic Test ROM
        loadTestROM(memory, testROMs.arithmeticTest);
        cpu.registers.setPC(testROMs.arithmeticTest.startAddress);

        // Run the test
        const startCycles = cpu.cycles;
        const maxCycles = 1000;
        
        while ((cpu.cycles - startCycles) < maxCycles) {
            cpu.execute();
            
            // Check for infinite loop
            if (memory.read(cpu.registers.getPC()) === 0x18 &&
                memory.read(cpu.registers.getPC() + 1) === 0xFE) {
                break;
            }
        }

        // Check results
        expect(memory.read(0xA000)).toBe(8);  // 5 + 3 = 8
        expect(memory.read(0xA001)).toBe(0xFF); // Verify no memory corruption
    });

    test('Stack operations should work correctly', () => {
        // Create a simple stack test ROM
        const stackTestRom = {
            name: 'Stack Test',
            description: 'Tests PUSH and POP',
            loadAddress: 0x8000,
            startAddress: 0x8000,
            data: hexToBytes(`
                21 34 12 E5 21 78 56 E1 22 00 B0 18 FE
            `)
            // LD HL,0x1234 ; PUSH HL ; LD HL,0x5678 ; POP HL ; LD (0xB000),HL ; JR $
        };
        
        loadTestROM(memory, stackTestRom);
        cpu.registers.setPC(stackTestRom.startAddress);

        // Run the test
        const startCycles = cpu.cycles;
        const maxCycles = 1000;
        
        while ((cpu.cycles - startCycles) < maxCycles) {
            cpu.execute();
            
            // Check for infinite loop
            if (memory.read(cpu.registers.getPC()) === 0x18 &&
                memory.read(cpu.registers.getPC() + 1) === 0xFE) {
                break;
            }
        }

        // Check that HL was restored from stack (0x1234)
        expect(memory.read(0xB000)).toBe(0x34); // Low byte
        expect(memory.read(0xB001)).toBe(0x12); // High byte
    });

    test('Jump operations should work correctly', () => {
        // Create a simple jump test ROM
        const jumpTestRom = {
            name: 'Jump Test',
            description: 'Tests JP and JR',
            loadAddress: 0x8000,
            startAddress: 0x8000,
            data: hexToBytes(`
                18 04 3E FF 18 02 3E 42 32 00 C0 18 FE
            `)
            // JR +4 ; LD A,0xFF ; JR +2 ; LD A,0x42 ; LD (0xC000),A ; JR $
            // Should skip the FF and store 0x42
        };
        
        loadTestROM(memory, jumpTestRom);
        cpu.registers.setPC(jumpTestRom.startAddress);

        // Run the test
        const startCycles = cpu.cycles;
        const maxCycles = 1000;
        
        while ((cpu.cycles - startCycles) < maxCycles) {
            cpu.execute();
            
            // Check for infinite loop
            if (memory.read(cpu.registers.getPC()) === 0x18 &&
                memory.read(cpu.registers.getPC() + 1) === 0xFE) {
                break;
            }
        }

        // Check that the jump worked correctly
        expect(memory.read(0xC000)).toBe(0x42); // Should have skipped 0xFF
    });
});