// Address / number / range argument parsing — cli.md CLI-PROD-CONV-ADDR-001
// (accept `0x8000`, `$8000`, `8000h`, decimal `32768`) and CLI-PROD-CONV-RANGE-001
// (`from-to`, inclusive of both endpoints).
//
// A shared primitive the observation/run commands map their address-shaped flags
// through, so every command accepts the same numeric forms.

import { userError } from '../output/envelope.js';

/**
 * Parse a number in any documented form (CLI-PROD-CONV-ADDR-001): `0x1F` / `$1F`
 * / `1Fh` (hex) or `31` (decimal). Returns `undefined` for an unrecognized form
 * (callers turn that into a typed error).
 */
export function parseNumber(input: string): number | undefined {
  const s = input.trim();
  if (s === '') return undefined;
  let value: number;
  if (/^0x[0-9a-f]+$/i.test(s)) value = parseInt(s.slice(2), 16);
  else if (/^\$[0-9a-f]+$/i.test(s)) value = parseInt(s.slice(1), 16);
  else if (/^[0-9a-f]+h$/i.test(s)) value = parseInt(s.slice(0, -1), 16);
  else if (/^\d+$/.test(s)) value = parseInt(s, 10);
  else return undefined;
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Parse a 16-bit address argument (0..0xFFFF). Throws a USER_ERROR naming the bad
 * input on an unrecognized form or an out-of-range value (CLI-PROD-ERR-001).
 */
export function parseAddress(input: string, stage?: string): number {
  const value = parseNumber(input);
  if (value === undefined || value < 0 || value > 0xffff) {
    throw userError(`Invalid address: "${input}" (use 0x1F, $1F, 1Fh, or decimal 0..65535)`, stage);
  }
  return value;
}

/** An inclusive `from-to` address range (CLI-PROD-CONV-RANGE-001). */
export interface AddressRange {
  from: number;
  to: number;
}

/**
 * Parse a `from-to` range argument, inclusive of both endpoints
 * (CLI-PROD-CONV-RANGE-001), e.g. `0x4000-0x5aff`. Each endpoint accepts any of
 * the address forms above. Throws a USER_ERROR on a malformed range or `to < from`.
 */
export function parseRange(input: string, stage?: string): AddressRange {
  const parts = input.split('-');
  if (parts.length !== 2) {
    throw userError(`Invalid range: "${input}" (expected from-to, e.g. 0x4000-0x5aff)`, stage);
  }
  const from = parseAddress(parts[0]!, stage);
  const to = parseAddress(parts[1]!, stage);
  if (to < from) {
    throw userError(`Invalid range: "${input}" (to is below from)`, stage);
  }
  return { from, to };
}
