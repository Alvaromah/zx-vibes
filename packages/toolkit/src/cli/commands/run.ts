import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeBeeperTimeline, encodeBeeperWav } from '../../core/audio.js';
import { Watchdog } from '../../core/detect.js';
import { disassemble, disassembleOne } from '../../core/disasm.js';
import { KeyPlanRunner, parseKeysSpec } from '../../core/input.js';
import { Machine } from '../../core/machine.js';
import { screenshotPNG } from '../../core/screen.js';
import { screenText } from '../../core/screen-text.js';
import { WatchpointMonitor } from '../../core/trace.js';
import { loadSymbols } from './debug-cmds.js';
import { EXIT, emit, ensureParentDir, hex, parseAddress, parseCount } from '../output.js';
import {
  bootCachedMachine,
  loadSessionMachine,
  loadSessionMeta,
  saveSessionMachine,
} from '../session.js';

export interface RunCommandOptions {
  bin?: string;
  org: string;
  pc?: string;
  sna?: string;
  z80?: string;
  tap?: string;
  frames: string;
  untilPc?: string;
  untilBreak: boolean;
  untilWatch?: boolean;
  untilWrite?: string;
  untilChange?: string;
  watchRead?: string;
  watchWrite?: string;
  keys?: string;
  fresh: boolean;
  save: boolean; // commander --no-save
  readOnly?: boolean;
  detectHangs: boolean; // commander --no-detect-hangs
  state?: string;
  screenshot?: string;
  wav?: string;
  text: boolean;
  json: boolean;
}

/**
 * The agent's main loop command. Sessions: loading a program (or --fresh)
 * starts from a cached clean boot; otherwise the previous session state in
 * .zxs/state.zxstate is resumed. State is saved back after the run.
 */
