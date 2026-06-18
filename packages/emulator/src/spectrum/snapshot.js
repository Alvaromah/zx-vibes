/**
 * ZX Spectrum .z80 Snapshot Loader.
 *
 * Supports 48K v1 snapshots and the 48K-compatible v2/v3 page layout used by
 * many emulators for saved 48K games.
 */

const BASE_HEADER_LENGTH = 30;
const RAM_48K_LENGTH = 49152;
const RAM_PAGE_LENGTH = 0x4000;
const EXTENDED_HEADER_START = 30;
const EXTENDED_MEMORY_PAGES_48K = new Map([
  [8, 0x4000],
  [4, 0x8000],
  [5, 0xc000],
]);
const REQUIRED_48K_PAGES = [4, 5, 8];

export class Z80SnapshotLoader {
  constructor(memory, cpu, ula) {
    this.memory = memory;
    this.cpu = cpu;
    this.ula = ula;
  }

  /**
   * Load a snapshot from a Uint8Array
   * @param {Uint8Array} data snapshot data
   */
  load(data) {
    if (!(data instanceof Uint8Array)) {
      throw new Error('Snapshot data must be Uint8Array');
    }
    if (data.length < BASE_HEADER_LENGTH) {
      throw new Error('Snapshot too small');
    }

    const header = data.subarray(0, BASE_HEADER_LENGTH);
    const basePc = this._word(header, 6);

    const snapshot =
      basePc === 0
        ? this._readExtended48K(data)
        : {
            pc: basePc,
            blocks: [
              {
                address: 0x4000,
                data: this._readV1Memory(data),
              },
            ],
          };

    // Byte 12 per the .z80 spec: bit 0 = bit 7 of R, bits 1-3 = border,
    // bit 5 = data compressed. Compatibility rule: 255 means 1.
    const flags1 = header[12] === 0xff ? 1 : header[12];
    this._loadRegisters(header, flags1, snapshot.pc);

    for (const block of snapshot.blocks) {
      this._writeMemory(block.address, block.data);
    }
  }

  _loadRegisters(header, flags1, pc) {
    const regs = this.cpu.registers;
    regs.set('A', header[0]);
    regs.set('F', header[1]);
    regs.set('C', header[2]);
    regs.set('B', header[3]);
    regs.set('L', header[4]);
    regs.set('H', header[5]);
    regs.set16('PC', pc);
    regs.set16('SP', this._word(header, 8));
    regs.data.I = header[10];

    regs.data.R = (header[11] & 0x7f) | ((flags1 & 0x01) << 7);
    const border = (flags1 >> 1) & 0x07;

    regs.set('E', header[13]);
    regs.set('D', header[14]);
    regs.data.C_ = header[15];
    regs.data.B_ = header[16];
    regs.data.E_ = header[17];
    regs.data.D_ = header[18];
    regs.data.L_ = header[19];
    regs.data.H_ = header[20];
    regs.data.A_ = header[21];
    regs.data.F_ = header[22];
    regs.set16('IY', header[23] | (header[24] << 8));
    regs.set16('IX', header[25] | (header[26] << 8));
    this.cpu.iff1 = header[27] !== 0;
    this.cpu.iff2 = header[28] !== 0;
    this.cpu.interruptMode = header[29] & 0x03; // bits 2-7 are other flags

    if (this.ula && typeof this.ula.setBorderColor === 'function') {
      this.ula.setBorderColor(border);
    }
  }

  _readV1Memory(data) {
    const flags1 = data[12] === 0xff ? 1 : data[12];
    const compressed = (flags1 & 0x20) !== 0;
    return compressed
      ? this._decompress(data.subarray(BASE_HEADER_LENGTH), RAM_48K_LENGTH, true)
      : this._copyFixed(data.subarray(BASE_HEADER_LENGTH), RAM_48K_LENGTH);
  }

  _readExtended48K(data) {
    if (data.length < 32) {
      throw new Error('Unsupported .z80 extended snapshot: missing extended header length');
    }

    const extraLength = this._word(data, EXTENDED_HEADER_START);
    const version = this._extendedVersion(extraLength);
    if (!version) {
      throw new Error(`Unsupported .z80 extended snapshot header length: ${extraLength}`);
    }

    const headerEnd = EXTENDED_HEADER_START + 2 + extraLength;
    if (data.length < headerEnd) {
      throw new Error('Truncated .z80 extended snapshot header');
    }

    const hardwareMode = data[34];
    if (!this._is48KCompatibleHardware(version, hardwareMode)) {
      throw new Error(`Unsupported .z80 ${version} hardware mode for 48K emulator: ${hardwareMode}`);
    }

    const blocks = [];
    const seenPages = new Set();
    let offset = headerEnd;

    while (offset < data.length) {
      if (offset + 3 > data.length) {
        throw new Error('Truncated .z80 memory block header');
      }

      const encodedLength = this._word(data, offset);
      const page = data[offset + 2];
      offset += 3;

      const payloadLength = encodedLength === 0xffff ? RAM_PAGE_LENGTH : encodedLength;
      if (offset + payloadLength > data.length) {
        throw new Error('Truncated .z80 memory block data');
      }

      const address = EXTENDED_MEMORY_PAGES_48K.get(page);
      const payload = data.subarray(offset, offset + payloadLength);
      offset += payloadLength;

      if (address === undefined) {
        continue;
      }

      const pageData =
        encodedLength === 0xffff
          ? this._copyFixed(payload, RAM_PAGE_LENGTH)
          : this._decompress(payload, RAM_PAGE_LENGTH, false);
      blocks.push({ address, data: pageData });
      seenPages.add(page);
    }

    for (const page of REQUIRED_48K_PAGES) {
      if (!seenPages.has(page)) {
        throw new Error(`Truncated .z80 48K snapshot: missing RAM page ${page}`);
      }
    }

    return {
      pc: this._word(data, 32),
      blocks,
    };
  }

  _writeMemory(address, data) {
    for (let i = 0; i < data.length; i++) {
      this.memory.write(address + i, data[i]);
    }
  }

  _copyFixed(data, length) {
    const result = new Uint8Array(length);
    result.set(data.subarray(0, length));
    return result;
  }

  _decompress(data, expectedLength, stopAtEndMarker) {
    const result = new Uint8Array(expectedLength);
    let ptr = 0;
    let i = 0;
    while (i < data.length && ptr < result.length) {
      const b = data[i++];
      if (
        stopAtEndMarker &&
        b === 0x00 &&
        i + 2 < data.length &&
        data[i] === 0xed &&
        data[i + 1] === 0xed &&
        data[i + 2] === 0x00
      ) {
        break;
      }
      if (b === 0xed && i < data.length && data[i] === 0xed) {
        if (i + 2 >= data.length) {
          break;
        }
        const count = data[i + 1];
        const value = data[i + 2];
        i += 3;
        if (count !== 0) {
          const end = Math.min(ptr + count, result.length);
          result.fill(value, ptr, end);
          ptr = end;
        }
        continue;
      }
      result[ptr++] = b;
    }
    return result;
  }

  _extendedVersion(extraLength) {
    if (extraLength === 23) return 'v2';
    if (extraLength === 54 || extraLength === 55) return 'v3';
    return undefined;
  }

  _is48KCompatibleHardware(version, hardwareMode) {
    if (hardwareMode === 0 || hardwareMode === 1) return true;
    return version === 'v3' && hardwareMode === 3;
  }

  _word(data, offset) {
    return (data[offset] | (data[offset + 1] << 8)) & 0xffff;
  }
}
