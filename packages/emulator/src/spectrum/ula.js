import {
  VIDEO_PROFILE_48K_PAL,
  contentionDelayForTstate,
} from './video-timing.js';

/**
 * ZX Spectrum ULA (Uncommitted Logic Array) Emulation
 * Handles I/O ports, keyboard, border color, and speaker
 */
export class SpectrumULA {
  constructor() {
    this.borderColor = 1; // Blue border by default
    this.speakerBit = 0;
    this.micBit = 0;

    // Keyboard matrix (8x5)
    this.keyboardMatrix = new Uint8Array(8).fill(0xff);

    // Port FE is the main ULA port
    this.lastPortFE = 0;

    // Callback for speaker changes
    this.onSpeakerChange = null;

    // NEW: Callback for port writes with exact timing
    this.onPortWrite = null;

    // Tape input bit (EAR)
    this.tapeInputBit = 1;

    // Scanline tracking for border effects
    this.scanline = 0;
    this.scanlineBorderColors = new Uint8Array(312).fill(1);
    this.borderTimeline = [{ tstate: 0, color: this.borderColor }];
    this.borderChanged = false;

    // Timing constants
    this.SCANLINES_PER_FRAME = 312;
    this.TSTATES_PER_SCANLINE = 224;
    this.cycleCounter = 0;

    // Interrupt generation
    this.interruptPending = false;
    this.videoProfile = VIDEO_PROFILE_48K_PAL;
    this.tstateProvider = () => 0;
    this.floatingBusProvider = null;
    this.contentionEnabled = false;
  }

  setVideoProfile(profile) {
    this.videoProfile = profile || VIDEO_PROFILE_48K_PAL;
  }

  setFrameTimingProvider(provider) {
    this.tstateProvider = typeof provider === 'function' ? provider : () => 0;
  }

  setFloatingBusProvider(provider) {
    this.floatingBusProvider = typeof provider === 'function' ? provider : null;
  }

  setContentionEnabled(enabled) {
    this.contentionEnabled = Boolean(enabled);
  }

  getFrameTstate(extraCycles = 0) {
    return Math.max(0, Math.floor(this.tstateProvider() + extraCycles));
  }

  beginFrameTrace() {
    this.borderTimeline = [{ tstate: 0, color: this.borderColor & 0x07 }];
    this.scanlineBorderColors.fill(this.borderColor & 0x07);
    this.scanlineBorderColors[this.scanline] = this.borderColor & 0x07;
    this.borderChanged = false;
  }

  recordBorderEvent(color) {
    const tstate = this.getFrameTstate();
    const normalizedColor = color & 0x07;
    const previous = this.borderTimeline[this.borderTimeline.length - 1];
    if (previous && previous.tstate === tstate) {
      previous.color = normalizedColor;
      return;
    }
    if (!previous || previous.color !== normalizedColor) {
      this.borderTimeline.push({ tstate, color: normalizedColor });
    }
  }

  readPort(port) {
    // Port 0xFE - Keyboard and tape input
    if ((port & 0x01) === 0) {
      let result = 0xbf; // Initial value with bit 6 set (no tape input)

      // Check keyboard rows based on high byte of port address
      const highByte = (port >> 8) & 0xff;

      for (let row = 0; row < 8; row++) {
        // Check if this row is selected (bit is 0)
        if ((highByte & (1 << row)) === 0) {
          // AND the result with this row's keys
          result &= this.keyboardMatrix[row];
        }
      }

      // Set bit 6 based on tape input (EAR)
      if (this.tapeInputBit) {
        result |= 0x40; // Set bit 6
      } else {
        result &= ~0x40; // Clear bit 6
      }

      return result;
    }

    const floating = this.floatingBusProvider ? this.floatingBusProvider(this.getFrameTstate()) : null;
    return floating ?? 0xff;
  }

  writePort(port, value) {
    const portByte = port & 0xff;
    const val = value & 0xff;

    // Port 0xFE - Border color and speaker
    if ((portByte & 0x01) === 0) {
      const previousPortFE = this.lastPortFE;
      this.lastPortFE = val;

      const newBorderColor = val & 0x07; // Bits 0-2: border color
      const newSpeakerBit = (val & 0x10) >> 4; // Bit 4: speaker
      this.micBit = (val & 0x08) >> 3; // Bit 3: mic

      // Update border color and track change
      if (newBorderColor !== this.borderColor) {
        this.borderColor = newBorderColor;
        this.borderChanged = true;
        this.scanlineBorderColors[this.scanline] = newBorderColor;
        this.recordBorderEvent(newBorderColor);
      }

      // Notify about port write with the value (for accurate beeper tracking)
      if (this.onPortWrite) {
        this.onPortWrite(val);
      }

      // Legacy speaker change notification (kept for compatibility)
      if (newSpeakerBit !== this.speakerBit) {
        this.speakerBit = newSpeakerBit;
        if (this.onSpeakerChange) {
          this.onSpeakerChange(this.speakerBit);
        }
      }
    }
  }

