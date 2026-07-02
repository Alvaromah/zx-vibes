// Command registry — the extension point later slices fill (cli.md
// CLI-PROD-CMDSET-001).
//
// Slice 1 establishes the skeleton: the canonical v2 command set is registered as
// metadata, with exactly one real command (`version`) proving the envelope path
// end-to-end. Every other command is a recognized-but-deferred stub that emits a
// clean USER_ERROR envelope, so the dispatcher, the exit-code mapping, and the
// `--json` contract are all exercised before any feature logic exists. Later
// slices replace a stub's `run` with the real service.

import type { Command } from 'commander';
import { successEnvelope, userError, type Envelope } from './output/envelope.js';
import { buildCommand, configureBuildCommand } from './build/build.js';
import { runCommand, configureRunCommand } from './runtime/run.js';
import { testCommand, configureTestCommand } from './test/runner.js';
import { verifyCommand, configureVerifyCommand } from './verify/verify.js';
// Read-only observe command group (Slice 7a) — cli.md CLI-PROD-SCREEN/REGS/MEM/DISASM/
// STEP/TRACE/SYMBOLS/COVERAGE, toolkit-runtime.md RT-PROD-OBSERVE-001.
import { screenCommand, configureScreenCommand } from './observe/screen-command.js';
import { regsCommand, configureRegsCommand } from './observe/regs-command.js';
import { memCommand, configureMemCommand } from './observe/memory.js';
import { disasmCommand, configureDisasmCommand } from './observe/disasm.js';
import { stepCommand, configureStepCommand } from './observe/step.js';
import { traceCommand, configureTraceCommand } from './observe/trace.js';
import { symbolsCommand, configureSymbolsCommand } from './observe/symbols.js';
import { coverageCommand, configureCoverageCommand } from './observe/coverage.js';
// Input + persistent-debug command group (Slice 7b) — cli.md CLI-PROD-INPUT/STATE/
// BREAK/WATCH-*, toolkit-runtime.md RT-PROD-SESSION-*.
import { keyCommand, configureKeyCommand, typeCommand, configureTypeCommand } from './input/input-command.js';
import { stateCommand, configureStateCommand } from './state/state-command.js';
import {
  breakCommand,
  configureBreakCommand,
  watchCommand,
  configureWatchCommand,
} from './state/debug-command.js';
// Preview server + bundled core player (Slice 8b) — cli.md CLI-PROD-PREVIEW-001/002,
// toolkit-runtime.md RT-PROD-PREVIEW-001..005.
import { previewCommand, configurePreviewCommand } from './preview/preview-command.js';
// Project scaffold command group (Slice 9) — cli.md CLI-PROD-NEW-001 / INIT-001 / CLEAN-001,
// toolkit-runtime.md RT-PROD-CONFIG-001.
import {
  newCommand,
  configureNewCommand,
  initCommand,
  configureInitCommand,
  cleanCommand,
  configureCleanCommand,
} from './scaffold/scaffold.js';
// Environment + agent-config command group (Slice 11a) — cli.md CLI-PROD-DOCTOR-001 /
// CLI-PROD-SETUP-001, CLI-PROD-OUT-DOCTOR-001; errors.md ERR-PROD-ENV-001;
// knowledge-pack.md KP-PROD-PKG-001.
import { doctorCommand, configureDoctorCommand } from './doctor/doctor.js';
import { setupCommand, configureSetupCommand } from './setup/setup.js';
// Core graphics decode (Slice 11a) — cli.md CLI-PROD-GFX-001/002/003,
// toolkit-runtime.md RT-PROD-OBSERVE-001 (the one screenshot encoder).
import { gfxCommand, configureGfxCommand } from './gfx/gfx.js';

/** The context handed to a command handler. */
export interface CommandContext {
  /** `--json` mode (CLI-PROD-CONV-JSON-001). */
  json: boolean;
  /** Positional arguments after the command name. */
  args: string[];
  /** Parsed flags for the command. */
  options: Record<string, unknown>;
}

/**
 * A command handler returns the envelope to print. A logical failure throws a
 * {@link CliError} (e.g. `userError`/`envError`/`hangError`) carrying its exit
 * code; the dispatcher renders and exits.
 */
export type CommandHandler = (context: CommandContext) => Envelope | Promise<Envelope>;

export interface CommandSpec {
  name: string;
  summary: string;
  run: CommandHandler;
  /**
   * Optional commander setup for a command that declares its own positional
   * arguments / flags (e.g. `build`'s `[file]` + `--out-dir`). When absent the
   * dispatcher attaches a generic variadic `[args...]` and tolerates unknown
   * options (the deferred-stub shape).
   */
  configure?: (command: Command) => void;
}

/** A simple name → spec registry that later slices extend. */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandSpec>();

  register(spec: CommandSpec): this {
    this.commands.set(spec.name, spec);
    return this;
  }

  get(name: string): CommandSpec | undefined {
    return this.commands.get(name);
  }

  list(): CommandSpec[] {
    return [...this.commands.values()];
  }
}

/**
 * The canonical v2 top-level command set (cli.md CLI-PROD-CMDSET-001) still awaiting a
 * real service. With Slice 11a complete (`doctor`/`setup`/core `gfx`), every core verb
 * is implemented; no deferred stubs remain.
 *
 * The optional reverse-engineering add-on (`snapshot`/`scan`/`xref` + reveng `gfx find` /
 * `gfx blit-linear`, CLI-PROD-REVENG-001, ADR-0027 D5) is NOT part of this core set: it is
 * mounted separately by `registerRevengAddon` (`src/reveng/`), which `createRegistry` never
 * calls. So `createRegistry` alone is pure core; the add-on layers on top (its absence is
 * the documented default, CLI-PROD-FREE-003).
 */
