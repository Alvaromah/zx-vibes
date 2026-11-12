import { assemble as embeddedAssemble, type AssembleResult } from './assembler.js';

/** One instruction the embedded assembler must turn into known bytes. */
const PROBE_SOURCE = '    ld a,0x2A\n';
const PROBE_BYTES = [0x3e, 0x2a];

export type RuntimeCheck = { ok: true } | { ok: false; message: string };

/**
 * `zxasm doctor`'s runtime check (ASM-PROD-CLI-DOCTOR-001): assemble a one-line probe
 * and compare the bytes, instead of reporting success unconditionally.
 */
export function checkAssemblerRuntime(
  assemble: (source: string) => AssembleResult = embeddedAssemble
): RuntimeCheck {
  let result: AssembleResult;
  try {
    result = assemble(PROBE_SOURCE);
  } catch (err) {
    return { ok: false, message: `assembling the probe threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!result.ok) {
    return { ok: false, message: `the probe failed to assemble: ${result.errors.map((e) => e.message).join('; ')}` };
  }
  const bytes = [...result.bytes];
  if (bytes.length !== PROBE_BYTES.length || bytes.some((b, i) => b !== PROBE_BYTES[i])) {
    return { ok: false, message: `the probe assembled to ${hex(bytes)} instead of ${hex(PROBE_BYTES)}` };
  }
  return { ok: true };
}

function hex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('') || '(no bytes)';
}