export async function runCommand(opts: RunCommandOptions): Promise<number> {
  const frames = parseCount(opts.frames, 'frames');
  const loadRequested = Boolean(opts.bin ?? opts.sna ?? opts.z80 ?? opts.tap);

  let m: Machine;
  let resumed = false;
  if (opts.fresh || loadRequested) {
    m = bootCachedMachine();
  } else {
    const session = loadSessionMachine(opts.state);
    resumed = session !== null;
    m = session ?? bootCachedMachine();
  }

  let loaded: string | undefined;
  if (opts.bin) {
    const org = parseAddress(opts.org);
    m.loadBinary(
      new Uint8Array(readFileSync(opts.bin)),
      org,
      opts.pc !== undefined ? { pc: parseAddress(opts.pc) } : {}
    );
    loaded = `${opts.bin} @ ${hex(org)}`;
  } else if (opts.sna) {
    m.loadSna(new Uint8Array(readFileSync(opts.sna)));
    loaded = opts.sna;
  } else if (opts.z80) {
    m.loadZ80(new Uint8Array(readFileSync(opts.z80)));
    loaded = opts.z80;
  } else if (opts.tap) {
    m.loadTap(new Uint8Array(readFileSync(opts.tap)), opts.tap);
    m.playTape();
    loaded = `${opts.tap} (tape loaded+playing — drive the ROM loader with --keys / zxs key J, zxs type '""')`;
  }

  const keyEvents = opts.keys ? parseKeysSpec(opts.keys) : [];
  const runner = new KeyPlanRunner(keyEvents, m);
  runner.applyDue(0);

  const meta = loadSessionMeta(opts.state);
  const symbols = loadSymbols(meta);
  const breakpoints =
    meta.breakpoints.length > 0 ? new Set(meta.breakpoints.map((b) => b.addr)) : undefined;
  const ephemeralWatchpoints = [
    ...(opts.watchRead ? [{ id: -1, type: 'read' as const, ...parseRange(opts.watchRead) }] : []),
    ...(opts.watchWrite ? [{ id: -2, type: 'write' as const, ...parseRange(opts.watchWrite) }] : []),
    ...(opts.untilWrite ? [{ id: -3, type: 'write' as const, ...parseRange(opts.untilWrite) }] : []),
    ...(opts.untilChange ? [{ id: -4, type: 'write' as const, ...parseRange(opts.untilChange) }] : []),
  ];
  const watchpoints = [...meta.watchpoints, ...ephemeralWatchpoints];
  const monitor =
    watchpoints.length > 0 ? new WatchpointMonitor(watchpoints) : undefined;

  const wd = opts.detectHangs ? new Watchdog() : undefined;
  wd?.attach(m);
  monitor?.attach(m); // after watchdog: wraps its patch, detached in reverse

  const frameBudget =
    opts.untilBreak || opts.untilWatch || opts.untilWrite || opts.untilChange
      ? Math.max(frames, 3000)
      : frames;
  const started = performance.now();
  m.resetAudioActivity();
  const outcome = m.run({
    frames: Math.max(frameBudget, runner.planFrames),
    ...(opts.untilPc !== undefined ? { untilPC: parseAddress(opts.untilPc) } : {}),
    onFrame: (f) => runner.applyDue(f),
    ...(wd ? { watchdog: wd } : {}),
    ...(breakpoints ? { breakpoints } : {}),
    // Resuming while parked exactly on a breakpoint must not instantly re-trigger.
    ...(breakpoints?.has(m.cpu.registers.getPC()) ? { skipFirstBreakpoint: true } : {}),
    ...(monitor ? { watchpoints: monitor } : {}),
  });
  const wallTimeMs = Math.round(performance.now() - started);
  const audio = m.getAudioActivity();
  const audioAnalysis = analyzeBeeperTimeline(audio.edgeTimeline);
  monitor?.detach();
  wd?.detach();

  let screenshotPath: string | undefined;
  if (opts.screenshot) {
    ensureParentDir(opts.screenshot);
    writeFileSync(opts.screenshot, screenshotPNG(m));
    screenshotPath = opts.screenshot;
  }

  let wavPath: string | undefined;
  if (opts.wav) {
    ensureParentDir(opts.wav);
    writeFileSync(opts.wav, encodeBeeperWav(audio.edgeTimeline, outcome.tstatesRun));
    wavPath = opts.wav;
  }

  let statePath: string | undefined;
  const saveState = opts.save && !opts.readOnly && !m.tape.playing;
  if (saveState) {
    statePath = saveSessionMachine(m, opts.state);
  }

  const text = screenText(m);
  const regs = m.getRegisters();
  const hang = outcome.hang;
  const sym = (addr: number): string => (symbols ? symbols.symbolicate(addr) : hex(addr));
  const status =
    hang !== undefined ? 'hang' : outcome.reason === 'breakpoint' || outcome.reason === 'watchpoint' ? outcome.reason : 'ok';

  const next: string[] = [];
  if (hang) {
    if (hang.kind === 'tight-loop') next.push('if waiting for input: rerun with --keys "10:SPACE*5"');
    if (hang.kind === 'pc-in-rom') next.push('zxs screen --text — back at the BASIC prompt? check SP and your last RET/JP');
    next.push('zxs regs', `zxs mem read ${hex(hang.pc)} --len 32`);
  } else if (status === 'breakpoint' || status === 'watchpoint') {
    next.push('zxs regs', 'zxs step 1', 'zxs disasm PC --count 8', 'zxs run --until-break to continue');
  } else {
    if (!screenshotPath) next.push('zxs screen --png screen.png to see the display');
    next.push('zxs screen --text for the character grid');
  }

  const breakpointInfo =
    outcome.breakpoint !== undefined
      ? {
          addr: sym(outcome.breakpoint.addr),
          ...(symbols?.addrToSource(outcome.breakpoint.addr)
            ? { source: symbols.addrToSource(outcome.breakpoint.addr) }
            : {}),
        }
      : undefined;
  const watchInfo =
    outcome.watchpointHit !== undefined
      ? {
          ...outcome.watchpointHit,
          addr: hex(outcome.watchpointHit.addr),
          ...(outcome.watchpointHit.pc !== undefined ? { pc: sym(outcome.watchpointHit.pc) } : {}),
          ...(outcome.watchpointHit.pc !== undefined
            ? watchHitContext(m, outcome.watchpointHit.pc, symbols)
            : {}),
        }
      : undefined;

  const result = {
    ok: !hang,
    stage: 'run',
    status,
    ...(loaded !== undefined ? { loaded } : {}),
    ...(resumed ? { resumedSession: true } : {}),
    boot: {
      mode: opts.fresh || loadRequested ? 'fresh-rom-cache' : resumed ? 'resumed-session' : 'fresh-rom-cache',
      frames: opts.fresh || loadRequested || !resumed ? 250 : 0,
    },
    exit: { reason: outcome.reason, pc: sym(outcome.pc) },
    ...(hang ? { hang: { ...hang, pc: sym(hang.pc) } } : {}),
    ...(breakpointInfo ? { breakpoint: breakpointInfo } : {}),
    ...(watchInfo ? { watchpoint: watchInfo } : {}),
    framesRun: outcome.framesRun,
    tstatesRun: outcome.tstatesRun,
    wallTimeMs,
    ...(wd ? { loop: { haltSynced: wd.haltSynced(outcome.framesRun) } } : {}),
    audio: {
      beeperEdges: audio.beeperEdges,
      portFEWrites: audio.portFEWrites,
      beeperLevel: audio.beeperLevel,
      lastPortFE: hex(audio.lastPortFE, 2),
      edgeTimeline: audioAnalysis.edgeTimeline,
      toneSegments: audioAnalysis.toneSegments,
      ...(audioAnalysis.dominantHz !== undefined ? { dominantHz: audioAnalysis.dominantHz } : {}),
      ...(wavPath !== undefined ? { wav: wavPath } : {}),
    },
    registers: {
      pc: hex(regs.pc),
      sp: hex(regs.sp),
      af: hex(regs.af),
      bc: hex(regs.bc),
      de: hex(regs.de),
      hl: hex(regs.hl),
      ix: hex(regs.ix),
      iy: hex(regs.iy),
      im: regs.im,
      iff1: regs.iff1,
      halted: regs.halted,
    },
    screen: {
      nonBlankCells: text.nonBlankCells,
      borderColor: text.borderColor,
      ...(opts.text ? { rows: text.rows } : {}),
      ...(screenshotPath !== undefined ? { png: screenshotPath } : {}),
    },
    input: {
      schedule: keyEvents,
      relativeTo: 'run-start-frame',
      planFrames: runner.planFrames,
    },
    readOnly: !saveState,
    ...(statePath !== undefined ? { statePath } : {}),
    next,
  };

  emit(result, opts.json, () => {
    const marker = status === 'ok' ? 'OK ' : status === 'hang' ? '✗  ' : '◉  ';
    const lines = [
      `${marker}ran ${outcome.framesRun} frames (${outcome.tstatesRun} T-states) in ${wallTimeMs}ms — stopped: ${outcome.reason}`,
    ];
    if (hang) {
      lines.push(`HANG [${hang.kind}] (${hang.confidence}): ${hang.detail}`);
      if (hang.likelyCause) lines.push(`likely cause: ${hang.likelyCause}`);
    }
    if (breakpointInfo) {
      lines.push(
        `BREAKPOINT at ${breakpointInfo.addr}` +
          (breakpointInfo.source ? ` (${breakpointInfo.source.file}:${breakpointInfo.source.line})` : '')
      );
    }
    if (watchInfo) {
      lines.push(
        `WATCHPOINT #${watchInfo.id}: ${watchInfo.type} ${watchInfo.addr} = ${hex(watchInfo.value, 2)}` +
          (watchInfo.pc ? ` by ${watchInfo.pc}` : '')
      );
    }
    lines.push(
      `PC=${hex(regs.pc)} SP=${hex(regs.sp)} AF=${hex(regs.af)} HL=${hex(regs.hl)} halted=${regs.halted}` +
        (wd ? ` haltSynced=${wd.haltSynced(outcome.framesRun)}` : '')
    );
    lines.push(
      `screen: ${text.nonBlankCells} non-blank cells, border ${text.borderColor}` +
        (screenshotPath ? `, saved ${screenshotPath}` : '')
    );
    lines.push(`audio: ${audio.beeperEdges} beeper edges from ${audio.portFEWrites} port writes`);
    if (wavPath) lines.push(`audio wav: ${wavPath}`);
    if (!saveState) lines.push('state: not saved');
    if (opts.text) lines.push('┌' + '─'.repeat(32) + '┐', ...text.rows.map((r) => `│${r}│`), '└' + '─'.repeat(32) + '┘');
    return lines.join('\n');
  });

  return hang ? EXIT.HANG : EXIT.OK;
}

function parseRange(range: string): { from: number; to: number } {
  const parts = range.split('-');
  const from = parseAddress(parts[0]!);
  const to = parts.length > 1 ? parseAddress(parts[1]!) : from;
  if (to < from) throw new Error(`Invalid range: ${range}`);
  return { from, to };
}

function watchHitContext(
  m: Machine,
  pc: number,
  symbols: ReturnType<typeof loadSymbols>
): { instruction: string; disasm: { addr: string; bytes: string; text: string }[] } {
  const read = (a: number) => m.memory.read(a);
  return {
    instruction: disassembleOne(read, pc).text,
    disasm: disassemble(read, pc, 4).map((line) => ({
      addr: symbols ? symbols.symbolicate(line.addr) : hex(line.addr),
      bytes: line.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' '),
      text: line.text,
    })),
  };
}
