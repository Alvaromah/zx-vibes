import type { DisasmLine } from './disasm.js';
import { annotateAddress } from './rom-symbols.js';

export interface StructuredDisasmLine {
  address: number;
  endAddress: number;
  bytes: number[];
  text: string;
  mnemonic: string;
  operands: string[];
  targets: { addr: number; kind: 'jump' | 'call' | 'rst' | 'memory' | 'immediate'; symbol?: string; note?: string }[];
}

export function structureDisasmLine(line: DisasmLine): StructuredDisasmLine {
  const [mnemonicRaw = '', operandText = ''] = splitMnemonic(line.text);
  const mnemonic = mnemonicRaw.toUpperCase();
  const operands = operandText.length > 0 ? operandText.split(',').map((p) => p.trim()) : [];
  const targets = extractTargets(mnemonic, operands);
  return {
    address: line.addr,
    endAddress: (line.addr + line.bytes.length - 1) & 0xffff,
    bytes: line.bytes,
    text: line.text,
    mnemonic,
    operands,
    targets,
  };
}

function splitMnemonic(text: string): [string, string] {
  const idx = text.indexOf(' ');
  if (idx === -1) return [text, ''];
  return [text.slice(0, idx), text.slice(idx + 1)];
}

function extractTargets(mnemonic: string, operands: string[]): StructuredDisasmLine['targets'] {
  const out: StructuredDisasmLine['targets'] = [];
  const kind =
    mnemonic === 'CALL'
      ? 'call'
      : mnemonic === 'JP' || mnemonic === 'JR' || mnemonic === 'DJNZ'
        ? 'jump'
        : mnemonic === 'RST'
          ? 'rst'
          : undefined;

  for (const operand of operands) {
    for (const addr of hexAddresses(operand)) {
      const targetKind =
        kind ?? (operand.includes('(') ? 'memory' : addr >= 0x4000 ? 'immediate' : 'immediate');
      out.push({ addr, kind: targetKind, ...annotateAddress(addr) });
    }
  }
  return out;
}

function hexAddresses(text: string): number[] {
  const out: number[] = [];
  const re = /0x([0-9a-f]{2,4})/gi;
  for (;;) {
    const match = re.exec(text);
    if (!match) break;
    out.push(parseInt(match[1]!, 16) & 0xffff);
  }
  return out;
}
