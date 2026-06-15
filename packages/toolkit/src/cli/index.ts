import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { benchCommand } from './commands/bench.js';
import { buildCommand } from './commands/build.js';
import {
  breakAddCommand,
  breakListCommand,
  breakRmCommand,
  disasmCommand,
  stepCommand,
  traceCommand,
  watchAddCommand,
  watchClearCommand,
  watchListCommand,
  watchRmCommand,
} from './commands/debug-cmds.js';
import { doctorCommand } from './commands/doctor.js';
import {
  gfxAttrsCommand,
  gfxBlitLinearCommand,
  gfxFindCommand,
  gfxFontCommand,
  gfxLinearCommand,
  gfxScreenCommand,
} from './commands/gfx.js';
import { keyCommand, typeCommand } from './commands/input-cmds.js';
import { newCommand } from './commands/new.js';
import { playCommand, previewCommand } from './commands/preview.js';
import {
  memDumpCommand,
  memLoadCommand,
  memReadCommand,
  memWriteCommand,
  regsCommand,
  regsSetCommand,
} from './commands/inspect-cmds.js';
import { runCommand } from './commands/run.js';
import { scanCommand, xrefCommand } from './commands/scan.js';
import { screenCommand } from './commands/screen.js';
import { setupCommand } from './commands/setup.js';
import {
  snapshotInfoCommand,
  snapshotMemCommand,
  snapshotRamCommand,
} from './commands/snapshot.js';
import { testCommand } from './commands/test-cmd.js';
import { verifyCommand } from './commands/verify.js';
import {
  stateExportCommand,
  stateLoadCommand,
  stateResetCommand,
  stateSaveCommand,
} from './commands/state-cmds.js';
import { EXIT, argvWantsJson, emitCliError, userError } from './output.js';

interface PackageMetadata {
  version: string;
}

const packageMetadata = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as PackageMetadata;

const program = new Command();
program.exitOverride();
program.configureOutput({ writeErr: () => undefined });

program
  .name('zxs')
  .description('zx-vibes — AI agent toolchain for the ZX Spectrum')
  .version(packageMetadata.version);

const jsonOpt = ['--json', 'machine-readable JSON output', false] as const;
const stateOpt = ['--state <file>', 'session state file (default .zxs/state.zxstate)'] as const;
const z80Opt = ['--z80 <file>', '.z80 v1 snapshot to read'] as const;
const snaOpt = ['--sna <file>', '48K .sna snapshot to read'] as const;
const binOpt = ['--bin <file>', 'raw binary to inject into RAM for read-only inspection'] as const;
const orgOpt = ['--org <addr>', 'load address for --bin', '0x8000'] as const;

program
  .command('build')
  .description('Assemble a Z80 source file (binary + SLD symbols)')
  .argument('[file]', 'entry .asm file (defaults to zx.config.json entry)')
  .option('--out-dir <dir>', 'output directory', 'build')
  .option('--assembler <name>', 'assembler backend: spectral or sjasmplus')
  .option(...jsonOpt)
  .action(async (file: string | undefined, opts) => {
    process.exitCode = await buildCommand(file, {
      outDir: opts.outDir,
      json: opts.json,
      assembler: opts.assembler,
    });
  });

program
  .command('run')
  .description('Run the Spectrum: resumes the session, or boots fresh when loading a program')
  .option('--bin <file>', 'raw binary to inject into RAM (fresh boot)')
  .option('--org <addr>', 'load address for --bin', '0x8000')
  .option('--pc <addr>', 'start address (defaults to --org)')
  .option('--sna <file>', '48K .sna snapshot to load (fresh boot)')
  .option('--z80 <file>', '.z80 v1 snapshot to load (fresh boot)')
  .option('--tap <file>', 'TAP/TZX tape to insert and play (drive the loader via keys)')
  .option('--frames <n>', 'frame budget (50 = 1 second)', '300')
  .option('--until-pc <addr>', 'stop when PC reaches this address')
  .option('--until-break', 'run until a breakpoint/watchpoint hits (≥3000 frame budget)', false)
  .option('--until-watch', 'raise the frame budget while waiting for a watchpoint', false)
  .option('--until-write <range>', 'temporary write watchpoint; stop when the range is written')
  .option('--until-change <addr>', 'temporary write watchpoint for an address')
  .option('--watch-read <range>', 'temporary read watchpoint for this run')
  .option('--watch-write <range>', 'temporary write watchpoint for this run')
  .option('--keys <spec>', 'scheduled keys, e.g. "60:O*30,120:SPACE*5"')
  .option('--fresh', 'ignore the session and boot clean', false)
  .option('--no-save', 'do not persist the session state after the run')
  .option('--read-only', 'alias for --no-save in investigation workflows', false)
  .option('--no-detect-hangs', 'disable the hang/crash watchdog')
  .option(...stateOpt)
  .option('--screenshot <file>', 'save a PNG of the final screen')
  .option('--wav <file>', 'save beeper output from this run as a WAV file')
  .option('--text', 'include the 32x24 character grid in the report', false)
  .option(...jsonOpt)
  .action(async (opts) => {
    process.exitCode = await runCommand(opts);
  });

