/**
 * Z80 Registers Manager
 * Handles all register operations and 16-bit register pairs
 */
class Registers {
  constructor() {
    this.reset();
  }

  reset() {
    this.data = {
      A: 0,
      F: 0,
      B: 0,
      C: 0,
      D: 0,
      E: 0,
      H: 0,
      L: 0,
      A_: 0,
      F_: 0,
      B_: 0,
      C_: 0,
      D_: 0,
      E_: 0,
      H_: 0,
      L_: 0,
      I: 0,
      R: 0,
      IX: 0,
      IY: 0,
      SP: 0xffff,
      PC: 0x0000,
    };
  }

  // 8-bit register access
  get(name) {
    return this.data[name] & 0xff;
  }

  set(name, value) {
    this.data[name] = value & 0xff;
  }

  // 16-bit register pair getters
  getBC() {
    return (this.data.B << 8) | this.data.C;
  }

  getDE() {
    return (this.data.D << 8) | this.data.E;
  }

  getHL() {
    return (this.data.H << 8) | this.data.L;
  }

  getAF() {
    return (this.data.A << 8) | this.data.F;
  }

  // 16-bit register pair setters
  setBC(value) {
    const val = value & 0xffff;
    this.data.B = (val >> 8) & 0xff;
    this.data.C = val & 0xff;
  }

  setDE(value) {
    const val = value & 0xffff;
    this.data.D = (val >> 8) & 0xff;
    this.data.E = val & 0xff;
  }

  setHL(value) {
    const val = value & 0xffff;
    this.data.H = (val >> 8) & 0xff;
    this.data.L = val & 0xff;
  }

  setAF(value) {
    const val = value & 0xffff;
    this.data.A = (val >> 8) & 0xff;
    this.data.F = val & 0xff;
  }

  // 16-bit register access
  get16(name) {
    switch (name) {
      case 'BC':
        return this.getBC();
      case 'DE':
        return this.getDE();
      case 'HL':
        return this.getHL();
      case 'AF':
        return this.getAF();
      case 'SP':
        return this.data.SP & 0xffff;
      case 'PC':
        return this.data.PC & 0xffff;
      case 'IX':
        return this.data.IX & 0xffff;
      case 'IY':
        return this.data.IY & 0xffff;
      default:
        throw new Error(`Unknown 16-bit register: ${name}`);
    }
  }

  set16(name, value) {
    const val = value & 0xffff;
    switch (name) {
      case 'BC':
        this.setBC(val);
        break;
      case 'DE':
        this.setDE(val);
        break;
      case 'HL':
        this.setHL(val);
        break;
      case 'AF':
        this.setAF(val);
        break;
      case 'SP':
        this.data.SP = val;
        break;
      case 'PC':
        this.data.PC = val;
        break;
      case 'IX':
        this.data.IX = val;
        break;
      case 'IY':
        this.data.IY = val;
        break;
      default:
        throw new Error(`Unknown 16-bit register: ${name}`);
    }
  }

  // Increment/Decrement 16-bit registers
  inc16(name) {
    const value = this.get16(name);
    this.set16(name, (value + 1) & 0xffff);
  }

  dec16(name) {
    const value = this.get16(name);
    this.set16(name, (value - 1) & 0xffff);
  }

  // Program counter operations
  incrementPC(amount = 1) {
    this.data.PC = (this.data.PC + amount) & 0xffff;
  }

  setPC(address) {
    this.data.PC = address & 0xffff;
  }

  getPC() {
    return this.data.PC & 0xffff;
  }

  // R register operations (7-bit counter with bit 7 unchanged)
  incrementR() {
    this.data.R = ((this.data.R + 1) & 0x7f) | (this.data.R & 0x80);
  }

  // Exchange operations
  exchangeAF() {
    const tempA = this.data.A;
    const tempF = this.data.F;
    this.data.A = this.data.A_;
    this.data.F = this.data.F_;
    this.data.A_ = tempA;
    this.data.F_ = tempF;
  }

