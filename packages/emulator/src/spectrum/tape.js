/**
 * ZX Spectrum Tape Emulation
 * Supports TAP and TZX tape formats
 *
 * Key findings from research:
 * - Each bit is represented by 2 pulses (complete square wave)
 * - Pilot tone: 8063 pulses for headers, 3223 for data blocks
 * - Standard timings: PILOT=2168, SYNC1=667, SYNC2=735, ZERO=855, ONE=1710 T-states
 * - Edge-triggered loading (polarity doesn't matter)
 * - TAP format is simple: 2-byte length + data (including flag + checksum)
 * - TZX format supports multiple block types for custom loaders
 */
/* eslint-disable no-console */

export class Tape {
  constructor(spectrum) {
    this.spectrum = spectrum;
    this.cpu = spectrum.cpu;
    this.ula = spectrum.ula;

    // Tape state
    this.playing = false;
    this.paused = false;
    this.position = 0;
    this.data = null;
    this.format = null;

    // Current block info
    this.currentBlock = null;
    this.blockIndex = 0;
    this.bitPosition = 0;
    this.currentBit = 0; // Current bit value (0 or 1)
    this.lastEarBit = 0; // Last EAR bit state (0 or 1)

    // Timing
    this.nextEdgeCycle = 0;
    this.lastUpdateCycle = 0;

    // Block state machine
    this.state = 'IDLE';
    this.pulseCount = 0; // Number of pulses generated
    this.edgeCount = 0; // Number of edges generated
    this.bytePosition = 0;
    this.pauseCycles = 0;

    // Pulse sequence state
    this.pulseIndex = 0;
    this.pulseCycles = 0;

    // Parsed blocks
    this.blocks = [];

    // TAP/TZX block types
    this.BLOCK_STANDARD = 0x10;
    this.BLOCK_TURBO = 0x11;
    this.BLOCK_PURE_TONE = 0x12;
    this.BLOCK_PULSE_SEQUENCE = 0x13;
    this.BLOCK_PURE_DATA = 0x14;
    this.BLOCK_PAUSE = 0x20;
    this.BLOCK_GROUP_START = 0x21;
    this.BLOCK_GROUP_END = 0x22;
    this.BLOCK_TEXT = 0x30;
    this.BLOCK_MESSAGE = 0x31;
    this.BLOCK_ARCHIVE_INFO = 0x32;
    this.BLOCK_HARDWARE_TYPE = 0x33;

    // Standard timing constants (in T-states)
    this.PILOT_PULSE = 2168;
    this.SYNC1_PULSE = 667;
    this.SYNC2_PULSE = 735;
    this.ZERO_PULSE = 855;
    this.ONE_PULSE = 1710;
    this.PILOT_PULSES_HEADER = 8063; // Number of pilot pulses for headers
    this.PILOT_PULSES_DATA = 3223; // Number of pilot pulses for data

    // Standard pause after block (in milliseconds)
    this.STANDARD_PAUSE = 500; // Reduced from 1000ms for better compatibility

    // Cycles per millisecond (3.5MHz for 48K Spectrum)
    this.CYCLES_PER_MS = 3500;
  }

  /**
   * Load a tape file
   * @param {ArrayBuffer} buffer - The tape file data
   * @param {string} filename - The filename to determine format
   */
  load(buffer, filename) {
    this.data = new Uint8Array(buffer);
    this.position = 0;
    this.blockIndex = 0;
    this.reset();

    // Determine format from extension
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'tap') {
      this.format = 'TAP';
      this.parseTAP();
    } else if (ext === 'tzx') {
      this.format = 'TZX';
      this.parseTZX();
    } else {
      throw new Error(`Unsupported tape format: ${ext}`);
    }

