import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { assembleFile, disassemble, writeAssemblyOutputs } from './index.js';

interface PackageMetadata {
  version: string;
}

const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as PackageMetadata;

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
  .option('--json', 'machine-readable JSON output', false)
  .action(async (file: string, opts: { outDir: string; inc: string[]; define: string[]; json: boolean }) => {
    const started = performance.now();
    const result = assembleFile(file, {
      includePaths: opts.inc,
      defines: parseDefines(opts.define),
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
      for (const w of result.warnings) console.warn(`${w.file}:${w.line}: warning: ${w.message}`);
    } else {
      for (const e of result.errors) console.error(`${e.file}:${e.line}: error: ${e.message}`);
    }
    process.exitCode = result.ok ? 0 : 1;
  });

program
  .command('disasm')
  .argument('<bin>', 'raw binary file')
  .option('--org <addr>', 'origin address', '0x8000')
  .option('--count <n>', 'instruction count')
  .action((bin: string, opts: { org: string; count?: string }) => {
    const bytes = new Uint8Array(readFileSync(bin));
    const org = parseAddress(opts.org, 'origin');
    const count = opts.count ? parseCount(opts.count, 'instruction count') : 32;
    const lines = disassemble((addr) => mappedByte(bytes, org, addr), org, count);
    for (const line of lines) {
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
    const ok = true;
    const doc = { ok, assembler: '@zx-vibes/asm', version: packageMetadata.version };
    if (opts.json) console.log(JSON.stringify(doc, null, 2));
    else console.log(`OK ${doc.assembler} ${doc.version}`);
  });

program.parseAsync().catch((err: unknown) => {
  if (typeof err === 'object' && err !== null && 'exitCode' in err && err.exitCode === 0) {
    process.exitCode = 0;
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

function hex16(n: number): string {
  return `0x${(n & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}
