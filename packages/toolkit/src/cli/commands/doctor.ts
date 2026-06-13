import { existsSync, statSync } from 'node:fs';
import { checkToolchain } from '../../build/sjasmplus.js';
import { romPath } from '../../core/rom.js';
import { EXIT, emit } from '../output.js';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function doctorCommand(opts: { json: boolean }): Promise<number> {
  const checks: Check[] = [];
  const assemblerBackend =
    process.env['ZXS_ASSEMBLER']?.toLowerCase() === 'spectral' ? 'spectral' : 'sjasmplus';

  const nodeMajor = parseInt(process.versions.node.split('.')[0]!, 10);
  checks.push({
    name: 'node',
    ok: nodeMajor >= 20,
    detail: `v${process.versions.node}` + (nodeMajor >= 20 ? '' : ' (need >= 20)'),
  });

  const toolchain = await checkToolchain();
  checks.push({
    name: 'sjasmplus',
    ok: assemblerBackend === 'spectral' || toolchain.found,
    detail: toolchain.found
      ? `v${toolchain.version ?? 'unknown'}`
      : assemblerBackend === 'spectral'
        ? 'not required while ZXS_ASSEMBLER=spectral'
      : toolchain.installHint ?? 'not found',
  });

  try {
    await importSpectralAsm();
    checks.push({ name: '@zx-vibes/asm', ok: true, detail: 'available' });
  } catch (err) {
    checks.push({
      name: '@zx-vibes/asm',
      ok: assemblerBackend !== 'spectral',
      detail:
        assemblerBackend === 'spectral'
          ? `cannot import embedded assembler: ${(err as Error).message}`
          : 'optional backend not installed',
    });
  }

  let romDetail: string;
  let romOk = false;
  try {
    const p = romPath();
    romOk = existsSync(p) && statSync(p).size === 16384;
    romDetail = romOk ? p : `unexpected ROM at ${p}`;
  } catch (err) {
    romDetail = `cannot resolve @zx-vibes/emulator ROM: ${(err as Error).message}`;
  }
  checks.push({ name: '48k.rom', ok: romOk, detail: romDetail });

  const allOk = checks.every((c) => c.ok);
  emit({ ok: allOk, stage: 'doctor', checks }, opts.json, () =>
    checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`).join('\n')
  );

  return allOk ? EXIT.OK : EXIT.ENV_ERROR;
}

async function importSpectralAsm(): Promise<void> {
  const packageName = '@zx-vibes/asm';
  try {
    await import(packageName);
    return;
  } catch (err) {
    throw new Error(`@zx-vibes/asm is not installed or has not been built: ${(err as Error).message}`);
  }
}