program
  .command('screen')
  .description("Observe the session's screen: character grid, attributes, PNG")
  .option('--png <file>', 'save a PNG screenshot')
  .option('--attrs', 'include the attribute summary', false)
  .option('--text', '(default) include the character grid', true)
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = screenCommand(opts);
  });

program
  .command('key')
  .description('Press a key in the session (down, hold, up, settle)')
  .argument('<key>', 'A-Z, 0-9, ENTER, SPACE, CAPS_SHIFT, SYMBOL_SHIFT')
  .option('--hold <frames>', 'frames to hold the key', '3')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((key: string, opts) => {
    process.exitCode = keyCommand(key, opts);
  });

program
  .command('type')
  .description('Type text into the session via the keyboard matrix')
  .argument('<text>')
  .option('--frames-per-key <n>', 'frames each key is held', '3')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((text: string, opts) => {
    process.exitCode = typeCommand(text, opts);
  });

const mem = program.command('mem').description('Read/write session memory');
mem
  .command('read')
  .argument('<addr>', 'address (0x8000, $8000 or 32768)')
  .option('--len <n>', 'bytes to read', '64')
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((addr: string, opts) => {
    process.exitCode = memReadCommand(addr, opts);
  });
mem
  .command('dump')
  .requiredOption('--range <from-to>', 'address range to export, e.g. 0x4000-0x5aff')
  .requiredOption('--out <file>', 'binary output path')
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = memDumpCommand(opts);
  });
mem
  .command('load')
  .argument('<addr>', 'address to write to')
  .requiredOption('--bin <file>', 'binary file to load into the session')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((addr: string, opts) => {
    process.exitCode = memLoadCommand(addr, opts);
  });
mem
  .command('write')
  .argument('<addr>')
  .argument('<hexBytes>', 'e.g. "3E42" or "3e 42 c9"')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((addr: string, bytes: string, opts) => {
    process.exitCode = memWriteCommand(addr, bytes, opts);
  });

const regs = program.command('regs').description('Inspect or set CPU registers');
regs
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = regsCommand(opts);
  });
regs
  .command('set')
  .argument('<reg>', 'A..L, I, R, AF, BC, DE, HL, SP, IX, IY, PC, IM')
  .argument('<value>')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((reg: string, value: string, opts) => {
    process.exitCode = regsSetCommand(reg, value, opts);
  });

const state = program.command('state').description('Manage session state files');
state
  .command('save')
  .argument('<file>')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((file: string, opts) => {
    process.exitCode = stateSaveCommand(file, opts);
  });
state
  .command('load')
  .argument('<file>')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((file: string, opts) => {
    process.exitCode = stateLoadCommand(file, opts);
  });
state
  .command('reset')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = stateResetCommand(opts);
  });
state
  .command('export')
  .option('--z80 <file>', 'export as .z80 v1 snapshot')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = stateExportCommand(opts);
  });

const brk = program.command('break').description('Manage breakpoints (label, file:line or address)');
brk
  .command('add')
  .argument('<spec>', 'label, file.asm:line, or address (0x8000)')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((spec: string, opts) => {
    process.exitCode = breakAddCommand(spec, opts);
  });
brk
  .command('list')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = breakListCommand(opts);
  });
brk
  .command('rm')
  .argument('<idOrAll>', 'breakpoint id, or "all"')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((idOrAll: string, opts) => {
    process.exitCode = breakRmCommand(idOrAll, opts);
  });

const watch = program.command('watch').description('Manage memory watchpoints');
watch
  .command('add')
  .option('--read <range>', 'watch reads, e.g. 0xBF00 or 0x5800-0x5AFF')
  .option('--write <range>', 'watch writes')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = watchAddCommand(opts);
  });
watch
  .command('list')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = watchListCommand(opts);
  });
watch
  .command('rm')
  .argument('<idOrAll>')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((idOrAll: string, opts) => {
    process.exitCode = watchRmCommand(idOrAll, opts);
  });
watch
  .command('clear')
  .description('Remove all watchpoints')
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = watchClearCommand(opts);
  });

