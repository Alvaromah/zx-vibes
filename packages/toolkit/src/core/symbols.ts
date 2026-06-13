/**
 * Parser for sjasmplus SLD (Source Level Debugging) files.
 *
 * Line format (pipe-separated, 8 fields):
 *   sourceFile|sourceLine|definitionFile|definitionLine|page|value|type|data
 * Types used here: F/D = label/define definitions, T = instruction trace
 * (code emitted at `value` for that source line), Z = device metadata.
 */

export interface SourceLoc {
  file: string;
  line: number;
}

export class SymbolTable {
  /** label name → address/value (F and D definitions). */
  readonly labels = new Map<string, number>();
  private readonly addrToLabelExact = new Map<number, string>();
  private readonly addrToLoc = new Map<number, SourceLoc>();
  private readonly fileLineToAddr = new Map<string, number>();
  /** Label addresses in RAM (0x4000+), sorted, for nearest-label lookup. */
  private sortedAddrs: number[] = [];

  static parse(sldText: string): SymbolTable {
    const t = new SymbolTable();
    for (const raw of sldText.split('\n')) {
      const line = raw.trimEnd();
      if (!line || line.startsWith('|')) continue; // header: |SLD.data.version|1
      const fields = line.split('|');
      if (fields.length < 8) continue;
      const file = fields[0]!;
      const srcLine = parseInt(fields[1]!, 10);
      const value = parseInt(fields[5]!, 10);
      const type = fields[6]!;
      const data = fields[7]!;

      if (type === 'F' || type === 'D') {
        if (data && !t.labels.has(data)) {
          t.labels.set(data, value);
          // Reverse mapping only for RAM addresses: EQU constants (counters,
          // sizes...) would otherwise pollute symbolication of low addresses.
          if (value >= 0x4000 && value <= 0xffff && !t.addrToLabelExact.has(value)) {
            t.addrToLabelExact.set(value, data);
          }
        }
      } else if (type === 'T') {
        if (!Number.isNaN(value) && !Number.isNaN(srcLine)) {
          if (!t.addrToLoc.has(value)) {
            t.addrToLoc.set(value, { file, line: srcLine });
          }
          const key = `${file}:${srcLine}`;
          if (!t.fileLineToAddr.has(key)) {
            t.fileLineToAddr.set(key, value);
          }
        }
      }
    }
    t.sortedAddrs = [...t.addrToLabelExact.keys()].sort((a, b) => a - b);
    return t;
  }

  /**
   * Resolves a breakpoint/disasm spec: a hex/decimal address, a label name,
   * or file.asm:line (file matched by suffix; lines without code snap to the
   * next code line within 10 lines).
   */
  resolve(spec: string): number | undefined {
    if (/^(0x[0-9a-f]+|\$[0-9a-f]+|\d+)$/i.test(spec)) {
      const n = spec.startsWith('$') ? parseInt(spec.slice(1), 16) : Number(spec);
      return Number.isNaN(n) ? undefined : n & 0xffff;
    }
    if (this.labels.has(spec)) return this.labels.get(spec);
    // case-insensitive label fallback
    const lower = spec.toLowerCase();
    for (const [name, addr] of this.labels) {
      if (name.toLowerCase() === lower) return addr;
    }
    const fileLine = spec.match(/^(.+):(\d+)$/);
    if (fileLine) {
      return this.sourceToAddr(fileLine[1]!, parseInt(fileLine[2]!, 10));
    }
    return undefined;
  }

  addrToSource(addr: number): SourceLoc | undefined {
    return this.addrToLoc.get(addr);
  }

  sourceToAddr(fileSuffix: string, line: number): number | undefined {
    // Exact then snap-forward: a breakpoint on a comment/label-only line
    // lands on the next line that emitted code.
    for (let l = line; l <= line + 10; l++) {
      for (const [key, addr] of this.fileLineToAddr) {
        const sep = key.lastIndexOf(':');
        const file = key.slice(0, sep);
        const keyLine = parseInt(key.slice(sep + 1), 10);
        if (keyLine === l && (file === fileSuffix || file.endsWith(fileSuffix))) {
          return addr;
        }
      }
    }
    return undefined;
  }

  /** Nearest label at or below addr (within 2KB), as 'name' or 'name+0xNN'. */
  nearestLabel(addr: number): { name: string; offset: number } | undefined {
    const exact = this.addrToLabelExact.get(addr);
    if (exact) return { name: exact, offset: 0 };
    // binary search for greatest label address <= addr
    let lo = 0;
    let hi = this.sortedAddrs.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.sortedAddrs[mid]! <= addr) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) return undefined;
    const labelAddr = this.sortedAddrs[best]!;
    const offset = addr - labelAddr;
    if (offset > 0x800) return undefined;
    return { name: this.addrToLabelExact.get(labelAddr)!, offset };
  }

  /** "0x8132 (move_player+0x08)" — or plain hex when no label is in range. */
  symbolicate(addr: number): string {
    const hex = `0x${addr.toString(16).toUpperCase().padStart(4, '0')}`;
    const near = this.nearestLabel(addr);
    if (!near) return hex;
    const suffix = near.offset === 0 ? '' : `+0x${near.offset.toString(16).toUpperCase()}`;
    return `${hex} (${near.name}${suffix})`;
  }
}
