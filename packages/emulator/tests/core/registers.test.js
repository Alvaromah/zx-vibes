import { Registers } from '../../src/core/registers.js';

describe('Registers', () => {
    let registers;

    beforeEach(() => {
        registers = new Registers();
    });

    describe('initialization', () => {
        it('should initialize all registers correctly', () => {
            expect(registers.get('A')).toBe(0);
            expect(registers.get('F')).toBe(0);
            expect(registers.get('B')).toBe(0);
            expect(registers.get('C')).toBe(0);
            expect(registers.get('D')).toBe(0);
            expect(registers.get('E')).toBe(0);
            expect(registers.get('H')).toBe(0);
            expect(registers.get('L')).toBe(0);
            expect(registers.get('I')).toBe(0);
            expect(registers.get('R')).toBe(0);
            expect(registers.get16('SP')).toBe(0xFFFF);
            expect(registers.get16('PC')).toBe(0x0000);
            expect(registers.get16('IX')).toBe(0x0000);
            expect(registers.get16('IY')).toBe(0x0000);
        });

        it('should reset all registers properly', () => {
            registers.set('A', 0x12);
            registers.set16('BC', 0x3456);
            registers.set16('PC', 0x1000);
            
            registers.reset();
            
            expect(registers.get('A')).toBe(0);
            expect(registers.get16('BC')).toBe(0);
            expect(registers.get16('PC')).toBe(0);
            expect(registers.get16('SP')).toBe(0xFFFF);
        });
    });

    describe('8-bit register operations', () => {
        it('should get and set 8-bit registers correctly', () => {
            registers.set('A', 0xFF);
            expect(registers.get('A')).toBe(0xFF);

            registers.set('B', 0x12);
            expect(registers.get('B')).toBe(0x12);

            registers.set('H', 0xAB);
            expect(registers.get('H')).toBe(0xAB);
        });

        it('should mask values to 8 bits', () => {
            registers.set('A', 0x1FF);
            expect(registers.get('A')).toBe(0xFF);

            registers.set('B', 0x300);
            expect(registers.get('B')).toBe(0x00);
        });

        it('should handle shadow registers', () => {
            registers.set('A_', 0x33);
            registers.set('B_', 0x44);
            expect(registers.get('A_')).toBe(0x33);
            expect(registers.get('B_')).toBe(0x44);
        });
    });

    describe('16-bit register pair operations', () => {
        describe('BC register pair', () => {
            it('should get and set BC correctly', () => {
                registers.setBC(0x1234);
                expect(registers.getBC()).toBe(0x1234);
                expect(registers.get('B')).toBe(0x12);
                expect(registers.get('C')).toBe(0x34);
            });

            it('should update BC when B or C changes', () => {
                registers.set('B', 0xAB);
                registers.set('C', 0xCD);
                expect(registers.getBC()).toBe(0xABCD);
            });
        });

        describe('DE register pair', () => {
            it('should get and set DE correctly', () => {
                registers.setDE(0x5678);
                expect(registers.getDE()).toBe(0x5678);
                expect(registers.get('D')).toBe(0x56);
                expect(registers.get('E')).toBe(0x78);
            });
        });

        describe('HL register pair', () => {
            it('should get and set HL correctly', () => {
                registers.setHL(0x9ABC);
                expect(registers.getHL()).toBe(0x9ABC);
                expect(registers.get('H')).toBe(0x9A);
                expect(registers.get('L')).toBe(0xBC);
            });
        });

        describe('AF register pair', () => {
            it('should get and set AF correctly', () => {
                registers.setAF(0xDEF0);
                expect(registers.getAF()).toBe(0xDEF0);
                expect(registers.get('A')).toBe(0xDE);
                expect(registers.get('F')).toBe(0xF0);
            });
        });

        it('should mask 16-bit values correctly', () => {
            registers.setBC(0x1FFFF);
            expect(registers.getBC()).toBe(0xFFFF);
        });
    });

    describe('16-bit register access', () => {
        it('should get 16-bit registers using get16', () => {
            registers.setBC(0x1234);
            registers.setDE(0x5678);
            registers.setHL(0x9ABC);
            registers.setAF(0xDEF0);
            registers.set16('SP', 0x8000);
            registers.set16('PC', 0x4000);
            registers.set16('IX', 0x2000);
            registers.set16('IY', 0x1000);

            expect(registers.get16('BC')).toBe(0x1234);
            expect(registers.get16('DE')).toBe(0x5678);
            expect(registers.get16('HL')).toBe(0x9ABC);
            expect(registers.get16('AF')).toBe(0xDEF0);
            expect(registers.get16('SP')).toBe(0x8000);
            expect(registers.get16('PC')).toBe(0x4000);
            expect(registers.get16('IX')).toBe(0x2000);
            expect(registers.get16('IY')).toBe(0x1000);
        });

        it('should set 16-bit registers using set16', () => {
            registers.set16('BC', 0x1111);
            registers.set16('DE', 0x2222);
            registers.set16('HL', 0x3333);
            registers.set16('AF', 0x4444);
            registers.set16('SP', 0x5555);
            registers.set16('PC', 0x6666);
            registers.set16('IX', 0x7777);
            registers.set16('IY', 0x8888);

            expect(registers.getBC()).toBe(0x1111);
            expect(registers.getDE()).toBe(0x2222);
            expect(registers.getHL()).toBe(0x3333);
            expect(registers.getAF()).toBe(0x4444);
            expect(registers.data.SP).toBe(0x5555);
            expect(registers.data.PC).toBe(0x6666);
            expect(registers.data.IX).toBe(0x7777);
            expect(registers.data.IY).toBe(0x8888);
        });

        it('should throw error for unknown 16-bit register', () => {
            expect(() => registers.get16('XY')).toThrow('Unknown 16-bit register: XY');
            expect(() => registers.set16('ZZ', 0x1234)).toThrow('Unknown 16-bit register: ZZ');
        });
    });

    describe('increment/decrement operations', () => {
        it('should increment 16-bit registers', () => {
            registers.set16('BC', 0x1234);
            registers.inc16('BC');
            expect(registers.get16('BC')).toBe(0x1235);

            registers.set16('HL', 0xFFFF);
            registers.inc16('HL');
            expect(registers.get16('HL')).toBe(0x0000);
        });

        it('should decrement 16-bit registers', () => {
            registers.set16('DE', 0x1234);
            registers.dec16('DE');
            expect(registers.get16('DE')).toBe(0x1233);

            registers.set16('SP', 0x0000);
            registers.dec16('SP');
            expect(registers.get16('SP')).toBe(0xFFFF);
        });
    });

    describe('program counter operations', () => {
        it('should increment PC by 1', () => {
            registers.setPC(0x1000);
            registers.incrementPC();
            expect(registers.getPC()).toBe(0x1001);
        });

        it('should increment PC by specified amount', () => {
            registers.setPC(0x1000);
            registers.incrementPC(3);
            expect(registers.getPC()).toBe(0x1003);
        });

        it('should wrap PC at 16-bit boundary', () => {
            registers.setPC(0xFFFE);
            registers.incrementPC(3);
            expect(registers.getPC()).toBe(0x0001);
        });

        it('should set PC correctly', () => {
            registers.setPC(0x8000);
            expect(registers.getPC()).toBe(0x8000);

            registers.setPC(0x1FFFF);
            expect(registers.getPC()).toBe(0xFFFF);
        });
    });

    describe('R register operations', () => {
        it('should increment R preserving bit 7', () => {
            registers.set('R', 0x00);
            registers.incrementR();
            expect(registers.get('R')).toBe(0x01);

            registers.set('R', 0x7F);
            registers.incrementR();
            expect(registers.get('R')).toBe(0x00);

            registers.set('R', 0x80);
            registers.incrementR();
            expect(registers.get('R')).toBe(0x81);

            registers.set('R', 0xFF);
            registers.incrementR();
            expect(registers.get('R')).toBe(0x80);
        });
    });

    describe('exchange operations', () => {
        it('should exchange AF with shadow AF', () => {
            registers.set('A', 0x12);
            registers.set('F', 0x34);
            registers.set('A_', 0x56);
            registers.set('F_', 0x78);

            registers.exchangeAF();

            expect(registers.get('A')).toBe(0x56);
            expect(registers.get('F')).toBe(0x78);
            expect(registers.get('A_')).toBe(0x12);
            expect(registers.get('F_')).toBe(0x34);
        });

        it('should exchange all main registers with shadows (EXX)', () => {
            registers.set('B', 0x11);
            registers.set('C', 0x22);
            registers.set('D', 0x33);
            registers.set('E', 0x44);
            registers.set('H', 0x55);
            registers.set('L', 0x66);

            registers.set('B_', 0xAA);
            registers.set('C_', 0xBB);
            registers.set('D_', 0xCC);
            registers.set('E_', 0xDD);
            registers.set('H_', 0xEE);
            registers.set('L_', 0xFF);

            registers.exchangeAll();

            expect(registers.get('B')).toBe(0xAA);
            expect(registers.get('C')).toBe(0xBB);
            expect(registers.get('D')).toBe(0xCC);
            expect(registers.get('E')).toBe(0xDD);
            expect(registers.get('H')).toBe(0xEE);
            expect(registers.get('L')).toBe(0xFF);

            expect(registers.get('B_')).toBe(0x11);
            expect(registers.get('C_')).toBe(0x22);
            expect(registers.get('D_')).toBe(0x33);
            expect(registers.get('E_')).toBe(0x44);
            expect(registers.get('H_')).toBe(0x55);
            expect(registers.get('L_')).toBe(0x66);
        });

        it('should exchange DE with HL', () => {
            registers.setDE(0x1234);
            registers.setHL(0x5678);

            registers.exchangeDE_HL();

            expect(registers.getDE()).toBe(0x5678);
            expect(registers.getHL()).toBe(0x1234);
        });
    });

    describe('undocumented IX/IY half registers', () => {
        describe('IX half registers', () => {
            it('should get and set IXH correctly', () => {
                registers.set16('IX', 0x1234);
                expect(registers.getIXH()).toBe(0x12);
                
                registers.setIXH(0xAB);
                expect(registers.getIXH()).toBe(0xAB);
                expect(registers.get16('IX')).toBe(0xAB34);
            });

            it('should get and set IXL correctly', () => {
                registers.set16('IX', 0x1234);
                expect(registers.getIXL()).toBe(0x34);
                
                registers.setIXL(0xCD);
                expect(registers.getIXL()).toBe(0xCD);
                expect(registers.get16('IX')).toBe(0x12CD);
            });
        });

        describe('IY half registers', () => {
            it('should get and set IYH correctly', () => {
                registers.set16('IY', 0x5678);
                expect(registers.getIYH()).toBe(0x56);
                
                registers.setIYH(0xEF);
                expect(registers.getIYH()).toBe(0xEF);
                expect(registers.get16('IY')).toBe(0xEF78);
            });

            it('should get and set IYL correctly', () => {
                registers.set16('IY', 0x5678);
                expect(registers.getIYL()).toBe(0x78);
                
                registers.setIYL(0x01);
                expect(registers.getIYL()).toBe(0x01);
                expect(registers.get16('IY')).toBe(0x5601);
            });
        });
    });

    describe('dump helper', () => {
        it('should return formatted register values', () => {
            registers.set('A', 0x12);
            registers.set('F', 0x34);
            registers.setBC(0x5678);
            registers.setDE(0x9ABC);
            registers.setHL(0xDEF0);
            registers.set16('SP', 0x1234);
            registers.set16('PC', 0x5678);
            registers.set16('IX', 0x9ABC);
            registers.set16('IY', 0xDEF0);
            registers.set('I', 0x11);
            registers.set('R', 0x22);

            const dump = registers.dump();

            expect(dump.A).toBe('12');
            expect(dump.F).toBe('34');
            expect(dump.BC).toBe('5678');
            expect(dump.DE).toBe('9abc');
            expect(dump.HL).toBe('def0');
            expect(dump.SP).toBe('1234');
            expect(dump.PC).toBe('5678');
            expect(dump.IX).toBe('9abc');
            expect(dump.IY).toBe('def0');
            expect(dump.I).toBe('11');
            expect(dump.R).toBe('22');
        });
    });
});