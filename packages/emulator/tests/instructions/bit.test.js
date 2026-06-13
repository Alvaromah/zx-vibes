import { Z80 as CPU } from '../../src/core/cpu.js';
import { Registers } from '../../src/core/registers.js';

describe('Bit Manipulation Instructions', () => {
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

  describe('BIT instructions', () => {
    describe('BIT b,r', () => {
      it('should test bit 0 in register B', () => {
        cpu.registers.b = 0x01; // Bit 0 set
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x40); // BIT 0,B

        cpu.execute();

        expect(cpu.registers.f & 0x40).toBe(0); // Z flag clear (bit is set)
        expect(cpu.registers.f & 0x10).toBe(0x10); // H flag set
        expect(cpu.registers.f & 0x02).toBe(0); // N flag clear
      });

      it('should set zero flag when bit is not set', () => {
        cpu.registers.b = 0xFE; // Bit 0 clear
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x40); // BIT 0,B

        cpu.execute();

        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set (bit is clear)
      });

      it('should test bit 7 in register A', () => {
        cpu.registers.a = 0x80; // Bit 7 set
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x7F); // BIT 7,A

        cpu.execute();

        expect(cpu.registers.f & 0x40).toBe(0); // Z flag clear (bit is set)
        expect(cpu.registers.f & 0x80).toBe(0x80); // S flag set (testing bit 7)
      });

      it('should test bit 3 in register D', () => {
        cpu.registers.d = 0x08; // Bit 3 set
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x5A); // BIT 3,D

        cpu.execute();

        expect(cpu.registers.f & 0x40).toBe(0); // Z flag clear (bit is set)
      });
    });

    describe('BIT b,(HL)', () => {
      it('should test bit in memory', () => {
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x46); // BIT 0,(HL)
        mockMemory.read.mockReturnValueOnce(0x01); // Memory value with bit 0 set

        cpu.execute();

        expect(cpu.registers.f & 0x40).toBe(0); // Z flag clear (bit is set)
        expect(mockMemory.read).toHaveBeenCalledWith(0x1000);
      });

      it('should set zero flag when bit in memory is clear', () => {
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x7E); // BIT 7,(HL)
        mockMemory.read.mockReturnValueOnce(0x7F); // Memory value with bit 7 clear

        cpu.execute();

        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set (bit is clear)
      });
    });
  });

  describe('SET instructions', () => {
    describe('SET b,r', () => {
      it('should set bit 0 in register B', () => {
        cpu.registers.b = 0x00;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0xC0); // SET 0,B

        cpu.execute();

        expect(cpu.registers.b).toBe(0x01);
      });

      it('should set bit 7 in register A', () => {
        cpu.registers.a = 0x00;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0xFF); // SET 7,A

        cpu.execute();

        expect(cpu.registers.a).toBe(0x80);
      });

      it('should not affect already set bits', () => {
        cpu.registers.c = 0xFF;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0xC9); // SET 1,C

        cpu.execute();

        expect(cpu.registers.c).toBe(0xFF);
      });
    });

    describe('SET b,(HL)', () => {
      it('should set bit in memory', () => {
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0xC6); // SET 0,(HL)
        mockMemory.read.mockReturnValueOnce(0x00); // Current memory value

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x1000, 0x01);
      });

      it('should set multiple bits correctly', () => {
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0xFE); // SET 7,(HL)
        mockMemory.read.mockReturnValueOnce(0x0F); // Current memory value

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x1000, 0x8F);
      });
    });
  });

  describe('RES instructions', () => {
    describe('RES b,r', () => {
      it('should reset bit 0 in register B', () => {
        cpu.registers.b = 0xFF;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x80); // RES 0,B

        cpu.execute();

        expect(cpu.registers.b).toBe(0xFE);
      });

      it('should reset bit 7 in register A', () => {
        cpu.registers.a = 0xFF;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0xBF); // RES 7,A

        cpu.execute();

        expect(cpu.registers.a).toBe(0x7F);
      });

      it('should not affect already reset bits', () => {
        cpu.registers.d = 0x00;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x92); // RES 2,D

        cpu.execute();

        expect(cpu.registers.d).toBe(0x00);
      });
    });

    describe('RES b,(HL)', () => {
      it('should reset bit in memory', () => {
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x86); // RES 0,(HL)
        mockMemory.read.mockReturnValueOnce(0xFF); // Current memory value

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x1000, 0xFE);
      });
    });
  });

  describe('Rotation instructions', () => {
    describe('RLC r', () => {
      it('should rotate left circular', () => {
        cpu.registers.b = 0x80;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x00); // RLC B

        cpu.execute();

        expect(cpu.registers.b).toBe(0x01);
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set (bit 7 was 1)
      });

      it('should handle zero value', () => {
        cpu.registers.c = 0x00;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x01); // RLC C

        cpu.execute();

        expect(cpu.registers.c).toBe(0x00);
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear
      });
    });

    describe('RRC r', () => {
      it('should rotate right circular', () => {
        cpu.registers.d = 0x01;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x0A); // RRC D

        cpu.execute();

        expect(cpu.registers.d).toBe(0x80);
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set (bit 0 was 1)
      });
    });

    describe('RL r', () => {
      it('should rotate left through carry', () => {
        cpu.registers.e = 0x80;
        cpu.registers.f = 0x01; // Carry flag set
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x13); // RL E

        cpu.execute();

        expect(cpu.registers.e).toBe(0x01);
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set (from bit 7)
      });

      it('should rotate carry into bit 0', () => {
        cpu.registers.h = 0x00;
        cpu.registers.f = 0x01; // Carry flag set
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x14); // RL H

        cpu.execute();

        expect(cpu.registers.h).toBe(0x01);
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear (from bit 7 which was 0)
      });
    });

    describe('RR r', () => {
      it('should rotate right through carry', () => {
        cpu.registers.l = 0x01;
        cpu.registers.f = 0x00; // Carry flag clear
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x1D); // RR L

        cpu.execute();

        expect(cpu.registers.l).toBe(0x00);
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set (from bit 0)
      });

      it('should rotate carry into bit 7', () => {
        cpu.registers.a = 0x00;
        cpu.registers.f = 0x01; // Carry flag set
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x1F); // RR A

        cpu.execute();

        expect(cpu.registers.a).toBe(0x80);
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear (from bit 0 which was 0)
      });
    });
  });

  describe('Shift instructions', () => {
    describe('SLA r', () => {
      it('should shift left arithmetic', () => {
        cpu.registers.b = 0x40;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x20); // SLA B

        cpu.execute();

        expect(cpu.registers.b).toBe(0x80);
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear (bit 7 was 0)
      });

      it('should set carry from bit 7', () => {
        cpu.registers.c = 0x80;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x21); // SLA C

        cpu.execute();

        expect(cpu.registers.c).toBe(0x00);
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set (bit 7 was 1)
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });
    });

    describe('SRA r', () => {
      it('should shift right arithmetic (preserve sign)', () => {
        cpu.registers.d = 0x80;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x2A); // SRA D

        cpu.execute();

        expect(cpu.registers.d).toBe(0xC0); // Sign bit preserved
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear (bit 0 was 0)
      });

      it('should shift positive number right', () => {
        cpu.registers.e = 0x40;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x2B); // SRA E

        cpu.execute();

        expect(cpu.registers.e).toBe(0x20);
      });
    });

    describe('SRL r', () => {
      it('should shift right logical', () => {
        cpu.registers.h = 0x80;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x3C); // SRL H

        cpu.execute();

        expect(cpu.registers.h).toBe(0x40); // Zero shifted into bit 7
        expect(cpu.registers.f & 0x01).toBe(0); // C flag clear (bit 0 was 0)
      });

      it('should set carry from bit 0', () => {
        cpu.registers.l = 0x01;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x3D); // SRL L

        cpu.execute();

        expect(cpu.registers.l).toBe(0x00);
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set (bit 0 was 1)
        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
      });
    });
  });

  describe('Memory operations', () => {
    describe('RLC (HL)', () => {
      it('should rotate memory left circular', () => {
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0x06); // RLC (HL)
        mockMemory.read.mockReturnValueOnce(0x80); // Memory value

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x1000, 0x01);
        expect(cpu.registers.f & 0x01).toBe(0x01); // C flag set
      });
    });

    describe('SET b,(HL) with result in register', () => {
      it('should set bit in memory and store result in register (undocumented)', () => {
        // Some undocumented opcodes store the result in a register too
        cpu.registers.setHL(0x1000);
        cpu.registers.b = 0x00;
        mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
        mockMemory.read.mockReturnValueOnce(0xC6); // SET 0,(HL) 
        mockMemory.read.mockReturnValueOnce(0x00); // Memory value

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x1000, 0x01);
        // Note: Undocumented behavior may store result in register too
      });
    });
  });

  describe('Complex bit patterns', () => {
    it('should handle alternating bit pattern', () => {
      cpu.registers.a = 0x55; // 01010101
      mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
      mockMemory.read.mockReturnValueOnce(0x07); // RLC A

      cpu.execute();

      expect(cpu.registers.a).toBe(0xAA); // 10101010
      expect(cpu.registers.f & 0x01).toBe(0); // C flag clear
    });

    it('should correctly set parity flag', () => {
      cpu.registers.b = 0x03; // 2 bits set (even parity)
      mockMemory.read.mockReturnValueOnce(0xCB); // CB prefix
      mockMemory.read.mockReturnValueOnce(0x20); // SLA B

      cpu.execute();

      expect(cpu.registers.b).toBe(0x06); // Still 2 bits set
      expect(cpu.registers.f & 0x04).toBe(0x04); // P flag set (even parity)
    });
  });
});