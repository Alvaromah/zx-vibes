import { Z80 as CPU } from '../../src/core/cpu.js';
import { Registers } from '../../src/core/registers.js';

describe('Jump and Control Flow Instructions', () => {
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

  describe('JP (Jump) Instructions', () => {
    describe('JP nn', () => {
      it('should jump to absolute address', () => {
        cpu.registers.pc = 0x1000;
        mockMemory.read.mockReturnValueOnce(0xC3); // JP nn
        mockMemory.read.mockReturnValueOnce(0x34); // Low byte
        mockMemory.read.mockReturnValueOnce(0x12); // High byte

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x1234);
      });
    });

    describe('JP cc,nn (Conditional Jump)', () => {
      it('should jump when zero flag is set (JP Z,nn)', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.f = 0x40; // Z flag set
        mockMemory.read.mockReturnValueOnce(0xCA); // JP Z,nn
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte
        mockMemory.read.mockReturnValueOnce(0x20); // High byte

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x2000);
      });

      it('should not jump when zero flag is clear (JP Z,nn)', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.f = 0x00; // Z flag clear
        mockMemory.read.mockReturnValueOnce(0xCA); // JP Z,nn
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte
        mockMemory.read.mockReturnValueOnce(0x20); // High byte

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x1003); // PC + 3 (instruction length)
      });

      it('should jump when carry flag is set (JP C,nn)', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.f = 0x01; // C flag set
        mockMemory.read.mockReturnValueOnce(0xDA); // JP C,nn
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte
        mockMemory.read.mockReturnValueOnce(0x30); // High byte

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x3000);
      });

      it('should jump when parity is even (JP PE,nn)', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.f = 0x04; // P/V flag set (even parity)
        mockMemory.read.mockReturnValueOnce(0xEA); // JP PE,nn
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte
        mockMemory.read.mockReturnValueOnce(0x40); // High byte

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x4000);
      });

      it('should jump when sign is negative (JP M,nn)', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.f = 0x80; // S flag set (negative)
        mockMemory.read.mockReturnValueOnce(0xFA); // JP M,nn
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte
        mockMemory.read.mockReturnValueOnce(0x50); // High byte

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x5000);
      });
    });

    describe('JP (HL)', () => {
      it('should jump to address in HL', () => {
        cpu.registers.setHL(0x3456);
        mockMemory.read.mockReturnValue(0xE9); // JP (HL)

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x3456);
      });
    });
  });

  describe('JR (Relative Jump) Instructions', () => {
    describe('JR e', () => {
      it('should jump forward relative to PC', () => {
        cpu.registers.pc = 0x1000;
        mockMemory.read.mockReturnValueOnce(0x18); // JR e
        mockMemory.read.mockReturnValueOnce(0x10); // Offset (+16)

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x1012); // 0x1000 + 2 + 0x10
      });

      it('should jump backward relative to PC', () => {
        cpu.registers.pc = 0x1000;
        mockMemory.read.mockReturnValueOnce(0x18); // JR e
        mockMemory.read.mockReturnValueOnce(0xFE); // Offset (-2)

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x1000); // 0x1000 + 2 - 2
      });

      it('should handle large negative offset', () => {
        cpu.registers.pc = 0x1080;
        mockMemory.read.mockReturnValueOnce(0x18); // JR e
        mockMemory.read.mockReturnValueOnce(0x80); // Offset (-128)

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x1002); // 0x1080 + 2 - 128
      });
    });

    describe('JR cc,e (Conditional Relative Jump)', () => {
      it('should jump when zero flag is set (JR Z,e)', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.f = 0x40; // Z flag set
        mockMemory.read.mockReturnValueOnce(0x28); // JR Z,e
        mockMemory.read.mockReturnValueOnce(0x10); // Offset

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x1012);
      });

      it('should not jump when zero flag is clear (JR Z,e)', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.f = 0x00; // Z flag clear
        mockMemory.read.mockReturnValueOnce(0x28); // JR Z,e
        mockMemory.read.mockReturnValueOnce(0x10); // Offset

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x1002); // PC + 2 (instruction length)
      });

      it('should jump when carry flag is set (JR C,e)', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.f = 0x01; // C flag set
        mockMemory.read.mockReturnValueOnce(0x38); // JR C,e
        mockMemory.read.mockReturnValueOnce(0x08); // Offset

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x100A);
      });

      it('should jump when carry flag is clear (JR NC,e)', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.f = 0x00; // C flag clear
        mockMemory.read.mockReturnValueOnce(0x30); // JR NC,e
        mockMemory.read.mockReturnValueOnce(0x08); // Offset

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x100A);
      });
    });

    describe('DJNZ e', () => {
      it('should decrement B and jump if not zero', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.b = 0x03;
        mockMemory.read.mockReturnValueOnce(0x10); // DJNZ e
        mockMemory.read.mockReturnValueOnce(0xFE); // Offset (-2)

        cpu.execute();

        expect(cpu.registers.b).toBe(0x02);
        expect(cpu.registers.pc).toBe(0x1000); // Jumped back
      });

      it('should decrement B and not jump when B becomes zero', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.b = 0x01;
        mockMemory.read.mockReturnValueOnce(0x10); // DJNZ e
        mockMemory.read.mockReturnValueOnce(0xFE); // Offset (-2)

        cpu.execute();

        expect(cpu.registers.b).toBe(0x00);
        expect(cpu.registers.pc).toBe(0x1002); // Did not jump
      });

      it('should handle B wrapping from 0 to 255', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.b = 0x00;
        mockMemory.read.mockReturnValueOnce(0x10); // DJNZ e
        mockMemory.read.mockReturnValueOnce(0xFE); // Offset (-2)

        cpu.execute();

        expect(cpu.registers.b).toBe(0xFF);
        expect(cpu.registers.pc).toBe(0x1000); // Jumped (B is not zero)
      });
    });
  });

  describe('CALL Instructions', () => {
    describe('CALL nn', () => {
      it('should call subroutine at absolute address', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.sp = 0x8000;
        mockMemory.read.mockReturnValueOnce(0xCD); // CALL nn
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte
        mockMemory.read.mockReturnValueOnce(0x20); // High byte

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x2000);
        expect(cpu.registers.sp).toBe(0x7FFE);
        // Return address pushed to stack
        expect(mockMemory.write).toHaveBeenCalledWith(0x7FFF, 0x10); // High byte of return address
        expect(mockMemory.write).toHaveBeenCalledWith(0x7FFE, 0x03); // Low byte of return address
      });
    });

    describe('CALL cc,nn (Conditional Call)', () => {
      it('should call when condition is true', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.sp = 0x8000;
        cpu.registers.f = 0x40; // Z flag set
        mockMemory.read.mockReturnValueOnce(0xCC); // CALL Z,nn
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte
        mockMemory.read.mockReturnValueOnce(0x30); // High byte

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x3000);
        expect(cpu.registers.sp).toBe(0x7FFE);
      });

      it('should not call when condition is false', () => {
        cpu.registers.pc = 0x1000;
        cpu.registers.sp = 0x8000;
        cpu.registers.f = 0x00; // Z flag clear
        mockMemory.read.mockReturnValueOnce(0xCC); // CALL Z,nn
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte
        mockMemory.read.mockReturnValueOnce(0x30); // High byte

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x1003); // PC + 3 (instruction length)
        expect(cpu.registers.sp).toBe(0x8000); // SP unchanged
      });
    });
  });

  describe('RET Instructions', () => {
    describe('RET', () => {
      it('should return from subroutine', () => {
        cpu.registers.sp = 0x7FFE;
        mockMemory.read.mockReturnValueOnce(0xC9); // RET
        mockMemory.read.mockReturnValueOnce(0x03); // Low byte of return address
        mockMemory.read.mockReturnValueOnce(0x10); // High byte of return address

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x1003);
        expect(cpu.registers.sp).toBe(0x8000);
      });
    });

    describe('RET cc (Conditional Return)', () => {
      it('should return when condition is true', () => {
        cpu.registers.sp = 0x7FFE;
        cpu.registers.f = 0x01; // C flag set
        mockMemory.read.mockReturnValueOnce(0xD8); // RET C
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte of return address
        mockMemory.read.mockReturnValueOnce(0x20); // High byte of return address

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x2000);
        expect(cpu.registers.sp).toBe(0x8000);
      });

      it('should not return when condition is false', () => {
        const initialPC = cpu.registers.pc;
        cpu.registers.sp = 0x7FFE;
        cpu.registers.f = 0x00; // C flag clear
        mockMemory.read.mockReturnValueOnce(0xD8); // RET C

        cpu.execute();

        expect(cpu.registers.pc).toBe(initialPC + 1); // PC + 1 (instruction length)
        expect(cpu.registers.sp).toBe(0x7FFE); // SP unchanged
      });
    });

    describe('RETI and RETN', () => {
      it('should return from interrupt (RETI)', () => {
        cpu.registers.sp = 0x7FFE;
        cpu.interruptsEnabled = false;
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x4D); // RETI
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte of return address
        mockMemory.read.mockReturnValueOnce(0x10); // High byte of return address

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x1000);
        expect(cpu.registers.sp).toBe(0x8000);
        // RETI should signal interrupt acknowledgment (implementation specific)
      });

      it('should return from non-maskable interrupt (RETN)', () => {
        cpu.registers.sp = 0x7FFE;
        cpu.iff1 = false;
        cpu.iff2 = true; // IFF2 preserves IFF1 state before NMI
        mockMemory.read.mockReturnValueOnce(0xED); // Extended prefix
        mockMemory.read.mockReturnValueOnce(0x45); // RETN
        mockMemory.read.mockReturnValueOnce(0x00); // Low byte of return address
        mockMemory.read.mockReturnValueOnce(0x10); // High byte of return address

        cpu.execute();

        expect(cpu.registers.pc).toBe(0x1000);
        expect(cpu.registers.sp).toBe(0x8000);
        expect(cpu.iff1).toBe(true); // IFF1 restored from IFF2
      });
    });
  });

  describe('RST Instructions', () => {
    it('should call restart vector 0x00 (RST 0)', () => {
      cpu.registers.pc = 0x1000;
      cpu.registers.sp = 0x8000;
      mockMemory.read.mockReturnValue(0xC7); // RST 0

      cpu.execute();

      expect(cpu.registers.pc).toBe(0x0000);
      expect(cpu.registers.sp).toBe(0x7FFE);
      expect(mockMemory.write).toHaveBeenCalledWith(0x7FFF, 0x10); // High byte of return
      expect(mockMemory.write).toHaveBeenCalledWith(0x7FFE, 0x01); // Low byte of return
    });

    it('should call restart vector 0x08 (RST 1)', () => {
      cpu.registers.pc = 0x1000;
      cpu.registers.sp = 0x8000;
      mockMemory.read.mockReturnValue(0xCF); // RST 1

      cpu.execute();

      expect(cpu.registers.pc).toBe(0x0008);
    });

    it('should call restart vector 0x38 (RST 7)', () => {
      cpu.registers.pc = 0x1000;
      cpu.registers.sp = 0x8000;
      mockMemory.read.mockReturnValue(0xFF); // RST 7

      cpu.execute();

      expect(cpu.registers.pc).toBe(0x0038);
    });
  });

  describe('Timing and Cycles', () => {
    it('should take correct cycles for unconditional jump', () => {
      mockMemory.read.mockReturnValueOnce(0xC3); // JP nn
      mockMemory.read.mockReturnValueOnce(0x00);
      mockMemory.read.mockReturnValueOnce(0x10);

      const cycles = cpu.execute();

      expect(cycles).toBe(10);
    });

    it('should take correct cycles for conditional jump taken', () => {
      cpu.registers.f = 0x40; // Z flag set
      mockMemory.read.mockReturnValueOnce(0xCA); // JP Z,nn
      mockMemory.read.mockReturnValueOnce(0x00);
      mockMemory.read.mockReturnValueOnce(0x10);

      const cycles = cpu.execute();

      expect(cycles).toBe(10);
    });

    it('should take correct cycles for conditional jump not taken', () => {
      cpu.registers.f = 0x00; // Z flag clear
      mockMemory.read.mockReturnValueOnce(0xCA); // JP Z,nn
      mockMemory.read.mockReturnValueOnce(0x00);
      mockMemory.read.mockReturnValueOnce(0x10);

      const cycles = cpu.execute();

      expect(cycles).toBe(10); // Same timing whether taken or not
    });

    it('should take correct cycles for relative jump', () => {
      mockMemory.read.mockReturnValueOnce(0x18); // JR e
      mockMemory.read.mockReturnValueOnce(0x10);

      const cycles = cpu.execute();

      expect(cycles).toBe(12);
    });

    it('should take correct cycles for DJNZ when jumping', () => {
      cpu.registers.b = 0x02;
      mockMemory.read.mockReturnValueOnce(0x10); // DJNZ e
      mockMemory.read.mockReturnValueOnce(0xFE);

      const cycles = cpu.execute();

      expect(cycles).toBe(13); // Jump taken
    });

    it('should take correct cycles for DJNZ when not jumping', () => {
      cpu.registers.b = 0x01;
      mockMemory.read.mockReturnValueOnce(0x10); // DJNZ e
      mockMemory.read.mockReturnValueOnce(0xFE);

      const cycles = cpu.execute();

      expect(cycles).toBe(8); // Jump not taken
    });
  });
});