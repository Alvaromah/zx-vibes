import type { Machine } from './machine.js';

/**
 * .zxstate — Spectral's own machine-state format: a JSON document holding
 * everything needed to resume execution bit-exactly, including the shadow
 * registers that zx-generation's Z80.getState() omits and the mid-frame
 * position (tStatesIntoFrame) that .z80/.sna cannot express.
 */
export interface ZxState {
  version: 1;
  emulator: { name: string; version: string };
  frameCount: number;
  tStatesIntoFrame: number;
  cpu: {
    pc: number;
    sp: number;
    a: number;
    f: number;
    b: number;
    c: number;
    d: number;
    e: number;
    h: number;
    l: number;
    ix: number;
    iy: number;
    i: number;
    r: number;
    im: number;
    iff1: boolean;
    iff2: boolean;
    halted: boolean;
    cycles: number;
    // Shadow registers — NOT covered by Z80.getState() (upstream bug).
    aPrime: number;
    fPrime: number;
    bPrime: number;
    cPrime: number;
    dPrime: number;
    ePrime: number;
    hPrime: number;
    lPrime: number;
  };
  ula: {
    borderColor: number;
    speakerBit: number;
    micBit: number;
    keyboardMatrix: number[];
    lastPortFE: number;
    tapeInputBit: number;
    scanline: number;
    cycleCounter: number;
    interruptPending: boolean;
    borderChanged: boolean;
    scanlineBorderColors: string; // base64, 312 bytes
  };
  ram: string; // base64, 49152 bytes
}

export const EMULATOR_ID = { name: 'zx-generation', version: '1.0.1' };

export function serializeMachine(m: Machine): ZxState {
  if (m.tape.playing) {
    throw new Error(
      'Cannot save state while the tape is playing (tape position is not serialized yet). ' +
        'Wait for loading to finish or use binary injection instead.'
    );
  }
  const cpuState = m.cpu.getState();
  const regs = m.cpu.registers;
  const ula = m.ula;
  return {
    version: 1,
    emulator: { ...EMULATOR_ID },
    frameCount: m.frameCount,
    tStatesIntoFrame: m.tStatesIntoFrame,
    cpu: {
      ...cpuState,
      aPrime: regs.data['A_']!,
      fPrime: regs.data['F_']!,
      bPrime: regs.data['B_']!,
      cPrime: regs.data['C_']!,
      dPrime: regs.data['D_']!,
      ePrime: regs.data['E_']!,
      hPrime: regs.data['H_']!,
      lPrime: regs.data['L_']!,
    },
    ula: {
      borderColor: ula.borderColor,
      speakerBit: ula.speakerBit,
      micBit: ula.micBit,
      keyboardMatrix: Array.from(ula.keyboardMatrix),
      lastPortFE: ula.lastPortFE,
      tapeInputBit: ula.tapeInputBit,
      scanline: ula.scanline,
      cycleCounter: ula.cycleCounter,
      interruptPending: ula.interruptPending,
      borderChanged: ula.borderChanged,
      scanlineBorderColors: Buffer.from(ula.scanlineBorderColors).toString('base64'),
    },
    ram: Buffer.from(m.memory.ram).toString('base64'),
  };
}

export function applyState(m: Machine, state: ZxState): void {
  if (state.version !== 1) {
    throw new Error(`Unsupported .zxstate version: ${state.version}`);
  }

  m.memory.ram.set(Buffer.from(state.ram, 'base64'));

  const { cpu } = state;
  m.cpu.setState(cpu);
  const regs = m.cpu.registers;
  regs.data['A_'] = cpu.aPrime;
  regs.data['F_'] = cpu.fPrime;
  regs.data['B_'] = cpu.bPrime;
  regs.data['C_'] = cpu.cPrime;
  regs.data['D_'] = cpu.dPrime;
  regs.data['E_'] = cpu.ePrime;
  regs.data['H_'] = cpu.hPrime;
  regs.data['L_'] = cpu.lPrime;

  const u = state.ula;
  const ula = m.ula;
  ula.borderColor = u.borderColor;
  ula.speakerBit = u.speakerBit;
  ula.micBit = u.micBit;
  ula.keyboardMatrix.set(u.keyboardMatrix);
  ula.lastPortFE = u.lastPortFE;
  ula.tapeInputBit = u.tapeInputBit;
  ula.scanline = u.scanline;
  ula.cycleCounter = u.cycleCounter;
  ula.interruptPending = u.interruptPending;
  ula.borderChanged = u.borderChanged;
  ula.scanlineBorderColors.set(Buffer.from(u.scanlineBorderColors, 'base64'));

  m.frameCount = state.frameCount;
  m.tStatesIntoFrame = state.tStatesIntoFrame;
}

