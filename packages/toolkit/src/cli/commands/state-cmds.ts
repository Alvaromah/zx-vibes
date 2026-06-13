import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { writeZ80v1 } from '../../core/state.js';
import { EXIT, emit, ensureParentDir, userError } from '../output.js';
import {
  loadSessionMachine,
  readStateFile,
  resetSession,
  sessionStatePath,
  writeStateFile,
} from '../session.js';

export function stateSaveCommand(file: string, opts: { state?: string; json: boolean }): number {
  const src = sessionStatePath(opts.state);
  if (!existsSync(src)) {
    throw userError('No session state found. Run `zxs run` first.', 'state');
  }
  ensureParentDir(file);
  copyFileSync(src, file);
  emit({ ok: true, stage: 'state', saved: file }, opts.json, () => `saved session → ${file}`);
  return EXIT.OK;
}

export function stateLoadCommand(file: string, opts: { state?: string; json: boolean }): number {
  if (!existsSync(file)) {
    throw userError(`State file not found: ${file}`, 'state');
  }
  const state = readStateFile(file); // validates JSON
  writeStateFile(sessionStatePath(opts.state), state);
  emit(
    { ok: true, stage: 'state', loaded: file, frameCount: state.frameCount },
    opts.json,
    () => `loaded ${file} (frame ${state.frameCount}) into the session`
  );
  return EXIT.OK;
}

export function stateResetCommand(opts: { state?: string; json: boolean }): number {
  resetSession(opts.state);
  emit(
    { ok: true, stage: 'state', reset: true, next: ['zxs run --fresh'] },
    opts.json,
    () => 'session cleared — next zxs run boots fresh'
  );
  return EXIT.OK;
}

export function stateExportCommand(opts: { z80?: string; state?: string; json: boolean }): number {
  if (!opts.z80) {
    throw userError('Specify an output: zxs state export --z80 out.z80', 'state');
  }
  const m = loadSessionMachine(opts.state);
  if (!m) {
    throw userError('No session state found. Run `zxs run` first.', 'state');
  }
  ensureParentDir(opts.z80);
  writeFileSync(opts.z80, writeZ80v1(m));
  emit(
    { ok: true, stage: 'state', exported: opts.z80, format: 'z80v1' },
    opts.json,
    () => `exported ${opts.z80} (.z80 v1, 48K) — loadable in FUSE or browser zx-generation`
  );
  return EXIT.OK;
}
