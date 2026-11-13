/* eslint-disable no-console -- CLI entry point; stdout/stderr are its output surface */
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { checkAssemblerRuntime } from './doctor.js';
import { assembleFile, disassembleOne, writeAssemblyOutputs, type Diagnostic, type DisasmLine } from './index.js';

interface PackageMetadata {
  version: string;
}

/** Instructions `zxasm disasm` lists when `--count` is not given. */
const DEFAULT_DISASM_COUNT = 32;

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as PackageMetadata;
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const packageMetadata: PackageMetadata = { version: readPackageVersion() };

const program = new Command();
program.exitOverride();
program.configureOutput({ writeErr: () => undefined });

program.name('zxasm').description('zx-vibes Z80 assembler/disassembler').version(packageMetadata.version);

program
  .command('assemble')
  .argument('<file>', 'entry .asm file')
  .option('--out-dir <dir>', 'output directory', 'build')
  .option('-I, --inc <path>', 'include search path', collect, [])
  .option('-D, --define <define>', 'define a symbol, optionally NAME=value', collect, [])
  .option('--sandbox', 'restrict INCLUDE/INCBIN reads to the project (cwd + include paths)', false)
  .option('--json', 'machine-readable JSON output', false)
  .action(async (file: string, opts: { outDir: string; inc: string[]; define: string[]; sandbox: boolean; json: boolean }) => {
    const started = performance.now();
    const result = assembleFile(file, {
      includePaths: opts.inc,
      defines: parseDefines(opts.define),
      sandbox: opts.sandbox,
    });
    const outputs = result.ok
      ? writeAssemblyOutputs(result, {
          entry: file,
          outDir: opts.outDir,
        })
      : {};
    const doc = {
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings,
      outputs,
      durationMs: Math.round(performance.now() - started),
    };
    if (opts.json) {
      console.log(JSON.stringify(doc, null, 2));
    } else if (result.ok) {
      console.log(`OK ${outputs.bin}`);
      if (outputs.sld) console.log(`symbols: ${outputs.sld}`);
      for (const artifact of outputs.artifacts ?? []) console.log(`artifact: ${artifact}`);
      for (const w of result.warnings) console.warn(formatDiagnostic(w));
    } else {
      // A failed build still shows the warnings (DISPLAY output included) and each
      // error's did-you-mean hint (ASM-PROD-ERR-001); only the bare errors were printed.
      for (const w of result.warnings) console.warn(formatDiagnostic(w));
      for (const e of result.errors) console.error(formatDiagnostic(e));
    }
    process.exitCode = result.ok ? 0 : 1;
  });

program
  .command('disasm')
  .argument('<bin>', 'raw binary file')
  .option('--org <addr>', 'origin address', '0x8000')
  .option('--count <n>', `instruction count (at most; default ${DEFAULT_DISASM_COUNT})`)
  .action((bin: string, opts: { org: string; count?: string }) => {
    const bytes = new Uint8Array(readFileSync(bin));
    const org = parseAddress(opts.org, 'origin');
    const count = opts.count ? parseCount(opts.count, 'instruction count') : DEFAULT_DISASM_COUNT;
    for (const line of disassembleFile(bytes, org, count)) {
      console.log(
        `${hex16(line.addr)}  ${line.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(12)} ${line.text}`
      );
    }
  });

program
  .command('doctor')
  .description('Check the embedded assembler runtime')
  .option('--json', 'machine-readable JSON output', false)
  .action((opts: { json: boolean }) => {
    const check = checkAssemblerRuntime();
    const doc = {
      ok: check.ok,
      assembler: '@zx-vibes/asm',
      version: packageMetadata.version,
      ...(check.ok ? {} : { error: { message: check.message, exitCode: 1 } }),
    };
    if (opts.json) console.log(JSON.stringify(doc, null, 2));
    else if (check.ok) console.log(`OK ${doc.assembler} ${doc.version}`);
    else console.error(`FAIL ${doc.assembler} ${doc.version}: ${check.message}`);
    process.exitCode = check.ok ? 0 : 1;
  });

program.parseAsync().catch((err: unknown) => {
  if (typeof err === 'object' && err !== null && 'exitCode' in err && err.exitCode === 0) {
    process.exitCode = 0;
    return;
  }
  // `zxasm` with no command: commander writes the help through writeErr, which is
  // silenced above so errors get our own format, so print the help here instead of
  // the bare "error: (outputHelp)".
  if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'commander.help') {
    process.stderr.write(program.helpInformation());
    process.exitCode = 1;
    return;
  }
  const message = err instanceof Error ? err.message.replace(/^error:\s*/i, '') : String(err);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: false, error: { message, exitCode: 1 } }, null, 2));
  } else {
    console.error(`error: ${message}`);
  }
  process.exitCode = 1;
});

function parseAddress(text: string, name: string): number {
  let n: number;
  if (/^0x[0-9a-f]+$/i.test(text)) n = parseInt(text, 16);
  else if (/^\$[0-9a-f]+$/i.test(text)) n = parseInt(text.slice(1), 16);
  else if (/^[0-9a-f]+h$/i.test(text)) n = parseInt(text.slice(0, -1), 16);
  else if (/^\d+$/.test(text)) n = parseInt(text, 10);
  else n = NaN;
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new Error(`Invalid ${name}: '${text}' must be a 16-bit address`);
  }
  return n;
}

function parseCount(text: string, name: string): number {
  if (!/^\d+$/.test(text)) throw new Error(`Invalid ${name}: '${text}' must be a positive integer`);
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`Invalid ${name}: '${text}' must be a positive integer`);
  }
  return n;
}

function mappedByte(bytes: Uint8Array, org: number, addr: number): number {
  const offset = (addr - org) & 0xffff;
  return offset < bytes.length ? bytes[offset]! : 0;
}

/**
 * Disassemble a raw binary loaded at `org`: at most `limit` instructions, and never past
 * the end of the file. Bytes after the end do not exist — reading them as 0x00 listed a
 * `NOP` for each (30 of them after a 3-byte file) and completed a cut-off instruction with
 * operands that were never there (a final `CD` became `CALL 0x0000`). An instruction the
 * file ends inside of is listed as the data bytes that are present (`DB 0xCD`).
 */
function disassembleFile(bytes: Uint8Array, org: number, limit: number): DisasmLine[] {
  const lines: DisasmLine[] = [];
  let offset = 0;
  while (lines.length < limit && offset < bytes.length) {
    const addr = (org + offset) & 0xffff;
    let line = disassembleOne((a) => mappedByte(bytes, org, a), addr);
    if (offset + line.bytes.length > bytes.length) {
      const rest = Array.from(bytes.subarray(offset));
      const data = rest.map((b) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`);
      line = { addr, bytes: rest, text: `DB ${data.join(',')}` };
    }
    lines.push(line);
    offset += line.bytes.length;
  }
  return lines;
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parseDefines(items: string[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const item of items) {
    const eq = item.indexOf('=');
    if (eq < 0) out[item] = true;
    else out[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return out;
}

/** `file:line: error: message`, plus an indented `hint:` line when there is one. */
function formatDiagnostic(d: Diagnostic): string {
  const line = `${d.file}:${d.line}: ${d.severity}: ${d.message}`;
  return d.hint ? `${line}\n  hint: ${d.hint}` : line;
}

function hex16(n: number): string {
  return `0x${(n & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}
