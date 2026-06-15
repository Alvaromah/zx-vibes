import { readFileSync } from 'node:fs';
import { Machine } from '../core/machine.js';
import { loadSnapshotMachine } from '../core/snapshot.js';
import { bootCachedMachine, loadSessionMachine, sessionStatePath } from './session.js';
import { hex, parseAddress, userError } from './output.js';

export interface MachineSourceOptions {
  state?: string;
  z80?: string;
  sna?: string;
  bin?: string;
  org?: string;
  pc?: string;
  fresh?: boolean;
}

export interface MachineSourceDescription {
  type: 'session' | 'z80' | 'sna' | 'bin' | 'fresh';
  path?: string;
  statePath?: string;
  org?: string;
  pc?: string;
  resumedSession?: boolean;
}

export interface LoadedMachine {
  machine: Machine;
  source: MachineSourceDescription;
  readOnly: boolean;
}

export function hasExplicitMachineSource(opts: MachineSourceOptions): boolean {
  return Boolean(opts.z80 ?? opts.sna ?? opts.bin ?? opts.fresh);
}

export function loadMachineFromSource(
  opts: MachineSourceOptions,
  context: string,
  config: { requireSession?: boolean; bootWhenMissing?: boolean } = {}
): LoadedMachine {
  const explicitSources = [opts.z80, opts.sna, opts.bin].filter(Boolean).length + (opts.fresh ? 1 : 0);
  if (explicitSources > 1) {
    throw userError('Choose only one machine source: --state, --z80, --sna, --bin, or --fresh', context);
  }

  if (opts.z80) {
    return {
      machine: loadSnapshotMachine(opts.z80, new Uint8Array(readFileSync(opts.z80))),
      source: { type: 'z80', path: opts.z80 },
      readOnly: true,
    };
  }

  if (opts.sna) {
    return {
      machine: loadSnapshotMachine(opts.sna, new Uint8Array(readFileSync(opts.sna))),
      source: { type: 'sna', path: opts.sna },
      readOnly: true,
    };
  }

  if (opts.bin) {
    const org = parseAddress(opts.org ?? '0x8000');
    const pc = opts.pc !== undefined ? parseAddress(opts.pc) : org;
    const m = bootCachedMachine();
    m.loadBinary(new Uint8Array(readFileSync(opts.bin)), org, { pc });
    return {
      machine: m,
      source: { type: 'bin', path: opts.bin, org: hex(org), pc: hex(pc) },
      readOnly: true,
    };
  }

  if (opts.fresh) {
    return {
      machine: bootCachedMachine(),
      source: { type: 'fresh' },
      readOnly: true,
    };
  }

  const session = loadSessionMachine(opts.state);
  if (!session) {
    if (config.bootWhenMissing) {
      return {
        machine: bootCachedMachine(),
        source: { type: 'fresh' },
        readOnly: true,
      };
    }
    if (config.requireSession ?? true) {
      throw userError(
        `No session state found at ${sessionStatePath(opts.state)}. Run \`zxs run\` first, or pass --z80, --sna, --bin --org, or --fresh.`,
        context
      );
    }
  }

  if (!session) {
    return {
      machine: bootCachedMachine(),
      source: { type: 'fresh' },
      readOnly: true,
    };
  }

  return {
    machine: session,
    source: { type: 'session', statePath: sessionStatePath(opts.state), resumedSession: true },
    readOnly: false,
  };
}