program
  .command('step')
  .description('Execute N instructions (--over steps across CALL/RST)')
  .argument('[n]', 'instructions to step', '1')
  .option('--over', 'step over CALL/RST subroutines', false)
  .option(...stateOpt)
  .option(...jsonOpt)
  .action((n: string, opts) => {
    process.exitCode = stepCommand(n, opts);
  });

program
  .command('disasm')
  .description('Disassemble from an address, label, or PC')
  .argument('<spec>', 'address, label, file.asm:line, or PC')
  .option('--count <n>', 'instructions to disassemble', '16')
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((spec: string, opts) => {
    process.exitCode = disasmCommand(spec, opts);
  });

program
  .command('trace')
  .description('Run with instruction tracing: hot spots + recent instructions')
  .option('--frames <n>', 'frames to trace', '5')
  .option('--top <n>', 'hot addresses to report', '10')
  .option('--last <n>', 'recent instructions to keep', '50')
  .option('--out <file>', 'write the full report as JSON')
  .option('--no-save', 'do not persist session changes after tracing')
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = traceCommand(opts);
  });

program
  .command('new')
  .description('Scaffold a game project (working skeleton + agent playbook + docs)')
  .argument('<name>', 'project directory name')
  .option('--template <name>', 'starter template: game or platformer', 'game')
  .option('--no-install', 'skip npm install after scaffolding')
  .option(...jsonOpt)
  .action((name: string, opts) => {
    process.exitCode = newCommand(name, opts);
  });

program
  .command('test')
  .description('Run declarative asm tests (test.json / *.test.json specs)')
  .argument('[path]', 'directory or spec file to test', '.')
  .option('--list-assertions', 'print the supported assertion vocabulary', false)
  .option(...jsonOpt)
  .action(async (path: string, opts) => {
    process.exitCode = await testCommand(path, opts);
  });

const snapshot = program.command('snapshot').description('Inspect and export .z80/.sna snapshots');
snapshot
  .command('info')
  .argument('<file>', '.z80 or .sna snapshot')
  .option(...jsonOpt)
  .action((file: string, opts) => {
    process.exitCode = snapshotInfoCommand(file, opts);
  });
snapshot
  .command('ram')
  .argument('<file>', '.z80 or .sna snapshot')
  .requiredOption('--out <file>', 'write the 48K RAM image')
  .option(...jsonOpt)
  .action((file: string, opts) => {
    process.exitCode = snapshotRamCommand(file, opts);
  });
snapshot
  .command('mem')
  .argument('<file>', '.z80 or .sna snapshot')
  .argument('<addr>', 'start address')
  .option('--len <n>', 'bytes to read/export', '64')
  .option('--out <file>', 'write bytes to a binary file')
  .option(...jsonOpt)
  .action((file: string, addr: string, opts) => {
    process.exitCode = snapshotMemCommand(file, addr, opts);
  });

const gfx = program.command('gfx').description('Decode Spectrum graphics and asset data');
gfx
  .command('screen')
  .requiredOption('--out <png>', 'PNG output path')
  .option('--scale <n>', 'nearest-neighbor scale', '2')
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = gfxScreenCommand(opts);
  });
gfx
  .command('attrs')
  .requiredOption('--out <png>', 'PNG output path')
  .option('--scale <n>', 'nearest-neighbor scale', '8')
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = gfxAttrsCommand(opts);
  });
gfx
  .command('linear')
  .argument('<addr>', 'start address')
  .requiredOption('--out <png>', 'PNG output path')
  .requiredOption('--width-bytes <n>', 'bytes per row')
  .requiredOption('--height <n>', 'rows per item')
  .option('--stride <n>', 'bytes between rows')
  .option('--count <n>', 'number of items', '1')
  .option('--columns <n>', 'sheet columns')
  .option('--scale <n>', 'nearest-neighbor scale', '4')
  .option('--ink <n>', 'ink color index 0-7')
  .option('--paper <n>', 'paper color index 0-7')
  .option('--invert', 'invert 1bpp pixels', false)
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((addr: string, opts) => {
    process.exitCode = gfxLinearCommand(addr, opts);
  });
gfx
  .command('sheet')
  .argument('<addr>', 'start address')
  .requiredOption('--out <png>', 'PNG output path')
  .requiredOption('--width-bytes <n>', 'bytes per row')
  .requiredOption('--height <n>', 'rows per item')
  .option('--stride <n>', 'bytes between rows')
  .option('--count <n>', 'number of items', '1')
  .option('--columns <n>', 'sheet columns')
  .option('--scale <n>', 'nearest-neighbor scale', '4')
  .option('--invert', 'invert 1bpp pixels', false)
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((addr: string, opts) => {
    process.exitCode = gfxLinearCommand(addr, opts);
  });
