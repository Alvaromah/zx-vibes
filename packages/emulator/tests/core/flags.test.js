import { Flags } from '../../src/core/flags.js';

describe('Flags', () => {
    let flags;

    beforeEach(() => {
        flags = new Flags();
    });

    describe('flag masks', () => {
        it('should have correct flag masks', () => {
            expect(flags.masks.S).toBe(0x80);
            expect(flags.masks.Z).toBe(0x40);
            expect(flags.masks.F5).toBe(0x20);
            expect(flags.masks.H).toBe(0x10);
            expect(flags.masks.F3).toBe(0x08);
            expect(flags.masks.PV).toBe(0x04);
            expect(flags.masks.N).toBe(0x02);
            expect(flags.masks.C).toBe(0x01);
        });
    });

    describe('getFlag', () => {
        it('should get flag state correctly', () => {
            const fRegister = 0b11111111; // All flags set
            
            expect(flags.getFlag(fRegister, flags.masks.S)).toBe(true);
            expect(flags.getFlag(fRegister, flags.masks.Z)).toBe(true);
            expect(flags.getFlag(fRegister, flags.masks.C)).toBe(true);
        });

        it('should return false for unset flags', () => {
            const fRegister = 0b00000000; // No flags set
            
            expect(flags.getFlag(fRegister, flags.masks.S)).toBe(false);
            expect(flags.getFlag(fRegister, flags.masks.Z)).toBe(false);
            expect(flags.getFlag(fRegister, flags.masks.C)).toBe(false);
        });

        it('should get individual flags correctly', () => {
            const fRegister = 0b10000001; // S and C flags set
            
            expect(flags.getFlag(fRegister, flags.masks.S)).toBe(true);
            expect(flags.getFlag(fRegister, flags.masks.Z)).toBe(false);
            expect(flags.getFlag(fRegister, flags.masks.C)).toBe(true);
        });
    });

    describe('setFlag', () => {
        it('should set flag to true', () => {
            let fRegister = 0x00;
            
            fRegister = flags.setFlag(fRegister, flags.masks.S, true);
            expect(fRegister & flags.masks.S).toBe(flags.masks.S);
            
            fRegister = flags.setFlag(fRegister, flags.masks.Z, true);
            expect(fRegister & flags.masks.Z).toBe(flags.masks.Z);
        });

        it('should set flag to false', () => {
            let fRegister = 0xFF; // All flags set
            
            fRegister = flags.setFlag(fRegister, flags.masks.S, false);
            expect(fRegister & flags.masks.S).toBe(0);
            
            fRegister = flags.setFlag(fRegister, flags.masks.Z, false);
            expect(fRegister & flags.masks.Z).toBe(0);
        });

        it('should not affect other flags', () => {
            let fRegister = 0b11101010; // Z flag (bit 6) is set
            
            fRegister = flags.setFlag(fRegister, flags.masks.C, true);
            expect(fRegister).toBe(0b11101011);
            
            fRegister = flags.setFlag(fRegister, flags.masks.Z, false);
            expect(fRegister).toBe(0b10101011);
        });
    });

    describe('calculateParity', () => {
        it('should calculate even parity correctly', () => {
            expect(flags.calculateParity(0b00000000)).toBe(true); // 0 bits set
            expect(flags.calculateParity(0b00000011)).toBe(true); // 2 bits set
            expect(flags.calculateParity(0b00001111)).toBe(true); // 4 bits set
            expect(flags.calculateParity(0b11111111)).toBe(true); // 8 bits set
        });

        it('should calculate odd parity correctly', () => {
            expect(flags.calculateParity(0b00000001)).toBe(false); // 1 bit set
            expect(flags.calculateParity(0b00000111)).toBe(false); // 3 bits set
            expect(flags.calculateParity(0b01111111)).toBe(false); // 7 bits set
        });

        it('should handle various values', () => {
            expect(flags.calculateParity(0x00)).toBe(true);  // 0 bits
            expect(flags.calculateParity(0x80)).toBe(false); // 1 bit
            expect(flags.calculateParity(0xAA)).toBe(true);  // 4 bits (10101010)
            expect(flags.calculateParity(0x55)).toBe(true);  // 4 bits (01010101)
        });
    });

    describe('updateFlags', () => {
        describe('arithmetic operations', () => {
            it('should update flags for zero result', () => {
                const result = flags.updateFlags(0x00, 0x00, 'arithmetic');
                
                expect(flags.getFlag(result, flags.masks.Z)).toBe(true);
                expect(flags.getFlag(result, flags.masks.S)).toBe(false);
                expect(flags.getFlag(result, flags.masks.N)).toBe(false);
            });

            it('should update flags for negative result', () => {
                const result = flags.updateFlags(0x00, 0x80, 'arithmetic');
                
                expect(flags.getFlag(result, flags.masks.S)).toBe(true);
                expect(flags.getFlag(result, flags.masks.Z)).toBe(false);
                expect(flags.getFlag(result, flags.masks.N)).toBe(false);
            });

            it('should update undocumented flags F3 and F5', () => {
                const result = flags.updateFlags(0x00, 0b00101000, 'arithmetic');
                
                expect(flags.getFlag(result, flags.masks.F5)).toBe(true);  // bit 5 set
                expect(flags.getFlag(result, flags.masks.F3)).toBe(true);  // bit 3 set
            });
        });

        describe('subtract operations', () => {
            it('should set N flag for subtract', () => {
                const result = flags.updateFlags(0x00, 0x01, 'subtract');
                
                expect(flags.getFlag(result, flags.masks.N)).toBe(true);
            });
        });

        describe('logical operations', () => {
            it('should clear N and H flags', () => {
                const result = flags.updateFlags(0xFF, 0x00, 'logical');
                
                expect(flags.getFlag(result, flags.masks.N)).toBe(false);
            });

            it('should set parity flag correctly', () => {
                let result = flags.updateFlags(0x00, 0xFF, 'logical'); // 8 bits = even parity
                expect(flags.getFlag(result, flags.masks.PV)).toBe(true);
                
                result = flags.updateFlags(0x00, 0x01, 'logical'); // 1 bit = odd parity
                expect(flags.getFlag(result, flags.masks.PV)).toBe(false);
            });
        });
    });

    describe('updateInFlags', () => {
        it('should update flags for IN instruction correctly', () => {
            const result = flags.updateInFlags(0xFF, 0x80);
            
            expect(flags.getFlag(result, flags.masks.S)).toBe(true);  // negative
            expect(flags.getFlag(result, flags.masks.Z)).toBe(false); // not zero
            expect(flags.getFlag(result, flags.masks.H)).toBe(false); // always cleared
            expect(flags.getFlag(result, flags.masks.N)).toBe(false); // always cleared
            expect(flags.getFlag(result, flags.masks.PV)).toBe(false); // odd parity
        });

        it('should handle zero value', () => {
            const result = flags.updateInFlags(0xFF, 0x00);
            
            expect(flags.getFlag(result, flags.masks.Z)).toBe(true);
            expect(flags.getFlag(result, flags.masks.S)).toBe(false);
            expect(flags.getFlag(result, flags.masks.PV)).toBe(true); // even parity
        });

        it('should update undocumented flags', () => {
            const result = flags.updateInFlags(0x00, 0b00101000);
            
            expect(flags.getFlag(result, flags.masks.F5)).toBe(true);
            expect(flags.getFlag(result, flags.masks.F3)).toBe(true);
        });
    });

    describe('updateIncFlags', () => {
        it('should update flags for increment correctly', () => {
            const result = flags.updateIncFlags(0x00, 0x7F, 0x80);
            
            expect(flags.getFlag(result, flags.masks.S)).toBe(true);  // negative result
            expect(flags.getFlag(result, flags.masks.Z)).toBe(false); // not zero
            expect(flags.getFlag(result, flags.masks.H)).toBe(true);  // half carry from 0x7F to 0x80
            expect(flags.getFlag(result, flags.masks.PV)).toBe(true); // overflow from 0x7F to 0x80
            expect(flags.getFlag(result, flags.masks.N)).toBe(false); // cleared for increment
        });

        it('should handle increment to zero', () => {
            const result = flags.updateIncFlags(0x00, 0xFF, 0x00);
            
            expect(flags.getFlag(result, flags.masks.Z)).toBe(true);
            expect(flags.getFlag(result, flags.masks.H)).toBe(true); // half carry from 0xFF to 0x00
            expect(flags.getFlag(result, flags.masks.PV)).toBe(false); // no overflow
        });

        it('should detect half carry correctly', () => {
            // Half carry occurs when bit 3 carries to bit 4
            let result = flags.updateIncFlags(0x00, 0x0F, 0x10);
            expect(flags.getFlag(result, flags.masks.H)).toBe(true);
            
            result = flags.updateIncFlags(0x00, 0x0E, 0x0F);
            expect(flags.getFlag(result, flags.masks.H)).toBe(false);
        });

        it('should update undocumented flags', () => {
            const result = flags.updateIncFlags(0x00, 0x27, 0x28);
            
            expect(flags.getFlag(result, flags.masks.F5)).toBe(true);  // bit 5 of 0x28
            expect(flags.getFlag(result, flags.masks.F3)).toBe(true);  // bit 3 of 0x28
        });
    });

    describe('updateDecFlags', () => {
        it('should update flags for decrement correctly', () => {
            const result = flags.updateDecFlags(0x00, 0x80, 0x7F);
            
            expect(flags.getFlag(result, flags.masks.S)).toBe(false); // positive result
            expect(flags.getFlag(result, flags.masks.Z)).toBe(false); // not zero
            expect(flags.getFlag(result, flags.masks.H)).toBe(true);  // half borrow occurs: 0x80 & 0x0F = 0, so H is set
            expect(flags.getFlag(result, flags.masks.PV)).toBe(true);  // overflow from 0x80 to 0x7F
            expect(flags.getFlag(result, flags.masks.N)).toBe(true);  // set for decrement
        });

        it('should handle decrement to zero', () => {
            const result = flags.updateDecFlags(0x00, 0x01, 0x00);
            
            expect(flags.getFlag(result, flags.masks.Z)).toBe(true);
            expect(flags.getFlag(result, flags.masks.H)).toBe(false); // no half borrow
            expect(flags.getFlag(result, flags.masks.PV)).toBe(false); // no overflow
        });

        it('should detect half borrow correctly', () => {
            // Half borrow occurs when bit 4 borrows from bit 3
            let result = flags.updateDecFlags(0x00, 0x10, 0x0F);
            expect(flags.getFlag(result, flags.masks.H)).toBe(true);
            
            result = flags.updateDecFlags(0x00, 0x11, 0x10);
            expect(flags.getFlag(result, flags.masks.H)).toBe(false);
        });

        it('should update undocumented flags', () => {
            const result = flags.updateDecFlags(0x00, 0x29, 0x28);
            
            expect(flags.getFlag(result, flags.masks.F5)).toBe(true);  // bit 5 of 0x28
            expect(flags.getFlag(result, flags.masks.F3)).toBe(true);  // bit 3 of 0x28
        });
    });

    describe('updateBitTestFlags', () => {
        it('should test bit correctly when bit is set', () => {
            const result = flags.updateBitTestFlags(0x00, 3, 0b00001000);
            
            expect(flags.getFlag(result, flags.masks.Z)).toBe(false);  // bit is set
            expect(flags.getFlag(result, flags.masks.PV)).toBe(false); // PV = Z for BIT
            expect(flags.getFlag(result, flags.masks.H)).toBe(true);   // always set
            expect(flags.getFlag(result, flags.masks.N)).toBe(false);  // always cleared
        });

        it('should test bit correctly when bit is clear', () => {
            const result = flags.updateBitTestFlags(0x00, 3, 0b11110111);
            
            expect(flags.getFlag(result, flags.masks.Z)).toBe(true);  // bit is clear
            expect(flags.getFlag(result, flags.masks.PV)).toBe(true); // PV = Z for BIT
        });

        it('should set S flag for bit 7', () => {
            let result = flags.updateBitTestFlags(0x00, 7, 0x80);
            expect(flags.getFlag(result, flags.masks.S)).toBe(true);
            
            result = flags.updateBitTestFlags(0x00, 7, 0x7F);
            expect(flags.getFlag(result, flags.masks.S)).toBe(false);
            
            // S flag should not be set for other bits
            result = flags.updateBitTestFlags(0x00, 6, 0x40);
            expect(flags.getFlag(result, flags.masks.S)).toBe(false);
        });

        it('should set undocumented flags from tested value', () => {
            const result = flags.updateBitTestFlags(0x00, 0, 0b00101000);
            
            expect(flags.getFlag(result, flags.masks.F5)).toBe(true);  // bit 5 of value
            expect(flags.getFlag(result, flags.masks.F3)).toBe(true);  // bit 3 of value
        });

        it('should handle all bit positions', () => {
            for (let bit = 0; bit < 8; bit++) {
                const value = 1 << bit;
                const result = flags.updateBitTestFlags(0x00, bit, value);
                
                expect(flags.getFlag(result, flags.masks.Z)).toBe(false); // bit is set
                expect(flags.getFlag(result, flags.masks.H)).toBe(true);  // always set
            }
        });
    });
});