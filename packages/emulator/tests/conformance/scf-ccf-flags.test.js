import { Z80 as CPU } from '../../src/core/cpu.js';

/**
 * SCF/CCF undocumented-flag (bits 3/5) conformance battery.
 *
 * The NMOS Z80 derives bits 5 and 3 of F after SCF/CCF as ((Q ^ F) | A), where
 * Q is the flags left by the last flag-modifying instruction (0 otherwise). This
 * reduces to:
 *   - "from A"   immediately after a flag-modifying (ALU) instruction, and
 *   - "from F|A" after an instruction that did not touch the flags.
 *
 * Each scenario below sets up a known A and F (via LD + CP, where CP takes bits
 * 3/5 from its operand and leaves A untouched), runs a chosen preceding
 * instruction, then SCF/CCF, and asserts the resulting bits 3/5. Expected values
 * are reasoned by hand from the rule above — independently of the implementation.
 *
 * NOTE: this is a curated battery, not Patrik Rak's full z80ccf ROM. That ROM is
 * a CP/M binary that runs for billions of T-states and needs a BDOS harness,
 * which is unsuitable for the unit-test suite; this covers the documented cases
 * across a representative range of preceding instructions.
 */

const XY = 0x28; // bits 5 (0x20) and 3 (0x08)

const SCF = 0x37;
const CCF = 0x3f;

function makeCpu() {
  const ram = new Uint8Array(0x10000);
  const memory = {
    read: (addr) => ram[addr & 0xffff],
    write: (addr, value) => {
      ram[addr & 0xffff] = value & 0xff;
    },
    readWord: (addr) => ram[addr & 0xffff] | (ram[(addr + 1) & 0xffff] << 8),
    writeWord: (addr, value) => {
      ram[addr & 0xffff] = value & 0xff;
      ram[(addr + 1) & 0xffff] = (value >> 8) & 0xff;
    },
  };
  const io = { read: () => 0xff, write: () => {} };
  return { cpu: new CPU(memory, io), ram };
}

/** Run `setup` then a final SCF/CCF, return the bits 3/5 of the resulting F. */
function runXY(setup, setupCount, finalOp) {
  const { cpu, ram } = makeCpu();
  ram.set([...setup, finalOp], 0);
  for (let i = 0; i < setupCount + 1; i++) cpu.execute();
  return cpu.registers.get('F') & XY;
}

// Each scenario is the instruction stream BEFORE the final SCF/CCF.
// LD A,n = 3E n ; CP n = FE n ; NOP = 00 ; INC BC = 03 ; EX DE,HL = EB ; OR A = B7
const SCENARIOS = [
  {
    name: 'after CP (ALU just set the flags) → bits come from A',
    setup: [0x3e, 0x00, 0xfe, 0x28], // A=0, then CP 0x28 sets F3/F5 from the operand
    count: 2,
    xy: 0x00, // A is 0
  },
  {
    name: 'after CP then LD A,n (LD does not touch F) → bits come from F|A',
    setup: [0x3e, 0x00, 0xfe, 0x28, 0x3e, 0x00],
    count: 3,
    xy: 0x28, // F still carries the bits from CP
  },
  {
    name: 'after CP then NOP → bits come from F|A',
    setup: [0x3e, 0x00, 0xfe, 0x28, 0x00],
    count: 3,
    xy: 0x28,
  },
  {
    name: 'after CP then INC BC (16-bit inc affects no flags) → bits come from F|A',
    setup: [0x3e, 0x00, 0xfe, 0x28, 0x03],
    count: 3,
    xy: 0x28,
  },
  {
    name: 'after CP then EX DE,HL (no flag change) → bits come from F|A',
    setup: [0x3e, 0x00, 0xfe, 0x28, 0xeb],
    count: 3,
    xy: 0x28,
  },
  {
    name: 'after CP then OR A (ALU clears F3/F5) → bits come from A',
    setup: [0x3e, 0x00, 0xfe, 0x28, 0xb7],
    count: 3,
    xy: 0x00, // OR A result is 0 → F3/F5 cleared, Q=F, A=0
  },
  {
    name: 'F bits clear, A bits set, after LD → F|A picks up A bits',
    setup: [0x3e, 0x28, 0xfe, 0x00, 0x3e, 0x28], // CP 0x00 clears F3/F5; A=0x28
    count: 3,
    xy: 0x28,
  },
  {
    name: 'after OR A with A=0x28 (ALU) → bits come from A (set)',
    setup: [0x3e, 0x28, 0xb7],
    count: 2,
    xy: 0x28,
  },
];

describe('SCF/CCF flag conformance (Q register, bits 3/5)', () => {
  for (const op of [
    { name: 'SCF', code: SCF },
    { name: 'CCF', code: CCF },
  ]) {
    describe(op.name, () => {
      for (const s of SCENARIOS) {
        it(`${s.name}`, () => {
          expect(runXY(s.setup, s.count, op.code)).toBe(s.xy);
        });
      }
    });
  }

  it('SCF still sets carry and clears H/N regardless of the undocumented bits', () => {
    const { cpu, ram } = makeCpu();
    ram.set([0x3e, 0x00, 0xfe, 0x28, SCF], 0);
    for (let i = 0; i < 3; i++) cpu.execute();
    const f = cpu.registers.get('F');
    expect(f & 0x01).toBe(0x01); // C set
    expect(f & 0x10).toBe(0x00); // H clear
    expect(f & 0x02).toBe(0x00); // N clear
  });
});
