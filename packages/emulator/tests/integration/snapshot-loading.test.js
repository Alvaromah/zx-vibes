import { ZXSpectrum } from '../../src/spectrum/spectrum.js';
import { Z80SnapshotLoader } from '../../src/spectrum/snapshot.js';

describe('Snapshot Loading Integration', () => {
    let spectrum;
    let mockCanvas;

    beforeEach(() => {
        // Create mock canvas
        mockCanvas = document.createElement('canvas');
        mockCanvas.width = 320;
        mockCanvas.height = 240;
        
        // Create a dummy ROM
        const dummyROM = new Uint8Array(16384);
        
        // Create spectrum instance
        spectrum = new ZXSpectrum(mockCanvas, {
            rom: dummyROM,
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

    describe('Z80 snapshot format', () => {
        it('should create a valid Z80 snapshot', () => {
            // Set up some test state
            spectrum.cpu.registers.set('A', 0x42);
            spectrum.cpu.registers.set('B', 0x84);
            spectrum.cpu.registers.set16('HL', 0x1234);
            spectrum.cpu.registers.set16('PC', 0x8000);
            spectrum.cpu.registers.set16('SP', 0x7000);
            spectrum.cpu.registers.set('I', 0x3F);
            spectrum.cpu.registers.set('R', 0x7F);
            
            // Set some memory values
            spectrum.memory.write(0x4000, 0xAA);
            spectrum.memory.write(0x5800, 0x07); // White on black attribute
            spectrum.memory.write(0x8000, 0x76); // HALT instruction
            
            // Create snapshot
            const snapshotData = spectrum.saveSnapshot();
            
            expect(snapshotData).toBeInstanceOf(Object);
            expect(snapshotData.ram).toBeInstanceOf(Uint8Array);
            expect(snapshotData.cpu).toBeDefined();
            expect(snapshotData.ula).toBeDefined();
            
            // Check RAM size
            expect(snapshotData.ram.length).toBe(49152); // 48K
            
            // Check CPU state (properties are lowercase)
            expect(snapshotData.cpu.a).toBe(0x42);
            expect(snapshotData.cpu.b).toBe(0x84);
            expect(snapshotData.cpu.h).toBe(0x12);
            expect(snapshotData.cpu.l).toBe(0x34);
            expect(snapshotData.cpu.pc).toBe(0x8000);
            expect(snapshotData.cpu.sp).toBe(0x7000);
            expect(snapshotData.cpu.i).toBe(0x3F);
            expect(snapshotData.cpu.r).toBe(0x7F);
            
            // Check memory was captured
            expect(snapshotData.ram[0]).toBe(0xAA); // Memory at 0x4000
            expect(snapshotData.ram[0x1800]).toBe(0x07); // Attribute at 0x5800
        });

        it('should load a Z80 snapshot correctly', () => {
            // Create a minimal Z80 v1 snapshot
            const snapshot = new Uint8Array(30 + 49152); // Header + 48K memory
            
            // Fill header with test values
            snapshot[0] = 0x12;  // A
            snapshot[1] = 0x34;  // F
            snapshot[2] = 0x56;  // C
            snapshot[3] = 0x78;  // B
            snapshot[4] = 0x9A;  // L
            snapshot[5] = 0xBC;  // H
            snapshot[6] = 0x00;  // PCL (0 means PC is in bytes 32-33)
            snapshot[7] = 0x00;  // PCH
            snapshot[8] = 0x00;  // SPL
            snapshot[9] = 0x60;  // SPH (SP = 0x6000)
            snapshot[10] = 0x3F; // I
            snapshot[11] = 0x7F; // R
            snapshot[12] = 0x00; // Flags (bit 7 = R bit 7, compressed flag, etc)
            snapshot[13] = 0xDE; // E
            snapshot[14] = 0xF0; // D
            snapshot[15] = 0x11; // C'
            snapshot[16] = 0x22; // B'
            snapshot[17] = 0x33; // E'
            snapshot[18] = 0x44; // D'
            snapshot[19] = 0x55; // L'
            snapshot[20] = 0x66; // H'
            snapshot[21] = 0x77; // A'
            snapshot[22] = 0x88; // F'
            snapshot[23] = 0x99; // IYL
            snapshot[24] = 0xAA; // IYH
            snapshot[25] = 0xBB; // IXL
            snapshot[26] = 0xCC; // IXH
            snapshot[27] = 0x00; // IFF1
            snapshot[28] = 0x00; // IFF2
            snapshot[29] = 0x01; // IM (bits 0-1)
            
            // PC for v1 format (when PC at 6-7 is 0)
            // Set PC directly in header for v1 format
            snapshot[6] = 0x00; // PCL
            snapshot[7] = 0x80; // PCH (PC = 0x8000)
            
            // Add some memory content
            const memStart = 30;
            snapshot[memStart + 0x4000] = 0x42; // RAM at 0x8000
            
            // Load the Z80 format snapshot
            spectrum.loadZ80Snapshot(snapshot);
            
            // Verify state was restored
            expect(spectrum.cpu.registers.get('A')).toBe(0x12);
            expect(spectrum.cpu.registers.get('B')).toBe(0x78);
            expect(spectrum.cpu.registers.get('C')).toBe(0x56);
            expect(spectrum.cpu.registers.get16('HL')).toBe(0xBC9A);
            expect(spectrum.cpu.registers.get16('SP')).toBe(0x6000);
            expect(spectrum.cpu.registers.get16('PC')).toBe(0x8000);
            expect(spectrum.cpu.registers.get('I')).toBe(0x3F);
            expect(spectrum.cpu.registers.get('R')).toBe(0x7F);
            
            // Check memory was loaded
            expect(spectrum.memory.read(0x8000)).toBe(0x42);
        });

        it('should handle compressed Z80 snapshots', () => {
            // Create a compressed snapshot with RLE encoding
            const header = new Uint8Array(30);
            
            // Set compression flag (bit 5 of byte 12)
            header[12] = 0x20;
            header[6] = 0x00;
            header[7] = 0x80;
            
            // Simple compressed data: 0xED 0xED <count> <value>
            const compressedData = new Uint8Array([
                0x00, 0x01, 0x02, 0x03,  // Normal bytes
                0xED, 0xED, 0x05, 0xFF,  // 5 bytes of 0xFF
                0x04, 0x05, 0x06,        // More normal bytes
                0xED, 0xED, 0x00         // End marker
            ]);
            
            // Combine header and compressed data
            const snapshot = new Uint8Array(header.length + compressedData.length);
            snapshot.set(header);
            snapshot.set(compressedData, header.length);
            
            // Test that loading doesn't crash
            expect(() => spectrum.loadZ80Snapshot(snapshot)).not.toThrow();
        });

        it('should preserve interrupt state', () => {
            // Set up interrupt state
            spectrum.cpu.iff1 = true;
            spectrum.cpu.iff2 = true;
            spectrum.cpu.interruptMode = 2;
            
            // Create and reload snapshot
            const snapshot = spectrum.saveSnapshot();
            
            // Change state
            spectrum.cpu.iff1 = false;
            spectrum.cpu.iff2 = false;
            spectrum.cpu.interruptMode = 0;
            
            // Restore from snapshot
            spectrum.loadSnapshot(snapshot);
            
            // Verify interrupt state was restored
            expect(spectrum.cpu.iff1).toBe(true);
            expect(spectrum.cpu.iff2).toBe(true);
            expect(spectrum.cpu.interruptMode).toBe(2);
        });

        it('should preserve black border when loading saved state snapshots', () => {
            const snapshot = spectrum.saveSnapshot();
            snapshot.ula.borderColor = 0;
            spectrum.ula.borderColor = 7;

            spectrum.loadSnapshot(snapshot);

            expect(spectrum.ula.borderColor).toBe(0);
        });
    });

    describe('Snapshot with running program', () => {
        it('should save and restore program state mid-execution', () => {
            // Load a simple program
            const program = [
                0x3E, 0x00,     // LD A, 0
                0x3C,           // INC A (loop start)
                0xFE, 0x10,     // CP 16
                0x20, 0xFB,     // JR NZ, -5 (back to INC A)
                0x76            // HALT
            ];
            
            let addr = 0x8000;
            for (const byte of program) {
                spectrum.memory.write(addr++, byte);
            }
            
            spectrum.cpu.registers.setPC(0x8000);
            
            // Execute part way through (5 increments)
            for (let i = 0; i < 15; i++) {
                spectrum.cpu.execute();
            }
            
            // A should be partially incremented
            const midA = spectrum.cpu.registers.get('A');
            expect(midA).toBeGreaterThan(0);
            expect(midA).toBeLessThan(16);
            
            // Save snapshot
            const snapshot = spectrum.saveSnapshot();
            
            // Reset and continue execution to completion
            spectrum.reset();
            spectrum.loadSnapshot(snapshot);
            
            // Continue execution
            let steps = 0;
            while (!spectrum.cpu.halted && steps < 100) {
                spectrum.cpu.execute();
                steps++;
            }
            
            // Should have completed with A = 16
            expect(spectrum.cpu.registers.get('A')).toBe(16);
            expect(spectrum.cpu.halted).toBe(true);
        });
    });

    describe('Error handling', () => {
        it('should handle invalid snapshot data gracefully', () => {
            const invalidSnapshot = new Uint8Array([0, 1, 2, 3, 4]); // Too small
            
            expect(() => spectrum.loadZ80Snapshot(invalidSnapshot)).toThrow();
        });

        it('should handle corrupted snapshots', () => {
            const corruptedSnapshot = new Uint8Array(30 + 49152);
            // Fill with random data
            for (let i = 0; i < corruptedSnapshot.length; i++) {
                corruptedSnapshot[i] = Math.floor(Math.random() * 256);
            }
            
            // Should not crash
            expect(() => spectrum.loadZ80Snapshot(corruptedSnapshot)).not.toThrow();
            
            // But state might be invalid - just check it's still running
            expect(spectrum.cpu).toBeDefined();
        });
    });
});
