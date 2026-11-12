export function compressZ80(bytes: any): Uint8Array<ArrayBuffer>;
/**
 * @param {ArrayLike<number>} bytes RLE-compressed `.z80` data
 * @param {number} [expectedLength] stop once this many bytes are produced
 * @returns {Uint8Array}
 */
export function decompressZ80(bytes: ArrayLike<number>, expectedLength?: number): Uint8Array;
/**
 * @param {object} [snapshot]
 * @param {Record<string, number>} [snapshot.registers] register file (8-bit halves, as Machine.registers)
 * @param {Uint8Array | ArrayLike<number>} [snapshot.memory] the 64 KB memory image
 * @param {number} [snapshot.border] border colour 0-7
 */
export function writeZ80({ registers, memory, border }?: {
    registers?: Record<string, number>;
    memory?: Uint8Array | ArrayLike<number>;
    border?: number;
}): Uint8Array<ArrayBuffer>;
/**
 * Decode a 48K `.z80` snapshot. Throws an `Error` whose message starts with
 * `readZ80: ` when the file is not a complete 48K snapshot (FMT-Z80-VALIDATE-001).
 * @param {Uint8Array | ArrayLike<number>} bytes a `.z80` snapshot (v1/v2/v3)
 * @returns {{ registers: Record<string, number>, memory: Uint8Array, border: number, version: number }}
 */
export function readZ80(bytes: Uint8Array | ArrayLike<number>): {
    registers: Record<string, number>;
    memory: Uint8Array;
    border: number;
    version: number;
};