  // Additional method to set the port write callback
  setPortWriteCallback(callback) {
    this.onPortWrite = callback;
  }

  // Set key state (row 0-7, col 0-4)
  setKey(row, col, pressed) {
    if (row >= 0 && row < 8 && col >= 0 && col < 5) {
      const oldValue = this.keyboardMatrix[row];
      if (pressed) {
        this.keyboardMatrix[row] &= ~(1 << col);
      } else {
        this.keyboardMatrix[row] |= 1 << col;
      }
    }
  }

  // Clear all keys
  clearKeys() {
    this.keyboardMatrix.fill(0xff);
  }

  // Get current border color
  getBorderColor() {
    return this.borderColor;
  }

  // Get speaker state
  getSpeakerState() {
    return this.speakerBit;
  }

  // Add cycles for scanline tracking
  addCycles(cycles) {
    this.cycleCounter += cycles;

    // Check if we've completed a scanline
    while (this.cycleCounter >= this.TSTATES_PER_SCANLINE) {
      this.cycleCounter -= this.TSTATES_PER_SCANLINE;

      // Record border color for this scanline
      this.scanlineBorderColors[this.scanline] = this.borderColor;

      // Move to next scanline
      this.scanline++;
      if (this.scanline >= this.SCANLINES_PER_FRAME) {
        this.scanline = 0;
        // Generate interrupt at start of frame
        this.interruptPending = true;
      }
    }
  }

  /**
   * Get per-scanline border colors for multicolor effects
   *
   * @returns {Uint8Array} Array of 312 border colors (one per scanline)
   */
  getScanlineBorderColors() {
    return this.scanlineBorderColors;
  }

  getBorderTimeline() {
    return this.borderTimeline.map((event) => ({ ...event }));
  }

  getPortContentionDelay(port, extraCycles = 0) {
    if (!this.contentionEnabled || (port & 0x0001) !== 0) {
      return 0;
    }
    return contentionDelayForTstate(this.getFrameTstate(extraCycles), this.videoProfile);
  }

  /**
   * Check if border color changed during this frame
   *
   * @returns {boolean} True if border color changed
   */
  isBorderColorChanged() {
    return this.borderChanged;
  }

  /**
   * Reset border changed flag for new frame
   *
   * @returns {void}
   */
  resetBorderChanged() {
    this.borderChanged = false;
  }

  /**
   * Check if interrupt should be generated
   * Interrupts occur at the start of the vertical retrace period
   *
   * @returns {boolean} True if interrupt should be generated
   */
  shouldGenerateInterrupt() {
    if (this.interruptPending) {
      this.interruptPending = false;
      return true;
    }
    return false;
  }

  /**
   * Set border color directly (used for snapshot loading)
   *
   * @param {number} color - Border color index (0-7)
   * @returns {void}
   */
  setBorderColor(color) {
    this.borderColor = color & 0x07;
    this.borderChanged = true;
    // Update scanline border color for current scanline
    this.scanlineBorderColors[this.scanline] = this.borderColor;
    this.recordBorderEvent(this.borderColor);
  }

  /**
   * Set tape input bit (EAR)
   *
   * @param {number} bit - Tape input state (0 or 1)
   * @returns {void}
   */
  setTapeInput(bit) {
    this.tapeInputBit = bit ? 1 : 0;
  }
}

