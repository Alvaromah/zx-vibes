// `zxs` CLI dispatcher — cli.md CLI-PROD-PKG-004 (Commander-style dispatch),
// CLI-PROD-CONV-JSON-001 (`--json`), exit-code wiring (CLI-PROD-EXIT-00x).
//
// Slice 1 skeleton: a Commander top-level dispatch over the command registry,
// `--help`/`--version`, and the output envelope wired end-to-end. The `version`
// command is the real command proving the envelope; the rest are deferred stubs.
// Every outcome is rendered through the single envelope printer and mapped to an
// exit code; commander's own error text is suppressed so the `--json` channel
// stays a single JSON object (CLI-PROD-CONV-JSON-001).

import { readFileSync } from 'node:fs';
import { Command, CommanderError, type Command as CommanderCommand } from 'commander';
import {
  ExitCode,
  defaultStreams,
  printEnvelope,
  toErrorEnvelope,
  userError,
  type ExitCode as ExitCodeType,
  type OutputStreams,
} from './output/envelope.js';
import { createRegistry, type CommandContext } from './registry.js';
import { registerRevengAddon } from './reveng/index.js';

/**
 * Whether the optional reverse-engineering add-on is mounted (cli.md CLI-PROD-REVENG-001,
 * ADR-0027 D5). OFF by default — its ABSENCE is the documented default (CLI-PROD-FREE-003),
 * so the default `zxs` surface is exactly the core command set (CLI-PROD-CMDSET-001;
 * `snapshot`/`scan`/`xref`/reveng `gfx` are demoted to the add-on, CLI-PROD-CMDSET-002). It
 * is OPT-IN via `ZXS_REVENG` (`on`/`1`/`true`/`yes`) — the "install" seam for the add-on
 * package/subcommand group. The DNA does not bless a default-ON marked group, so default-OFF
 * is the reconciliation. The flag is an internal/Incidental toggle (CLI-PROD-FREE-002).
 */
export function revengAddonEnabled(): boolean {
  const flag = (process.env.ZXS_REVENG ?? '').trim().toLowerCase();
  return flag === 'on' || flag === '1' || flag === 'true' || flag === 'yes';
}

/** Read the toolkit version from the package manifest (beside the built module). */
export function readVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface RunCliOptions {
  streams?: OutputStreams;
}

/**
 * Parse and dispatch a `zxs` invocation. Returns the process exit code; never
 * calls `process.exit` itself, so it is unit-testable. `argv` is the user args
 * (i.e. `process.argv.slice(2)`).
 */
export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const streams = options.streams ?? defaultStreams;
  const version = readVersion();
  const registry = createRegistry(version);
  // Mount the OPTIONAL reverse-engineering add-on on top of the pristine core registry
  // (CLI-PROD-REVENG-001, ADR-0027 D5). Core never references it; this single gated call is
  // the only coupling point, so `ZXS_REVENG=off` yields a pure-core CLI (add-on absent).
  if (revengAddonEnabled()) {
    registerRevengAddon(registry);
  }
  // `--json` may appear anywhere (including after a subcommand); detect it directly.
  const jsonFlag = argv.includes('--json');

  const program = new Command();
  program
    .name('zxs')
    .description('Agent-facing ZX Spectrum 48K build/run/observe/verify toolkit')
    .version(version, '-v, --version', 'print the toolkit version')
    .option('--json', 'emit a single machine-readable JSON envelope')
    .allowExcessArguments(true)
    .exitOverride();
  program.configureOutput({
    writeOut: (str) => streams.out(str),
    // Suppress commander's own error text; usage/parse errors are rendered as
    // envelopes below so the JSON channel stays a single object.
    writeErr: () => undefined,
  });

  let exitCode: ExitCodeType = ExitCode.OK;

  for (const spec of registry.list()) {
    const command = program.command(spec.name).description(spec.summary);
    if (spec.configure) {
      // A real command declares its own arguments/flags (e.g. `build`).
      spec.configure(command);
    } else {
      // A deferred stub: accept anything; it throws "not implemented" regardless.
      command
        .allowUnknownOption(true)
        .allowExcessArguments(true)
        .argument('[args...]', 'command arguments')
        .option('--json', 'emit a single machine-readable JSON envelope');
    }
    // Commander passes `(...declaredArgs, options, thisCommand)`; read positionals
    // from `thisCommand.args` and options from the penultimate argument uniformly,
    // so generic stubs and configured commands share one action.
    command.action(async (...actionArgs: unknown[]) => {
      const thisCommand = actionArgs[actionArgs.length - 1] as CommanderCommand;
      const options = (actionArgs[actionArgs.length - 2] ?? {}) as Record<string, unknown>;
      const context: CommandContext = {
        json: jsonFlag || Boolean(program.opts().json) || Boolean(options.json),
        args: [...thisCommand.args],
        options,
      };
      let envelope;
      try {
        envelope = await spec.run(context);
      } catch (error) {
        envelope = toErrorEnvelope(error, spec.name);
      }
      printEnvelope(envelope, { json: context.json, streams });
      exitCode = envelope.ok ? ExitCode.OK : envelope.error.exitCode;
    });
  }

  // Pre-handle the flag-only / no-command cases ourselves so `--help`, `--version`,
  // and a bare invocation are deterministic clean exits (commander's no-command path
  // would otherwise throw a help-as-error with a non-zero code).
  const firstPositional = argv.find((token) => !token.startsWith('-'));
  if (firstPositional === undefined) {
    if (argv.includes('-v') || argv.includes('--version')) {
      streams.out(`${version}\n`);
      return ExitCode.OK;
    }
    if (argv.includes('-h') || argv.includes('--help')) {
      streams.out(program.helpInformation());
      return ExitCode.OK;
    }
    if (jsonFlag) {
      const envelope = toErrorEnvelope(userError('no command given', 'cli'), 'cli');
      printEnvelope(envelope, { json: true, streams });
      return envelope.error.exitCode;
    }
    streams.out(program.helpInformation());
    return ExitCode.OK;
  }

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      // `--help` / `--version` are clean exits; commander already wrote them out.
      if (error.exitCode === 0) return ExitCode.OK;
      // A usage/parse error (unknown command, bad option) is a user error.
      const envelope = toErrorEnvelope(
        userError(cleanMessage(error.message) || 'invalid command', 'cli'),
        'cli',
      );
      printEnvelope(envelope, { json: jsonFlag, streams });
      return envelope.error.exitCode;
    }
    // Any other unexpected throw surfaces (never swallowed, ERR-PROD-NOSILENT-001).
    const envelope = toErrorEnvelope(error, 'cli');
    printEnvelope(envelope, { json: jsonFlag, streams });
    return envelope.error.exitCode;
  }

  return exitCode;
}

/** Strip commander's leading "error: " prefix (we add our own framing). */
function cleanMessage(message: string): string {
  return message.replace(/^error:\s*/i, '').trim();
}
