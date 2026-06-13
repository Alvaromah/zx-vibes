import { Z80 as CPU } from '../../src/core/cpu.js';
import { Registers } from '../../src/core/registers.js';

describe('Load Instructions', () => {
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

  describe('8-bit Load Instructions', () => {
    describe('LD r,r', () => {
      it('should load register to register', () => {
        cpu.registers.b = 0x42;
        cpu.registers.c = 0x00;
        mockMemory.read.mockReturnValue(0x48); // LD C,B

        cpu.execute();

        expect(cpu.registers.c).toBe(0x42);
        expect(cpu.registers.b).toBe(0x42); // Source unchanged
      });

      it('should handle LD A,A (no-op)', () => {
        cpu.registers.a = 0x55;
        mockMemory.read.mockReturnValue(0x7F); // LD A,A

        cpu.execute();

        expect(cpu.registers.a).toBe(0x55);
      });
    });

    describe('LD r,n', () => {
      it('should load immediate value to register', () => {
        mockMemory.read.mockReturnValueOnce(0x06); // LD B,n
        mockMemory.read.mockReturnValueOnce(0x42); // immediate value

        cpu.execute();

        expect(cpu.registers.b).toBe(0x42);
      });

      it('should load immediate to accumulator', () => {
        mockMemory.read.mockReturnValueOnce(0x3E); // LD A,n
        mockMemory.read.mockReturnValueOnce(0xFF); // immediate value

        cpu.execute();

        expect(cpu.registers.a).toBe(0xFF);
      });
    });

    describe('LD r,(HL)', () => {
      it('should load from memory to register', () => {
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0x46); // LD B,(HL)
        mockMemory.read.mockReturnValueOnce(0x42); // value at (HL)

        cpu.execute();

        expect(cpu.registers.b).toBe(0x42);
        expect(mockMemory.read).toHaveBeenCalledWith(0x1000);
      });

      it('should load from memory to accumulator', () => {
        cpu.registers.setHL(0x2000);
        mockMemory.read.mockReturnValueOnce(0x7E); // LD A,(HL)
        mockMemory.read.mockReturnValueOnce(0x55); // value at (HL)

        cpu.execute();

        expect(cpu.registers.a).toBe(0x55);
        expect(mockMemory.read).toHaveBeenCalledWith(0x2000);
      });
    });

    describe('LD (HL),r', () => {
      it('should store register to memory', () => {
        cpu.registers.setHL(0x1000);
        cpu.registers.b = 0x42;
        mockMemory.read.mockReturnValue(0x70); // LD (HL),B

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x1000, 0x42);
      });

      it('should store accumulator to memory', () => {
        cpu.registers.setHL(0x2000);
        cpu.registers.a = 0xFF;
        mockMemory.read.mockReturnValue(0x77); // LD (HL),A

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x2000, 0xFF);
      });
    });

    describe('LD (HL),n', () => {
      it('should store immediate value to memory', () => {
        cpu.registers.setHL(0x1000);
        mockMemory.read.mockReturnValueOnce(0x36); // LD (HL),n
        mockMemory.read.mockReturnValueOnce(0x42); // immediate value

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x1000, 0x42);
      });
    });

    describe('LD A,(BC) and LD A,(DE)', () => {
      it('should load from address in BC to accumulator', () => {
        cpu.registers.setBC(0x1000);
        mockMemory.read.mockReturnValueOnce(0x0A); // LD A,(BC)
        mockMemory.read.mockReturnValueOnce(0x42); // value at (BC)

        cpu.execute();

        expect(cpu.registers.a).toBe(0x42);
        expect(mockMemory.read).toHaveBeenCalledWith(0x1000);
      });

      it('should load from address in DE to accumulator', () => {
        cpu.registers.setDE(0x2000);
        mockMemory.read.mockReturnValueOnce(0x1A); // LD A,(DE)
        mockMemory.read.mockReturnValueOnce(0x55); // value at (DE)

        cpu.execute();

        expect(cpu.registers.a).toBe(0x55);
        expect(mockMemory.read).toHaveBeenCalledWith(0x2000);
      });
    });

    describe('LD (BC),A and LD (DE),A', () => {
      it('should store accumulator at address in BC', () => {
        cpu.registers.setBC(0x1000);
        cpu.registers.a = 0x42;
        mockMemory.read.mockReturnValue(0x02); // LD (BC),A

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x1000, 0x42);
      });

      it('should store accumulator at address in DE', () => {
        cpu.registers.setDE(0x2000);
        cpu.registers.a = 0x55;
        mockMemory.read.mockReturnValue(0x12); // LD (DE),A

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x2000, 0x55);
      });
    });

    describe('LD A,(nn) and LD (nn),A', () => {
      it('should load from direct address to accumulator', () => {
        mockMemory.read.mockReturnValueOnce(0x3A); // LD A,(nn)
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte of address
        mockMemory.read.mockReturnValueOnce(0x10); // High byte of address
        mockMemory.read.mockReturnValueOnce(0x42); // Value at address

        cpu.execute();

        expect(cpu.registers.a).toBe(0x42);
        expect(mockMemory.read).toHaveBeenCalledWith(0x1000);
      });

      it('should store accumulator at direct address', () => {
        cpu.registers.a = 0x42;
        mockMemory.read.mockReturnValueOnce(0x32); // LD (nn),A
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte of address
        mockMemory.read.mockReturnValueOnce(0x20); // High byte of address

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x2000, 0x42);
      });
    });
  });

  describe('16-bit Load Instructions', () => {
    describe('LD rr,nn', () => {
      it('should load immediate 16-bit value to BC', () => {
        mockMemory.read.mockReturnValueOnce(0x01); // LD BC,nn
        mockMemory.read.mockReturnValueOnce(0x34); // Low byte
        mockMemory.read.mockReturnValueOnce(0x12); // High byte

        cpu.execute();

        expect(cpu.registers.getBC()).toBe(0x1234);
      });

      it('should load immediate 16-bit value to HL', () => {
        mockMemory.read.mockReturnValueOnce(0x21); // LD HL,nn
        mockMemory.read.mockReturnValueOnce(0x78); // Low byte
        mockMemory.read.mockReturnValueOnce(0x56); // High byte

        cpu.execute();

        expect(cpu.registers.getHL()).toBe(0x5678);
      });

      it('should load immediate 16-bit value to SP', () => {
        mockMemory.read.mockReturnValueOnce(0x31); // LD SP,nn
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte
        mockMemory.read.mockReturnValueOnce(0x80); // High byte

        cpu.execute();

        expect(cpu.registers.sp).toBe(0x8000);
      });
    });

    describe('LD HL,(nn) and LD (nn),HL', () => {
      it('should load 16-bit value from memory to HL', () => {
        mockMemory.read.mockReturnValueOnce(0x2A); // LD HL,(nn)
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte of address
        mockMemory.read.mockReturnValueOnce(0x10); // High byte of address
        mockMemory.read.mockReturnValueOnce(0x34); // Low byte of value
        mockMemory.read.mockReturnValueOnce(0x12); // High byte of value

        cpu.execute();

        expect(cpu.registers.getHL()).toBe(0x1234);
        expect(mockMemory.read).toHaveBeenCalledWith(0x1000);
        expect(mockMemory.read).toHaveBeenCalledWith(0x1001);
      });

      it('should store HL to memory', () => {
        cpu.registers.setHL(0x1234);
        mockMemory.read.mockReturnValueOnce(0x22); // LD (nn),HL
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte of address
        mockMemory.read.mockReturnValueOnce(0x20); // High byte of address

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x2000, 0x34); // Low byte
        expect(mockMemory.write).toHaveBeenCalledWith(0x2001, 0x12); // High byte
      });
    });

    describe('LD SP,HL', () => {
      it('should load HL to SP', () => {
        cpu.registers.setHL(0x8000);
        mockMemory.read.mockReturnValue(0xF9); // LD SP,HL

        cpu.execute();

        expect(cpu.registers.sp).toBe(0x8000);
      });
    });

    describe('Extended 16-bit loads', () => {
      it('should load 16-bit value from memory to BC', () => {
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x4B); // LD BC,(nn)
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte of address
        mockMemory.read.mockReturnValueOnce(0x10); // High byte of address
        mockMemory.read.mockReturnValueOnce(0x34); // Low byte of value
        mockMemory.read.mockReturnValueOnce(0x12); // High byte of value

        cpu.execute();

        expect(cpu.registers.getBC()).toBe(0x1234);
      });

      it('should store BC to memory', () => {
        cpu.registers.setBC(0x1234);
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x43); // LD (nn),BC
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte of address
        mockMemory.read.mockReturnValueOnce(0x20); // High byte of address

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x2000, 0x34); // Low byte
        expect(mockMemory.write).toHaveBeenCalledWith(0x2001, 0x12); // High byte
      });
    });
  });

  describe('Stack Operations', () => {
    describe('PUSH', () => {
      it('should push BC onto stack', () => {
        cpu.registers.sp = 0x8000;
        cpu.registers.setBC(0x1234);
        mockMemory.read.mockReturnValue(0xC5); // PUSH BC

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x7FFF, 0x12); // High byte
        expect(mockMemory.write).toHaveBeenCalledWith(0x7FFE, 0x34); // Low byte
        expect(cpu.registers.sp).toBe(0x7FFE);
      });

      it('should push AF onto stack', () => {
        cpu.registers.sp = 0x8000;
        cpu.registers.a = 0x42;
        cpu.registers.f = 0x55;
        mockMemory.read.mockReturnValue(0xF5); // PUSH AF

        cpu.execute();

        expect(mockMemory.write).toHaveBeenCalledWith(0x7FFF, 0x42); // A
        expect(mockMemory.write).toHaveBeenCalledWith(0x7FFE, 0x55); // F
        expect(cpu.registers.sp).toBe(0x7FFE);
      });
    });

    describe('POP', () => {
      it('should pop stack to BC', () => {
        cpu.registers.sp = 0x7FFE;
        mockMemory.read.mockReturnValueOnce(0xC1); // POP BC
        mockMemory.read.mockReturnValueOnce(0x34); // Low byte
        mockMemory.read.mockReturnValueOnce(0x12); // High byte

        cpu.execute();

        expect(cpu.registers.getBC()).toBe(0x1234);
        expect(cpu.registers.sp).toBe(0x8000);
      });

      it('should pop stack to AF', () => {
        cpu.registers.sp = 0x7FFE;
        mockMemory.read.mockReturnValueOnce(0xF1); // POP AF
        mockMemory.read.mockReturnValueOnce(0x55); // F
        mockMemory.read.mockReturnValueOnce(0x42); // A

        cpu.execute();

        expect(cpu.registers.a).toBe(0x42);
        expect(cpu.registers.f).toBe(0x55);
        expect(cpu.registers.sp).toBe(0x8000);
      });
    });
  });

  describe('Special Load Instructions', () => {
    describe('LD A,I and LD A,R', () => {
      it('should load I register to accumulator', () => {
        cpu.registers.i = 0x42;
        cpu.iff2 = true;
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x57); // LD A,I

        cpu.execute();

        expect(cpu.registers.a).toBe(0x42);
        expect(cpu.registers.f & 0x04).toBe(0x04); // P/V flag set (IFF2 was true)
      });

      it('should load R register to accumulator', () => {
        cpu.registers.r = 0x55;
        cpu.iff2 = false;
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x5F); // LD A,R

        cpu.execute();

        // R register increments by 2 (ED prefix + instruction)
        expect(cpu.registers.a).toBe(0x57);
        expect(cpu.registers.f & 0x04).toBe(0); // P/V flag clear (IFF2 was false)
      });

      it('should set flags correctly for LD A,I', () => {
        cpu.registers.i = 0x00;
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x57); // LD A,I

        cpu.execute();

        expect(cpu.registers.f & 0x40).toBe(0x40); // Z flag set
        expect(cpu.registers.f & 0x80).toBe(0); // S flag clear
        expect(cpu.registers.f & 0x10).toBe(0); // H flag clear
        expect(cpu.registers.f & 0x02).toBe(0); // N flag clear
      });
    });

    describe('LD I,A and LD R,A', () => {
      it('should load accumulator to I register', () => {
        cpu.registers.a = 0x42;
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x47); // LD I,A

        cpu.execute();

        expect(cpu.registers.i).toBe(0x42);
      });

      it('should load accumulator to R register', () => {
        cpu.registers.a = 0x55;
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x4F); // LD R,A

        cpu.execute();

        expect(cpu.registers.r).toBe(0x55);
      });
    });
  });

  describe('Load timing and cycles', () => {
    it('should take correct cycles for register-to-register load', () => {
      cpu.registers.b = 0x42;
      mockMemory.read.mockReturnValue(0x48); // LD C,B

      const cycles = cpu.execute();

      expect(cycles).toBe(4);
    });

    it('should take correct cycles for immediate load', () => {
      mockMemory.read.mockReturnValueOnce(0x06); // LD B,n
      mockMemory.read.mockReturnValueOnce(0x42);

      const cycles = cpu.execute();

      expect(cycles).toBe(7);
    });

    it('should take correct cycles for memory load', () => {
      cpu.registers.setHL(0x1000);
      mockMemory.read.mockReturnValueOnce(0x46); // LD B,(HL)
      mockMemory.read.mockReturnValueOnce(0x42);

      const cycles = cpu.execute();

      expect(cycles).toBe(7);
    });

    it('should take correct cycles for 16-bit immediate load', () => {
      mockMemory.read.mockReturnValueOnce(0x01); // LD BC,nn
      mockMemory.read.mockReturnValueOnce(0x34);
      mockMemory.read.mockReturnValueOnce(0x12);

      const cycles = cpu.execute();

      expect(cycles).toBe(10);
    });
  });
});