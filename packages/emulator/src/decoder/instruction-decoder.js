/**
 * Complete Instruction Decoder
 * Comprehensive opcode decoding and dispatch system for Z80 emulator
 *
 * Timing philosophy: Each instruction handler returns its TOTAL cycle count.
 * The decoder does NOT add extra cycles - it trusts the instruction's return value.
 */
class InstructionDecoder {
  constructor(registers, flags, memory, io, instructions) {
    this.registers = registers;
    this.flags = flags;
    this.memory = memory;
    this.io = io;
    this.instructions = instructions;

    // Build comprehensive instruction lookup tables
    this.buildAllInstructionTables();
  }

  buildAllInstructionTables() {
    this.mainTable = {};
    this.cbTable = {};
    this.edTable = {};
    this.ddTable = {};
    this.fdTable = {};
    this.ddcbTable = {};
    this.fdcbTable = {};

    this.buildMainTable();
    this.buildCBTable();
    this.buildEDTable();
    this.buildDDTable();
    this.buildFDTable();
  }

  buildMainTable() {
    const { logical, load } = this.instructions;

    // 8x8 grid of register-to-register loads (0x40-0x7F)
    const regMap = ['B', 'C', 'D', 'E', 'H', 'L', null, 'A'];
    for (let dest = 0; dest < 8; dest++) {
      for (let src = 0; src < 8; src++) {
        if (dest === 6 && src === 6) {
          this.mainTable[0x76] = (cpu) => this.instructions.misc.halt(cpu); // HALT
          continue;
        }

        const opcode = 0x40 + (dest << 3) + src;

        if (dest === 6) {
          // LD (HL), reg
          this.mainTable[opcode] = () => load.loadHLFromReg(regMap[src]);
        } else if (src === 6) {
          // LD reg, (HL)
          this.mainTable[opcode] = () => load.loadRegFromHL(regMap[dest]);
        } else {
          // LD reg, reg
          this.mainTable[opcode] = () => load.loadRegReg(regMap[dest], regMap[src]);
        }
      }
    }

    // Arithmetic operations (0x80-0xBF)
    for (let i = 0; i < 8; i++) {
      const reg = regMap[i];
      if (reg) {
        // Arithmetic with registers - handlers return their own cycle count
        this.mainTable[0x80 + i] = () => this.instructions.arithmetic.addA(this.registers.get(reg));
        this.mainTable[0x88 + i] = () => this.instructions.arithmetic.adcA(this.registers.get(reg));
        this.mainTable[0x90 + i] = () => this.instructions.arithmetic.subA(this.registers.get(reg));
        this.mainTable[0x98 + i] = () => this.instructions.arithmetic.sbcA(this.registers.get(reg));
        this.mainTable[0xa0 + i] = () => logical.andA(this.registers.get(reg));
        this.mainTable[0xa8 + i] = () => logical.xorA(this.registers.get(reg));
        this.mainTable[0xb0 + i] = () => logical.orA(this.registers.get(reg));
        this.mainTable[0xb8 + i] = () => this.instructions.arithmetic.cpA(this.registers.get(reg));
      } else if (i === 6) {
        // Arithmetic with (HL)
        this.mainTable[0x86] = () => {
          this.instructions.arithmetic.addA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0x8e] = () => {
          this.instructions.arithmetic.adcA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0x96] = () => {
          this.instructions.arithmetic.subA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0x9e] = () => {
          this.instructions.arithmetic.sbcA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0xa6] = () => {
          logical.andA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0xae] = () => {
          logical.xorA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0xb6] = () => {
          logical.orA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0xbe] = () => {
          this.instructions.arithmetic.cpA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
      }
    }

    // All other main instructions
    this.buildMainInstructions();
  }

  buildMainInstructions() {
    const { logical, load, jump, bit } = this.instructions;

    // Basic instructions
    this.mainTable[0x00] = () => this.instructions.misc.nop(); // NOP

    // 16-bit loads
    this.mainTable[0x01] = () => load.loadReg16Immediate('BC', this.memory.fetchWord(this.registers));
    this.mainTable[0x11] = () => load.loadReg16Immediate('DE', this.memory.fetchWord(this.registers));
    this.mainTable[0x21] = () => load.loadReg16Immediate('HL', this.memory.fetchWord(this.registers));
    this.mainTable[0x31] = () => load.loadReg16Immediate('SP', this.memory.fetchWord(this.registers));

    // 8-bit immediate loads
    this.mainTable[0x06] = () => load.loadRegImmediate('B', this.memory.fetchByte(this.registers));
    this.mainTable[0x0e] = () => load.loadRegImmediate('C', this.memory.fetchByte(this.registers));
    this.mainTable[0x16] = () => load.loadRegImmediate('D', this.memory.fetchByte(this.registers));
    this.mainTable[0x1e] = () => load.loadRegImmediate('E', this.memory.fetchByte(this.registers));
    this.mainTable[0x26] = () => load.loadRegImmediate('H', this.memory.fetchByte(this.registers));
    this.mainTable[0x2e] = () => load.loadRegImmediate('L', this.memory.fetchByte(this.registers));
    this.mainTable[0x3e] = () => load.loadRegImmediate('A', this.memory.fetchByte(this.registers));
    this.mainTable[0x36] = () => load.loadHLImmediate(this.memory.fetchByte(this.registers));

    // Increments and decrements
    this.mainTable[0x04] = () => this.instructions.arithmetic.incReg('B');
    this.mainTable[0x0c] = () => this.instructions.arithmetic.incReg('C');
    this.mainTable[0x14] = () => this.instructions.arithmetic.incReg('D');
    this.mainTable[0x1c] = () => this.instructions.arithmetic.incReg('E');
    this.mainTable[0x24] = () => this.instructions.arithmetic.incReg('H');
    this.mainTable[0x2c] = () => this.instructions.arithmetic.incReg('L');
    this.mainTable[0x3c] = () => this.instructions.arithmetic.incReg('A');
    this.mainTable[0x34] = () => this.instructions.arithmetic.incHL();

    this.mainTable[0x05] = () => this.instructions.arithmetic.decReg('B');
    this.mainTable[0x0d] = () => this.instructions.arithmetic.decReg('C');
    this.mainTable[0x15] = () => this.instructions.arithmetic.decReg('D');
    this.mainTable[0x1d] = () => this.instructions.arithmetic.decReg('E');
    this.mainTable[0x25] = () => this.instructions.arithmetic.decReg('H');
    this.mainTable[0x2d] = () => this.instructions.arithmetic.decReg('L');
    this.mainTable[0x3d] = () => this.instructions.arithmetic.decReg('A');
    this.mainTable[0x35] = () => this.instructions.arithmetic.decHL();

    // 16-bit arithmetic
    this.mainTable[0x03] = () => {
      this.registers.inc16('BC');
      return 6;
    };
    this.mainTable[0x13] = () => {
      this.registers.inc16('DE');
      return 6;
    };
    this.mainTable[0x23] = () => {
      this.registers.inc16('HL');
      return 6;
    };
    this.mainTable[0x33] = () => {
      this.registers.inc16('SP');
      return 6;
    };

    this.mainTable[0x0b] = () => {
      this.registers.dec16('BC');
      return 6;
    };
    this.mainTable[0x1b] = () => {
      this.registers.dec16('DE');
      return 6;
    };
    this.mainTable[0x2b] = () => {
      this.registers.dec16('HL');
      return 6;
    };
    this.mainTable[0x3b] = () => {
      this.registers.dec16('SP');
      return 6;
    };

    // ADD HL, reg16
    this.mainTable[0x09] = () => this.instructions.arithmetic.addHL(this.registers.getBC());
    this.mainTable[0x19] = () => this.instructions.arithmetic.addHL(this.registers.getDE());
    this.mainTable[0x29] = () => this.instructions.arithmetic.addHL(this.registers.getHL());
    this.mainTable[0x39] = () => this.instructions.arithmetic.addHL(this.registers.get16('SP'));

    // Immediate arithmetic - handlers return base cycles, we add fetch cycles
    this.mainTable[0xc6] = () => {
      this.instructions.arithmetic.addA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xce] = () => {
      this.instructions.arithmetic.adcA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xd6] = () => {
      this.instructions.arithmetic.subA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xde] = () => {
      this.instructions.arithmetic.sbcA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xe6] = () => {
      logical.andA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xee] = () => {
      logical.xorA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xf6] = () => {
      logical.orA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xfe] = () => {
      this.instructions.arithmetic.cpA(this.memory.fetchByte(this.registers));
      return 7;
    };

    // Jumps and calls
    this.mainTable[0xc3] = () => jump.jump(this.memory.fetchWord(this.registers));
    this.mainTable[0x18] = () => jump.jumpRelative(this.memory.fetchByte(this.registers));
    this.mainTable[0xe9] = () => jump.jumpHL();
    this.mainTable[0xcd] = () => jump.call(this.memory.fetchWord(this.registers));
    this.mainTable[0xc9] = () => jump.ret();

    // Conditional operations
    this.addConditionalInstructions();

    // Stack operations
    this.mainTable[0xc5] = () => this.instructions.misc.push('BC');
    this.mainTable[0xd5] = () => this.instructions.misc.push('DE');
    this.mainTable[0xe5] = () => this.instructions.misc.push('HL');
    this.mainTable[0xf5] = () => this.instructions.misc.push('AF');

    this.mainTable[0xc1] = () => this.instructions.misc.pop('BC');
    this.mainTable[0xd1] = () => this.instructions.misc.pop('DE');
    this.mainTable[0xe1] = () => this.instructions.misc.pop('HL');
    this.mainTable[0xf1] = () => this.instructions.misc.pop('AF');

    // Rotates
    this.mainTable[0x07] = () => bit.rlca();
    this.mainTable[0x0f] = () => bit.rrca();
    this.mainTable[0x17] = () => bit.rla();
    this.mainTable[0x1f] = () => bit.rra();

    // Misc operations
    this.mainTable[0x37] = () => logical.scf();
    this.mainTable[0x3f] = () => logical.ccf();
    this.mainTable[0x27] = () => logical.daa();
    this.mainTable[0x2f] = () => logical.cpl();

    // Interrupt control
    this.mainTable[0xf3] = (cpu) => this.instructions.misc.di(cpu);
    this.mainTable[0xfb] = (cpu) => this.instructions.misc.ei(cpu);

    // Exchange operations
    this.mainTable[0x08] = () => this.instructions.misc.exAF();
    this.mainTable[0xd9] = () => this.instructions.misc.exx();
    this.mainTable[0xeb] = () => this.instructions.misc.exDEHL();
    this.mainTable[0xe3] = () => this.instructions.misc.exSPHL();

    // I/O
    this.mainTable[0xdb] = () => this.instructions.misc.inAImmediate(this.memory.fetchByte(this.registers), this.io);
    this.mainTable[0xd3] = () => this.instructions.misc.outAImmediate(this.memory.fetchByte(this.registers), this.io);

    // Memory operations
    this.addMemoryInstructions();

    // RST instructions
    this.addRSTInstructions();

    // DJNZ
    this.mainTable[0x10] = () => jump.djnz(this.memory.fetchByte(this.registers));

    // LD SP, HL
    this.mainTable[0xf9] = () => load.loadSPFromHL();

    // Prefixed instructions
    this.mainTable[0xcb] = (cpu) => this.executeCBInstruction(cpu);
    this.mainTable[0xed] = (cpu) => this.executeEDInstruction(cpu);
    this.mainTable[0xdd] = (cpu) => this.executeDDInstruction(cpu);
    this.mainTable[0xfd] = (cpu) => this.executeFDInstruction(cpu);
  }

  addConditionalInstructions() {
    const { jump } = this.instructions;

    // Conditional jumps
    this.mainTable[0xc2] = () => jump.jumpConditional('NZ', this.memory.fetchWord(this.registers));
    this.mainTable[0xca] = () => jump.jumpConditional('Z', this.memory.fetchWord(this.registers));
    this.mainTable[0xd2] = () => jump.jumpConditional('NC', this.memory.fetchWord(this.registers));
    this.mainTable[0xda] = () => jump.jumpConditional('C', this.memory.fetchWord(this.registers));
    this.mainTable[0xe2] = () => jump.jumpConditional('PO', this.memory.fetchWord(this.registers));
    this.mainTable[0xea] = () => jump.jumpConditional('PE', this.memory.fetchWord(this.registers));
    this.mainTable[0xf2] = () => jump.jumpConditional('P', this.memory.fetchWord(this.registers));
    this.mainTable[0xfa] = () => jump.jumpConditional('M', this.memory.fetchWord(this.registers));

    // Conditional relative jumps
    this.mainTable[0x20] = () => jump.jumpRelativeConditional('NZ', this.memory.fetchByte(this.registers));
    this.mainTable[0x28] = () => jump.jumpRelativeConditional('Z', this.memory.fetchByte(this.registers));
    this.mainTable[0x30] = () => jump.jumpRelativeConditional('NC', this.memory.fetchByte(this.registers));
    this.mainTable[0x38] = () => jump.jumpRelativeConditional('C', this.memory.fetchByte(this.registers));

    // Conditional calls
    this.mainTable[0xc4] = () => jump.callConditional('NZ', this.memory.fetchWord(this.registers));
    this.mainTable[0xcc] = () => jump.callConditional('Z', this.memory.fetchWord(this.registers));
    this.mainTable[0xd4] = () => jump.callConditional('NC', this.memory.fetchWord(this.registers));
    this.mainTable[0xdc] = () => jump.callConditional('C', this.memory.fetchWord(this.registers));
    this.mainTable[0xe4] = () => jump.callConditional('PO', this.memory.fetchWord(this.registers));
    this.mainTable[0xec] = () => jump.callConditional('PE', this.memory.fetchWord(this.registers));
    this.mainTable[0xf4] = () => jump.callConditional('P', this.memory.fetchWord(this.registers));
    this.mainTable[0xfc] = () => jump.callConditional('M', this.memory.fetchWord(this.registers));

    // Conditional returns
    this.mainTable[0xc0] = () => jump.retConditional('NZ');
    this.mainTable[0xc8] = () => jump.retConditional('Z');
    this.mainTable[0xd0] = () => jump.retConditional('NC');
    this.mainTable[0xd8] = () => jump.retConditional('C');
    this.mainTable[0xe0] = () => jump.retConditional('PO');
    this.mainTable[0xe8] = () => jump.retConditional('PE');
    this.mainTable[0xf0] = () => jump.retConditional('P');
    this.mainTable[0xf8] = () => jump.retConditional('M');
  }

  addMemoryInstructions() {
    const { load } = this.instructions;

    this.mainTable[0x02] = () => load.loadBCFromA();
    this.mainTable[0x12] = () => load.loadDEFromA();
    this.mainTable[0x0a] = () => load.loadAFromBC();
    this.mainTable[0x1a] = () => load.loadAFromDE();
    this.mainTable[0x22] = () => load.loadAddressFromHL(this.memory.fetchWord(this.registers));
    this.mainTable[0x2a] = () => load.loadHLFromAddress(this.memory.fetchWord(this.registers));
    this.mainTable[0x32] = () => load.loadAddressFromA(this.memory.fetchWord(this.registers));
    this.mainTable[0x3a] = () => load.loadAFromAddress(this.memory.fetchWord(this.registers));
    this.mainTable[0x77] = () => load.loadHLFromReg('A');
    this.mainTable[0x7e] = () => load.loadRegFromHL('A');
  }

  addRSTInstructions() {
    const { jump } = this.instructions;

    this.mainTable[0xc7] = () => jump.rst(0x00);
    this.mainTable[0xcf] = () => jump.rst(0x08);
    this.mainTable[0xd7] = () => jump.rst(0x10);
    this.mainTable[0xdf] = () => jump.rst(0x18);
    this.mainTable[0xe7] = () => jump.rst(0x20);
    this.mainTable[0xef] = () => jump.rst(0x28);
    this.mainTable[0xf7] = () => jump.rst(0x30);
    this.mainTable[0xff] = () => jump.rst(0x38);
  }

  buildCBTable() {
    const { bit } = this.instructions;
    const regMap = ['B', 'C', 'D', 'E', 'H', 'L', null, 'A'];

    // Build all CB instructions systematically
    for (let opcode = 0x00; opcode <= 0xff; opcode++) {
      const reg = regMap[opcode & 0x07];
      const isHL = (opcode & 0x07) === 6;

      if ((opcode & 0xc0) === 0x40) {
        // BIT operations (0x40-0x7F)
        const bitNum = (opcode >> 3) & 0x07;
        if (isHL) {
          this.cbTable[opcode] = () => bit.bitTest(bitNum, this.memory.readByte(this.registers.getHL()), true);
        } else {
          this.cbTable[opcode] = () => bit.bitTest(bitNum, this.registers.get(reg), false);
        }
      } else if ((opcode & 0xc0) === 0x80) {
        // RES operations (0x80-0xBF)
        const bitNum = (opcode >> 3) & 0x07;
        if (isHL) {
          this.cbTable[opcode] = () => bit.resBitHL(bitNum);
        } else {
          this.cbTable[opcode] = () => bit.resBitReg(bitNum, reg);
        }
      } else if ((opcode & 0xc0) === 0xc0) {
        // SET operations (0xC0-0xFF)
        const bitNum = (opcode >> 3) & 0x07;
        if (isHL) {
          this.cbTable[opcode] = () => bit.setBitHL(bitNum);
        } else {
          this.cbTable[opcode] = () => bit.setBitReg(bitNum, reg);
        }
      } else {
        // Rotate/Shift operations (0x00-0x3F)
        const operation = opcode & 0xf8;
        let opName;

        switch (operation) {
          case 0x00:
            opName = 'RLC';
            break;
          case 0x08:
            opName = 'RRC';
            break;
          case 0x10:
            opName = 'RL';
            break;
          case 0x18:
            opName = 'RR';
            break;
          case 0x20:
            opName = 'SLA';
            break;
          case 0x28:
            opName = 'SRA';
            break;
          case 0x30:
            opName = 'SLL';
            break;
          case 0x38:
            opName = 'SRL';
            break;
          default:
            continue;
        }

        if (isHL) {
          this.cbTable[opcode] = () => bit.processHL(opName);
        } else {
          this.cbTable[opcode] = () => bit.processRegister(opName, reg);
        }
      }
    }
  }

  buildEDTable() {
    const { extended } = this.instructions;

    // Block operations
    this.edTable[0xa0] = () => extended.ldi();
    this.edTable[0xb0] = () => extended.ldir();
    this.edTable[0xa8] = () => extended.ldd();
    this.edTable[0xb8] = () => extended.lddr();
    this.edTable[0xa1] = () => extended.cpi();
    this.edTable[0xb1] = () => extended.cpir();
    this.edTable[0xa9] = () => extended.cpd();
    this.edTable[0xb9] = () => extended.cpdr();

    // 16-bit arithmetic
    this.edTable[0x42] = () => extended.sbcHL(this.registers.getBC());
    this.edTable[0x52] = () => extended.sbcHL(this.registers.getDE());
    this.edTable[0x62] = () => extended.sbcHL(this.registers.getHL());
    this.edTable[0x72] = () => extended.sbcHL(this.registers.get16('SP'));

    this.edTable[0x4a] = () => extended.adcHL(this.registers.getBC());
    this.edTable[0x5a] = () => extended.adcHL(this.registers.getDE());
    this.edTable[0x6a] = () => extended.adcHL(this.registers.getHL());
    this.edTable[0x7a] = () => extended.adcHL(this.registers.get16('SP'));

    // Decimal operations
    this.edTable[0x6f] = () => extended.rld();
    this.edTable[0x67] = () => extended.rrd();

    // NEG
    for (let i = 0x44; i <= 0x7c; i += 8) {
      this.edTable[i] = () => this.instructions.arithmetic.neg();
    }

    // I/O operations
    const regMap = ['B', 'C', 'D', 'E', 'H', 'L', null, 'A'];
    for (let i = 0; i < 8; i++) {
      const reg = regMap[i];
      if (reg) {
        this.edTable[0x40 + (i << 3)] = () => this.instructions.misc.inRegC(reg, this.io, this.flags);
        this.edTable[0x41 + (i << 3)] = () => this.instructions.misc.outRegC(reg, this.io);
      } else {
        // Special case for F register
        this.edTable[0x70] = () => this.instructions.misc.inRegC(null, this.io, this.flags);
        this.edTable[0x71] = () => this.instructions.misc.outRegC(null, this.io);
      }
    }

    // I/O block operations
    this.edTable[0xa2] = () => extended.ini();
    this.edTable[0xb2] = () => extended.inir();
    this.edTable[0xa3] = () => extended.outi();
    this.edTable[0xb3] = () => extended.otir();
    this.edTable[0xaa] = () => extended.ind();
    this.edTable[0xba] = () => extended.indr();
    this.edTable[0xab] = () => extended.outd();
    this.edTable[0xbb] = () => extended.otdr();

    // Interrupt mode
    this.addInterruptModeInstructions();

    // Return instructions
    this.addEDReturnInstructions();

    // 16-bit load operations
    this.addED16BitLoads();

    // Add undocumented ED instructions
    this.addUndocumentedEDInstructions();
  }

  addInterruptModeInstructions() {
    // IM 0
    this.edTable[0x46] =
      this.edTable[0x4e] =
      this.edTable[0x66] =
      this.edTable[0x6e] =
        (cpu) => this.instructions.misc.setInterruptMode(0, cpu);

    // IM 1
    this.edTable[0x56] = this.edTable[0x76] = (cpu) => this.instructions.misc.setInterruptMode(1, cpu);

    // IM 2
    this.edTable[0x5e] = this.edTable[0x7e] = (cpu) => this.instructions.misc.setInterruptMode(2, cpu);
  }

  addEDReturnInstructions() {
    const { jump } = this.instructions;

    // RETI
    this.edTable[0x4d] = () => jump.reti();

    // RETN
    this.edTable[0x45] =
      this.edTable[0x55] =
      this.edTable[0x5d] =
      this.edTable[0x65] =
      this.edTable[0x6d] =
      this.edTable[0x75] =
      this.edTable[0x7d] =
        (cpu) => this.instructions.jump.retn(cpu);
  }

  addED16BitLoads() {
    const { load } = this.instructions;

    // LD (nn), reg16
    this.edTable[0x43] = () => load.loadAddressFromReg16(this.memory.fetchWord(this.registers), 'BC');
    this.edTable[0x53] = () => load.loadAddressFromReg16(this.memory.fetchWord(this.registers), 'DE');
    this.edTable[0x63] = () => load.loadAddressFromReg16(this.memory.fetchWord(this.registers), 'HL');
    this.edTable[0x73] = () => load.loadAddressFromReg16(this.memory.fetchWord(this.registers), 'SP');

    // LD reg16, (nn)
    this.edTable[0x4b] = () => load.loadReg16FromAddress('BC', this.memory.fetchWord(this.registers));
    this.edTable[0x5b] = () => load.loadReg16FromAddress('DE', this.memory.fetchWord(this.registers));
    this.edTable[0x6b] = () => load.loadReg16FromAddress('HL', this.memory.fetchWord(this.registers));
    this.edTable[0x7b] = () => load.loadReg16FromAddress('SP', this.memory.fetchWord(this.registers));

    // LD I/R operations
    this.edTable[0x47] = () => load.loadIFromA();
    this.edTable[0x4f] = () => load.loadRFromA();
    this.edTable[0x57] = () => load.loadAFromI();
    this.edTable[0x5f] = () => load.loadAFromR();
  }

  addUndocumentedEDInstructions() {
    // Add all undocumented ED instructions as NOPs
    const undocumentedOpcodes = [
      // Row 0x0X - all undocumented
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
      // Row 0x1X - all undocumented
      0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
      // Row 0x2X - all undocumented
      0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f,
      // Row 0x3X - all undocumented
      0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f,
      // Additional undocumented opcodes
      0x77, 0x7f,
      // Row 0x8X - all undocumented
      0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f,
      // Row 0x9X - all undocumented
      0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f,
      // Row 0xAX gaps
      0xa4, 0xa5, 0xa6, 0xa7, 0xac, 0xad, 0xae, 0xaf,
      // Row 0xBX gaps
      0xb4, 0xb5, 0xb6, 0xb7, 0xbc, 0xbd, 0xbe, 0xbf,
      // Row 0xCX - all undocumented
      0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf,
      // Row 0xDX - all undocumented
      0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
      // Row 0xEX - all undocumented
      0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef,
      // Row 0xFX - all undocumented
      0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
    ];

    // Add all undocumented opcodes as NOPs (they don't modify state)
    undocumentedOpcodes.forEach((opcode) => {
      if (!this.edTable[opcode]) {
        this.edTable[opcode] = (_cpu) =>
          // Undocumented ED instruction - acts as 2-byte NOP
          8; // Standard ED instruction timing
      }
    });
  }

  buildDDTable() {
    // DD prefix instructions for IX operations
    this.buildIndexedTable('IX', this.ddTable);
  }

  buildFDTable() {
    // FD prefix instructions for IY operations
    this.buildIndexedTable('IY', this.fdTable);
  }

  buildIndexedTable(indexReg, table) {
    const { indexed, load } = this.instructions;

    // Basic IX/IY operations
    table[0x21] = () => load.loadReg16Immediate(indexReg, this.memory.fetchWord(this.registers));
    table[0x22] = () => load.loadAddressFromReg16(this.memory.fetchWord(this.registers), indexReg);
    table[0x2a] = () => load.loadReg16FromAddress(indexReg, this.memory.fetchWord(this.registers));
    table[0x23] = () => {
      this.registers.inc16(indexReg);
      return 10;
    };
    table[0x2b] = () => {
      this.registers.dec16(indexReg);
      return 10;
    };

    // ADD IX/IY, reg16
    table[0x09] = () => indexed.addIndex(indexReg, this.registers.getBC());
    table[0x19] = () => indexed.addIndex(indexReg, this.registers.getDE());
    table[0x29] = () => indexed.addIndex(indexReg, this.registers.get16(indexReg));
    table[0x39] = () => indexed.addIndex(indexReg, this.registers.get16('SP'));

    // Indexed memory operations
    table[0x7e] = () => indexed.loadRegFromIndexed('A', indexReg, this.memory.fetchByte(this.registers));
    table[0x77] = () => indexed.loadIndexedFromReg(indexReg, this.memory.fetchByte(this.registers), 'A');
    table[0x36] = () => {
      const disp = this.memory.fetchByte(this.registers);
      const value = this.memory.fetchByte(this.registers);
      return indexed.loadIndexedImmediate(indexReg, disp, value);
    };

    // More indexed loads
    this.addIndexedLoads(table, indexReg, indexed);

    // Indexed arithmetic
    this.addIndexedArithmetic(table, indexReg, indexed);

    // Misc indexed operations
    table[0xe9] = () => indexed.jumpIndexed(indexReg);
    table[0xe3] = () => indexed.exchangeSPIndexed(indexReg);
    table[0xe5] = () => indexed.pushIndexed(indexReg);
    table[0xe1] = () => indexed.popIndexed(indexReg);

    // CB prefix for indexed bit operations
    table[0xcb] = (_cpu) => this.executeIndexedCBInstruction(_cpu, indexReg);
  }

  addIndexedLoads(table, indexReg, indexed) {
    const regMap = ['B', 'C', 'D', 'E', 'H', 'L', null, 'A'];

    // LD reg, (IX/IY+d)
    const loadOpcodes = [0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, null, 0x7e];
    for (let i = 0; i < loadOpcodes.length; i++) {
      if (loadOpcodes[i] && regMap[i]) {
        table[loadOpcodes[i]] = () => {
          const disp = this.memory.fetchByte(this.registers);
          return indexed.loadRegFromIndexed(regMap[i], indexReg, disp);
        };
      }
    }

    // LD (IX/IY+d), reg
    const storeOpcodes = [0x70, 0x71, 0x72, 0x73, 0x74, 0x75, null, 0x77];
    for (let i = 0; i < storeOpcodes.length; i++) {
      if (storeOpcodes[i] && regMap[i]) {
        table[storeOpcodes[i]] = () => {
          const disp = this.memory.fetchByte(this.registers);
          return indexed.loadIndexedFromReg(indexReg, disp, regMap[i]);
        };
      }
    }
  }

  addIndexedArithmetic(table, indexReg, indexed) {
    // Arithmetic with (IX/IY+d)
    table[0x86] = () => indexed.addAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0x8e] = () => indexed.adcAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0x96] = () => indexed.subAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0x9e] = () => indexed.sbcAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0xa6] = () => indexed.andAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0xae] = () => indexed.xorAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0xb6] = () => indexed.orAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0xbe] = () => indexed.cpAIndexed(indexReg, this.memory.fetchByte(this.registers));

    // INC/DEC (IX/IY+d)
    table[0x34] = () => indexed.incIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0x35] = () => indexed.decIndexed(indexReg, this.memory.fetchByte(this.registers));
  }

  // Main instruction execution
  execute(opcode, cpu = null) {
    const handler = this.mainTable[opcode];
    if (handler) {
      return handler(cpu);
    }
    console.warn(
      `Unimplemented opcode: 0x${opcode.toString(16).padStart(2, '0')} at PC: 0x${(this.registers.getPC() - 1).toString(16).padStart(4, '0')}`,
    );
    return 4; // Default cycles
  }

  // Prefixed instruction handlers
  executeCBInstruction() {
    this.registers.incrementR();
    const cbOpcode = this.memory.fetchByte(this.registers);

    const handler = this.cbTable[cbOpcode];
    if (handler) {
      return handler();
    }
    console.warn(`Unimplemented CB opcode: 0x${cbOpcode.toString(16).padStart(2, '0')}`);
    return 8;
  }

  executeEDInstruction(cpu) {
    this.registers.incrementR();
    const edOpcode = this.memory.fetchByte(this.registers);

    const handler = this.edTable[edOpcode];
    if (handler) {
      return handler(cpu);
    }
    // Many ED opcodes act as NOPs
    return 8;
  }

  executeDDInstruction(cpu) {
    const ddOpcode = this.memory.fetchByte(this.registers);

    const handler = this.ddTable[ddOpcode];
    if (handler) {
      this.registers.incrementR(); // Only increment R if we handle the instruction
      return handler(cpu);
    }
    // Handle undocumented IXH/IXL opcodes
    switch (ddOpcode) {
      // LD reg,IXH
      case 0x44:
        this.registers.set('B', this.registers.getIXH());
        return 8;
      case 0x4c:
        this.registers.set('C', this.registers.getIXH());
        return 8;
      case 0x54:
        this.registers.set('D', this.registers.getIXH());
        return 8;
      case 0x5c:
        this.registers.set('E', this.registers.getIXH());
        return 8;
      case 0x7c:
        this.registers.set('A', this.registers.getIXH());
        return 8;

      // LD reg,IXL
      case 0x45:
        this.registers.set('B', this.registers.getIXL());
        return 8;
      case 0x4d:
        this.registers.set('C', this.registers.getIXL());
        return 8;
      case 0x55:
        this.registers.set('D', this.registers.getIXL());
        return 8;
      case 0x5d:
        this.registers.set('E', this.registers.getIXL());
        return 8;
      case 0x7d:
        this.registers.set('A', this.registers.getIXL());
        return 8;

      // LD IXH,reg
      case 0x60:
        this.registers.setIXH(this.registers.get('B'));
        return 8;
      case 0x61:
        this.registers.setIXH(this.registers.get('C'));
        return 8;
      case 0x62:
        this.registers.setIXH(this.registers.get('D'));
        return 8;
      case 0x63:
        this.registers.setIXH(this.registers.get('E'));
        return 8;
      case 0x67:
        this.registers.setIXH(this.registers.get('A'));
        return 8;

      // LD IXL,reg
      case 0x68:
        this.registers.setIXL(this.registers.get('B'));
        return 8;
      case 0x69:
        this.registers.setIXL(this.registers.get('C'));
        return 8;
      case 0x6a:
        this.registers.setIXL(this.registers.get('D'));
        return 8;
      case 0x6b:
        this.registers.setIXL(this.registers.get('E'));
        return 8;
      case 0x6f:
        this.registers.setIXL(this.registers.get('A'));
        return 8;

      // LD IXH,IXH / LD IXL,IXL (NOPs effectively)
      case 0x64:
        return 8; // LD IXH,IXH
      case 0x6d:
        return 8; // LD IXL,IXL

      // LD IXH,IXL / LD IXL,IXH
      case 0x65:
        this.registers.setIXH(this.registers.getIXL());
        return 8;
      case 0x6c:
        this.registers.setIXL(this.registers.getIXH());
        return 8;

      // Arithmetic with IXH
      case 0x84:
        this.instructions.arithmetic.addA(this.registers.getIXH());
        return 8;
      case 0x85:
        this.instructions.arithmetic.addA(this.registers.getIXL());
        return 8;
      case 0x8c:
        this.instructions.arithmetic.adcA(this.registers.getIXH());
        return 8;
      case 0x8d:
        this.instructions.arithmetic.adcA(this.registers.getIXL());
        return 8;
      case 0x94:
        this.instructions.arithmetic.subA(this.registers.getIXH());
        return 8;
      case 0x95:
        this.instructions.arithmetic.subA(this.registers.getIXL());
        return 8;
      case 0x9c:
        this.instructions.arithmetic.sbcA(this.registers.getIXH());
        return 8;
      case 0x9d:
        this.instructions.arithmetic.sbcA(this.registers.getIXL());
        return 8;

      // Logical with IXH/IXL
      case 0xa4:
        this.instructions.logical.andA(this.registers.getIXH());
        return 8;
      case 0xa5:
        this.instructions.logical.andA(this.registers.getIXL());
        return 8;
      case 0xac:
        this.instructions.logical.xorA(this.registers.getIXH());
        return 8;
      case 0xad:
        this.instructions.logical.xorA(this.registers.getIXL());
        return 8;
      case 0xb4:
        this.instructions.logical.orA(this.registers.getIXH());
        return 8;
      case 0xb5:
        this.instructions.logical.orA(this.registers.getIXL());
        return 8;
      case 0xbc:
        this.instructions.arithmetic.cpA(this.registers.getIXH());
        return 8;
      case 0xbd:
        this.instructions.arithmetic.cpA(this.registers.getIXL());
        return 8;

      // INC/DEC IXH/IXL
      case 0x24: {
        const result = this.instructions.arithmetic.inc8(this.registers.getIXH());
        this.registers.setIXH(result);
        return 8;
      }
      case 0x25: {
        const result = this.instructions.arithmetic.dec8(this.registers.getIXH());
        this.registers.setIXH(result);
        return 8;
      }
      case 0x2c: {
        const result = this.instructions.arithmetic.inc8(this.registers.getIXL());
        this.registers.setIXL(result);
        return 8;
      }
      case 0x2d: {
        const result = this.instructions.arithmetic.dec8(this.registers.getIXL());
        this.registers.setIXL(result);
        return 8;
      }

      // LD IXH/IXL,n
      case 0x26:
        this.registers.setIXH(this.memory.fetchByte(this.registers));
        return 11;
      case 0x2e:
        this.registers.setIXL(this.memory.fetchByte(this.registers));
        return 11;

      default:
        // If no DD handler, execute as normal instruction WITHOUT the prefix
        // Don't increment R again since main execute will do it
        return this.execute(ddOpcode, cpu);
    }
  }

  executeFDInstruction(cpu) {
    const fdOpcode = this.memory.fetchByte(this.registers);

    const handler = this.fdTable[fdOpcode];
    if (handler) {
      this.registers.incrementR(); // Only increment R if we handle the instruction
      return handler(cpu);
    }
    // Handle undocumented IYH/IYL opcodes
    switch (fdOpcode) {
      // LD reg,IYH
      case 0x44:
        this.registers.set('B', this.registers.getIYH());
        return 8;
      case 0x4c:
        this.registers.set('C', this.registers.getIYH());
        return 8;
      case 0x54:
        this.registers.set('D', this.registers.getIYH());
        return 8;
      case 0x5c:
        this.registers.set('E', this.registers.getIYH());
        return 8;
      case 0x7c:
        this.registers.set('A', this.registers.getIYH());
        return 8;

      // LD reg,IYL
      case 0x45:
        this.registers.set('B', this.registers.getIYL());
        return 8;
      case 0x4d:
        this.registers.set('C', this.registers.getIYL());
        return 8;
      case 0x55:
        this.registers.set('D', this.registers.getIYL());
        return 8;
      case 0x5d:
        this.registers.set('E', this.registers.getIYL());
        return 8;
      case 0x7d:
        this.registers.set('A', this.registers.getIYL());
        return 8;

      // LD IYH,reg
      case 0x60:
        this.registers.setIYH(this.registers.get('B'));
        return 8;
      case 0x61:
        this.registers.setIYH(this.registers.get('C'));
        return 8;
      case 0x62:
        this.registers.setIYH(this.registers.get('D'));
        return 8;
      case 0x63:
        this.registers.setIYH(this.registers.get('E'));
        return 8;
      case 0x67:
        this.registers.setIYH(this.registers.get('A'));
        return 8;

      // LD IYL,reg
      case 0x68:
        this.registers.setIYL(this.registers.get('B'));
        return 8;
      case 0x69:
        this.registers.setIYL(this.registers.get('C'));
        return 8;
      case 0x6a:
        this.registers.setIYL(this.registers.get('D'));
        return 8;
      case 0x6b:
        this.registers.setIYL(this.registers.get('E'));
        return 8;
      case 0x6f:
        this.registers.setIYL(this.registers.get('A'));
        return 8;

      // LD IYH,IYH / LD IYL,IYL (NOPs effectively)
      case 0x64:
        return 8; // LD IYH,IYH
      case 0x6d:
        return 8; // LD IYL,IYL

      // LD IYH,IYL / LD IYL,IYH
      case 0x65:
        this.registers.setIYH(this.registers.getIYL());
        return 8;
      case 0x6c:
        this.registers.setIYL(this.registers.getIYH());
        return 8;

      // Arithmetic with IYH
      case 0x84:
        this.instructions.arithmetic.addA(this.registers.getIYH());
        return 8;
      case 0x85:
        this.instructions.arithmetic.addA(this.registers.getIYL());
        return 8;
      case 0x8c:
        this.instructions.arithmetic.adcA(this.registers.getIYH());
        return 8;
      case 0x8d:
        this.instructions.arithmetic.adcA(this.registers.getIYL());
        return 8;
      case 0x94:
        this.instructions.arithmetic.subA(this.registers.getIYH());
        return 8;
      case 0x95:
        this.instructions.arithmetic.subA(this.registers.getIYL());
        return 8;
      case 0x9c:
        this.instructions.arithmetic.sbcA(this.registers.getIYH());
        return 8;
      case 0x9d:
        this.instructions.arithmetic.sbcA(this.registers.getIYL());
        return 8;

      // Logical with IYH/IYL
      case 0xa4:
        this.instructions.logical.andA(this.registers.getIYH());
        return 8;
      case 0xa5:
        this.instructions.logical.andA(this.registers.getIYL());
        return 8;
      case 0xac:
        this.instructions.logical.xorA(this.registers.getIYH());
        return 8;
      case 0xad:
        this.instructions.logical.xorA(this.registers.getIYL());
        return 8;
      case 0xb4:
        this.instructions.logical.orA(this.registers.getIYH());
        return 8;
      case 0xb5:
        this.instructions.logical.orA(this.registers.getIYL());
        return 8;
      case 0xbc:
        this.instructions.arithmetic.cpA(this.registers.getIYH());
        return 8;
      case 0xbd:
        this.instructions.arithmetic.cpA(this.registers.getIYL());
        return 8;

      // INC/DEC IYH/IYL
      case 0x24: {
        const result = this.instructions.arithmetic.inc8(this.registers.getIYH());
        this.registers.setIYH(result);
        return 8;
      }
      case 0x25: {
        const result = this.instructions.arithmetic.dec8(this.registers.getIYH());
        this.registers.setIYH(result);
        return 8;
      }
      case 0x2c: {
        const result = this.instructions.arithmetic.inc8(this.registers.getIYL());
        this.registers.setIYL(result);
        return 8;
      }
      case 0x2d: {
        const result = this.instructions.arithmetic.dec8(this.registers.getIYL());
        this.registers.setIYL(result);
        return 8;
      }

      // LD IYH/IYL,n
      case 0x26:
        this.registers.setIYH(this.memory.fetchByte(this.registers));
        return 11;
      case 0x2e:
        this.registers.setIYL(this.memory.fetchByte(this.registers));
        return 11;

      default:
        // If no FD handler, execute as normal instruction WITHOUT the prefix
        // Don't increment R again since main execute will do it
        return this.execute(fdOpcode, cpu);
    }
  }

  executeIndexedCBInstruction(_cpu, indexReg) {
    this.registers.incrementR();
    const displacement = this.memory.fetchByte(this.registers);
    const cbOpcode = this.memory.fetchByte(this.registers);

    return this.instructions.indexed.processIndexedCB(indexReg, displacement, cbOpcode);
  }
}

export { InstructionDecoder };
