/**
 * Test ROMs for ZX Spectrum emulator validation
 * These ROMs test various aspects of the emulator
 */

// Convert hex string to Uint8Array
function hexToBytes(hex) {
    const bytes = [];
    const cleanHex = hex.replace(/\s/g, '');
    for (let i = 0; i < cleanHex.length; i += 2) {
        bytes.push(parseInt(cleanHex.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
}

// Test ROM definitions
export const testROMs = {
    // Simple memory write test
    memoryWrite: {
        name: 'Memory Write',
        description: 'Writes test values to RAM',
        loadAddress: 0x8000,
        startAddress: 0x8000,
        data: hexToBytes(`
            3E 42 32 00 90 3E 55 32 01 90 3E AA 32 02 90 18 FE
        `)
        // LD A,0x42 ; LD (0x9000),A ; LD A,0x55 ; LD (0x9001),A ; LD A,0xAA ; LD (0x9002),A ; JR $
    },

    // Basic arithmetic test
    arithmeticTest: {
        name: 'Arithmetic Test',
        description: 'Tests basic arithmetic operations',
        loadAddress: 0x8000,
        startAddress: 0x8000,
        data: hexToBytes(`
            3E 05 C6 03 32 00 A0 3E FF 32 01 A0 18 FE
        `)
        // LD A,5 ; ADD A,3 ; LD (0xA000),A ; LD A,0xFF ; LD (0xA001),A ; JR $
        // Result: 0xA000 should contain 8, 0xA001 should contain 0xFF (to verify no corruption)
    },

    // Memory test
    memoryTest: {
        name: 'Memory Test',
        description: 'Tests RAM read/write operations',
        loadAddress: 0x8000,
        startAddress: 0x8000,
        data: hexToBytes(`
            21 00 81 11 00 81 01 00 7F 7D 77 23 0B 78 B1 20
            F7 21 00 81 01 00 7F 7E BD 20 0C 23 0B 78 B1 20
            F5 21 30 80 18 04 54 5D 21 40 80 D5 11 00 40 7E
            B7 28 05 12 23 13 18 F7 D1 7C B5 28 29 21 20 40
            3E 41 77 23 3E 54 77 23 3E 3A 77 23 3E 20 77 23
            7A CD 50 80 7B CD 50 80 18 FE F5 1F 1F 1F 1F E6
            0F C6 30 FE 3A 38 02 C6 07 77 23 F1 E6 0F C6 30
            FE 3A 38 02 C6 07 77 23 C9 4D 45 4D 4F 52 59 20
            54 45 53 54 20 50 41 53 53 45 44 00 4D 45 4D 4F
            52 59 20 54 45 53 54 20 46 41 49 4C 45 44 00
        `)
    },

    // Screen pattern test
    screenTest: {
        name: 'Screen Test',
        description: 'Tests display patterns and colors',
        loadAddress: 0x8000,
        startAddress: 0x8000,
        data: hexToBytes(`
            21 00 40 11 01 40 01 FF 17 36 00 ED B0 21 00 58
            11 01 58 01 FF 02 36 07 ED B0 06 20 21 00 40 0E
            C0 E5 36 AA 7C C6 01 67 0D 20 F7 E1 2C 10 ED 01
            FF FF 0B 78 B1 20 FB 21 00 40 06 60 0E 20 3E FF
            77 23 0D 20 FA 0E 20 36 00 23 0D 20 FA 10 EC 21
            00 58 06 08 0E 00 C5 06 04 C5 06 18 79 07 07 07
            F6 07 77 23 10 F8 11 08 00 19 C1 10 EE C1 0C 10
            E5 21 E0 50 11 E0 50 01 0B 00 ED B0 18 FE 53 43
            52 45 45 4E 20 54 45 53 54
        `)
    },

    // Simple beeper test
    soundTest: {
        name: 'Sound Test',
        description: 'Tests beeper sound generation',
        loadAddress: 0x8000,
        startAddress: 0x8000,
        data: hexToBytes(`
            21 00 40 11 01 40 01 FF 17 36 00 ED B0 21 90 80
            11 00 40 01 0A 00 ED B0 21 A0 80 06 08 C5 E5 5E
            23 56 21 C8 00 CD 60 80 E1 23 23 C1 10 ED 21 B0
            80 5E 23 56 23 7A B3 28 0E 4E 23 46 23 E5 60 69
            CD 60 80 E1 18 EB 18 FE F3 7D B4 C8 E5 D5 3E 10
            D3 FE 42 4B 0B 78 B1 20 FB AF D3 FE D1 D5 42 4B
            0B 78 B1 20 FB D1 E1 2B 7D B4 20 DD FB C9 77 07
            A7 06 EF 05 94 05 FC 04 70 04 F4 03 BC 03 77 07
            77 07 FC 04 FC 04 70 04 70 04 FC 04 58 02 94 05
            94 05 EF 05 EF 05 A7 06 A7 06 77 07 58 02 00 00
            53 4F 55 4E 44 20 54 45 53 54
        `)
    }
};

// Helper function to load a test ROM into memory
export function loadTestROM(memory, rom) {
    const { data, loadAddress } = rom;
    for (let i = 0; i < data.length; i++) {
        memory.write(loadAddress + i, data[i]);
    }
}

// Test ROM runner for automated testing
export function runTestROM(spectrum, romName) {
    const rom = testROMs[romName];
    if (!rom) {
        throw new Error(`Unknown test ROM: ${romName}`);
    }

    // Load ROM into memory
    loadTestROM(spectrum.memory, rom);

    // Set PC to start address
    spectrum.cpu.registers.PC = rom.startAddress;

    // Run for a limited number of cycles to prevent infinite loops
    const maxCycles = 1000000; // About 0.3 seconds at 3.5MHz
    let cycles = 0;

    while (cycles < maxCycles) {
        cycles += spectrum.cpu.step();
        
        // Check if we've hit an infinite loop (JR FE)
        const pc = spectrum.cpu.registers.PC;
        if (spectrum.memory.read(pc) === 0x18 && 
            spectrum.memory.read(pc + 1) === 0xFE) {
            break; // Test complete
        }
    }

    return {
        cyclesRun: cycles,
        completed: cycles < maxCycles
    };
}