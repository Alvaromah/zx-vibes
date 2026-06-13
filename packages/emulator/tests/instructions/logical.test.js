import { Z80 as CPU } from '../../src/core/cpu.js';
import { Registers } from '../../src/core/registers.js';

describe('Logical Instructions', () => {
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

  describe('AND operations', () => {
    describe('AND r', () => {
      it('should AND register with accumulator', () => {
        cpu.registers.a = 0xFF;
        cpu.registers.b = 0x0F;
        mockMemory.read.mockReturnValue(0xA0); // AND B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x0F);
        expect(cpu.registers.f & 0x40).toBe(0); // Z flag clear
        expect(cpu.registers.f & 0x10).toBe(0x10); // H flag set
        expect(cpu.registers.f & 0x02).toBe(0); // N flag clear
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear
      });

      it('should set zero flag when result is zero', () => {
        cpu.registers.a = 0xFF;
        cpu.registers.b = 0x00;
        mockMemory.read.mockReturnValue(0xA0); // AND B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x00);
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });

      it('should set parity flag for even parity', () => {
        cpu.registers.a = 0xFF;
        cpu.registers.b = 0x03; // Result 0x03 has 2 bits set (even)
        mockMemory.read.mockReturnValue(0xA0); // AND B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x03);
        expect(cpu.registers.f & 0x04).toBe(0x04); // P/V flag set (even parity)
      });

      it('should clear parity flag for odd parity', () => {
        cpu.registers.a = 0xFF;
        cpu.registers.b = 0x01; // Result 0x01 has 1 bit set (odd)
        mockMemory.read.mockReturnValue(0xA0); // AND B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x01);
        expect(cpu.registers.f & 0x04).toBe(0); // P/V flag clear (odd parity)
      });

      it('should set sign flag for negative result', () => {
        cpu.registers.a = 0xFF;
        cpu.registers.b = 0x80;
        mockMemory.read.mockReturnValue(0xA0); // AND B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x80);
        expect(cpu.registers.f & 0x80).toBe(0x80); // S flag set
      });
    });

    describe('AND n', () => {
      it('should AND immediate value with accumulator', () => {
        cpu.registers.a = 0xFF;
        mockMemory.read.mockReturnValueOnce(0xE6); // AND n
        mockMemory.read.mockReturnValueOnce(0x0F); // immediate value

        cpu.execute();

        expect(cpu.registers.a).toBe(0x0F);
      });
    });

    describe('AND (HL)', () => {
      it('should AND memory value with accumulator', () => {
        cpu.registers.a = 0xFF;
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0xA6); // AND (HL)
        mockMemory.read.mockReturnValueOnce(0x0F); // value at (HL)

        cpu.execute();

        expect(cpu.registers.a).toBe(0x0F);
        expect(mockMemory.read).toHaveBeenCalledWith(0x1000);
      });
    });
  });

  describe('OR operations', () => {
    describe('OR r', () => {
      it('should OR register with accumulator', () => {
        cpu.registers.a = 0xF0;
        cpu.registers.b = 0x0F;
        mockMemory.read.mockReturnValue(0xB0); // OR B

        cpu.execute();

        expect(cpu.registers.a).toBe(0xFF);
        expect(cpu.registers.f & 0x40).toBe(0); // Z flag clear
        expect(cpu.registers.f & 0x10).toBe(0); // H flag clear
        expect(cpu.registers.f & 0x02).toBe(0); // N flag clear
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear
      });

      it('should set zero flag when result is zero', () => {
        cpu.registers.a = 0x00;
        cpu.registers.b = 0x00;
        mockMemory.read.mockReturnValue(0xB0); // OR B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x00);
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });

      it('should handle OR with same value', () => {
        cpu.registers.a = 0x55;
        cpu.registers.b = 0x55;
        mockMemory.read.mockReturnValue(0xB0); // OR B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x55);
      });
    });

    describe('OR n', () => {
      it('should OR immediate value with accumulator', () => {
        cpu.registers.a = 0xF0;
        mockMemory.read.mockReturnValueOnce(0xF6); // OR n
        mockMemory.read.mockReturnValueOnce(0x0F); // immediate value

        cpu.execute();

        expect(cpu.registers.a).toBe(0xFF);
      });
    });

    describe('OR (HL)', () => {
      it('should OR memory value with accumulator', () => {
        cpu.registers.a = 0xF0;
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0xB6); // OR (HL)
        mockMemory.read.mockReturnValueOnce(0x0F); // value at (HL)

        cpu.execute();

        expect(cpu.registers.a).toBe(0xFF);
        expect(mockMemory.read).toHaveBeenCalledWith(0x1000);
      });
    });
  });

  describe('XOR operations', () => {
    describe('XOR r', () => {
      it('should XOR register with accumulator', () => {
        cpu.registers.a = 0xFF;
        cpu.registers.b = 0x0F;
        mockMemory.read.mockReturnValue(0xA8); // XOR B

        cpu.execute();

        expect(cpu.registers.a).toBe(0xF0);
        expect(cpu.registers.f & 0x40).toBe(0); // Z flag clear
        expect(cpu.registers.f & 0x10).toBe(0); // H flag clear
        expect(cpu.registers.f & 0x02).toBe(0); // N flag clear
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear
      });

      it('should set zero flag when XORing same values', () => {
        cpu.registers.a = 0x55;
        cpu.registers.b = 0x55;
        mockMemory.read.mockReturnValue(0xA8); // XOR B

        cpu.execute();

        expect(cpu.registers.a).toBe(0x00);
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });

      it('should clear accumulator when XORing with itself', () => {
        cpu.registers.a = 0xFF;
        mockMemory.read.mockReturnValue(0xAF); // XOR A

        cpu.execute();

        expect(cpu.registers.a).toBe(0x00);
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });
    });

    describe('XOR n', () => {
      it('should XOR immediate value with accumulator', () => {
        cpu.registers.a = 0xFF;
        mockMemory.read.mockReturnValueOnce(0xEE); // XOR n
        mockMemory.read.mockReturnValueOnce(0x0F); // immediate value

        cpu.execute();

        expect(cpu.registers.a).toBe(0xF0);
      });
    });

    describe('XOR (HL)', () => {
      it('should XOR memory value with accumulator', () => {
        cpu.registers.a = 0xFF;
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0xAE); // XOR (HL)
        mockMemory.read.mockReturnValueOnce(0x0F); // value at (HL)

        cpu.execute();

        expect(cpu.registers.a).toBe(0xF0);
        expect(mockMemory.read).toHaveBeenCalledWith(0x1000);
      });
    });
  });

  describe('CPL (Complement Accumulator)', () => {
    it('should complement all bits in accumulator', () => {
      cpu.registers.a = 0x55;
      mockMemory.read.mockReturnValue(0x2F); // CPL

      cpu.execute();

      expect(cpu.registers.a).toBe(0xAA);
      expect(cpu.registers.f & 0x10).toBe(0x10); // H flag set
      expect(cpu.registers.f & 0x02).toBe(0x02); // N flag set
    });

    it('should not affect other flags', () => {
      cpu.registers.a = 0x00;
      cpu.registers.f = 0x85; // Set S, Z, C flags
      mockMemory.read.mockReturnValue(0x2F); // CPL

      cpu.execute();

      expect(cpu.registers.a).toBe(0xFF);
      expect(cpu.registers.f & 0x80).toBe(0x80); // S flag preserved
      expect(cpu.registers.f & 0x01).toBe(0x01); // C flag preserved
    });
  });

  describe('SCF (Set Carry Flag)', () => {
    it('should set carry flag', () => {
      cpu.registers.f = 0x00;
      mockMemory.read.mockReturnValue(0x37); // SCF

      cpu.execute();

      expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set
      expect(cpu.registers.f & 0x10).toBe(0); // H flag clear
      expect(cpu.registers.f & 0x02).toBe(0); // N flag clear
    });

    it('should preserve other flags', () => {
      cpu.registers.f = 0x84; // Set S and P/V flags
      mockMemory.read.mockReturnValue(0x37); // SCF

      cpu.execute();

      expect(cpu.registers.f & 0x80).toBe(0x80); // S flag preserved
      expect(cpu.registers.f & 0x04).toBe(0x04); // P/V flag preserved
      expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set
    });
  });

  describe('CCF (Complement Carry Flag)', () => {
    it('should complement carry flag when set', () => {
      cpu.registers.f = 0x01; // Carry flag set
      mockMemory.read.mockReturnValue(0x3F); // CCF

      cpu.execute();

      expect(cpu.registers.f & 0x01).toBe(0); // C flag clear
      expect(cpu.registers.f & 0x10).toBe(0x10); // H flag set to previous C
    });

    it('should complement carry flag when clear', () => {
      cpu.registers.f = 0x00; // Carry flag clear
      mockMemory.read.mockReturnValue(0x3F); // CCF

      cpu.execute();

      expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set
      expect(cpu.registers.f & 0x10).toBe(0); // H flag clear (previous C was 0)
    });

    it('should clear N flag', () => {
      cpu.registers.f = 0x41; // Set N and C flags
      mockMemory.read.mockReturnValue(0x3F); // CCF

      cpu.execute();

      expect(cpu.registers.f & 0x02).toBe(0); // N flag clear
    });
  });

  describe('Flag combinations', () => {
    it('should handle complex flag scenarios with AND', () => {
      // Test undocumented flag behavior
      cpu.registers.a = 0x00;
      cpu.registers.b = 0x00;
      mockMemory.read.mockReturnValue(0xA0); // AND B

      cpu.execute();

      expect(cpu.registers.a).toBe(0x00);
      expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      expect(cpu.registers.f & 0x10).toBe(0x10); // H flag set
      expect(cpu.registers.f & 0x04).toBe(0x04); // P/V flag set (even parity - 0 bits)
      expect(cpu.registers.f & 0x01).toBe(0); // C flag clear
      expect(cpu.registers.f & 0x02).toBe(0); // N flag clear
    });

    it('should handle undocumented flag bits (bits 3 and 5)', () => {
      // These are typically copied from the result
      cpu.registers.a = 0x28; // Bit 3 and 5 set
      cpu.registers.b = 0x28;
      mockMemory.read.mockReturnValue(0xA0); // AND B

      cpu.execute();

      expect(cpu.registers.a).toBe(0x28);
      expect(cpu.registers.f & 0x08).toBe(0x08); // Bit 3 set
      expect(cpu.registers.f & 0x20).toBe(0x20); // Bit 5 set
    });
  });
});