export interface RomSymbol {
  addr: number;
  name: string;
  note: string;
}

const ROM_SYMBOLS = new Map<number, RomSymbol>(
  [
    { addr: 0x0010, name: 'RST_PRINT_A', note: 'RST 0x10 prints the character in A through the ROM channel' },
    { addr: 0x028e, name: 'KEY_SCAN', note: 'ROM keyboard scan routine' },
    { addr: 0x03b5, name: 'BEEPER', note: 'ROM beeper routine; blocking and register-clobbering' },
    { addr: 0x0d6b, name: 'CLS', note: 'ROM CLS entry used by BASIC clear-screen paths' },
    { addr: 0x0daf, name: 'CL_ALL', note: 'ROM clear screen / lower-screen reset helper' },
    { addr: 0x15f2, name: 'PRINT_A_2', note: 'ROM printable-character path' },
  ].map((entry) => [entry.addr, entry])
);

export function romSymbol(addr: number): RomSymbol | undefined {
  return ROM_SYMBOLS.get(addr & 0xffff);
}

export function annotateAddress(addr: number): { symbol?: string; note?: string } {
  const symbol = romSymbol(addr);
  return symbol ? { symbol: symbol.name, note: symbol.note } : {};
}