/* ───────────────────────── SNA (48K) ───────────────────────── */

/**
 * Loads a 48K .sna snapshot: 27-byte header + 49152 bytes of RAM.
 * PC is popped from the stack per the SNA convention.
 */
export function applySna(m: Machine, data: Uint8Array): void {
  if (data.length !== 27 + 49152) {
    throw new Error(`Not a 48K SNA snapshot: ${data.length} bytes (expected 49179)`);
  }
  const regs = m.cpu.registers;
  const w = (lo: number, hi: number) => data[lo]! | (data[hi]! << 8);

  regs.data['I'] = data[0]!;
  regs.data['L_'] = data[1]!;
  regs.data['H_'] = data[2]!;
  regs.data['E_'] = data[3]!;
  regs.data['D_'] = data[4]!;
  regs.data['C_'] = data[5]!;
  regs.data['B_'] = data[6]!;
  regs.data['F_'] = data[7]!;
  regs.data['A_'] = data[8]!;
  regs.set('L', data[9]!);
  regs.set('H', data[10]!);
  regs.set('E', data[11]!);
  regs.set('D', data[12]!);
  regs.set('C', data[13]!);
  regs.set('B', data[14]!);
  regs.set16('IY', w(15, 16));
  regs.set16('IX', w(17, 18));
  m.cpu.iff2 = (data[19]! & 0x04) !== 0;
  m.cpu.iff1 = m.cpu.iff2;
  regs.data['R'] = data[20]!;
  regs.set('F', data[21]!);
  regs.set('A', data[22]!);
  let sp = w(23, 24);
  m.cpu.interruptMode = data[25]! & 0x03;
  m.ula.setBorderColor(data[26]! & 0x07);

  m.memory.ram.set(data.subarray(27));

  // SNA stores PC on the stack; pop it.
  const pc = m.memory.read(sp) | (m.memory.read((sp + 1) & 0xffff) << 8);
  sp = (sp + 2) & 0xffff;
  regs.setPC(pc);
  regs.set16('SP', sp);
  m.cpu.halted = false;
}

/* ───────────────────────── .z80 v1 export ───────────────────────── */

/**
 * Exports a standard .z80 v1 snapshot (uncompressed) for interop with other
 * emulators (FUSE, browser zx-generation...). Note: .z80 cannot represent
 * mid-frame position; .zxstate remains the source of truth for sessions.
 */
export function writeZ80v1(m: Machine): Uint8Array {
  const regs = m.cpu.registers;
  const out = new Uint8Array(30 + 49152);
  const h = out;
  h[0] = regs.get('A');
  h[1] = regs.get('F');
  h[2] = regs.get('C');
  h[3] = regs.get('B');
  h[4] = regs.get('L');
  h[5] = regs.get('H');
  const pc = regs.getPC();
  h[6] = pc & 0xff;
  h[7] = pc >> 8;
  const sp = regs.get16('SP');
  h[8] = sp & 0xff;
  h[9] = sp >> 8;
  h[10] = regs.get('I');
  const r = regs.get('R');
  h[11] = r & 0x7f;
  // flags1: bit0 = R bit 7, bits 1-3 = border, bit 5 = 0 (uncompressed)
  h[12] = ((r >> 7) & 0x01) | ((m.ula.getBorderColor() & 0x07) << 1);
  h[13] = regs.get('E');
  h[14] = regs.get('D');
  h[15] = regs.data['C_']!;
  h[16] = regs.data['B_']!;
  h[17] = regs.data['E_']!;
  h[18] = regs.data['D_']!;
  h[19] = regs.data['L_']!;
  h[20] = regs.data['H_']!;
  h[21] = regs.data['A_']!;
  h[22] = regs.data['F_']!;
  const iy = regs.get16('IY');
  h[23] = iy & 0xff;
  h[24] = iy >> 8;
  const ix = regs.get16('IX');
  h[25] = ix & 0xff;
  h[26] = ix >> 8;
  h[27] = m.cpu.iff1 ? 1 : 0;
  h[28] = m.cpu.iff2 ? 1 : 0;
  h[29] = m.cpu.interruptMode & 0x03;
  out.set(m.memory.ram, 30);
  return out;
}
