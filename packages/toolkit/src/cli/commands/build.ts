import { relative } from 'node:path';
import { build } from '../../build/sjasmplus.js';
import {
  configuredAssembler,
  configuredEntry,
  configuredOrg,
  configuredOutDir,
  loadProjectConfig,
  resolveProjectPath,
} from '../config.js';
import { EXIT, emit, userError } from '../output.js';
import { loadSessionMeta, saveSessionMeta } from '../session.js';

export interface BuildCommandOptions {
  outDir?: string;
  json: boolean;
  assembler?: string;
}

export async function buildCommand(entryArg: string | undefined, opts: BuildCommandOptions): Promise<number> {
  const loaded = loadProjectConfig();
  const entry = configuredEntry(entryArg, loaded.config);
  if (!entry) {
    throw userError('No entry provided. Pass a file or add "entry" to zx.config.json.', 'build');
  }

  const outDir = configuredOutDir(opts.outDir, loaded.config);
  const assembler = configuredAssembler(opts.assembler, loaded.config);
  if (!assembler) {
    emit(
      {
        ok: false,
        stage: 'build',
        entry,
        errorCount: 1,
        warningCount: 0,
        errors: [
          {
            file: entry,
            line: 1,
            severity: 'error',
            message: `Unknown assembler backend: ${opts.assembler ?? process.env['ZXS_ASSEMBLER']}`,
          },
        ],
        warnings: [],
        outputs: {},
        durationMs: 0,
      },
      opts.json,
      () => `Unknown assembler backend: ${opts.assembler ?? process.env['ZXS_ASSEMBLER']}`
    );
    return EXIT.USER_ERROR;
  }

  const result = await build(resolveProjectPath(entry), { outDir, assembler });

  // Record the SLD path so break/disasm/trace can resolve labels and lines.
  if (result.ok && result.outputs.sld) {
    const meta = loadSessionMeta();
    meta.symbolsPath = result.outputs.sld;
    saveSessionMeta(meta);
  }

  const summary = {
    ok: result.ok,
    stage: 'build',
    entry,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    assembler,
    errors: result.errors,
    warnings: result.warnings,
    outputs: result.outputs,
    durationMs: result.durationMs,
    next: result.ok
      ? [`zxs run --bin ${rel(result.outputs.bin)} --org ${configuredOrg(undefined, loaded.config)} --frames 300 --screenshot screen.png`]
      : [`fix ${result.errors[0]?.file}:${result.errors[0]?.line}, then rerun zxs build`],
  };

  emit(summary, opts.json, () => {
    if (result.ok) {
      const lines = [`OK  ${rel(result.outputs.bin)} (${result.durationMs}ms)`];
      if (result.outputs.sld) lines.push(`    symbols: ${rel(result.outputs.sld)}`);
      for (const w of result.warnings) {
        lines.push(`warning ${w.file}:${w.line}: ${w.message}`);
      }
      return lines.join('\n');
    }
    return result.errors
      .map((e) => {
        let s = `${e.file}:${e.line}: error: ${e.message}`;
        if (e.sourceLine) s += `\n    ${e.sourceLine.trim()}`;
        if (e.hint) s += `\n    hint: ${e.hint}`;
        return s;
      })
      .join('\n');
  });

  return result.ok ? EXIT.OK : EXIT.USER_ERROR;
}

function rel(p: string | undefined): string {
  return p ? relative(process.cwd(), p) : '';
}
