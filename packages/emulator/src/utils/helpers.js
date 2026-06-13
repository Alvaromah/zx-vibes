/**
 * Common utility functions for the Z80 emulator
 */

/**
 * Sign-extend an 8-bit value to a signed integer
 * @param {number} value - 8-bit unsigned value
 * @returns {number} Sign-extended value (-128 to 127)
 */
export function sign8(value) {
  return value & 0x80 ? value - 256 : value;
}

/**
 * Sign-extend a 16-bit value to a signed integer
 * @param {number} value - 16-bit unsigned value
 * @returns {number} Sign-extended value (-32768 to 32767)
 */
export function sign16(value) {
  return value & 0x8000 ? value - 65536 : value;
}

/**
 * Convert a number to hex string with padding
 * @param {number} value - Value to convert
 * @param {number} digits - Number of hex digits
 * @returns {string} Padded hex string
 */
export function toHex(value, digits = 2) {
  return value.toString(16).padStart(digits, '0').toUpperCase();
}

/**
 * Check if a value would cause overflow when added to another
 * @param {number} a - First value
 * @param {number} b - Second value
 * @param {number} result - Result of a + b
 * @returns {boolean} True if overflow occurred
 */
export function checkOverflowAdd(a, b, result) {
  // Overflow occurs when both operands have same sign but result has different sign
  return ((a ^ b) & 0x80) === 0 && ((a ^ result) & 0x80) !== 0;
}

/**
 * Check if a value would cause overflow when subtracted from another
 * @param {number} a - First value
 * @param {number} b - Second value
 * @param {number} result - Result of a - b
 * @returns {boolean} True if overflow occurred
 */
export function checkOverflowSub(a, b, result) {
  // Overflow occurs when operands have different signs and result has same sign as subtrahend
  return ((a ^ b) & 0x80) !== 0 && ((a ^ result) & 0x80) !== 0;
}

/**
 * Memory interface recommendation for performance
 * @example
 * // For best performance, back your memory with TypedArray:
 * class Memory {
 *     constructor(size = 65536) {
 *         this.ram = new Uint8Array(size);
 *     }
 *
 *     read(address) {
 *         return this.ram[address & 0xFFFF];
 *     }
 *
 *     write(address, value) {
 *         this.ram[address & 0xFFFF] = value & 0xFF;
 *     }
 * }
 */