// ZX Spectrum keyboard mapping
export const SPECTRUM_KEYS = {
  // Row 0 (CAPS SHIFT, Z, X, C, V)
  CAPS_SHIFT: { row: 0, col: 0 },
  Z: { row: 0, col: 1 },
  X: { row: 0, col: 2 },
  C: { row: 0, col: 3 },
  V: { row: 0, col: 4 },

  // Row 1 (A, S, D, F, G)
  A: { row: 1, col: 0 },
  S: { row: 1, col: 1 },
  D: { row: 1, col: 2 },
  F: { row: 1, col: 3 },
  G: { row: 1, col: 4 },

  // Row 2 (Q, W, E, R, T)
  Q: { row: 2, col: 0 },
  W: { row: 2, col: 1 },
  E: { row: 2, col: 2 },
  R: { row: 2, col: 3 },
  T: { row: 2, col: 4 },

  // Row 3 (1, 2, 3, 4, 5)
  1: { row: 3, col: 0 },
  2: { row: 3, col: 1 },
  3: { row: 3, col: 2 },
  4: { row: 3, col: 3 },
  5: { row: 3, col: 4 },

  // Row 4 (0, 9, 8, 7, 6)
  0: { row: 4, col: 0 },
  9: { row: 4, col: 1 },
  8: { row: 4, col: 2 },
  7: { row: 4, col: 3 },
  6: { row: 4, col: 4 },

  // Row 5 (P, O, I, U, Y)
  P: { row: 5, col: 0 },
  O: { row: 5, col: 1 },
  I: { row: 5, col: 2 },
  U: { row: 5, col: 3 },
  Y: { row: 5, col: 4 },

  // Row 6 (ENTER, L, K, J, H)
  ENTER: { row: 6, col: 0 },
  L: { row: 6, col: 1 },
  K: { row: 6, col: 2 },
  J: { row: 6, col: 3 },
  H: { row: 6, col: 4 },

  // Row 7 (SPACE, SYMBOL SHIFT, M, N, B)
  SPACE: { row: 7, col: 0 },
  SYMBOL_SHIFT: { row: 7, col: 1 },
  M: { row: 7, col: 2 },
  N: { row: 7, col: 3 },
  B: { row: 7, col: 4 },
};

// PC to Spectrum key mappings with modifiers
export const PC_KEY_MAP = {
  // Direct mappings
  Enter: 'ENTER',
  ' ': 'SPACE',
  Shift: 'CAPS_SHIFT',
  Control: 'SYMBOL_SHIFT',
  Alt: 'SYMBOL_SHIFT',
  Meta: 'SYMBOL_SHIFT', // Mac Command key
  AltGraph: 'SYMBOL_SHIFT', // Right Alt on some keyboards

  // Arrow keys using Spectrum cursor keys (Caps Shift + 5,6,7,8)
  ArrowLeft: { keys: ['CAPS_SHIFT', '5'] }, // Caps Shift + 5
  ArrowDown: { keys: ['CAPS_SHIFT', '6'] }, // Caps Shift + 6
  ArrowUp: { keys: ['CAPS_SHIFT', '7'] }, // Caps Shift + 7
  ArrowRight: { keys: ['CAPS_SHIFT', '8'] }, // Caps Shift + 8

  // Common symbols with Symbol Shift
  '!': { keys: ['SYMBOL_SHIFT', '1'] },
  '@': { keys: ['SYMBOL_SHIFT', '2'] },
  '#': { keys: ['SYMBOL_SHIFT', '3'] },
  $: { keys: ['SYMBOL_SHIFT', '4'] },
  '%': { keys: ['SYMBOL_SHIFT', '5'] },
  '&': { keys: ['SYMBOL_SHIFT', '6'] },
  "'": { keys: ['SYMBOL_SHIFT', '7'] },
  '(': { keys: ['SYMBOL_SHIFT', '8'] },
  ')': { keys: ['SYMBOL_SHIFT', '9'] },
  _: { keys: ['SYMBOL_SHIFT', '0'] },

  // Other symbols
  '-': { keys: ['SYMBOL_SHIFT', 'J'] },
  '+': { keys: ['SYMBOL_SHIFT', 'K'] },
  '=': { keys: ['SYMBOL_SHIFT', 'L'] },
  ':': { keys: ['SYMBOL_SHIFT', 'Z'] },
  ';': { keys: ['SYMBOL_SHIFT', 'O'] },
  '"': { keys: ['SYMBOL_SHIFT', 'P'] },
  ',': { keys: ['SYMBOL_SHIFT', 'N'] },
  '.': { keys: ['SYMBOL_SHIFT', 'M'] },
  '<': { keys: ['SYMBOL_SHIFT', 'R'] },
  '>': { keys: ['SYMBOL_SHIFT', 'T'] },
  '?': { keys: ['SYMBOL_SHIFT', 'C'] },
  '/': { keys: ['SYMBOL_SHIFT', 'V'] },
  '*': { keys: ['SYMBOL_SHIFT', 'B'] },

  // Special keys
  Backspace: { keys: ['CAPS_SHIFT', '0'] }, // DELETE key on Spectrum
  Delete: { keys: ['CAPS_SHIFT', '0'] },
  Escape: { keys: ['CAPS_SHIFT', 'SPACE'] }, // BREAK
  Tab: { keys: ['CAPS_SHIFT', 'SYMBOL_SHIFT'] }, // EXTENDED MODE
};