export const DEFERRED_COMMANDS: ReadonlyArray<{ name: string; summary: string }> = [];

/** Build the deferred stub handler for a not-yet-implemented command. */
function deferredHandler(name: string): CommandHandler {
  return () => {
    throw userError(`Command "${name}" is not implemented yet (planned for a later slice)`, name);
  };
}

/**
 * Build the Slice 1 registry: the real `version` command plus every other v2
 * command as a deferred stub. `version` reports the toolkit version through the
 * standard envelope, proving the `--json` + exit-code path end-to-end.
 */
export function createRegistry(version: string): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register({
    name: 'version',
    summary: 'Print the toolkit version',
    run: () => successEnvelope('version', { version }),
  });
  // The build service (Slice 2) — the first real feature command.
  registry.register({
    name: 'build',
    summary: 'Assemble the entry .asm to a binary + SLD symbols',
    run: buildCommand,
    configure: configureBuildCommand,
  });
  // The run service (Slice 3) — fresh-by-default emulator run.
  registry.register({
    name: 'run',
    summary: 'Run the emulator for a frame budget (fresh by default)',
    run: runCommand,
    configure: configureRunCommand,
  });
  // The declarative test runner (Slice 4) — assert observable machine state.
  registry.register({
    name: 'test',
    summary: 'Run declarative asm tests (or print the assertion reference)',
    run: testCommand,
    configure: configureTestCommand,
  });
  // The verify acceptance pipeline (Slice 5) — build -> run -> screenshot -> tests.
  registry.register({
    name: 'verify',
    summary: 'Project acceptance gate: build -> run -> screenshot -> tests',
    run: verifyCommand,
    configure: configureVerifyCommand,
  });
  // The read-only observe command group (Slice 7a) — RT-PROD-OBSERVE-001.
  registry.register({
    name: 'screen',
    summary: 'Report the current machine screen (text / png / base64 / diff)',
    run: screenCommand,
    configure: configureScreenCommand,
  });
  registry.register({
    name: 'regs',
    summary: 'Report the CPU registers',
    run: regsCommand,
    configure: configureRegsCommand,
  });
  registry.register({
    name: 'mem',
    summary: 'Read / dump session memory',
    run: memCommand,
    configure: configureMemCommand,
  });
  registry.register({
    name: 'disasm',
    summary: 'Disassemble from an address / label / file.asm:line / PC',
    run: disasmCommand,
    configure: configureDisasmCommand,
  });
  registry.register({
    name: 'step',
    summary: 'Execute n instructions and report the resulting state',
    run: stepCommand,
    configure: configureStepCommand,
  });
  registry.register({
    name: 'trace',
    summary: 'Run with per-instruction execution tracing',
    run: traceCommand,
    configure: configureTraceCommand,
  });
  registry.register({
    name: 'symbols',
    summary: 'Dump the SLD symbol table as JSON',
    run: symbolsCommand,
    configure: configureSymbolsCommand,
  });
  registry.register({
    name: 'coverage',
    summary: 'Report which code (SLD routines) was reached over a run',
    run: coverageCommand,
    configure: configureCoverageCommand,
  });
  // Input + persistent-debug command group (Slice 7b) — key/type/state/break/watch.
  registry.register({
    name: 'key',
    summary: 'Press one key into a machine (scheduled --keys sugar)',
    run: keyCommand,
    configure: configureKeyCommand,
  });
  registry.register({
    name: 'type',
    summary: 'Type a string through the keyboard matrix',
    run: typeCommand,
    configure: configureTypeCommand,
  });
  registry.register({
    name: 'state',
    summary: 'Manage the opt-in persistent session (save/load/reset/export)',
    run: stateCommand,
    configure: configureStateCommand,
  });
  registry.register({
    name: 'break',
    summary: 'Manage breakpoints (add/list/rm)',
    run: breakCommand,
    configure: configureBreakCommand,
  });
  registry.register({
    name: 'watch',
    summary: 'Manage memory watchpoints (add/list/rm/clear)',
    run: watchCommand,
    configure: configureWatchCommand,
  });
  // Preview server + bundled core player (Slice 8b) — the optional human-review handoff.
  registry.register({
    name: 'preview',
    summary: 'Build + serve the project in the bundled core player',
    run: previewCommand,
    configure: configurePreviewCommand,
  });
  // Project scaffold command group (Slice 9) — new / init / clean.
  registry.register({
    name: 'new',
    summary: 'Scaffold a fresh project',
    run: newCommand,
    configure: configureNewCommand,
  });
  registry.register({
    name: 'init',
    summary: 'Scaffold the toolkit contract into an existing dir',
    run: initCommand,
    configure: configureInitCommand,
  });
  registry.register({
    name: 'clean',
    summary: 'Remove generated artifacts',
    run: cleanCommand,
    configure: configureCleanCommand,
  });
  // Environment + agent-config command group (Slice 11a) — doctor / setup.
  registry.register({
    name: 'doctor',
    summary: 'Check the toolchain (Node, @zx-vibes/asm, the 48K ROM); exit 3 on failure',
    run: doctorCommand,
    configure: configureDoctorCommand,
  });
  registry.register({
    name: 'setup',
    summary: 'Install the knowledge pack as native agent skills + register the MCP server',
    run: setupCommand,
    configure: configureSetupCommand,
  });
  // Core graphics decode (Slice 11a) — gfx linear / gfx attrs (reveng find/blit = 11b).
  registry.register({
    name: 'gfx',
    summary: 'Decode the agent\'s own Spectrum graphics data to PNG (linear | attrs)',
    run: gfxCommand,
    configure: configureGfxCommand,
  });
  for (const { name, summary } of DEFERRED_COMMANDS) {
    registry.register({ name, summary, run: deferredHandler(name) });
  }
  return registry;
}