    console.log(`Loaded ${this.format} file: ${filename}`);
    console.log(`Total blocks: ${this.blocks.length}`);
    this.blocks.forEach((block, i) => {
      const type = this.getBlockTypeName(block.type);
      console.log(
        `Block ${i}: ${type}, ` +
          `${block.data ? `${block.data.length} bytes` : 'no data'}, ` +
          `pause=${block.pause || 0}ms`,
      );
    });
  }

  /**
   * Parse TAP format
   */
  parseTAP() {
    this.blocks = [];
    let pos = 0;

    while (pos < this.data.length) {
      // Check if we have at least 2 bytes for length
      if (pos + 2 > this.data.length) {
        console.warn('TAP file truncated at position', pos);
        break;
      }

      // Read block length (little-endian)
      const length = this.data[pos] | (this.data[pos + 1] << 8);
      pos += 2;

      if (pos + length > this.data.length) {
        console.warn(`TAP file truncated: expected ${length} bytes at position ${pos}`);
        break;
      }

      // Create standard speed data block
      const blockData = this.data.slice(pos, pos + length);
      const flagByte = blockData[0];

      // Different pause times for headers vs data blocks
      const pauseTime = flagByte < 128 ? 100 : 500; // Shorter pause after headers

      const block = {
        type: this.BLOCK_STANDARD,
        data: blockData,
        pilotPulse: this.PILOT_PULSE,
        sync1Pulse: this.SYNC1_PULSE,
        sync2Pulse: this.SYNC2_PULSE,
        zeroPulse: this.ZERO_PULSE,
        onePulse: this.ONE_PULSE,
        pilotPulses: flagByte < 128 ? this.PILOT_PULSES_HEADER : this.PILOT_PULSES_DATA,
        pause: pauseTime, // Different pauses for header/data
        usedBits: 8, // All bits used in TAP format
      };

      this.blocks.push(block);

      // Log block info
      const blockType = flagByte === 0x00 ? 'Header' : 'Data';
      console.log(
        `TAP Block ${this.blocks.length - 1}: ${blockType} (flag=0x${flagByte.toString(16).padStart(2, '0')}), ` +
          `${length} bytes`,
      );

      pos += length;
    }
  }

  /**
   * Parse TZX format
   */
  parseTZX() {
    this.blocks = [];

    // Check TZX header
    const header = String.fromCharCode(...this.data.slice(0, 7));
    if (header !== 'ZXTape!') {
      throw new Error('Invalid TZX file header');
    }

    const eofMarker = this.data[7];
    if (eofMarker !== 0x1a) {
      throw new Error('Invalid TZX EOF marker');
    }

    const majorVersion = this.data[8];
    const minorVersion = this.data[9];
    console.log(`TZX version ${majorVersion}.${minorVersion}`);

    // Skip header
    let pos = 10;

    while (pos < this.data.length) {
      const blockId = this.data[pos];
      pos++;

      try {
        switch (blockId) {
          case this.BLOCK_STANDARD:
            pos = this.parseTZXStandardBlock(pos);
            break;

          case this.BLOCK_TURBO:
            pos = this.parseTZXTurboBlock(pos);
            break;

          case this.BLOCK_PURE_TONE:
            pos = this.parseTZXPureToneBlock(pos);
            break;

          case this.BLOCK_PULSE_SEQUENCE:
            pos = this.parseTZXPulseSequenceBlock(pos);
            break;

          case this.BLOCK_PURE_DATA:
            pos = this.parseTZXPureDataBlock(pos);
            break;

          case this.BLOCK_PAUSE:
            pos = this.parseTZXPauseBlock(pos);
            break;

          case this.BLOCK_GROUP_START:
          case this.BLOCK_GROUP_END:
          case this.BLOCK_TEXT:
          case this.BLOCK_MESSAGE:
          case this.BLOCK_ARCHIVE_INFO:
          case this.BLOCK_HARDWARE_TYPE:
            pos = this.skipTZXInfoBlock(pos, blockId);
            break;

          default:
            console.warn(`Unknown TZX block type: 0x${blockId.toString(16)} at position ${pos - 1}`);
            // Try to skip unknown block by looking for size
            if (pos + 4 <= this.data.length) {
              const size = this.readDWord(pos);
              pos += 4 + size;
            } else {
              pos = this.data.length;
            }
        }
      } catch (e) {
        console.error(`Error parsing TZX block 0x${blockId.toString(16)} at position ${pos - 1}:`, e);
        break;
      }
    }
  }

  /**
   * Parse TZX standard speed data block (ID 10h)
   */
  parseTZXStandardBlock(pos) {
    if (pos + 4 > this.data.length) {
      throw new Error('Insufficient data for standard block');
    }

    const pause = this.readWord(pos);
    const length = this.readWord(pos + 2);

    if (pos + 4 + length > this.data.length) {
      throw new Error('Insufficient data for standard block data');
    }

    const blockData = this.data.slice(pos + 4, pos + 4 + length);
    const flagByte = blockData[0];

    const block = {
      type: this.BLOCK_STANDARD,
      data: blockData,
      pilotPulse: this.PILOT_PULSE,
      sync1Pulse: this.SYNC1_PULSE,
      sync2Pulse: this.SYNC2_PULSE,
      zeroPulse: this.ZERO_PULSE,
      onePulse: this.ONE_PULSE,
      pilotPulses: flagByte < 128 ? this.PILOT_PULSES_HEADER : this.PILOT_PULSES_DATA,
      pause,
      usedBits: 8,
    };

    this.blocks.push(block);
    return pos + 4 + length;
  }

  /**
   * Parse TZX turbo speed data block (ID 11h)
   */
  parseTZXTurboBlock(pos) {
    if (pos + 18 > this.data.length) {
      throw new Error('Insufficient data for turbo block');
    }

    const block = {
      type: this.BLOCK_TURBO,
      pilotPulse: this.readWord(pos),
      sync1Pulse: this.readWord(pos + 2),
      sync2Pulse: this.readWord(pos + 4),
      zeroPulse: this.readWord(pos + 6),
      onePulse: this.readWord(pos + 8),
      pilotPulses: this.readWord(pos + 10),
      usedBits: this.data[pos + 12],
      pause: this.readWord(pos + 13),
      dataLength: this.readTriple(pos + 15),
    };

    const dataStart = pos + 18;
    if (dataStart + block.dataLength > this.data.length) {
      throw new Error('Insufficient data for turbo block data');
    }

    block.data = this.data.slice(dataStart, dataStart + block.dataLength);

    this.blocks.push(block);
    return dataStart + block.dataLength;
  }

  /**
   * Parse TZX pure tone block (ID 12h)
   */
  parseTZXPureToneBlock(pos) {
    if (pos + 4 > this.data.length) {
      throw new Error('Insufficient data for pure tone block');
    }

    const block = {
      type: this.BLOCK_PURE_TONE,
      pulseLength: this.readWord(pos),
      pulseCount: this.readWord(pos + 2),
    };

    this.blocks.push(block);
    return pos + 4;
  }

  /**
   * Parse TZX pulse sequence block (ID 13h)
   */
  parseTZXPulseSequenceBlock(pos) {
    if (pos + 1 > this.data.length) {
      throw new Error('Insufficient data for pulse sequence block');
    }

    const count = this.data[pos];
    const dataPos = pos + 1;

    if (dataPos + count * 2 > this.data.length) {
      throw new Error('Insufficient data for pulse sequence');
    }

    const block = {
      type: this.BLOCK_PULSE_SEQUENCE,
      pulses: [],
    };

    for (let i = 0; i < count; i++) {
      block.pulses.push(this.readWord(dataPos + i * 2));
    }

    this.blocks.push(block);
    return dataPos + count * 2;
  }

  /**
   * Parse TZX pure data block (ID 14h)
   */
  parseTZXPureDataBlock(pos) {
    if (pos + 10 > this.data.length) {
      throw new Error('Insufficient data for pure data block');
    }

    const block = {
      type: this.BLOCK_PURE_DATA,
      zeroPulse: this.readWord(pos),
      onePulse: this.readWord(pos + 2),
      usedBits: this.data[pos + 4],
      pause: this.readWord(pos + 5),
      dataLength: this.readTriple(pos + 7),
    };

    const dataStart = pos + 10;
    if (dataStart + block.dataLength > this.data.length) {
      throw new Error('Insufficient data for pure data block data');
    }

    block.data = this.data.slice(dataStart, dataStart + block.dataLength);

    this.blocks.push(block);
    return dataStart + block.dataLength;
  }

  /**
   * Parse TZX pause/silence block (ID 20h)
   */
  parseTZXPauseBlock(pos) {
    if (pos + 2 > this.data.length) {
      throw new Error('Insufficient data for pause block');
    }

    const pause = this.readWord(pos);

    // Pause of 0 means stop the tape
    if (pause === 0) {
      console.log('TZX: Stop the tape block encountered');
    }

    this.blocks.push({
      type: this.BLOCK_PAUSE,
      pause,
    });

    return pos + 2;
  }

  /**
   * Skip TZX info blocks
   */
  skipTZXInfoBlock(pos, blockId) {
    switch (blockId) {
      case this.BLOCK_GROUP_START:
        // Group start: length byte + text
        if (pos + 1 > this.data.length) {
          return this.data.length;
        }
        return pos + 1 + this.data[pos];

      case this.BLOCK_GROUP_END:
        // Group end: no data
        return pos;

      case this.BLOCK_TEXT:
        // Text description: length byte + text
        if (pos + 1 > this.data.length) {
          return this.data.length;
        }
        return pos + 1 + this.data[pos];

      case this.BLOCK_MESSAGE:
        // Message block: time byte + length byte + text
        if (pos + 2 > this.data.length) {
          return this.data.length;
        }
        return pos + 2 + this.data[pos + 1];

      case this.BLOCK_ARCHIVE_INFO:
        // Archive info: length word + data
        if (pos + 2 > this.data.length) {
          return this.data.length;
        }
        return pos + 2 + this.readWord(pos);

      case this.BLOCK_HARDWARE_TYPE:
        // Hardware type: count byte + 3 bytes per entry
        if (pos + 1 > this.data.length) {
          return this.data.length;
        }
        return pos + 1 + this.data[pos] * 3;

      default:
        return pos;
    }
  }

  /**
   * Read a 16-bit word (little-endian)
   */
  readWord(pos) {
    return this.data[pos] | (this.data[pos + 1] << 8);
  }

  /**
   * Read a 24-bit triple (little-endian)
   */
  readTriple(pos) {
    return this.data[pos] | (this.data[pos + 1] << 8) | (this.data[pos + 2] << 16);
  }

  /**
   * Read a 32-bit dword (little-endian)
   */
  readDWord(pos) {
    return this.data[pos] | (this.data[pos + 1] << 8) | (this.data[pos + 2] << 16) | (this.data[pos + 3] << 24);
  }

  /**
   * Get block type name
   */
  getBlockTypeName(type) {
    const names = {
      0x10: 'Standard Speed Data',
      0x11: 'Turbo Speed Data',
      0x12: 'Pure Tone',
      0x13: 'Pulse Sequence',
      0x14: 'Pure Data',
      0x20: 'Pause/Stop',
      0x21: 'Group Start',
      0x22: 'Group End',
      0x30: 'Text Description',
      0x31: 'Message',
      0x32: 'Archive Info',
      0x33: 'Hardware Type',
    };
    return names[type] || `Unknown (0x${type.toString(16)})`;
  }

  /**
   * Reset tape state
   */
  reset() {
    this.state = 'IDLE';
    this.currentBlock = null;
    this.lastEarBit = 0;
    this.nextEdgeCycle = 0;
    this.pulseCount = 0;
    this.edgeCount = 0;
    this.bitPosition = 0;
    this.bytePosition = 0;
    this.currentBit = 0;
    this.pauseCycles = 0;
    this.pulseIndex = 0;
    this.pulseCycles = 0;
  }

  /**
   * Start playing the tape
   */
  play() {
    if (!this.blocks || this.blocks.length === 0) {
      console.log('No blocks to play');
      return;
    }

    console.log('Starting tape playback');
    this.playing = true;
    this.paused = false;

    // Initialize timing
    this.lastUpdateCycle = this.cpu.cycles;

    if (!this.currentBlock) {
      this.nextBlock();
    }
  }

  /**
   * Pause tape playback
   */
  pause() {
    this.paused = true;
    console.log('Tape paused');
  }

  /**
   * Stop tape playback
   */
  stop() {
    this.playing = false;
    this.paused = false;
    this.blockIndex = 0;
    this.reset();
    console.log('Tape stopped');
  }

  /**
   * Rewind tape to beginning
   */
  rewind() {
    this.stop();
    this.blockIndex = 0;
    console.log('Tape rewound');
  }

  /**
   * Move to next block
   */
  nextBlock() {
    if (this.blockIndex >= this.blocks.length) {
      console.log('End of tape reached');
      this.stop();
      return;
    }

    this.currentBlock = this.blocks[this.blockIndex];
    const blockType = this.getBlockTypeName(this.currentBlock.type);
    console.log(`\nStarting block ${this.blockIndex}: ${blockType}`);

    if (this.currentBlock.data) {
      const flagByte = this.currentBlock.data[0];
      console.log(`  Flag byte: 0x${flagByte.toString(16).padStart(2, '0')} (${flagByte < 128 ? 'Header' : 'Data'})`);
      console.log(`  Data length: ${this.currentBlock.data.length} bytes`);
      console.log(`  Pause after: ${this.currentBlock.pause || 0}ms`);
    }

    this.blockIndex++;

    // Reset block state
    this.bitPosition = 0;
    this.bytePosition = 0;
    this.pulseCount = 0;
    this.edgeCount = 0;
    this.pulseIndex = 0;
    this.pulseCycles = 0;

    // Initialize block state based on type
    switch (this.currentBlock.type) {
      case this.BLOCK_STANDARD:
      case this.BLOCK_TURBO:
        this.state = 'PILOT';
        // Initialize next edge timing
        this.nextEdgeCycle = this.cpu.cycles + this.currentBlock.pilotPulse;
        console.log(`  Starting PILOT state with ${this.currentBlock.pilotPulses} pulses`);
        break;

      case this.BLOCK_PAUSE:
        this.state = 'PAUSE';
        this.pauseCycles = this.currentBlock.pause * this.CYCLES_PER_MS;
        // If pause is 0, stop the tape
        if (this.currentBlock.pause === 0) {
          console.log('Stop the tape command encountered');
          this.stop();
        }
        break;

      case this.BLOCK_PURE_TONE:
        this.state = 'TONE';
        this.nextEdgeCycle = this.cpu.cycles + this.currentBlock.pulseLength;
        break;

      case this.BLOCK_PULSE_SEQUENCE:
        this.state = 'PULSES';
        if (this.currentBlock.pulses.length > 0) {
          this.nextEdgeCycle = this.cpu.cycles + this.currentBlock.pulses[0];
        }
        break;

      case this.BLOCK_PURE_DATA:
        this.state = 'DATA';
        // Pure data block starts directly with data, no pilot or sync
        this.nextEdgeCycle = this.cpu.cycles;
        break;

      default:
        console.warn(`Unsupported block type: ${this.currentBlock.type}`);
        this.nextBlock();
    }
  }

  /**
   * Update tape playback
   * @param {number} cycles - Current CPU cycle count
   * @returns {number} - Current tape input bit (0 or 1)
   */
  update(cycles) {
    if (!this.playing || this.paused || !this.currentBlock) {
      return this.lastEarBit;
    }

    // Handle pause state first (can occur after any block type)
    if (this.state === 'PAUSE') {
      this.updatePauseState(cycles);
      this.lastUpdateCycle = cycles;
      return this.lastEarBit;
    }

    // Update based on current block type
    switch (this.currentBlock.type) {
      case this.BLOCK_STANDARD:
      case this.BLOCK_TURBO:
        this.updateDataBlock(cycles);
        break;

      case this.BLOCK_PAUSE:
        this.updatePauseBlock(cycles);
        break;

      case this.BLOCK_PURE_TONE:
        this.updateToneBlock(cycles);
        break;

      case this.BLOCK_PULSE_SEQUENCE:
        this.updatePulseSequenceBlock(cycles);
        break;

      case this.BLOCK_PURE_DATA:
        this.updatePureDataBlock(cycles);
        break;
    }

    this.lastUpdateCycle = cycles;
    return this.lastEarBit;
  }

  /**
   * Update standard/turbo data block
   */
  updateDataBlock(cycles) {
    const block = this.currentBlock;

    // Check if it's time for next edge
    if (cycles < this.nextEdgeCycle) {
      return;
    }

    // Toggle EAR bit
    this.lastEarBit = 1 - this.lastEarBit;

    switch (this.state) {
      case 'PILOT':
        // Generate pilot tone
        this.nextEdgeCycle += block.pilotPulse;
        this.edgeCount++;

        // Each pulse consists of 2 edges
        if (this.edgeCount >= block.pilotPulses * 2) {
          console.log(`Pilot complete after ${this.edgeCount} edges`);
          this.state = 'SYNC1';
          this.nextEdgeCycle = cycles + block.sync1Pulse;
        }
        break;

      case 'SYNC1':
        // First sync pulse
        this.state = 'SYNC2';
        this.nextEdgeCycle = cycles + block.sync2Pulse;
        break;

      case 'SYNC2':
        // Second sync pulse - prepare for data
        this.state = 'DATA';
        this.bytePosition = 0;
        this.bitPosition = 0;
        this.pulseCount = 0;

        // Start with first bit
        if (block.data && block.data.length > 0) {
          this.currentBit = (block.data[0] >> 7) & 1;
          const pulseLength = this.currentBit ? block.onePulse : block.zeroPulse;
          this.nextEdgeCycle = cycles + pulseLength;
          console.log(`Starting DATA state: ${block.data.length} bytes, first bit=${this.currentBit}`);
        } else {
          // No data, move to next block
          console.log('No data in block, moving to next');
          this.handleBlockEnd();
        }
        break;

      case 'DATA':
        // Output data bits
        this.pulseCount++;

        // Each bit consists of 2 pulses (4 edges)
        if (this.pulseCount < 2) {
          // Same bit, next pulse
          const pulseLength = this.currentBit ? block.onePulse : block.zeroPulse;
          this.nextEdgeCycle = cycles + pulseLength;
        } else {
          // Move to next bit
          this.pulseCount = 0;
          this.bitPosition++;

          if (this.bitPosition >= 8) {
            // Move to next byte
            this.bitPosition = 0;
            this.bytePosition++;

            if (this.bytePosition >= block.data.length) {
              // All data sent
              this.handleBlockEnd();
              return;
            }
          }

          // Check if this is the last byte and we have limited bits
          const isLastByte = this.bytePosition === block.data.length - 1;
          const bitsInByte = isLastByte ? block.usedBits : 8;

          if (this.bitPosition < bitsInByte) {
            // Get next bit
            const byte = block.data[this.bytePosition];
            this.currentBit = (byte >> (7 - this.bitPosition)) & 1;
            const pulseLength = this.currentBit ? block.onePulse : block.zeroPulse;
            this.nextEdgeCycle = cycles + pulseLength;
          } else {
            // No more bits in last byte
            this.handleBlockEnd();
          }
        }
        break;
    }
  }

  /**
   * Update pause state (can occur after any block)
   *
   * @private
   * @param {number} cycles - Current CPU cycle count
   * @returns {void}
   */
  updatePauseState(cycles) {
    if (this.pauseCycles > 0) {
      const elapsed = cycles - this.lastUpdateCycle;
      this.pauseCycles -= elapsed;

      // During pause, keep EAR bit low (0)
      this.lastEarBit = 0;

      if (this.pauseCycles <= 0) {
        console.log(`Pause complete after ${elapsed} cycles, moving to next block`);
        console.log(`Current state: ${this.state}, Block index: ${this.blockIndex}/${this.blocks.length}`);
        this.pauseCycles = 0;
        this.state = 'IDLE'; // Reset state before moving to next block
        this.nextBlock();
      }
    } else {
      // No pause cycles, move to next block immediately
      console.log('No pause cycles remaining, moving to next block');
      this.state = 'IDLE';
      this.nextBlock();
    }
  }

  /**
   * Update pause block
   *
   * @private
   * @param {number} cycles - Current CPU cycle count
   * @returns {void}
   */
  updatePauseBlock(cycles) {
    // For explicit pause blocks, delegate to updatePauseState
    this.updatePauseState(cycles);
  }

  /**
   * Update pure tone block
   *
   * @private
   * @param {number} cycles - Current CPU cycle count
   * @returns {void}
   */
  updateToneBlock(cycles) {
    if (cycles >= this.nextEdgeCycle) {
      this.lastEarBit = 1 - this.lastEarBit;
      this.nextEdgeCycle += this.currentBlock.pulseLength;
      this.pulseCount++;

      if (this.pulseCount >= this.currentBlock.pulseCount) {
        console.log(`Pure tone complete after ${this.pulseCount} pulses`);
        this.nextBlock();
      }
    }
  }

  /**
   * Update pulse sequence block
   *
   * @private
   * @param {number} cycles - Current CPU cycle count
   * @returns {void}
   */
  updatePulseSequenceBlock(cycles) {
    if (cycles >= this.nextEdgeCycle) {
      this.lastEarBit = 1 - this.lastEarBit;

      if (this.pulseIndex < this.currentBlock.pulses.length) {
        this.nextEdgeCycle += this.currentBlock.pulses[this.pulseIndex];
        this.pulseIndex++;
      } else {
        console.log('Pulse sequence complete');
        this.nextBlock();
      }
    }
  }

  /**
   * Update pure data block
   */
  updatePureDataBlock(cycles) {
    const block = this.currentBlock;

    if (cycles >= this.nextEdgeCycle) {
      this.lastEarBit = 1 - this.lastEarBit;
      this.pulseCount++;

      // Each bit consists of 2 pulses
      if (this.pulseCount < 2) {
        // Same bit, next pulse
        const pulseLength = this.currentBit ? block.onePulse : block.zeroPulse;
        this.nextEdgeCycle = cycles + pulseLength;
      } else {
        // Move to next bit
        this.pulseCount = 0;
        this.bitPosition++;

        if (this.bitPosition >= 8) {
          // Move to next byte
          this.bitPosition = 0;
          this.bytePosition++;

          if (this.bytePosition >= block.data.length) {
            // All data sent
            this.handleBlockEnd();
            return;
          }
        }

        // Check if this is the last byte and we have limited bits
        const isLastByte = this.bytePosition === block.data.length - 1;
        const bitsInByte = isLastByte ? block.usedBits : 8;

        if (this.bitPosition < bitsInByte) {
          // Get next bit
          const byte = block.data[this.bytePosition];
          this.currentBit = (byte >> (7 - this.bitPosition)) & 1;
          const pulseLength = this.currentBit ? block.onePulse : block.zeroPulse;
          this.nextEdgeCycle = cycles + pulseLength;
        } else {
          // No more bits in last byte
          this.handleBlockEnd();
        }
      }
    }
  }

  /**
   * Handle end of current block
   *
   * @private
   * @returns {void}
   */
  handleBlockEnd() {
    const block = this.currentBlock;

    console.log(`Block ${this.blockIndex - 1} complete: ${this.bytePosition} bytes sent`);

    // Check if there's a pause after this block
    if (block.pause && block.pause > 0) {
      this.state = 'PAUSE';
      this.pauseCycles = block.pause * this.CYCLES_PER_MS;
      console.log(`Entering PAUSE state for ${block.pause}ms (${this.pauseCycles} cycles)`);
      console.log(
        `Next block will be ${this.blockIndex < this.blocks.length ? `block ${this.blockIndex}` : 'end of tape'}`,
      );
    } else {
      // Move to next block immediately
      console.log('No pause, moving to next block immediately');
      this.nextBlock();
    }
  }

  /**
   * Get current tape position as percentage
   *
   * @returns {number} Position as percentage (0-100)
   */
  getPosition() {
    if (!this.blocks || this.blocks.length === 0) {
      return 0;
    }

    const currentBlock = Math.max(0, this.blockIndex - 1);
    return (currentBlock / this.blocks.length) * 100;
  }

  /**
   * Get human-readable tape status
   *
   * @returns {string} Status message
   */
  getStatus() {
    if (!this.blocks || this.blocks.length === 0) {
      return 'No tape loaded';
    }

    if (!this.playing) {
      return 'Stopped';
    }

    if (this.paused) {
      return 'Paused';
    }

    const currentBlock = Math.max(0, this.blockIndex - 1);
    return `Playing block ${currentBlock + 1}/${this.blocks.length} (${this.state})`;
  }

  /**
   * Get current EAR bit for tape input
   * This is what the Spectrum reads from port 0xFE bit 6
   *
   * @returns {number} Current EAR bit (0 or 1)
   */
  getEarBit() {
    return this.lastEarBit;
  }
}
