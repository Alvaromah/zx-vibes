import { readFileSync, writeFileSync } from 'node:fs';
import { snapshotInfo, snapshotRam } from '../../core/snapshot.js';
import { EXIT, emit, ensureParentDir, hex, parseAddress, parseCount, userError } from '../output.js';

export function snapshotInfoCommand(file: string, opts: { json: boolean }): number {
  const data = new Uint8Array(readFileSync(file));
  const info = snapshotInfo(file, data);
  emit(
    {
      ...info,
      registers: formatRegisters(info.registers),
      ramPages: info.ramPages.map((p) => ({ ...p, address: hex(p.address) })),
    },
    opts.json,
    () =>
      [
        `${info.format.toUpperCase()} ${info.version} ${info.hardwareMode}` +
          (info.supported ? '' : ' (metadata only; RAM layout unsupported)'),
        `PC=${hex(info.registers.pc)} SP=${hex(info.registers.sp)} IY=${hex(info.registers.iy)} IM${info.interrupt.im} iff1=${info.interrupt.iff1}`,
        `compression: ${info.compression}; border: ${info.borderColor}`,
        ...info.ramPages.map((p) => `${p.name}: ${hex(p.address)} length ${p.length}${p.compressed ? ' compressed' : ''}`),
        ...info.notes.map((n) => `note: ${n}`),
      ].join('\n')
  );
  return EXIT.OK;
}

export function snapshotRamCommand(file: string, opts: { out: string; json: boolean }): number {
  const data = new Uint8Array(readFileSync(file));
  const ram = snapshotRam(file, data);
  ensureParentDir(opts.out);
  writeFileSync(opts.out, ram);
  emit(
    { ok: true, stage: 'snapshot', file, exported: opts.out, address: hex(0x4000), len: ram.length },
    opts.json,
    () => `exported ${ram.length} bytes of 48K RAM to ${opts.out}`
  );
  return EXIT.OK;
}

export function snapshotMemCommand(
  file: string,
  addr: string,
  opts: { len: string; out?: string; json: boolean }
): number {
  const start = parseAddress(addr);
  const len = parseCount(opts.len, 'length', 49152);
  if (start < 0x4000 || start + len > 0x10000) {
    throw userError('snapshot mem ranges must stay inside 48K RAM (0x4000-0xFFFF)', 'snapshot');
  }
  const ram = snapshotRam(file, new Uint8Array(readFileSync(file)));
  const bytes = ram.subarray(start - 0x4000, start - 0x4000 + len);
  if (opts.out) {
    ensureParentDir(opts.out);
    writeFileSync(opts.out, bytes);
  }
  emit(
    {
      ok: true,
      stage: 'snapshot',
      file,
      addr: hex(start),
      len,
      hex: Buffer.from(bytes).toString('hex'),
      ...(opts.out ? { exported: opts.out } : {}),
    },
    opts.json,
    () => (opts.out ? `exported ${len} bytes from ${hex(start)} to ${opts.out}` : Buffer.from(bytes).toString('hex'))
  );
  return EXIT.OK;
}

function formatRegisters(r: ReturnType<typeof snapshotInfo>['registers']) {
  return {
    pc: hex(r.pc),
    sp: hex(r.sp),
    af: hex(r.af),
    bc: hex(r.bc),
    de: hex(r.de),
    hl: hex(r.hl),
    afPrime: hex(r.afPrime),
    bcPrime: hex(r.bcPrime),
    dePrime: hex(r.dePrime),
    hlPrime: hex(r.hlPrime),
    ix: hex(r.ix),
    iy: hex(r.iy),
    i: hex(r.i, 2),
    r: hex(r.r, 2),
    im: r.im,
    iff1: r.iff1,
    iff2: r.iff2,
    halted: r.halted,
  };
}
