// The preview player's 48K keyboard: the matrix read (keyboard-input.md
// KBD-MATRIX-001, host-io-port-fe.md HOST-IO-PORTFE-READ-001) plus the host
// quick-tap latch (KBD-LATCH-001).
//
// Pure and DOM-free so the tsup-bundled player and the Node tests share it. The
// browser-key → matrix-key mapping lives in ./host-keys.ts; this module only
// knows matrix keys (CAPS_SHIFT, SYMBOL_SHIFT, A, 1, ENTER, …).

/** The 48K keyboard matrix (KBD-MATRIX-001): canonical key → [half-row, bit]. */
export const KEY_MATRIX: Readonly<Record<string, readonly [number, number]>> = {
  CAPS_SHIFT: [0, 0], Z: [0, 1], X: [0, 2], C: [0, 3], V: [0, 4],
  A: [1, 0], S: [1, 1], D: [1, 2], F: [1, 3], G: [1, 4],
  Q: [2, 0], W: [2, 1], E: [2, 2], R: [2, 3], T: [2, 4],
  '1': [3, 0], '2': [3, 1], '3': [3, 2], '4': [3, 3], '5': [3, 4],
  '0': [4, 0], '9': [4, 1], '8': [4, 2], '7': [4, 3], '6': [4, 4],
  P: [5, 0], O: [5, 1], I: [5, 2], U: [5, 3], Y: [5, 4],
  ENTER: [6, 0], L: [6, 1], K: [6, 2], J: [6, 3], H: [6, 4],
  SPACE: [7, 0], SYMBOL_SHIFT: [7, 1], M: [7, 2], N: [7, 3], B: [7, 4],
};

/** Every matrix key name, for "release everything except …" loops. */
export const KEY_NAMES: readonly string[] = Object.keys(KEY_MATRIX);

/**
 * The five active-low key bits of each half-row for a set of pressed keys:
 * `masks[row]` has bit `b` clear when the key at `[row, b]` is pressed. Unknown
 * names are ignored. Writes into `into` when given (a reusable `Uint8Array(8)`).
 */
export function rowMasksFor(keys: Iterable<string>, into?: Uint8Array): Uint8Array {
  const masks = into ?? new Uint8Array(8);
  masks.fill(0x1f);
  for (const key of keys) {
    const cell = KEY_MATRIX[key];
    if (cell) masks[cell[0]] = masks[cell[0]]! & ~(1 << cell[1]) & 0x1f;
  }
  return masks;
}

/**
 * The key bits (b0–b4) an `IN (0xFE)` reads for the port high byte `highByte`
 * (KBD-MATRIX-001): bit `r` LOW selects half-row `r`, and the selected rows are
 * ANDed, so a key pressed in any selected row reads 0.
 */
export function keyBitsFor(rowMasks: ArrayLike<number>, highByte: number): number {
  let bits = 0x1f;
  for (let row = 0; row < 8; row += 1) {
    if (((highByte >> row) & 1) === 0) bits &= rowMasks[row] as number;
  }
  return bits & 0x1f;
}

/**
 * Host keyboard state with the quick-tap latch (KBD-LATCH-001): a key pressed and
 * released before any scan observed it stays visible for exactly one scan; a key
 * held across a scan releases at the next scan boundary; a key-up with no matching
 * live key-down is a no-op (no phantom press).
 *
 * The SCAN is the 50 Hz FRAME, not one IN read: the ROM's keyboard interrupt reads
 * all eight half-rows per frame, so a latch cleared by the first read would hide a
 * tapped B/N/M/SPACE (row 7, read last). {@link beginScan} — called once per
 * emulated frame, before the frame runs — freezes the frame's visible set (the
 * live keys plus the taps buffered since the previous freeze) and retires those
 * taps. The visible set's half-row masks are computed there, once per frame, so
 * the many `IN (0xFE)` reads of a frame allocate nothing.
 */
export class PreviewKeyLatch {
  private readonly live = new Set<string>();
  private pendingTaps = new Set<string>();
  private scanSet = new Set<string>();
  private readonly masks = new Uint8Array(8).fill(0x1f);
  private dirty = false;

  /** A key went down (unknown names are ignored). */
  down(key: string): void {
    if (!(key in KEY_MATRIX) || this.live.has(key)) return;
    this.live.add(key);
    this.dirty = true;
  }

  /** A key went up. Releasing a key that is not down is a no-op. */
  up(key: string): void {
    if (this.live.delete(key)) this.dirty = true;
  }

  /** Latch a key for the next scan: only real presses reach here (KBD-LATCH-001). */
  tap(key: string): void {
    if (key in KEY_MATRIX) this.pendingTaps.add(key);
  }

  /** Start the next frame's scan: freeze live + buffered taps, retire the taps. */
  beginScan(): void {
    const next = this.pendingTaps;
    this.pendingTaps = this.scanSet;
    this.pendingTaps.clear();
    for (const key of this.live) next.add(key);
    this.scanSet = next;
    this.dirty = true;
  }

  /** The keys this frame's reads see: the frozen scan set plus anything held now. */
  visibleKeys(): Set<string> {
    const keys = new Set(this.scanSet);
    for (const key of this.live) keys.add(key);
    return keys;
  }

  /** The key bits (b0–b4) of an `IN (0xFE)` with port high byte `highByte`. */
  keyBits(highByte: number): number {
    if (this.dirty) {
      rowMasksFor(this.scanSet, this.masks);
      for (const key of this.live) {
        const cell = KEY_MATRIX[key]!;
        this.masks[cell[0]] = this.masks[cell[0]]! & ~(1 << cell[1]) & 0x1f;
      }
      this.dirty = false;
    }
    return keyBitsFor(this.masks, highByte & 0xff);
  }
}