gfx
  .command('font')
  .argument('<addr>', 'font/UDG table start address')
  .requiredOption('--out <png>', 'PNG output path')
  .option('--glyphs <n>', 'number of 8x8 glyphs', '96')
  .option('--columns <n>', 'sheet columns', '16')
  .option('--scale <n>', 'nearest-neighbor scale', '4')
  .option('--invert', 'invert 1bpp pixels', false)
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((addr: string, opts) => {
    process.exitCode = gfxFontCommand(addr, opts);
  });
gfx
  .command('find')
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = gfxFindCommand(opts);
  });
gfx
  .command('blit-linear')
  .argument('<addr>', 'linear bitmap start address')
  .requiredOption('--out <png>', 'PNG output path')
  .requiredOption('--x <n>', 'screen x coordinate, byte-aligned')
  .requiredOption('--y <n>', 'screen y coordinate')
  .requiredOption('--width-bytes <n>', 'bytes per row')
  .requiredOption('--height <n>', 'rows')
  .option('--stride <n>', 'bytes between rows')
  .option('--xor', 'XOR source bytes with screen bytes', false)
  .option('--scale <n>', 'nearest-neighbor scale', '2')
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((addr: string, opts) => {
    process.exitCode = gfxBlitLinearCommand(addr, opts);
  });

program
  .command('scan')
  .description('Search memory for opcodes or immediate address ranges')
  .option('--opcode <bytes>', 'byte sequence, e.g. "ED B0"')
  .option('--imm-range <from-to>', 'little-endian 16-bit values in a range')
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = scanCommand(opts);
  });

program
  .command('xref')
  .description('Find static disassembly references to an address')
  .argument('<addr>', 'target address')
  .option(...stateOpt)
  .option(...z80Opt)
  .option(...snaOpt)
  .option(...binOpt)
  .option(...orgOpt)
  .option(...jsonOpt)
  .action((addr: string, opts) => {
    process.exitCode = xrefCommand(addr, opts);
  });

program
  .command('doctor')
  .description('Check the toolchain: node, assembler backend, ROM')
  .option(...jsonOpt)
  .action(async (opts) => {
    process.exitCode = await doctorCommand(opts);
  });

program
  .command('setup')
  .description('Generate or install MCP configuration for supported agents')
  .requiredOption('--agent <name>', 'agent integration: codex or claude')
  .option('--write-global', 'write Codex global config with a backup', false)
  .option(...jsonOpt)
  .action((opts) => {
    const agent = String(opts.agent).toLowerCase();
    if (agent !== 'codex' && agent !== 'claude') {
      throw userError('--agent must be codex or claude', 'setup');
    }
    process.exitCode = setupCommand({
      agent,
      writeGlobal: opts.writeGlobal,
      json: opts.json,
    });
  });

program
  .command('verify')
  .description('Build, run, screenshot, and run declarative tests for the current project')
  .option('--screenshot <file>', 'screenshot output path (default .zxs/verify-screen.png)')
  .option(...jsonOpt)
  .action(async (opts) => {
    process.exitCode = await verifyCommand(opts);
  });

program
  .command('preview')
  .description('Build the current project and serve it in a browser player')
  .option('--port <n>', 'local preview port', '5173')
  .option('--strict-port', 'fail if --port is already in use instead of trying later ports', false)
  .option('--watch', 'rebuild the preview snapshot and reload the page on source changes', false)
  .option('--list', 'list the tracked preview server', false)
  .option('--stop', 'stop the tracked preview server', false)
  .option('--detach', 'start preview in the background and return', false)
  .option('--detached-child', 'internal detached preview worker', false)
  .option(...jsonOpt)
  .action(async (opts) => {
    process.exitCode = await previewCommand(opts);
  });

program
  .command('play')
  .description('Open a .z80/.sna snapshot or .tap/.tzx tape in the browser player')
  .argument('<file>', 'snapshot or tape file')
  .option('--port <n>', 'local player port', '5173')
  .option('--strict-port', 'fail if --port is already in use instead of trying later ports', false)
  .option(...jsonOpt)
  .action(async (file: string, opts) => {
    process.exitCode = await playCommand(file, opts);
  });

program
  .command('bench')
  .description('Measure headless emulation speed')
  .option('--frames <n>', 'frames to run', '2000')
  .option(...jsonOpt)
  .action((opts) => {
    process.exitCode = benchCommand(opts);
  });

program.parseAsync().catch((err: unknown) => {
  if (typeof err === 'object' && err !== null && 'exitCode' in err && err.exitCode === 0) {
    process.exitCode = EXIT.OK;
    return;
  }
  process.exitCode = emitCliError(err, argvWantsJson());
});
