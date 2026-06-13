import { Z80 as CPU } from '../../src/core/cpu.js';
import { Registers } from '../../src/core/registers.js';

describe('Arithmetic Instructions', () => {
  let cpu;
  let mockMemory;
  let mockIO;

  beforeEach(() => {
    mockMemory = {
      read: jest.fn(),
      write: jest.fn(),
    };
    mockIO = {
      read: jest.fn(),
      write: jest.fn(),
    };
    cpu = new CPU(mockMemory, mockIO);
  });

  describe('8-bit Arithmetic', () => {
    describe('ADD A,r', () => {
      it('should add register to accumulator', () => {
        cpu.registers.a = 0x10;
        cpu.registers.b = 0x20;
        mockMemory.read.mockReturnValue(0x80); // ADD A,B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x30);
        expect(cpu.registers.f & 0x40).toBe(0); // Z flag clear
        expect(cpu.registers.f & 0x02).toBe(0); // N flag clear
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear
      });

      it('should set zero flag when result is zero', () => {
        cpu.registers.a = 0x00;
        cpu.registers.b = 0x00;
        mockMemory.read.mockReturnValue(0x80); // ADD A,B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x00);
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });

      it('should set carry flag on overflow', () => {
        cpu.registers.a = 0xFF;
        cpu.registers.b = 0x01;
        mockMemory.read.mockReturnValue(0x80); // ADD A,B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x00);
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });

      it('should set half-carry flag', () => {
        cpu.registers.a = 0x0F;
        cpu.registers.b = 0x01;
        mockMemory.read.mockReturnValue(0x80); // ADD A,B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x10);
        expect(cpu.registers.f & 0x10).toBe(0x10); // H flag set
      });

      it('should set overflow flag', () => {
        cpu.registers.a = 0x7F;
        cpu.registers.b = 0x01;
        mockMemory.read.mockReturnValue(0x80); // ADD A,B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x80);
        expect(cpu.registers.f & 0x04).toBe(0x04); // P/V flag set (overflow)
      });
    });

    describe('ADD A,n', () => {
      it('should add immediate value to accumulator', () => {
        cpu.registers.a = 0x10;
        mockMemory.read.mockReturnValueOnce(0xC6); // ADD A,n
        mockMemory.read.mockReturnValueOnce(0x20); // immediate value

        cpu.execute();

        expect(cpu.registers.a).toBe(0x30);
      });
    });

    describe('ADD A,(HL)', () => {
      it('should add memory value to accumulator', () => {
        cpu.registers.a = 0x10;
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0x86); // ADD A,(HL)
        mockMemory.read.mockReturnValueOnce(0x20); // value at (HL)

        cpu.execute();

        expect(cpu.registers.a).toBe(0x30);
        expect(mockMemory.read).toHaveBeenCalledWith(0x1000);
      });
    });

    describe('SUB r', () => {
      it('should subtract register from accumulator', () => {
        cpu.registers.a = 0x30;
        cpu.registers.b = 0x10;
        mockMemory.read.mockReturnValue(0x90); // SUB B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x20);
        expect(cpu.registers.f & 0x02).toBe(0x02); // N flag set
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear
      });

      it('should set carry flag on borrow', () => {
        cpu.registers.a = 0x10;
        cpu.registers.b = 0x20;
        mockMemory.read.mockReturnValue(0x90); // SUB B

        cpu.execute();

        expect(cpu.registers.a).toBe(0xF0);
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set (borrow)
      });
    });

    describe('ADC A,r', () => {
      it('should add register and carry to accumulator', () => {
        cpu.registers.a = 0x10;
        cpu.registers.b = 0x20;
        cpu.registers.f = 0x01; // Set carry flag
        mockMemory.read.mockReturnValue(0x88); // ADC A,B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x31);
      });
    });

    describe('SBC A,r', () => {
      it('should subtract register and carry from accumulator', () => {
        cpu.registers.a = 0x30;
        cpu.registers.b = 0x10;
        cpu.registers.f = 0x01; // Set carry flag
        mockMemory.read.mockReturnValue(0x98); // SBC A,B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x1F);
      });
    });

    describe('INC r', () => {
      it('should increment register', () => {
        cpu.registers.b = 0x10;
        mockMemory.read.mockReturnValue(0x04); // INC B

        cpu.execute();

        expect(cpu.registers.b).toBe(0x11);
        expect(cpu.registers.f & 0x02).toBe(0); // N flag clear
      });

      it('should set zero flag when incrementing 0xFF', () => {
        cpu.registers.b = 0xFF;
        mockMemory.read.mockReturnValue(0x04); // INC B

        cpu.execute();

        expect(cpu.registers.b).toBe(0x00);
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });

      it('should set half-carry flag', () => {
        cpu.registers.b = 0x0F;
        mockMemory.read.mockReturnValue(0x04); // INC B

        cpu.execute();

        expect(cpu.registers.b).toBe(0x10);
        expect(cpu.registers.f & 0x10).toBe(0x10); // H flag set
      });

      it('should set overflow flag when incrementing 0x7F', () => {
        cpu.registers.b = 0x7F;
        mockMemory.read.mockReturnValue(0x04); // INC B

        cpu.execute();

        expect(cpu.registers.b).toBe(0x80);
        expect(cpu.registers.f & 0x04).toBe(0x04); // P/V flag set (overflow)
      });

      it('should not affect carry flag', () => {
        cpu.registers.b = 0xFF;
        cpu.registers.f = 0x01; // Set carry flag
        mockMemory.read.mockReturnValue(0x04); // INC B

        cpu.execute();

        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag unchanged
      });
    });

    describe('DEC r', () => {
      it('should decrement register', () => {
        cpu.registers.b = 0x10;
        mockMemory.read.mockReturnValue(0x05); // DEC B

        cpu.execute();

        expect(cpu.registers.b).toBe(0x0F);
        expect(cpu.registers.f & 0x02).toBe(0x02); // N flag set
      });

      it('should set zero flag when decrementing 0x01', () => {
        cpu.registers.b = 0x01;
        mockMemory.read.mockReturnValue(0x05); // DEC B

        cpu.execute();

        expect(cpu.registers.b).toBe(0x00);
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });

      it('should set overflow flag when decrementing 0x80', () => {
        cpu.registers.b = 0x80;
        mockMemory.read.mockReturnValue(0x05); // DEC B

        cpu.execute();

        expect(cpu.registers.b).toBe(0x7F);
        expect(cpu.registers.f & 0x04).toBe(0x04); // P/V flag set (overflow)
      });
    });

    describe('CP r', () => {
      it('should compare register with accumulator without changing A', () => {
        cpu.registers.a = 0x30;
        cpu.registers.b = 0x20;
        mockMemory.read.mockReturnValue(0xB8); // CP B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x30); // A unchanged
        expect(cpu.registers.f & 0x40).toBe(0); // Z flag clear (not equal)
        expect(cpu.registers.f & 0x02).toBe(0x02); // N flag set
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear (no borrow)
      });

      it('should set zero flag when values are equal', () => {
        cpu.registers.a = 0x20;
        cpu.registers.b = 0x20;
        mockMemory.read.mockReturnValue(0xB8); // CP B

        cpu.execute();

        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });

      it('should set carry flag when A < operand', () => {
        cpu.registers.a = 0x10;
        cpu.registers.b = 0x20;
        mockMemory.read.mockReturnValue(0xB8); // CP B

        cpu.execute();

        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set
      });
    });

    describe('NEG', () => {
      it('should negate accumulator', () => {
        cpu.registers.a = 0x10;
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x44); // NEG

        cpu.execute();

        expect(cpu.registers.a).toBe(0xF0);
        expect(cpu.registers.f & 0x02).toBe(0x02); // N flag set
      });

      it('should handle NEG of 0x00', () => {
        cpu.registers.a = 0x00;
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x44); // NEG

        cpu.execute();

        expect(cpu.registers.a).toBe(0x00);
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear
      });

      it('should handle NEG of 0x80', () => {
        cpu.registers.a = 0x80;
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x44); // NEG

        cpu.execute();

        expect(cpu.registers.a).toBe(0x80);
        expect(cpu.registers.f & 0x04).toBe(0x04); // P/V flag set (overflow)
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set
      });
    });
  });

  describe('16-bit Arithmetic', () => {
    describe('ADD HL,rr', () => {
      it('should add 16-bit register to HL', () => {
        cpu.registers.setHL(0x1000);
        cpu.registers.setBC(0x2000);
        mockMemory.read.mockReturnValue(0x09); // ADD HL,BC

        cpu.execute();

        expect(cpu.registers.getHL()).toBe(0x3000);
        expect(cpu.registers.f & 0x02).toBe(0); // N flag clear
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear
      });

      it('should set carry flag on 16-bit overflow', () => {
        cpu.registers.setHL(0xFFFF);
        cpu.registers.setBC(0x0001);
        mockMemory.read.mockReturnValue(0x09); // ADD HL,BC

        cpu.execute();

        expect(cpu.registers.getHL()).toBe(0x0000);
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set
      });

      it('should set half-carry flag on bit 11 carry', () => {
        cpu.registers.setHL(0x0FFF);
        cpu.registers.setBC(0x0001);
        mockMemory.read.mockReturnValue(0x09); // ADD HL,BC

        cpu.execute();

        expect(cpu.registers.getHL()).toBe(0x1000);
        expect(cpu.registers.f & 0x10).toBe(0x10); // H flag set
      });
    });

    describe('INC rr', () => {
      it('should increment 16-bit register', () => {
        cpu.registers.setBC(0x1000);
        mockMemory.read.mockReturnValue(0x03); // INC BC

        cpu.execute();

        expect(cpu.registers.getBC()).toBe(0x1001);
      });

      it('should wrap around at 0xFFFF', () => {
        cpu.registers.setBC(0xFFFF);
        mockMemory.read.mockReturnValue(0x03); // INC BC

        cpu.execute();

        expect(cpu.registers.getBC()).toBe(0x0000);
      });

      it('should not affect flags', () => {
        cpu.registers.setBC(0xFFFF);
        cpu.registers.f = 0xFF; // Set all flags
        mockMemory.read.mockReturnValue(0x03); // INC BC

        cpu.execute();

        expect(cpu.registers.f).toBe(0xFF); // Flags unchanged
      });
    });

    describe('DEC rr', () => {
      it('should decrement 16-bit register', () => {
        cpu.registers.setBC(0x1000);
        mockMemory.read.mockReturnValue(0x0B); // DEC BC

        cpu.execute();

        expect(cpu.registers.getBC()).toBe(0x0FFF);
      });

      it('should wrap around at 0x0000', () => {
        cpu.registers.setBC(0x0000);
        mockMemory.read.mockReturnValue(0x0B); // DEC BC

        cpu.execute();

        expect(cpu.registers.getBC()).toBe(0xFFFF);
      });
    });

    describe('ADC HL,rr', () => {
      it('should add 16-bit register and carry to HL', () => {
        cpu.registers.setHL(0x1000);
        cpu.registers.setBC(0x2000);
        cpu.registers.f = 0x01; // Set carry flag
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x4A); // ADC HL,BC

        cpu.execute();

        expect(cpu.registers.getHL()).toBe(0x3001);
      });

      it('should set zero flag when result is zero', () => {
        cpu.registers.setHL(0xFFFF);
        cpu.registers.setBC(0x0000);
        cpu.registers.f = 0x01; // Set carry flag
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x4A); // ADC HL,BC

        cpu.execute();

        expect(cpu.registers.getHL()).toBe(0x0000);
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });

      it('should set overflow flag appropriately', () => {
        cpu.registers.setHL(0x7FFF);
        cpu.registers.setBC(0x0001);
        cpu.registers.f = 0x00; // Clear carry flag
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x4A); // ADC HL,BC

        cpu.execute();

        expect(cpu.registers.getHL()).toBe(0x8000);
        expect(cpu.registers.f & 0x04).toBe(0x04); // P/V flag set (overflow)
      });
    });

    describe('SBC HL,rr', () => {
      it('should subtract 16-bit register and carry from HL', () => {
        cpu.registers.setHL(0x3000);
        cpu.registers.setBC(0x1000);
        cpu.registers.f = 0x01; // Set carry flag
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x42); // SBC HL,BC

        cpu.execute();

        expect(cpu.registers.getHL()).toBe(0x1FFF);
      });

      it('should set carry flag on borrow', () => {
        cpu.registers.setHL(0x1000);
        cpu.registers.setBC(0x2000);
        cpu.registers.f = 0x00; // Clear carry flag
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x42); // SBC HL,BC

        cpu.execute();

        expect(cpu.registers.getHL()).toBe(0xF000);
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set (borrow)
      });
    });
  });

  describe('DAA (Decimal Adjust Accumulator)', () => {
    it('should adjust accumulator after BCD addition', () => {
      cpu.registers.a = 0x19; // BCD 19
      cpu.registers.b = 0x28; // BCD 28
      mockMemory.read.mockReturnValueOnce(0x80); // ADD A,B
      cpu.execute();
      
      // Result is 0x41, needs adjustment to BCD 47
      mockMemory.read.mockReturnValueOnce(0x27); // DAA
      cpu.execute();

      expect(cpu.registers.a).toBe(0x47); // BCD 47
    });

    it('should handle carry from BCD addition', () => {
      cpu.registers.a = 0x99; // BCD 99
      cpu.registers.b = 0x01; // BCD 01
      mockMemory.read.mockReturnValueOnce(0x80); // ADD A,B
      cpu.execute();
      
      // Result is 0x9A, needs adjustment to BCD 00 with carry
      mockMemory.read.mockReturnValueOnce(0x27); // DAA
      cpu.execute();

      expect(cpu.registers.a).toBe(0x00); // BCD 00
      expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set
    });

    it('should adjust accumulator after BCD subtraction', () => {
      cpu.registers.a = 0x42; // BCD 42
      cpu.registers.b = 0x13; // BCD 13
      mockMemory.read.mockReturnValueOnce(0x90); // SUB B
      cpu.execute();
      
      // Result needs adjustment for BCD
      mockMemory.read.mockReturnValueOnce(0x27); // DAA
      cpu.execute();

      expect(cpu.registers.a).toBe(0x29); // BCD 29
    });
  });
});