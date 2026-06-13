import { SpectrumMemory } from '../../src/spectrum/memory.js';

describe('SpectrumMemory', () => {
    let memory;

    beforeEach(() => {
        memory = new SpectrumMemory();
    });

    describe('initialization', () => {
        it('should create ROM and RAM arrays of correct size', () => {
            expect(memory.rom.length).toBe(16384); // 16KB
            expect(memory.ram.length).toBe(49152); // 48KB
        });

        it('should enable ROM by default', () => {
            expect(memory.romEnabled).toBe(true);
        });

        it('should initialize memory to zeros', () => {
            // Check some random RAM locations
            expect(memory.read(0x4000)).toBe(0);
            expect(memory.read(0x8000)).toBe(0);
            expect(memory.read(0xFFFF)).toBe(0);
        });
    });

    describe('read operations', () => {
        it('should read from ROM when address < 0x4000 and ROM enabled', () => {
            memory.rom[0x0000] = 0x12;
            memory.rom[0x3FFF] = 0x34;
            
            expect(memory.read(0x0000)).toBe(0x12);
            expect(memory.read(0x3FFF)).toBe(0x34);
        });

        it('should read from RAM when address >= 0x4000', () => {
            memory.ram[0x0000] = 0x56; // RAM offset 0 = address 0x4000
            memory.ram[0xBFFF] = 0x78; // RAM offset 0xBFFF = address 0xFFFF
            
            expect(memory.read(0x4000)).toBe(0x56);
            expect(memory.read(0xFFFF)).toBe(0x78);
        });

        it('should mask addresses to 16 bits', () => {
            memory.ram[0x0000] = 0xAB;
            expect(memory.read(0x14000)).toBe(0xAB); // 0x14000 & 0xFFFF = 0x4000
        });

        it('should return 0xFF when reading ROM area with ROM disabled', () => {
            memory.rom[0x1000] = 0x12;
            memory.romEnabled = false;
            
            expect(memory.read(0x1000)).toBe(0xFF);
        });

        it('should read from screen memory area correctly', () => {
            // Screen memory starts at 0x4000
            memory.ram[0x0000] = 0x11; // First byte of screen
            memory.ram[0x17FF] = 0x22; // Last byte of screen pixels
            
            expect(memory.read(0x4000)).toBe(0x11);
            expect(memory.read(0x57FF)).toBe(0x22);
        });

        it('should read from attribute memory area correctly', () => {
            // Attribute memory at 0x5800-0x5AFF
            memory.ram[0x1800] = 0x38; // Bright white on black
            memory.ram[0x1AFF] = 0x47; // Bright white on white
            
            expect(memory.read(0x5800)).toBe(0x38);
            expect(memory.read(0x5AFF)).toBe(0x47);
        });
    });

    describe('write operations', () => {
        it('should write to RAM when address >= 0x4000', () => {
            memory.write(0x4000, 0x12);
            memory.write(0xFFFF, 0x34);
            
            expect(memory.ram[0x0000]).toBe(0x12);
            expect(memory.ram[0xBFFF]).toBe(0x34);
        });

        it('should not write to ROM area (< 0x4000)', () => {
            memory.rom[0x1000] = 0x00;
            memory.write(0x1000, 0xFF);
            
            expect(memory.rom[0x1000]).toBe(0x00); // Unchanged
        });

        it('should mask addresses to 16 bits', () => {
            memory.write(0x14000, 0x56); // 0x14000 & 0xFFFF = 0x4000
            expect(memory.ram[0x0000]).toBe(0x56);
        });

        it('should mask values to 8 bits', () => {
            memory.write(0x4000, 0x1FF);
            expect(memory.ram[0x0000]).toBe(0xFF);
        });

        it('should write to screen memory correctly', () => {
            memory.write(0x4000, 0xAA); // First screen byte
            memory.write(0x57FF, 0x55); // Last screen pixel byte
            
            expect(memory.ram[0x0000]).toBe(0xAA);
            expect(memory.ram[0x17FF]).toBe(0x55);
        });

        it('should write to attribute memory correctly', () => {
            memory.write(0x5800, 0x07); // White on black
            memory.write(0x5AFF, 0x38); // Bright black on white
            
            expect(memory.ram[0x1800]).toBe(0x07);
            expect(memory.ram[0x1AFF]).toBe(0x38);
        });
    });

    describe('ROM loading', () => {
        it('should load ROM data correctly', () => {
            const romData = new Uint8Array(16384);
            romData[0] = 0xF3; // DI instruction
            romData[1] = 0xAF; // XOR A
            romData[16383] = 0xFF;
            
            memory.loadROM(romData);
            
            expect(memory.rom[0]).toBe(0xF3);
            expect(memory.rom[1]).toBe(0xAF);
            expect(memory.rom[16383]).toBe(0xFF);
        });

        it('should load partial ROM data', () => {
            const romData = new Uint8Array(100);
            for (let i = 0; i < 100; i++) {
                romData[i] = i;
            }
            
            memory.loadROM(romData);
            
            expect(memory.rom[0]).toBe(0);
            expect(memory.rom[99]).toBe(99);
            expect(memory.rom[100]).toBe(0); // Rest should be zero
        });

        it('should throw error if ROM too large', () => {
            const romData = new Uint8Array(16385); // 1 byte too large
            
            expect(() => memory.loadROM(romData)).toThrow('ROM too large: 16385 bytes (max 16384)');
        });
    });

    describe('screen memory access', () => {
        it('should return correct screen memory subarray', () => {
            // Set some test data in screen memory
            memory.ram[0x0000] = 0x11;
            memory.ram[0x17FF] = 0x22;
            
            const screenMem = memory.getScreenMemory();
            
            expect(screenMem.length).toBe(0x1800); // 6KB
            expect(screenMem[0]).toBe(0x11);
            expect(screenMem[0x17FF]).toBe(0x22);
        });

        it('should return correct attribute memory subarray', () => {
            // Set some test data in attribute memory
            memory.ram[0x1800] = 0x07; // White on black
            memory.ram[0x1AFF] = 0x38; // Bright black on white
            
            const attrMem = memory.getAttributeMemory();
            
            expect(attrMem.length).toBe(768); // 32x24 attributes
            expect(attrMem[0]).toBe(0x07);
            expect(attrMem[767]).toBe(0x38);
        });

        it('should return live subarrays that reflect memory changes', () => {
            const screenMem = memory.getScreenMemory();
            const attrMem = memory.getAttributeMemory();
            
            // Modify through main memory
            memory.write(0x4000, 0xAA);
            memory.write(0x5800, 0x47);
            
            // Check subarrays reflect changes
            expect(screenMem[0]).toBe(0xAA);
            expect(attrMem[0]).toBe(0x47);
        });
    });

    describe('clearRAM', () => {
        it('should clear all RAM to zero', () => {
            // Set some data
            memory.write(0x4000, 0xFF);
            memory.write(0x8000, 0xAA);
            memory.write(0xFFFF, 0x55);
            
            memory.clearRAM();
            
            expect(memory.read(0x4000)).toBe(0);
            expect(memory.read(0x8000)).toBe(0);
            expect(memory.read(0xFFFF)).toBe(0);
        });

        it('should not affect ROM', () => {
            memory.rom[0x1000] = 0x42;
            
            memory.clearRAM();
            
            expect(memory.rom[0x1000]).toBe(0x42);
        });
    });

    describe('memory contention areas', () => {
        it('should correctly identify screen memory area', () => {
            // Screen memory: 0x4000-0x57FF
            const screenStart = 0x4000;
            const screenEnd = 0x57FF;
            
            memory.write(screenStart, 0x01);
            memory.write(screenEnd, 0x02);
            
            expect(memory.read(screenStart)).toBe(0x01);
            expect(memory.read(screenEnd)).toBe(0x02);
        });

        it('should correctly identify attribute memory area', () => {
            // Attribute memory: 0x5800-0x5AFF
            const attrStart = 0x5800;
            const attrEnd = 0x5AFF;
            
            memory.write(attrStart, 0x07);
            memory.write(attrEnd, 0x38);
            
            expect(memory.read(attrStart)).toBe(0x07);
            expect(memory.read(attrEnd)).toBe(0x38);
        });
    });
});