  exchangeAll() {
    // EXX - Exchange BC, DE, HL with their shadow registers
    const tempB = this.data.B;
    const tempC = this.data.C;
    const tempD = this.data.D;
    const tempE = this.data.E;
    const tempH = this.data.H;
    const tempL = this.data.L;

    this.data.B = this.data.B_;
    this.data.C = this.data.C_;
    this.data.D = this.data.D_;
    this.data.E = this.data.E_;
    this.data.H = this.data.H_;
    this.data.L = this.data.L_;

    this.data.B_ = tempB;
    this.data.C_ = tempC;
    this.data.D_ = tempD;
    this.data.E_ = tempE;
    this.data.H_ = tempH;
    this.data.L_ = tempL;
  }

  exchangeDE_HL() {
    const tempDE = this.getDE();
    this.setDE(this.getHL());
    this.setHL(tempDE);
  }

  // Debug helper
  dump() {
    return {
      A: this.data.A.toString(16).padStart(2, '0'),
      F: this.data.F.toString(16).padStart(2, '0'),
      BC: this.getBC().toString(16).padStart(4, '0'),
      DE: this.getDE().toString(16).padStart(4, '0'),
      HL: this.getHL().toString(16).padStart(4, '0'),
      SP: this.data.SP.toString(16).padStart(4, '0'),
      PC: this.data.PC.toString(16).padStart(4, '0'),
      IX: this.data.IX.toString(16).padStart(4, '0'),
      IY: this.data.IY.toString(16).padStart(4, '0'),
      I: this.data.I.toString(16).padStart(2, '0'),
      R: this.data.R.toString(16).padStart(2, '0'),
    };
  }

  // Undocumented IX/IY half registers
  getIXH() {
    return (this.data.IX >> 8) & 0xff;
  }

  setIXH(value) {
    this.data.IX = (this.data.IX & 0x00ff) | ((value & 0xff) << 8);
  }

  getIXL() {
    return this.data.IX & 0xff;
  }

  setIXL(value) {
    this.data.IX = (this.data.IX & 0xff00) | (value & 0xff);
  }

  getIYH() {
    return (this.data.IY >> 8) & 0xff;
  }

  setIYH(value) {
    this.data.IY = (this.data.IY & 0x00ff) | ((value & 0xff) << 8);
  }

  getIYL() {
    return this.data.IY & 0xff;
  }

  setIYL(value) {
    this.data.IY = (this.data.IY & 0xff00) | (value & 0xff);
  }

  // Property accessors for test compatibility
  get a() {
    return this.get('A');
  }
  set a(value) {
    this.set('A', value);
  }

  get f() {
    return this.get('F');
  }
  set f(value) {
    this.set('F', value);
  }

  get b() {
    return this.get('B');
  }
  set b(value) {
    this.set('B', value);
  }

  get c() {
    return this.get('C');
  }
  set c(value) {
    this.set('C', value);
  }

  get d() {
    return this.get('D');
  }
  set d(value) {
    this.set('D', value);
  }

  get e() {
    return this.get('E');
  }
  set e(value) {
    this.set('E', value);
  }

  get h() {
    return this.get('H');
  }
  set h(value) {
    this.set('H', value);
  }

  get l() {
    return this.get('L');
  }
  set l(value) {
    this.set('L', value);
  }

  get i() {
    return this.get('I');
  }
  set i(value) {
    this.set('I', value);
  }

  get r() {
    return this.get('R');
  }
  set r(value) {
    this.set('R', value);
  }

  get pc() {
    return this.getPC();
  }
  set pc(value) {
    this.setPC(value);
  }

  get sp() {
    return this.data.SP & 0xffff;
  }
  set sp(value) {
    this.data.SP = value & 0xffff;
  }

  get ix() {
    return this.data.IX & 0xffff;
  }
  set ix(value) {
    this.data.IX = value & 0xffff;
  }

  get iy() {
    return this.data.IY & 0xffff;
  }
  set iy(value) {
    this.data.IY = value & 0xffff;
  }

  get bc() {
    return this.getBC();
  }
  set bc(value) {
    this.setBC(value);
  }

  get de() {
    return this.getDE();
  }
  set de(value) {
    this.setDE(value);
  }

  get hl() {
    return this.getHL();
  }
  set hl(value) {
    this.setHL(value);
  }

  get af() {
    return this.getAF();
  }
  set af(value) {
    this.setAF(value);
  }
}

export { Registers };
