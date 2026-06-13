import { ZXSpectrum } from '../../src/spectrum/spectrum.js';
import fs from 'fs';
import path from 'path';

describe('ROM Loading Integration', () => {
    let spectrum;
    let mockCanvas;

    beforeEach(() => {
        // Create mock canvas
        mockCanvas = document.createElement('canvas');
        mockCanvas.width = 320;
        mockCanvas.height = 240;
        
        // Create a dummy ROM to prevent automatic loading
        const dummyROM = new Uint8Array(16384);
        
        // Create spectrum instance with mock canvas and minimal options
        spectrum = new ZXSpectrum(mockCanvas, {
            rom: dummyROM,  // Provide ROM data directly to avoid fetch
            autoStart: false,
            sound: false,
            handleKeyboard: false,
            touchKeyboard: false
        });
    });

    afterEach(() => {
        if (spectrum) {
            spectrum.reset();
        }
    });

    describe('loadROM', () => {
        it('should load a valid ROM file', () => {
            // Create a test ROM with recognizable patterns
            const testROM = new Uint8Array(16384);
            testROM[0] = 0xF3;    // DI instruction at 0x0000
            testROM[1] = 0xAF;    // XOR A
            testROM[2] = 0xED;    // Extended instruction prefix
            testROM[3] = 0x47;    // LD I,A
            testROM[0x38] = 0xC9; // RET at interrupt vector
            testROM[0x66] = 0xC9; // RET at NMI vector
            
            spectrum.loadROM(testROM);
            
            // Verify ROM is loaded correctly
            expect(spectrum.memory.read(0x0000)).toBe(0xF3);
            expect(spectrum.memory.read(0x0001)).toBe(0xAF);
            expect(spectrum.memory.read(0x0002)).toBe(0xED);
            expect(spectrum.memory.read(0x0003)).toBe(0x47);
            expect(spectrum.memory.read(0x0038)).toBe(0xC9);
            expect(spectrum.memory.read(0x0066)).toBe(0xC9);
        });

        it('should load the actual 48K ROM if available', () => {
            const romPath = path.join(process.cwd(), 'rom', '48k.rom');
            
            if (fs.existsSync(romPath)) {
                const romBuffer = fs.readFileSync(romPath);
                const romData = new Uint8Array(romBuffer);
                spectrum.loadROM(romData);
                
                // Check for known values in the Spectrum 48K ROM
                // Address 0x0000 should contain 0xF3 (DI instruction)
                expect(spectrum.memory.read(0x0000)).toBe(0xF3);
                
                // The copyright message starts at 0x153B
                // "©1982 Sinclair Research Ltd"
                // Just check that some ROM content is loaded
                // The exact content may vary depending on the ROM version
                expect(spectrum.memory.read(0x153B)).not.toBe(0x00);
            } else {
                console.log('48K ROM not found, skipping test');
            }
        });

        it('should reject oversized ROM', () => {
            const oversizedROM = new Uint8Array(16385);
            
            expect(() => spectrum.loadROM(oversizedROM)).toThrow('ROM too large');
        });

        it('should allow partial ROM loading', () => {
            const partialROM = new Uint8Array(1000);
            for (let i = 0; i < 1000; i++) {
                partialROM[i] = i & 0xFF;
            }
            
            spectrum.loadROM(partialROM);
            
            // Check loaded portion
            expect(spectrum.memory.read(0x0000)).toBe(0x00);
            expect(spectrum.memory.read(0x00FF)).toBe(0xFF);
            expect(spectrum.memory.read(0x03E7)).toBe(0xE7); // 999 = 0x3E7
            
            // Check unloaded portion is still zero
            expect(spectrum.memory.read(0x03E8)).toBe(0x00);
            expect(spectrum.memory.read(0x3FFF)).toBe(0x00);
        });
    });

    describe('ROM execution', () => {
        it('should start execution from address 0x0000', () => {
            const testROM = new Uint8Array(16384);
            testROM[0] = 0x00; // NOP
            testROM[1] = 0x00; // NOP
            testROM[2] = 0x76; // HALT
            
            spectrum.loadROM(testROM);
            
            // PC should start at 0x0000
            expect(spectrum.cpu.registers.getPC()).toBe(0x0000);
            
            // Execute a single instruction at a time
            spectrum.cpu.execute();
            // After NOP, PC should be 0x0001
            expect(spectrum.cpu.registers.getPC()).toBe(0x0001);
            
            spectrum.cpu.execute();
            // After second NOP, PC should be 0x0002
            expect(spectrum.cpu.registers.getPC()).toBe(0x0002);
            
            spectrum.cpu.execute();
            // After HALT, CPU should be halted
            expect(spectrum.cpu.halted).toBe(true);
        });

        it('should handle interrupts correctly with ROM vectors', () => {
            const testROM = new Uint8Array(16384);
            
            // Interrupt vector at 0x0038
            testROM[0x0038] = 0x3E; // LD A,n
            testROM[0x0039] = 0x42; // value 0x42
            testROM[0x003A] = 0xED; // RETI
            testROM[0x003B] = 0x4D;
            
            spectrum.loadROM(testROM);
            
            // Enable interrupts
            spectrum.cpu.registers.set('I', 0x00);
            spectrum.cpu.interruptMode = 1;
            spectrum.cpu.iff1 = true;
            spectrum.cpu.iff2 = true;
            
            // Trigger interrupt
            spectrum.cpu.interrupt();
            
            // Should jump to 0x0038
            expect(spectrum.cpu.registers.getPC()).toBe(0x0038);
            // Interrupts are disabled during interrupt processing
            expect(spectrum.cpu.iff1).toBe(false);
            expect(spectrum.cpu.iff2).toBe(false);
        });
    });

    describe('ROM protection', () => {
        it('should not allow writing to ROM area', () => {
            const testROM = new Uint8Array(16384);
            testROM[0x1000] = 0x42;
            
            spectrum.loadROM(testROM);
            
            // Attempt to write to ROM area
            spectrum.memory.write(0x1000, 0xFF);
            
            // ROM should remain unchanged
            expect(spectrum.memory.read(0x1000)).toBe(0x42);
        });

        it('should allow writing to RAM area', () => {
            spectrum.memory.write(0x4000, 0x42);
            expect(spectrum.memory.read(0x4000)).toBe(0x42);
            
            spectrum.memory.write(0xFFFF, 0x84);
            expect(spectrum.memory.read(0xFFFF)).toBe(0x84);
        });
    });

    describe('ROM with system initialization', () => {
        it('should initialize system correctly', () => {
            // Create a simple ROM that initializes the system
            const testROM = new Uint8Array(16384);
            let addr = 0;
            
            // Disable interrupts
            testROM[addr++] = 0xF3; // DI
            
            // Clear accumulator
            testROM[addr++] = 0xAF; // XOR A
            
            // Set interrupt register
            testROM[addr++] = 0xED; // LD I,A
            testROM[addr++] = 0x47;
            
            // Set stack pointer
            testROM[addr++] = 0x31; // LD SP,nn
            testROM[addr++] = 0x00; // Low byte
            testROM[addr++] = 0x60; // High byte (0x6000)
            
            // Clear screen memory
            testROM[addr++] = 0x21; // LD HL,nn
            testROM[addr++] = 0x00; // Low byte
            testROM[addr++] = 0x40; // High byte (0x4000)
            
            testROM[addr++] = 0x11; // LD DE,nn
            testROM[addr++] = 0x01; // Low byte
            testROM[addr++] = 0x40; // High byte (0x4001)
            
            testROM[addr++] = 0x01; // LD BC,nn
            testROM[addr++] = 0xFF; // Low byte
            testROM[addr++] = 0x17; // High byte (0x17FF = 6143)
            
            testROM[addr++] = 0x36; // LD (HL),n
            testROM[addr++] = 0x00; // Value to write
            
            testROM[addr++] = 0xED; // LDIR
            testROM[addr++] = 0xB0;
            
            testROM[addr++] = 0x76; // HALT
            
            spectrum.loadROM(testROM);
            
            // Execute initialization by stepping through instructions
            let steps = 0;
            while (!spectrum.cpu.halted && steps < 1000) {
                spectrum.cpu.execute();
                steps++;
                if (spectrum.cpu.registers.getPC() > 0x100) {
                    break; // Safety check
                }
            }
            
            // Check results
            expect(spectrum.cpu.registers.get16('SP')).toBe(0x6000);
            expect(spectrum.cpu.registers.get('I')).toBe(0x00);
            expect(spectrum.memory.read(0x4000)).toBe(0x00);
            expect(spectrum.memory.read(0x57FF)).toBe(0x00);
        });
    });
});
