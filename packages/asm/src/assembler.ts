import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { Z80_OPCODE_TABLE, type OpcodeByte } from './generated/z80-opcodes-table.js';

export interface Diagnostic {
  file: string;
  line: number;
  severity: 'error' | 'warning';
  message: string;
  sourceLine?: string;
  hint?: string;
}

export interface AssembleOptions {
  entryPath?: string;
  cwd?: string;
  includePaths?: string[];
  defines?: Record<string, string | number | boolean>;
  /**
   * When true, INCLUDE/INCBIN/INSERT may only read files inside the sandbox
   * roots (cwd + includePaths). Off by default to preserve existing behavior;
   * turn it on when assembling untrusted source. SAVEBIN output is always
   * confined to the output directory regardless of this flag.
   */
  sandbox?: boolean;
}

export interface SymbolDef {
  name: string;
  value: number;
  kind: 'F' | 'D';
  file: string;
  line: number;
}

export interface SourceMapEntry {
  file: string;
  line: number;
  addr: number;
}

export interface OutputArtifact {
  kind: 'bin';
  path: string;
  bytes: Uint8Array;
  start: number;
  length: number;
}

export interface AssembleResult {
  ok: boolean;
  bytes: Uint8Array;
  origin: number;
  symbols: SymbolDef[];
  sourceMap: SourceMapEntry[];
  artifacts: OutputArtifact[];
  sld: string;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

export interface OutputFiles {
  bin?: string;
  sld?: string;
  artifacts?: string[];
}

interface SourceLine {
  file: string;
  line: number;
  text: string;
  moduleScope?: string | undefined;
  /** For a line produced by a macro expansion: the invocations, innermost first. */
  macroStack?: readonly MacroCall[] | undefined;
}

interface MacroCall {
  name: string;
  file: string;
  line: number;
}

interface ParsedLine {
  loc: SourceLine;
  label?: string | undefined;
  labelKey?: string | undefined;
  op?: string | undefined;
  args: string;
  equ?: boolean | undefined;
  globalScope: string;
  moduleScope: string;
}

interface EvalContext {
  /** Symbol values as expressions read them: 16-bit, so `X EQU -1` reads as 0xFFFF. */
  symbols: Map<string, number>;
  /**
   * The negative value a symbol was defined with (`X EQU -1`, `X EQU 1==1` -> -1), for
   * the signed view only (see readsAsNegativeByte). Absent where no 8-bit check runs.
   */
  negativeSymbols?: Map<string, number>;
  currentGlobal: string;
  moduleScope: string;
  pc: number;
  cwd: string;
  includePaths: string[];
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
  loc: SourceLine;
  strict: boolean;
  /** Sandbox config for INCBIN/INSERT; absent = unrestricted (default). */
  sandbox?: boolean;
  roots?: string[];
  /**
   * Set while evaluating during source loading, before any address exists: IF/ELSEIF
   * conditions, DUP/REPT counts, and the load-time values of EQU and DEFINE that those
   * read. `$` and code labels (and constants computed from them) are then reported as
   * unusable instead of silently reading PC 0 or failing as "Label not found".
   */
  beforeLayout?: { directive: string; layoutSymbols: ReadonlySet<string> };
}

function beforeLayoutMessage(directive: string, uses: readonly string[]): string {
  return `${directive} is evaluated before layout and can only use constants already known above it, not $ or code labels (${uses.join(', ')})`;
}

interface LayoutResult {
  origin: number;
  pc: number;
  symbols: Map<string, number>;
  negativeSymbols: Map<string, number>;
  definitions: Map<string, SymbolDef>;
  lines: ParsedLine[];
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

interface IncludeTarget {
  path: string;
  searchOnly: boolean;
}

interface LoadContext {
  cwd: string;
  includePaths: string[];
  diagnostics: Diagnostic[];
  active: Set<string>;
  /** Constants known while loading: defines, constant EQU/DEFL values, DUP counters. */
  symbols: Map<string, number>;
  /**
   * Symbols seen while loading that only get a value during layout: code labels, and
   * EQU/DEFL/DEFINE values computed from `$` or code labels (see EvalContext.beforeLayout).
   */
  layoutSymbols: Set<string>;
  defineNames: Set<string>;
  defineValueNames: Set<string>;
  conditionals: ConditionalFrame[];
  macros: Map<string, MacroDef>;
  macroSerial: number;
  expansionDepth: number;
  modules: ModuleFrame[];
  terminated: boolean;
  sandbox: boolean;
  roots: string[];
}

interface ConditionalFrame {
  loc: SourceLine;
  parentActive: boolean;
  active: boolean;
  conditionMatched: boolean;
  elseSeen: boolean;
}

interface RepeatDirective {
  op: 'DUP' | 'REPT';
  args: string;
}

interface MacroDef {
  name: string;
  params: string[];
  body: SourceLine[];
  loc: SourceLine;
}

type MacroDefinitionParse = { name: string; params: string[] } | { error: string };

interface ModuleFrame {
  name: string;
  scope: string;
  loc: SourceLine;
}

const REG8 = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
const RP = ['BC', 'DE', 'HL', 'SP'];
const RP2 = ['BC', 'DE', 'HL', 'AF'];
const CC = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];
const JR_CC = ['NZ', 'Z', 'NC', 'C'];

const NO_ARG_OPS = new Map<string, number[]>([
  ['NOP', [0x00]],
  ["EX AF,AF'", [0x08]],
  ['RLCA', [0x07]],
  ['RRCA', [0x0f]],
  ['RLA', [0x17]],
  ['RRA', [0x1f]],
  ['DAA', [0x27]],
  ['CPL', [0x2f]],
  ['SCF', [0x37]],
  ['CCF', [0x3f]],
  ['HALT', [0x76]],
  ['RET', [0xc9]],
  ['EXA', [0x08]],
  ['EXD', [0xeb]],
  ['EX AF', [0x08]],
  ['EX AF,AF', [0x08]],
  ['EXX', [0xd9]],
  ['EX DE,HL', [0xeb]],
  ['DI', [0xf3]],
  ['EI', [0xfb]],
  ['LDI', [0xed, 0xa0]],
  ['CPI', [0xed, 0xa1]],
  ['INI', [0xed, 0xa2]],
  ['OUTI', [0xed, 0xa3]],
  ['LDD', [0xed, 0xa8]],
  ['CPD', [0xed, 0xa9]],
  ['IND', [0xed, 0xaa]],
  ['OUTD', [0xed, 0xab]],
  ['LDIR', [0xed, 0xb0]],
  ['CPIR', [0xed, 0xb1]],
  ['INIR', [0xed, 0xb2]],
  ['OTIR', [0xed, 0xb3]],
  ['LDDR', [0xed, 0xb8]],
  ['CPDR', [0xed, 0xb9]],
  ['INDR', [0xed, 0xba]],
  ['OTDR', [0xed, 0xbb]],
  ['NEG', [0xed, 0x44]],
  ['RETN', [0xed, 0x45]],
  ['RETI', [0xed, 0x4d]],
  ['RRD', [0xed, 0x67]],
  ['RLD', [0xed, 0x6f]],
]);

const ALU_BASE = new Map<string, { reg: number; imm: number; arity: 1 | 2 }>([
  ['ADD', { reg: 0x80, imm: 0xc6, arity: 2 }],
  ['ADC', { reg: 0x88, imm: 0xce, arity: 2 }],
  ['SUB', { reg: 0x90, imm: 0xd6, arity: 1 }],
  ['SBC', { reg: 0x98, imm: 0xde, arity: 2 }],
  ['AND', { reg: 0xa0, imm: 0xe6, arity: 1 }],
  ['XOR', { reg: 0xa8, imm: 0xee, arity: 1 }],
  ['OR', { reg: 0xb0, imm: 0xf6, arity: 1 }],
  ['CP', { reg: 0xb8, imm: 0xfe, arity: 1 }],
]);

const ROT_BASE = new Map<string, number>([
  ['RLC', 0x00],
  ['RRC', 0x08],
  ['RL', 0x10],
  ['RR', 0x18],
  ['SLA', 0x20],
  ['SRA', 0x28],
  ['SLL', 0x30],
  ['SLI', 0x30],
  ['SRL', 0x38],
]);

const INDEX_HALF_REGS = new Map<string, { code: number; prefix: 0xdd | 0xfd }>([
  ['IXH', { code: 4, prefix: 0xdd }],
  ['IXL', { code: 5, prefix: 0xdd }],
  ['XH', { code: 4, prefix: 0xdd }],
  ['XL', { code: 5, prefix: 0xdd }],
  ['HX', { code: 4, prefix: 0xdd }],
  ['LX', { code: 5, prefix: 0xdd }],
  ['IYH', { code: 4, prefix: 0xfd }],
  ['IYL', { code: 5, prefix: 0xfd }],
  ['YH', { code: 4, prefix: 0xfd }],
  ['YL', { code: 5, prefix: 0xfd }],
  ['HY', { code: 4, prefix: 0xfd }],
  ['LY', { code: 5, prefix: 0xfd }],
]);

export function assemble(source: string, opts: AssembleOptions = {}): AssembleResult {
  // `entryPath` is relative to `opts.cwd`, as in assembleFile; in-memory source resolves
  // its quoted INCLUDE/INCBIN paths against `opts.cwd` (see includeBaseDir).
  const file = opts.entryPath ? resolve(resolve(opts.cwd ?? process.cwd()), opts.entryPath) : MEMORY_FILE;
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const sourceLines = lines.map((text, i) => ({ file, line: i + 1, text }));
  const defineErrors = validateDefines(opts.defines ?? {});
  if (defineErrors.length > 0) return emptyResult(defineErrors);
  const diagnostics: Diagnostic[] = [];
  const cwd = resolve(opts.cwd ?? process.cwd());
  const ctx = makeLoadContext(opts, cwd, diagnostics);
  const processed = processSourceLines(sourceLines, ctx);
  finishConditionals(ctx);
  if (diagnostics.length > 0) return emptyResult(diagnostics);
  return assembleLines(processed, opts);
}

export function assembleFile(entry: string, opts: AssembleOptions = {}): AssembleResult {
  const defineErrors = validateDefines(opts.defines ?? {});
  if (defineErrors.length > 0) return emptyResult(defineErrors);
  const diagnostics: Diagnostic[] = [];
  const cwd = resolve(opts.cwd ?? process.cwd());
  const file = resolve(cwd, entry);
  const ctx = makeLoadContext(opts, cwd, diagnostics);
  const sourceLines = loadSourceFile(file, ctx);
  finishConditionals(ctx);
  if (diagnostics.length > 0) {
    return emptyResult(diagnostics);
  }
  return assembleLines(sourceLines, opts);
}

export function writeAssemblyOutputs(
  result: AssembleResult,
  opts: { entry: string; outDir: string }
): OutputFiles {
  if (!result.ok) return {};
  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });
  const stem = basename(opts.entry).replace(/\.[^.]+$/, '');
  const bin = join(outDir, `${stem}.bin`);
  const sld = join(outDir, `${stem}.sld`);
  writeFileSync(bin, result.bytes);
  writeFileSync(sld, result.sld);
  const artifacts: string[] = [];
  for (const artifact of result.artifacts) {
    const target = resolve(outDir, artifact.path);
    // Final containment guard: never write an artifact outside outDir, even if
    // the path slipped past the assembler-time SAVEBIN validation.
    const rel = relative(outDir, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Refusing to write artifact outside the output directory: ${artifact.path}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, artifact.bytes);
    artifacts.push(target);
  }
  return {
    bin,
    sld,
    ...(artifacts.length > 0 ? { artifacts } : {}),
  };
}

function assembleLines(sourceLines: SourceLine[], opts: AssembleOptions): AssembleResult {
  const layout = computeLayout(sourceLines, opts);
  if (layout.errors.length > 0) return resultFromLayout(layout, new Uint8Array(), []);

  const bytes: number[] = [];
  const artifacts: OutputArtifact[] = [];
  const sourceMap: SourceMapEntry[] = [];
  let pc = layout.origin;
  let currentGlobal = '';
  const errors: Diagnostic[] = [];
  const warnings = [...layout.warnings];
  const cwd = resolve(opts.cwd ?? process.cwd());
  const includePaths = normalizeIncludePaths(opts.includePaths ?? [], cwd);
  const sandbox = opts.sandbox ?? false;
  const roots = sandboxRoots(cwd, includePaths);
  const deviceEnabled = layout.lines.some((line) => line.op === 'DEVICE');
  const emitSymbols = new Map(layout.symbols);
  const negativeSymbols = new Map(layout.negativeSymbols);
  const apiDefines = apiDefineValues(opts.defines ?? {});
  for (const [name, value] of apiDefines) setDefineValue(emitSymbols, negativeSymbols, name, value);
  const activeDefineSymbols = new Set(apiDefines.keys());
  const sourceDefineSymbols = new Set<string>();

  // The output is one contiguous run of bytes from `layout.origin`: a forward ORG pads
  // with zeros, but bytes can never be placed below what is already emitted. A
  // backwards ORG (or code before the first ORG, which is laid out at the origin) used
  // to append them anyway, so a label's address and its byte's position disagreed.
  let lastOrg: { loc: SourceLine; addr: number; afterUnorgedCode: boolean; reported: boolean } | undefined;
  const write = (loc: SourceLine, at: number, out: number[]): void => {
    const end = layout.origin + bytes.length;
    if (out.length > 0 && at < end) {
      if (lastOrg && !lastOrg.reported) {
        lastOrg.reported = true;
        const org = `ORG ${hex16(lastOrg.addr)}`;
        errors.push(
          diag(
            lastOrg.loc,
            lastOrg.afterUnorgedCode
              ? `${org} follows code or data emitted before the first ORG; put the ORG before any instruction or data`
              : `${org} moves backwards into code or data already emitted (the output ends at ${hex16(end)})`
          )
        );
      }
      return;
    }
    while (layout.origin + bytes.length < at) bytes.push(0);
    if (out.length === 0) return;
    // Source-line records cover data directives as well as instructions (ASM-PROD-OUTPUT-003).
    sourceMap.push({ file: loc.file, line: loc.line, addr: at & 0xffff });
    for (const b of out) bytes.push(b & 0xff);
  };

  for (const line of layout.lines) {
    currentGlobal = line.globalScope;
    const ctx: EvalContext = {
      symbols: emitSymbols,
      negativeSymbols,
      currentGlobal,
      moduleScope: line.moduleScope,
      pc,
      cwd,
      includePaths,
      diagnostics: errors,
      warnings,
      loc: line.loc,
      strict: true,
      sandbox,
      roots,
    };
    if (!line.op) continue;
    const op = line.op;
    if (line.equ) {
      if (line.labelKey) {
        const value = evalExpr(line.args, ctx);
        if (value !== undefined) {
          emitSymbols.set(line.labelKey, value & 0xffff);
          recordSignedValue(ctx, line.labelKey, line.args);
        }
      }
      continue;
    }
    if (op === 'DEFINE' || op === 'UNDEFINE') {
      applyLayoutDefine(op, line.args, ctx, sourceDefineSymbols, activeDefineSymbols);
      continue;
    }
    if (isDirective(op)) {
      const before = bytes.length;
      pc = emitDirective(op, line.args, ctx, (at, out) => write(line.loc, at, out), bytes, layout.origin, artifacts, deviceEnabled);
      if (op === 'ORG') {
        lastOrg = { loc: line.loc, addr: pc, afterUnorgedCode: lastOrg === undefined && before > 0, reported: false };
      }
    } else {
      const out = encodeInstruction(op, line.args, ctx);
      if (out) {
        write(line.loc, pc, out);
        pc += out.length;
      }
    }
  }

  const finalErrors = [...layout.errors, ...errors];
  const result: AssembleResult = {
    ok: finalErrors.length === 0,
    bytes: Uint8Array.from(bytes),
    origin: layout.origin,
    symbols: [...layout.definitions.values()],
    sourceMap,
    artifacts,
    sld: '',
    errors: finalErrors,
    warnings,
  };
  result.sld = makeSld(result.symbols, result.sourceMap, sourceLines);
  return result;
}

function computeLayout(sourceLines: SourceLine[], opts: AssembleOptions): LayoutResult {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const lines = parseLines(sourceLines, errors);
  const symbols = new Map<string, number>();
  const negativeSymbols = new Map<string, number>();
  const definitions = new Map<string, SymbolDef>();
  seedDefines(opts.defines ?? {}, symbols, definitions);
  const cwd = resolve(opts.cwd ?? process.cwd());
  const includePaths = normalizeIncludePaths(opts.includePaths ?? [], cwd);
  const sandbox = opts.sandbox ?? false;
  const roots = sandboxRoots(cwd, includePaths);
  const seen = new Set<string>(symbols.keys());
  // How each source symbol is defined (collected in pass 0): a code label, an EQU
  // constant, or a DEFL/`=` variable. A name used for both a label and a constant
  // used to resolve silently to whichever definition the emit pass saw last.
  const definedAs = new Map<string, 'label' | 'EQU' | 'DEFL'>();
  const apiDefines = apiDefineValues(opts.defines ?? {});
  const sourceDefineSymbols = new Set<string>();
  // The output origin is the first ORG's address, recomputed every pass: an ORG whose
  // expression is a forward reference (`ORG BASE` before `BASE EQU 0x8000`) evaluates
  // to the placeholder 0 in pass 0 and must not freeze the origin there.
  let origin = 0;
  let hasOrg = false;
  let pc = 0;
  let previousSymbols: Map<string, number> | undefined;
  let previousOrigin: number | undefined;

  for (let pass = 0; pass < LAYOUT_PASSES; pass++) {
    const finalPass = pass === LAYOUT_PASSES - 1;
    for (const name of sourceDefineSymbols) {
      symbols.delete(name);
      negativeSymbols.delete(name);
    }
    sourceDefineSymbols.clear();
    for (const [name, value] of apiDefines) setDefineValue(symbols, negativeSymbols, name, value);
    const activeDefineSymbols = new Set(apiDefines.keys());
    // Lines before the first ORG are laid out at the origin (found by the previous pass).
    pc = hasOrg ? origin : 0;
    let passOrigin: number | undefined;
    // Final pass: the first value of each EQU constant, to catch a redefinition.
    const equValues = new Map<string, number>();
    let currentGlobal = '';
    for (const line of lines) {
      currentGlobal = line.globalScope;
      if (line.labelKey && !line.equ) {
        if (pass === 0) {
          const previous = definedAs.get(line.labelKey);
          if (previous === 'EQU' || previous === 'DEFL') {
            errors.push(diag(line.loc, duplicateSymbolMessage(line.labelKey, previous)));
          } else if (seen.has(line.labelKey)) {
            errors.push(diag(line.loc, `Duplicate label: ${line.labelKey}`));
          }
          if (!previous) definedAs.set(line.labelKey, 'label');
        }
        seen.add(line.labelKey);
        symbols.set(line.labelKey, pc & 0xffff);
        negativeSymbols.delete(line.labelKey);
        if (!definitions.has(line.labelKey)) {
          definitions.set(line.labelKey, {
            name: line.labelKey,
            value: pc & 0xffff,
            kind: 'F',
            file: line.loc.file,
            line: line.loc.line,
          });
        } else {
          const def = definitions.get(line.labelKey)!;
          def.value = pc & 0xffff;
        }
      }
      if (!line.op) continue;

      const ctx: EvalContext = {
        symbols,
        negativeSymbols,
        currentGlobal,
        moduleScope: line.moduleScope,
        pc,
        cwd,
        includePaths,
        diagnostics: finalPass ? errors : [],
        warnings: finalPass ? warnings : [],
        loc: line.loc,
        strict: finalPass,
        sandbox,
        roots,
      };

      if (line.equ && line.labelKey) {
        const kind = line.op === 'EQU' ? 'EQU' : 'DEFL';
        if (pass === 0) {
          const previous = definedAs.get(line.labelKey);
          if (previous === 'label') errors.push(diag(line.loc, duplicateSymbolMessage(line.labelKey, kind)));
          else if (previous !== 'EQU') definedAs.set(line.labelKey, kind);
        }
        const raw = evalExpr(line.args, ctx);
        const value = raw ?? 0;
        // EQU defines a constant: every definition of an EQU symbol must agree (an
        // included header defining the same EQU twice is fine). DEFL and `=` stay
        // reassignable.
        if (finalPass && raw !== undefined && definedAs.get(line.labelKey) === 'EQU') {
          const first = equValues.get(line.labelKey);
          if (first === undefined) {
            equValues.set(line.labelKey, value & 0xffff);
          } else if (first !== (value & 0xffff)) {
            errors.push(
              diag(
                line.loc,
                `EQU ${line.labelKey} redefined with a different value (${hex16(first)}, then ${hex16(value & 0xffff)}); use DEFL or = for a symbol that changes`
              )
            );
          }
        }
        symbols.set(line.labelKey, value & 0xffff);
        recordSignedValue(ctx, line.labelKey, line.args);
        if (!definitions.has(line.labelKey)) {
          definitions.set(line.labelKey, {
            name: line.labelKey,
            value: value & 0xffff,
            kind: 'D',
            file: line.loc.file,
            line: line.loc.line,
          });
        } else {
          definitions.get(line.labelKey)!.value = value & 0xffff;
        }
        continue;
      }

      if (line.op === 'DEFINE' || line.op === 'UNDEFINE') {
        applyLayoutDefine(line.op, line.args, ctx, sourceDefineSymbols, activeDefineSymbols);
        continue;
      }

      if (isDirective(line.op)) {
        const nextPc = layoutDirective(line.op, line.args, ctx);
        if (line.op === 'ORG' && passOrigin === undefined) passOrigin = nextPc;
        pc = nextPc;
      } else {
        const out = encodeInstruction(line.op, line.args, { ...ctx, strict: false });
        if (out) pc += out.length;
      }
    }
    origin = passOrigin ?? 0;
    hasOrg = passOrigin !== undefined;
    if (
      finalPass &&
      previousSymbols &&
      (!sameSymbolValues(previousSymbols, symbols) || previousOrigin !== origin)
    ) {
      errors.push(diag(lines[0]?.loc ?? sourceLines[0] ?? { file: MEMORY_FILE, line: 1, text: '' }, 'Layout did not converge after 5 passes'));
    }
    previousSymbols = new Map(symbols);
    previousOrigin = origin;
  }

  return {
    origin,
    pc,
    symbols,
    negativeSymbols,
    definitions,
    lines,
    errors: uniqueDiagnostics(errors),
    warnings,
  };
}

/** Number of layout passes; the last one is strict and reports diagnostics. */
const LAYOUT_PASSES = 5;

function duplicateSymbolMessage(name: string, kind: 'EQU' | 'DEFL'): string {
  return kind === 'EQU'
    ? `Duplicate symbol: ${name} is both a code label and an EQU constant`
    : `Duplicate symbol: ${name} is both a code label and a DEFL/= variable`;
}

/** `0x8000` for diagnostics; negative values (an `ORG -1`) keep their sign. */
function hex16(value: number): string {
  const digits = Math.abs(value).toString(16).toUpperCase().padStart(4, '0');
  return value < 0 ? `-0x${digits}` : `0x${digits}`;
}

interface ApiDefine {
  /** The value as expressions read it (before the 16-bit masking of the symbol table). */
  value: number;
  /** The signed view (see readsAsNegativeByte): `-D X=1==1` is -1 here, 0xFFFF above. */
  signed: number;
}

/** The API/CLI defines, by name. */
function apiDefineValues(defines: Record<string, string | number | boolean>): Map<string, ApiDefine> {
  return new Map(
    Object.entries(defines).map(([name, raw]) => [name, { value: defineValue(raw), signed: defineValue(raw, true) }])
  );
}

/** Stores a define's value: 16-bit in `symbols`, a negative signed view in `negativeSymbols`. */
function setDefineValue(
  symbols: Map<string, number>,
  negativeSymbols: Map<string, number>,
  name: string,
  define: ApiDefine
): void {
  symbols.set(name, define.value & 0xffff);
  if (define.signed < 0) negativeSymbols.set(name, define.signed);
  else negativeSymbols.delete(name);
}

/** A source line split into its optional label and the rest (the operation and arguments). */
interface LineHead {
  label: string | undefined;
  /** The label is defined by EQU, DEFL or `=`; `rest` is then `EQU expr` / `DEFL expr`. */
  equ: boolean;
  rest: string;
}

/**
 * Splits off a line's label: `name:` (any indentation), a column-0 `name` that is not an
 * instruction or directive, or the constant forms `name EQU`, `name DEFL`, `name = ...`
 * (each also accepted after `name:`). Shared by layout (parseLines) and source loading,
 * so both recognize the same labels.
 */
function splitLineHead(cleaned: string, hasLeadingWhitespace: boolean): LineHead {
  const colon = cleaned.match(/^([A-Za-z_.][A-Za-z0-9_.]*)\s*:\s*(.*)$/);
  if (colon) {
    const rest = colon[2]!.trim();
    // `FOO: EQU 5` / `FOO: DEFL 7` / `FOO: = 3` define a constant, exactly like the
    // colon-less forms below; without this the label silently took the PC.
    const equAfterColon = rest.match(/^(EQU|DEFL)\b\s*(.*)$/i);
    if (equAfterColon) {
      return { label: colon[1]!, equ: true, rest: `${equAfterColon[1]!.toUpperCase()} ${equAfterColon[2]!.trim()}`.trim() };
    }
    const assignAfterColon = rest.match(/^=\s*(.*)$/);
    if (assignAfterColon) return { label: colon[1]!, equ: true, rest: `DEFL ${assignAfterColon[1]!.trim()}`.trim() };
    return { label: colon[1]!, equ: false, rest };
  }
  const equMatch = cleaned.match(/^([A-Za-z_.][A-Za-z0-9_.]*)\s+(EQU|DEFL)\b\s*(.*)$/i);
  if (equMatch) {
    return { label: equMatch[1]!, equ: true, rest: `${equMatch[2]!.toUpperCase()} ${equMatch[3]!.trim()}`.trim() };
  }
  const assignMatch = cleaned.match(/^([A-Za-z_.][A-Za-z0-9_.]*)\s*=\s*(.*)$/);
  if (assignMatch) return { label: assignMatch[1]!, equ: true, rest: `DEFL ${assignMatch[2]!.trim()}`.trim() };
  if (!hasLeadingWhitespace) {
    const labelMatch = cleaned.match(/^([A-Za-z_.][A-Za-z0-9_.]*)(?:\s+(.*))?$/);
    const head = labelMatch?.[1]?.toUpperCase();
    if (labelMatch && (!isKnownOperation(head!) || isIndentSensitiveDirective(head!))) {
      return { label: labelMatch[1]!, equ: false, rest: (labelMatch[2] ?? '').trim() };
    }
  }
  return { label: undefined, equ: false, rest: cleaned };
}

function parseLines(sourceLines: SourceLine[], errors: Diagnostic[]): ParsedLine[] {
  const out: ParsedLine[] = [];
  let currentGlobal = '';
  for (const loc of sourceLines) {
    const moduleScope = loc.moduleScope ?? '';
    const cleaned = stripComment(loc.text).trim();
    if (!cleaned) {
      out.push({ loc, args: '', globalScope: currentGlobal, moduleScope });
      continue;
    }

    const hasLeadingWhitespace = /^\s/.test(stripComment(loc.text));
    const { label, equ, rest } = splitLineHead(cleaned, hasLeadingWhitespace);
    const labelKey = label === undefined ? undefined : qualifyLabel(label, currentGlobal, moduleScope);
    // A code label (not a constant) opens the scope of the dotted local labels after it.
    if (labelKey !== undefined && !equ && !label!.startsWith('.')) currentGlobal = labelKey;

    if (!rest) {
      out.push({ loc, label, labelKey, args: '', globalScope: currentGlobal, moduleScope });
      continue;
    }
    const match = rest.match(/^([A-Za-z_.][A-Za-z0-9_.]*)(?:\s+(.*))?$/);
    if (!match) {
      errors.push(diag(loc, `Cannot parse line: ${cleaned}`));
      out.push({ loc, label, labelKey, args: '', globalScope: currentGlobal, moduleScope });
      continue;
    }
    const op = match[1]!.toUpperCase();
    const args = (match[2] ?? '').trim();
    out.push({ loc, label, labelKey, op, args, equ, globalScope: currentGlobal, moduleScope });
  }
  return out;
}

function loadSourceFile(file: string, ctx: LoadContext): SourceLine[] {
  const abs = resolve(file);
  if (!existsSync(abs)) {
    ctx.diagnostics.push({
      file: abs,
      line: 1,
      severity: 'error',
      message: `File not found: ${abs}`,
    });
    return [];
  }
  if (ctx.active.has(abs)) {
    ctx.diagnostics.push({
      file: abs,
      line: 1,
      severity: 'error',
      message: `Recursive INCLUDE detected: ${abs}`,
    });
    return [];
  }
  ctx.active.add(abs);
  const text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = text.split('\n');
  const sourceLines = rawLines.map((text, i) => ({ file: abs, line: i + 1, text }));
  const out = processSourceLines(sourceLines, ctx);
  ctx.active.delete(abs);
  return out;
}

function processSourceLines(sourceLines: SourceLine[], ctx: LoadContext): SourceLine[] {
  const out: SourceLine[] = [];
  for (let i = 0; i < sourceLines.length; i++) {
    if (ctx.terminated) break;
    const line = sourceLines[i]!;
    const cleaned = stripComment(line.text).trim();
    const hasLeadingWhitespace = /^\s/.test(stripComment(line.text));
    const conditional = parseConditional(cleaned);
    if (conditional) {
      applyConditional(line, conditional, ctx);
      continue;
    }
    if (!conditionsActive(ctx)) continue;
    if (parseEndDirective(cleaned, hasLeadingWhitespace)) {
      ctx.terminated = true;
      out.push(withCurrentModuleScope(line, ctx));
      break;
    }
    const moduleDirective = parseModuleDirective(cleaned);
    if (moduleDirective) {
      applyModuleDirective(line, moduleDirective, ctx);
      continue;
    }
    const repeat = parseRepeat(cleaned);
    if (repeat) {
      const block = collectRepeatBlock(sourceLines, i, ctx);
      if (!block) return out;
      out.push(...expandRepeat(line, repeat, block.body, ctx));
      i = block.endIndex;
      continue;
    }
    if (parseRepeatEnd(cleaned)) {
      ctx.diagnostics.push(diag(line, `${cleaned.split(/\s+/, 1)[0]!.toUpperCase()} without DUP/REPT`));
      continue;
    }
    const macro = parseMacroDefinition(cleaned, hasLeadingWhitespace);
    if (macro) {
      if ('error' in macro) {
        ctx.diagnostics.push(diag(line, macro.error));
        continue;
      }
      const block = collectMacroBlock(sourceLines, i, ctx);
      if (!block) return out;
      defineMacro(line, macro, block.body, ctx);
      i = block.endIndex;
      continue;
    }
    if (parseMacroEnd(cleaned)) {
      ctx.diagnostics.push(diag(line, 'ENDM without MACRO'));
      continue;
    }
    const invocation = parseMacroInvocation(cleaned, ctx);
    if (invocation) {
      out.push(...expandMacro(line, invocation.macro, invocation.args, ctx));
      continue;
    }
    const define = parseDefineDirective(cleaned, hasLeadingWhitespace);
    if (define) {
      if ('error' in define) {
        ctx.diagnostics.push(diag(line, define.error));
      } else {
        applySourceDefine(line, define, ctx);
        out.push(withCurrentModuleScope(line, ctx));
      }
      continue;
    }
    // `here: M 7` / `here INCLUDE "x.asm"`: a label in front of a macro call or an
    // INCLUDE is defined at the current address, then the rest is expanded / included.
    // These used to fail as "Unsupported instruction: M 7" or skip the INCLUDE silently.
    const head = splitLineHead(cleaned, hasLeadingWhitespace);
    if (head.label !== undefined && !head.equ && head.rest) {
      const labelledCall = parseMacroInvocation(head.rest, ctx);
      const labelledInclude = labelledCall ? null : head.rest.match(/^INCLUDE\s+(.+)$/i);
      if (labelledCall || labelledInclude) {
        const labelLine = withCurrentModuleScope({ ...line, text: `${head.label}:` }, ctx);
        out.push(labelLine);
        noteLoadTimeSymbol(labelLine, ctx);
        if (labelledCall) out.push(...expandMacro(line, labelledCall.macro, labelledCall.args, ctx));
        else includeSource(line, labelledInclude![1]!.trim(), ctx, out);
        continue;
      }
    }
    const inc = cleaned.match(/^INCLUDE\s+(.+)$/i);
    if (inc) {
      includeSource(line, inc[1]!.trim(), ctx, out);
    } else {
      const scoped = withCurrentModuleScope(line, ctx);
      out.push(scoped);
      noteLoadTimeSymbol(scoped, ctx);
    }
  }
  return out;
}

function includeSource(line: SourceLine, targetText: string, ctx: LoadContext, out: SourceLine[]): void {
  const target = parseIncludeTarget(targetText);
  if (!target) {
    ctx.diagnostics.push(diag(line, `Invalid INCLUDE target: ${targetText}`));
    return;
  }
  const resolved = resolveIncludeFile(line, target, ctx);
  if (resolved) for (const included of loadSourceFile(resolved, ctx)) out.push(included);
}

function parseModuleDirective(cleaned: string): { op: 'MODULE' | 'ENDMODULE'; args: string } | undefined {
  const match = cleaned.match(/^(MODULE|ENDMODULE)\b\s*(.*)$/i);
  if (!match) return undefined;
  return { op: match[1]!.toUpperCase() as 'MODULE' | 'ENDMODULE', args: match[2]!.trim() };
}

function applyModuleDirective(
  loc: SourceLine,
  directive: { op: 'MODULE' | 'ENDMODULE'; args: string },
  ctx: LoadContext
): void {
  if (directive.op === 'MODULE') {
    if (!directive.args) {
      ctx.diagnostics.push(diag(loc, 'MODULE expects a name'));
      return;
    }
    if (directive.args.includes('.')) {
      ctx.diagnostics.push(diag(loc, `Dots are not allowed in MODULE names: ${directive.args}`));
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(directive.args)) {
      ctx.diagnostics.push(diag(loc, `Invalid MODULE name: ${directive.args}`));
      return;
    }
    const parent = currentModuleScope(ctx);
    const scope = parent ? `${parent}.${directive.args}` : directive.args;
    ctx.modules.push({ name: directive.args, scope, loc });
    return;
  }

  if (directive.args) {
    ctx.diagnostics.push(diag(loc, `ENDMODULE does not accept arguments: ${directive.args}`));
  }
  if (!ctx.modules.pop()) ctx.diagnostics.push(diag(loc, 'ENDMODULE without MODULE'));
}

function currentModuleScope(ctx: LoadContext): string {
  return ctx.modules[ctx.modules.length - 1]?.scope ?? '';
}

function withCurrentModuleScope(line: SourceLine, ctx: LoadContext): SourceLine {
  const moduleScope = currentModuleScope(ctx);
  return moduleScope ? { ...line, moduleScope } : line;
}

function parseEndDirective(cleaned: string, hasLeadingWhitespace: boolean): boolean {
  // An indented `END` (but not an indented label named `end:`).
  if (hasLeadingWhitespace && /^END\b(?!\s*:)/i.test(cleaned)) return true;
  if (/^[A-Za-z_.][A-Za-z0-9_.]*:\s*END\b/i.test(cleaned)) return true;
  // `stop END`: a column-0 label followed by END. Like parseLines, a first word that
  // is an instruction or directive is not a label, so `call end`, `jp end` and
  // `dw end` reference a label named `end` instead of silently ending the source.
  const labelled = cleaned.match(/^([A-Za-z_.][A-Za-z0-9_.]*)\s+END\b/i);
  return labelled !== null && !hasLeadingWhitespace && !isKnownOperation(labelled[1]!.toUpperCase());
}

function parseRepeat(cleaned: string): RepeatDirective | undefined {
  const match = cleaned.match(/^(DUP|REPT)\b\s*(.*)$/i);
  if (!match) return undefined;
  return { op: match[1]!.toUpperCase() as 'DUP' | 'REPT', args: match[2]!.trim() };
}

function parseRepeatEnd(cleaned: string): boolean {
  return /^(EDUP|ENDR|ENDW)\b/i.test(cleaned);
}

function collectRepeatBlock(
  sourceLines: SourceLine[],
  startIndex: number,
  ctx: LoadContext
): { body: SourceLine[]; endIndex: number } | undefined {
  let depth = 0;
  const body: SourceLine[] = [];
  for (let i = startIndex + 1; i < sourceLines.length; i++) {
    const line = sourceLines[i]!;
    const cleaned = stripComment(line.text).trim();
    if (parseRepeat(cleaned)) {
      depth++;
      body.push(line);
      continue;
    }
    if (parseRepeatEnd(cleaned)) {
      if (depth === 0) return { body, endIndex: i };
      depth--;
      body.push(line);
      continue;
    }
    body.push(line);
  }
  ctx.diagnostics.push(diag(sourceLines[startIndex]!, 'Unclosed repeat block'));
  return undefined;
}

function expandRepeat(
  loc: SourceLine,
  repeat: RepeatDirective,
  body: SourceLine[],
  ctx: LoadContext
): SourceLine[] {
  const parts = splitArgs(repeat.args);
  if (parts.length === 0) {
    ctx.diagnostics.push(diag(loc, `${repeat.op} expects a repeat count`));
    return [];
  }
  if (parts.length > 2) {
    ctx.diagnostics.push(diag(loc, `${repeat.op} expects 1 or 2 argument(s), got ${parts.length}`));
    return [];
  }
  const count = repeatCount(loc, repeat.op, parts[0]!, ctx);
  if (count === undefined) return [];
  const counter = parts[1]?.trim();
  if (counter !== undefined && !/^[A-Za-z_.][A-Za-z0-9_.]*$/.test(counter)) {
    ctx.diagnostics.push(diag(loc, `${repeat.op} counter must be a symbol name: ${counter}`));
    return [];
  }
  const previousCounter = counter ? ctx.symbols.get(counter) : undefined;
  const hadCounter = counter ? ctx.symbols.has(counter) : false;
  const expanded: SourceLine[] = [];
  for (let i = 0; i < count; i++) {
    if (counter) ctx.symbols.set(counter, i);
    const iterationBody = counter ? body.map((line) => substituteRepeatCounter(line, counter, i)) : body;
    expanded.push(...processSourceLines(iterationBody, ctx));
  }
  if (counter) {
    if (hadCounter) ctx.symbols.set(counter, previousCounter!);
    else ctx.symbols.delete(counter);
  }
  return expanded;
}

function repeatCount(loc: SourceLine, op: string, expr: string, ctx: LoadContext): number | undefined {
  const value = evalExpr(expr, loadEvalContext(loc, ctx, op, ctx.diagnostics, true));
  if (value === undefined) return undefined;
  if (value < 0) {
    ctx.diagnostics.push(diag(loc, `${op} repeat count must be positive or zero: ${expr}`));
    return undefined;
  }
  const count = Math.trunc(value);
  if (count > MAX_REPEAT_COUNT) {
    ctx.diagnostics.push(
      diag(loc, `${op} repeat count too large: ${count} (max ${MAX_REPEAT_COUNT})`)
    );
    return undefined;
  }
  return count;
}

/** Upper bound on REPT/DUP iterations — far above any legitimate program (the
 * address space is 64KB) but low enough to prevent runaway memory growth. */
const MAX_REPEAT_COUNT = 1 << 20;

function substituteRepeatCounter(line: SourceLine, counter: string, value: number): SourceLine {
  return { ...line, text: replaceIdentifierOutsideStrings(line.text, counter, String(value)) };
}

function replaceIdentifierOutsideStrings(text: string, name: string, replacement: string): string {
  let out = '';
  let quote: string | undefined;
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (quote) {
      out += ch;
      if (ch === '\\') {
        if (i + 1 < text.length) out += text[++i]!;
      } else if (ch === quote) {
        quote = undefined;
      }
      i++;
      continue;
    }
    if (ch === ';') {
      out += text.slice(i);
      break;
    }
    if (opensQuote(text, i)) {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (isIdentStart(ch)) {
      let end = i + 1;
      while (end < text.length && isIdentPart(text[end]!)) end++;
      const id = text.slice(i, end);
      out += id === name ? replacement : id;
      i = end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_.]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_.]/.test(ch);
}

/**
 * Whether the quote at `text[i]` opens a string literal. The `'` of a shadow register
 * (`AF'`) follows an identifier character and does not; treating it as a quote made
 * `ex af,af' ; comment` keep its comment as part of the operand.
 */
function opensQuote(text: string, i: number): boolean {
  const ch = text[i];
  if (ch === '"') return true;
  return ch === "'" && (i === 0 || !isIdentPart(text[i - 1]!));
}

function parseMacroDefinition(cleaned: string, hasLeadingWhitespace: boolean): MacroDefinitionParse | undefined {
  const infix = cleaned.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s+MACRO\b\s*(.*)$/i);
  if (infix) return { name: infix[1]!, params: parseMacroParams(infix[2]!.trim()) };

  if (!hasLeadingWhitespace || !/^MACRO\b/i.test(cleaned)) return undefined;
  const rest = cleaned.replace(/^MACRO\b/i, '').trim();
  if (!rest) return { error: 'MACRO expects a name' };
  const prefix = rest.match(/^([A-Za-z_][A-Za-z0-9_.]*)(?:\s+(.*))?$/);
  if (!prefix) return { error: `Invalid macro name: ${rest}` };
  return { name: prefix[1]!, params: parseMacroParams(prefix[2]?.trim() ?? '') };
}

function parseMacroParams(text: string): string[] {
  if (!text) return [];
  const parts = text.includes(',') ? splitArgs(text) : text.split(/\s+/).filter(Boolean);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseMacroEnd(cleaned: string): boolean {
  return /^ENDM\b/i.test(cleaned);
}

type DefineDirectiveParse =
  | { op: 'DEFINE'; name: string; expr: string | undefined }
  | { op: 'UNDEFINE'; name: string }
  | { error: string };

function parseDefineDirective(cleaned: string, hasLeadingWhitespace: boolean): DefineDirectiveParse | undefined {
  if (!hasLeadingWhitespace) return undefined;
  const match = cleaned.match(/^(DEFINE|UNDEFINE)\b\s*(.*)$/i);
  if (!match) return undefined;
  const op = match[1]!.toUpperCase() as 'DEFINE' | 'UNDEFINE';
  const rest = match[2]!.trim();
  if (!rest) return { error: `${op} expects a name` };
  if (op === 'UNDEFINE') {
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(rest)) return { error: `Invalid UNDEFINE name: ${rest}` };
    return { op, name: rest };
  }
  const parts = rest.match(/^([A-Za-z_][A-Za-z0-9_.]*)(?:\s+(.+))?$/);
  if (!parts) return { error: `Invalid DEFINE syntax: ${rest}` };
  return { op, name: parts[1]!, expr: parts[2]?.trim() };
}

function applySourceDefine(
  loc: SourceLine,
  define: Exclude<DefineDirectiveParse, { error: string }>,
  ctx: LoadContext
): void {
  if (define.op === 'UNDEFINE') {
    ctx.defineNames.delete(define.name);
    if (ctx.defineValueNames.delete(define.name)) ctx.symbols.delete(define.name);
    ctx.layoutSymbols.delete(define.name);
    return;
  }

  if (ctx.defineNames.has(define.name)) {
    ctx.diagnostics.push(diag(loc, `Duplicate DEFINE: ${define.name}`));
  }
  ctx.defineNames.add(define.name);
  if (!define.expr) {
    if (ctx.defineValueNames.delete(define.name)) ctx.symbols.delete(define.name);
    ctx.layoutSymbols.delete(define.name);
    return;
  }

  // A value computed from `$` or code labels only exists during layout (where
  // applyLayoutDefine evaluates it at the DEFINE's address); while loading it is
  // unknown, not 0, so an IF reading it is reported rather than silently false.
  const probe = new ExprParser(define.expr, loadEvalContext(loc, ctx, 'DEFINE', [], false));
  probe.parse();
  if (probe.layoutUses.length > 0) {
    if (ctx.defineValueNames.delete(define.name)) ctx.symbols.delete(define.name);
    ctx.layoutSymbols.add(define.name);
    return;
  }
  const value = evalExpr(define.expr, loadEvalContext(loc, ctx, 'DEFINE', ctx.diagnostics, true));
  if (value === undefined) return;
  ctx.symbols.set(define.name, value & 0xffff);
  ctx.layoutSymbols.delete(define.name);
  ctx.defineValueNames.add(define.name);
}

function applyLayoutDefine(
  op: 'DEFINE' | 'UNDEFINE',
  args: string,
  ctx: EvalContext,
  sourceDefineSymbols: Set<string>,
  activeDefineSymbols: Set<string>
): void {
  const trimmed = args.trim();
  if (!trimmed) {
    fail(ctx, `${op} expects a name`);
    return;
  }

  if (op === 'UNDEFINE') {
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(trimmed)) {
      fail(ctx, `Invalid UNDEFINE name: ${trimmed}`);
      return;
    }
    if (activeDefineSymbols.delete(trimmed)) {
      sourceDefineSymbols.delete(trimmed);
      ctx.symbols.delete(trimmed);
      ctx.negativeSymbols?.delete(trimmed);
    }
    return;
  }

  const parts = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.]*)(?:\s+(.+))?$/);
  if (!parts) {
    fail(ctx, `Invalid DEFINE syntax: ${trimmed}`);
    return;
  }

  const name = parts[1]!;
  const expr = parts[2]?.trim();
  if (activeDefineSymbols.has(name)) fail(ctx, `Duplicate DEFINE: ${name}`);
  activeDefineSymbols.add(name);

  if (!expr) {
    sourceDefineSymbols.delete(name);
    ctx.symbols.delete(name);
    ctx.negativeSymbols?.delete(name);
    return;
  }

  const value = evalExpr(expr, ctx);
  if (value === undefined) return;
  ctx.symbols.set(name, value & 0xffff);
  // `DEFINE NEG -1` must stay usable in an 8-bit slot, like `NEG EQU -1`.
  recordSignedValue(ctx, name, expr);
  sourceDefineSymbols.add(name);
}

function collectMacroBlock(
  sourceLines: SourceLine[],
  startIndex: number,
  ctx: LoadContext
): { body: SourceLine[]; endIndex: number } | undefined {
  const body: SourceLine[] = [];
  for (let i = startIndex + 1; i < sourceLines.length; i++) {
    const line = sourceLines[i]!;
    const cleaned = stripComment(line.text).trim();
    if (parseMacroEnd(cleaned)) return { body, endIndex: i };
    body.push(line);
  }
  ctx.diagnostics.push(diag(sourceLines[startIndex]!, 'Unclosed MACRO block'));
  return undefined;
}

function defineMacro(
  loc: SourceLine,
  macro: { name: string; params: string[] },
  body: SourceLine[],
  ctx: LoadContext
): void {
  const key = macro.name.toUpperCase();
  if (ctx.macros.has(key)) {
    ctx.diagnostics.push(diag(loc, `Duplicate macro: ${macro.name}`));
    return;
  }
  for (const param of macro.params) {
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(param)) {
      ctx.diagnostics.push(diag(loc, `Invalid macro parameter: ${param}`));
      return;
    }
  }
  ctx.macros.set(key, {
    name: macro.name,
    params: macro.params,
    body,
    loc,
  });
}

function parseMacroInvocation(
  cleaned: string,
  ctx: LoadContext
): { macro: MacroDef; args: string[] } | undefined {
  const match = cleaned.match(/^([A-Za-z_][A-Za-z0-9_.]*)(?:\s+(.*))?$/);
  if (!match) return undefined;
  const macro = ctx.macros.get(match[1]!.toUpperCase());
  if (!macro) return undefined;
  return { macro, args: splitArgs(match[2] ?? '') };
}

function expandMacro(
  loc: SourceLine,
  macro: MacroDef,
  args: string[],
  ctx: LoadContext
): SourceLine[] {
  if (ctx.expansionDepth >= 32) {
    ctx.diagnostics.push(diag(loc, `Macro expansion too deep: ${macro.name}`));
    return [];
  }
  // Too few arguments used to expand the missing parameters to empty text silently.
  if (args.length !== macro.params.length) {
    ctx.diagnostics.push(diag(loc, `Macro ${macro.name} expects ${macro.params.length} argument(s), got ${args.length}`));
    return [];
  }
  const argMap = new Map<string, string>();
  for (let i = 0; i < macro.params.length; i++) argMap.set(macro.params[i]!, args[i] ?? '');
  const localMap = macroLocalLabelMap(macro.body, ++ctx.macroSerial);
  // Diagnostics on expanded lines keep the body's file:line and name the call site.
  const macroStack: MacroCall[] = [{ name: macro.name, file: loc.file, line: loc.line }, ...(loc.macroStack ?? [])];
  const expanded = macro.body.map((line) => ({ ...expandMacroLine(line, argMap, localMap), macroStack }));
  ctx.expansionDepth++;
  const out = processSourceLines(expanded, ctx);
  ctx.expansionDepth--;
  return out;
}

function macroLocalLabelMap(body: SourceLine[], serial: number): Map<string, string> {
  const labels = new Set<string>();
  for (const line of body) {
    for (const id of identifiersOutsideStrings(line.text)) {
      if (id.startsWith('.') && /^\.?[A-Za-z_][A-Za-z0-9_.]*$/.test(id)) labels.add(id);
    }
  }
  const map = new Map<string, string>();
  for (const label of labels) map.set(label, `.__macro${serial}_${label.slice(1).replace(/\./g, '_')}`);
  return map;
}

function expandMacroLine(
  line: SourceLine,
  args: Map<string, string>,
  localLabels: Map<string, string>
): SourceLine {
  let text = line.text;
  for (const [from, to] of localLabels) text = replaceIdentifierOutsideStrings(text, from, to);
  for (const [from, to] of args) text = replaceIdentifierOutsideStrings(text, from, to);
  return { ...line, text };
}

function identifiersOutsideStrings(text: string): string[] {
  const out: string[] = [];
  let quote: string | undefined;
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i += 2;
      else {
        if (ch === quote) quote = undefined;
        i++;
      }
      continue;
    }
    if (ch === ';') break;
    if (opensQuote(text, i)) {
      quote = ch;
      i++;
      continue;
    }
    if (isIdentStart(ch)) {
      let end = i + 1;
      while (end < text.length && isIdentPart(text[end]!)) end++;
      out.push(text.slice(i, end));
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

function finishConditionals(ctx: LoadContext): void {
  for (const frame of ctx.conditionals) {
    ctx.diagnostics.push(diag(frame.loc, 'Unclosed conditional block'));
  }
  ctx.conditionals.length = 0;
}

function parseIncludeTarget(text: string): IncludeTarget | undefined {
  const quoted = text.match(/^"([^"]+)"$/) ?? text.match(/^'([^']+)'$/);
  if (quoted) return { path: quoted[1]!, searchOnly: false };
  const angled = text.match(/^<([^>]+)>$/);
  if (angled) return { path: angled[1]!, searchOnly: true };
  return undefined;
}

/** The `file` of source lines given to `assemble()` as a string rather than read from disk. */
const MEMORY_FILE = '<memory>';

/** The directory a quoted INCLUDE/INCBIN path is relative to: the including file's, or `cwd` for in-memory source. */
function includeBaseDir(loc: SourceLine, cwd: string): string {
  return loc.file === MEMORY_FILE ? cwd : dirname(loc.file);
}

/** Whether `path` names an existing regular file (an INCLUDE/INCBIN directory is not one). */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function resolveIncludeFile(loc: SourceLine, target: IncludeTarget, ctx: LoadContext): string | undefined {
  const candidates = target.searchOnly ? [] : [resolve(includeBaseDir(loc, ctx.cwd), target.path)];
  candidates.push(...ctx.includePaths.map((dir) => resolve(dir, target.path)));
  let blocked = false;
  for (const candidate of candidates) {
    if (!isFile(candidate)) continue;
    if (ctx.sandbox && !isWithinRoots(candidate, ctx.roots)) {
      blocked = true;
      continue;
    }
    return candidate;
  }
  ctx.diagnostics.push(
    diag(
      loc,
      blocked
        ? `INCLUDE path is outside the sandbox roots: ${target.path}`
        : `INCLUDE file not found: ${target.path}`
    )
  );
  return undefined;
}

function normalizeIncludePaths(paths: string[], cwd: string): string[] {
  return paths.map((path) => resolve(cwd, path));
}

/** Allowed read roots in sandbox mode: the working dir plus the include paths. */
function sandboxRoots(cwd: string, includePaths: string[]): string[] {
  return [resolve(cwd), ...includePaths.map((p) => resolve(p))];
}

/**
 * Whether `candidate` lies inside one of the sandbox roots. Both sides are compared as
 * real paths (symlinks and junctions resolved, so a link inside the project cannot
 * reach outside it) and, on Windows, case-insensitively (a `d:\` cwd against a `D:\`
 * include used to be "outside the sandbox"). A lexical startsWith check did neither.
 */
function isWithinRoots(candidate: string, roots: string[]): boolean {
  const target = comparablePath(candidate);
  return roots.some((root) => {
    const rel = relative(comparablePath(root), target);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  });
}

function comparablePath(path: string): string {
  let real = resolve(path);
  try {
    real = realpathSync.native(real);
  } catch {
    // A path that does not exist (yet) is compared lexically.
  }
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

function makeLoadContext(opts: AssembleOptions, cwd: string, diagnostics: Diagnostic[]): LoadContext {
  const symbols = new Map<string, number>();
  const definitions = new Map<string, SymbolDef>();
  seedDefines(opts.defines ?? {}, symbols, definitions);
  const includePaths = normalizeIncludePaths(opts.includePaths ?? [], cwd);
  return {
    cwd,
    includePaths,
    diagnostics,
    active: new Set(),
    symbols,
    layoutSymbols: new Set(),
    defineNames: new Set(Object.keys(opts.defines ?? {})),
    defineValueNames: new Set(Object.keys(opts.defines ?? {})),
    conditionals: [],
    macros: new Map(),
    macroSerial: 0,
    expansionDepth: 0,
    modules: [],
    terminated: false,
    sandbox: opts.sandbox ?? false,
    roots: sandboxRoots(cwd, includePaths),
  };
}

function conditionsActive(ctx: LoadContext): boolean {
  return ctx.conditionals.every((frame) => frame.active);
}

function parseConditional(cleaned: string): { op: string; args: string } | undefined {
  const match = cleaned.match(/^(IF|IFDEF|IFNDEF|ELSEIF|ELIF|ELSE|ENDIF)\b\s*(.*)$/i);
  if (!match) return undefined;
  return { op: match[1]!.toUpperCase(), args: match[2]!.trim() };
}

function applyConditional(
  loc: SourceLine,
  directive: { op: string; args: string },
  ctx: LoadContext
): void {
  switch (directive.op) {
    case 'IF':
    case 'IFDEF':
    case 'IFNDEF': {
      const parentActive = conditionsActive(ctx);
      const condition = parentActive ? evalConditional(directive.op, directive.args, loc, ctx) : false;
      ctx.conditionals.push({
        loc,
        parentActive,
        active: parentActive && condition,
        conditionMatched: parentActive && condition,
        elseSeen: false,
      });
      return;
    }
    case 'ELSEIF':
    case 'ELIF': {
      const frame = ctx.conditionals[ctx.conditionals.length - 1];
      if (!frame) {
        ctx.diagnostics.push(diag(loc, `${directive.op} without IF`));
        return;
      }
      if (frame.elseSeen) {
        ctx.diagnostics.push(diag(loc, `${directive.op} after ELSE`));
        frame.active = false;
        return;
      }
      if (!frame.parentActive || frame.conditionMatched) {
        frame.active = false;
        return;
      }
      const condition = evalConditional(directive.op, directive.args, loc, ctx);
      frame.active = condition;
      frame.conditionMatched = condition;
      return;
    }
    case 'ELSE': {
      const frame = ctx.conditionals[ctx.conditionals.length - 1];
      if (!frame) {
        ctx.diagnostics.push(diag(loc, 'ELSE without IF'));
        return;
      }
      if (frame.elseSeen) {
        ctx.diagnostics.push(diag(loc, 'Duplicate ELSE in conditional block'));
        frame.active = false;
        return;
      }
      frame.active = frame.parentActive && !frame.conditionMatched;
      frame.conditionMatched = true;
      frame.elseSeen = true;
      return;
    }
    case 'ENDIF': {
      if (!ctx.conditionals.pop()) ctx.diagnostics.push(diag(loc, 'ENDIF without IF'));
      return;
    }
  }
}

function evalConditional(op: string, args: string, loc: SourceLine, ctx: LoadContext): boolean {
  if (op === 'IFDEF' || op === 'IFNDEF') {
    const name = args.trim();
    if (!name) {
      ctx.diagnostics.push(diag(loc, `${op} expects a symbol name`));
      return false;
    }
    const defined = ctx.defineNames.has(name);
    return op === 'IFDEF' ? defined : !defined;
  }

  if (!args) {
    ctx.diagnostics.push(diag(loc, `${op} expects an expression`));
    return false;
  }
  const value = evalExpr(args, loadEvalContext(loc, ctx, op, ctx.diagnostics, true));
  return (value ?? 0) !== 0;
}

/**
 * The evaluation context for an expression read while loading source, before layout:
 * only constants are known, and `$` / code labels are reported (EvalContext.beforeLayout).
 */
function loadEvalContext(
  loc: SourceLine,
  ctx: LoadContext,
  directive: string,
  diagnostics: Diagnostic[],
  strict: boolean
): EvalContext {
  return {
    symbols: ctx.symbols,
    currentGlobal: '',
    moduleScope: loc.moduleScope ?? currentModuleScope(ctx),
    pc: 0,
    cwd: ctx.cwd,
    includePaths: ctx.includePaths,
    diagnostics,
    warnings: [],
    loc,
    strict,
    beforeLayout: { directive, layoutSymbols: ctx.layoutSymbols },
  };
}

/**
 * Records what loading knows about the symbol `loc` defines, for the IF/ELSEIF
 * conditions and DUP/REPT counts evaluated before layout. A constant EQU/DEFL/`=` is
 * seeded with its value. A code label, or a constant that cannot be computed yet (it
 * uses `$`, a code label or a later definition), has no value until layout and is
 * remembered so a condition using it gets a precise error. Seeding a partial value
 * (`B+1` read as 1 while B is unknown) used to pick IF branches silently.
 */
function noteLoadTimeSymbol(loc: SourceLine, ctx: LoadContext): void {
  const cleaned = stripComment(loc.text).trim();
  if (!cleaned) return;
  const head = splitLineHead(cleaned, /^\s/.test(stripComment(loc.text)));
  if (head.label === undefined) return;
  const key = qualifyLabel(head.label, '', loc.moduleScope ?? currentModuleScope(ctx));
  if (!head.equ) {
    // Dotted local labels are scoped to a global label only known during layout.
    if (!head.label.startsWith('.')) ctx.layoutSymbols.add(key);
    return;
  }
  const expr = head.rest.replace(/^(EQU|DEFL)\b\s*/i, '');
  const parser = new ExprParser(expr, loadEvalContext(loc, ctx, 'EQU', [], false));
  const value = parser.parse();
  if (parser.layoutUses.length > 0 || parser.missing.length > 0) {
    ctx.symbols.delete(key);
    ctx.layoutSymbols.add(key);
  } else if (value === undefined || parser.syntaxErrors.length > 0) {
    // Malformed: layout reports the expression error itself.
    ctx.symbols.delete(key);
    ctx.layoutSymbols.delete(key);
  } else {
    ctx.symbols.set(key, value & 0xffff);
    ctx.layoutSymbols.delete(key);
  }
}

function seedDefines(
  defines: Record<string, string | number | boolean>,
  symbols: Map<string, number>,
  definitions: Map<string, SymbolDef>
): void {
  for (const [name, raw] of Object.entries(defines)) {
    const value = defineValue(raw);
    symbols.set(name, value & 0xffff);
    definitions.set(name, {
      name,
      value: value & 0xffff,
      kind: 'D',
      file: '<define>',
      line: 1,
    });
  }
}

/** The `file` of diagnostics and symbols that come from API/CLI defines. */
const DEFINE_FILE = '<define>';

/**
 * Value of an API/CLI define: a number, a boolean (1/0), an empty string (`-D NAME`,
 * true = 1) or a numeric expression such as `0x44`, `-5` or `1<<8`. Invalid values
 * are rejected up front by validateDefines.
 */
function defineValue(raw: string | number | boolean, signedView = false): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  const trimmed = raw.trim();
  if (trimmed === '') return 1;
  // Evaluate the full expression (e.g. -5, 1+1, 1<<8) rather than only the
  // first token, which silently collapsed any compound/negative define to 1.
  const ctx = defineEvalContext(trimmed, [], false);
  return (signedView ? evalSignedView(trimmed, ctx) : evalExpr(trimmed, ctx)) ?? 1;
}

function defineEvalContext(text: string, diagnostics: Diagnostic[], strict: boolean): EvalContext {
  return {
    symbols: new Map(),
    currentGlobal: '',
    moduleScope: '',
    pc: 0,
    cwd: process.cwd(),
    includePaths: [],
    diagnostics,
    warnings: [],
    loc: { file: DEFINE_FILE, line: 1, text },
    strict,
    beforeLayout: { directive: 'A define', layoutSymbols: new Set() },
  };
}

/**
 * Rejects API/CLI define values that are not numbers or numeric expressions. `-D
 * MODE=fast` used to become 1 and `-D X=0x` became 0, silently.
 */
function validateDefines(defines: Record<string, string | number | boolean>): Diagnostic[] {
  const errors: Diagnostic[] = [];
  for (const [name, raw] of Object.entries(defines)) {
    const loc = { file: DEFINE_FILE, line: 1, text: `${name}=${String(raw)}` };
    if (typeof raw === 'number') {
      if (!Number.isInteger(raw)) errors.push(diag(loc, `Invalid value for define ${name}: ${raw} is not an integer`));
      continue;
    }
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const diagnostics: Diagnostic[] = [];
    const value = evalExpr(raw.trim(), defineEvalContext(raw.trim(), diagnostics, true));
    if (value === undefined || diagnostics.length > 0) {
      const reason = diagnostics[0]?.message ?? 'not a numeric expression';
      errors.push(diag(loc, `Invalid value for define ${name}: '${raw}' (${reason})`));
    }
  }
  return errors;
}

function isDirective(op: string): boolean {
  return [
    'DEVICE',
    'ORG',
    'EQU',
    'DEFL',
    'DB',
    'DEFB',
    'BYTE',
    'DEFM',
    'DM',
    'DZ',
    'DC',
    'DW',
    'DEFW',
    'WORD',
    'D24',
    'DEFD',
    'DD',
    'DWORD',
    'DS',
    'DEFS',
    'BLOCK',
    'ALIGN',
    'ASSERT',
    'DISPLAY',
    'DEFINE',
    'UNDEFINE',
    'END',
    'INCLUDE',
    'BINARY',
    'INCBIN',
    'INSERT',
    'SAVEBIN',
    'SAVESNA',
  ].includes(op);
}

function isKnownOperation(op: string): boolean {
  return (
    isDirective(op) ||
    NO_ARG_OPS.has(op) ||
    ALU_BASE.has(op) ||
    [
      'LD',
      'INC',
      'DEC',
      'JP',
      'JR',
      'DJNZ',
      'CALL',
      'RET',
      'RST',
      'PUSH',
      'POP',
      'EX',
      'BIT',
      'RES',
      'SET',
      'RLC',
      'RRC',
      'RL',
      'RR',
      'SLA',
      'SRA',
      'SLL',
      'SLI',
      'SRL',
      'IN',
      'OUT',
      'IM',
    ].includes(op)
  );
}

function isIndentSensitiveDirective(op: string): boolean {
  return op === 'DEFINE' || op === 'UNDEFINE' || op === 'END';
}

/** Directives whose arguments are a comma-separated list. */
const LIST_DIRECTIVES = new Set([
  'DB', 'DEFB', 'BYTE', 'DEFM', 'DM', 'DZ', 'DC', 'DW', 'DEFW', 'WORD', 'D24', 'DEFD', 'DD', 'DWORD',
  'DS', 'DEFS', 'BLOCK', 'ALIGN', 'INCBIN', 'BINARY', 'INSERT', 'SAVEBIN', 'ASSERT', 'DISPLAY',
]);

/** The only DEVICE this assembler emulates (ASM-PROD-SRC-SKELETON-001). */
const SUPPORTED_DEVICE = 'ZXSPECTRUM48';

function layoutDirective(op: string, args: string, ctx: EvalContext): number {
  if (LIST_DIRECTIVES.has(op) && hasEmptyArgument(args)) {
    fail(ctx, `${op} has an empty argument: ${args}`);
    return ctx.pc;
  }
  switch (op) {
    case 'DEVICE': {
      // Any other name used to be accepted and still produced 48K metadata.
      const device = args.trim();
      if (!device) fail(ctx, `DEVICE expects a device name (${SUPPORTED_DEVICE})`);
      else if (upper(device) !== SUPPORTED_DEVICE) {
        fail(ctx, `Unsupported DEVICE: ${device} (only ${SUPPORTED_DEVICE} is supported; use sjasmplus for other devices)`);
      }
      return ctx.pc;
    }
    case 'DEFINE':
    case 'UNDEFINE':
    case 'INCLUDE':
      return ctx.pc;
    case 'END':
      if (args) evalExpr(args, ctx);
      return ctx.pc;
    case 'INCBIN':
    case 'BINARY':
    case 'INSERT':
      return ctx.pc + readIncbinBytes(args, ctx, op).length;
    case 'ASSERT':
      checkAssert(args, ctx);
      return ctx.pc;
    case 'DISPLAY':
      displayMessage(args, ctx);
      return ctx.pc;
    case 'SAVEBIN':
      return ctx.pc;
    case 'SAVESNA':
      fail(ctx, 'SAVESNA is not supported by @zx-vibes/asm; use sjasmplus for snapshot output');
      return ctx.pc;
    case 'ORG': {
      const address = evalExpr(args, ctx);
      if (address === undefined) return ctx.pc;
      if (address < 0 || address > 0xffff) fail(ctx, `ORG address out of range: ${args}`);
      return address;
    }
    case 'DB':
    case 'DEFB':
    case 'BYTE':
    case 'DEFM':
    case 'DM':
      return ctx.pc + dbValues(args, ctx, op).length;
    case 'DZ':
      return ctx.pc + dzValues(args, ctx).length;
    case 'DC':
      return ctx.pc + dcValues(args, ctx).length;
    case 'DW':
    case 'DEFW':
    case 'WORD':
      return ctx.pc + fixedWidthValues(args, 2, ctx, op).length;
    case 'D24':
      return ctx.pc + fixedWidthValues(args, 3, ctx, op).length;
    case 'DEFD':
    case 'DD':
    case 'DWORD':
      return ctx.pc + fixedWidthValues(args, 4, ctx, op).length;
    case 'DS':
    case 'DEFS':
    case 'BLOCK':
      return ctx.pc + blockArgs(args, ctx, op).count;
    case 'ALIGN': {
      return alignArgs(args, ctx).next;
    }
    default:
      return ctx.pc;
  }
}

/**
 * Emit-pass directive handling; returns the next PC. `write(at, out)` places `out` at
 * address `at` (padding a forward gap with zeros); `bytes`/`origin` are the output so
 * far, read by SAVEBIN.
 */
function emitDirective(
  op: string,
  args: string,
  ctx: EvalContext,
  write: (at: number, out: number[]) => void,
  bytes: number[],
  origin: number,
  artifacts: OutputArtifact[],
  deviceEnabled: boolean
): number {
  switch (op) {
    case 'DEVICE':
    case 'DEFINE':
    case 'UNDEFINE':
    case 'INCLUDE':
    case 'ASSERT':
    case 'DISPLAY':
      return ctx.pc;
    case 'END':
      if (args) evalExpr(args, ctx);
      return ctx.pc;
    case 'SAVEBIN':
      emitSavebinArtifact(args, ctx, bytes, origin, artifacts, deviceEnabled);
      return ctx.pc;
    case 'INCBIN':
    case 'BINARY':
    case 'INSERT': {
      const out = readIncbinBytes(args, ctx, op);
      write(ctx.pc, out);
      return ctx.pc + out.length;
    }
    case 'SAVESNA':
      fail(ctx, 'SAVESNA is not supported by @zx-vibes/asm; use sjasmplus for snapshot output');
      return ctx.pc;
    case 'ORG':
      return evalExpr(args, ctx) ?? ctx.pc;
    case 'DB':
    case 'DEFB':
    case 'BYTE':
    case 'DEFM':
    case 'DM': {
      const out = dbValues(args, ctx, op);
      write(ctx.pc, out);
      return ctx.pc + out.length;
    }
    case 'DZ': {
      const out = dzValues(args, ctx);
      write(ctx.pc, out);
      return ctx.pc + out.length;
    }
    case 'DC': {
      const out = dcValues(args, ctx);
      write(ctx.pc, out);
      return ctx.pc + out.length;
    }
    case 'DW':
    case 'DEFW':
    case 'WORD': {
      const out = fixedWidthValues(args, 2, ctx, op);
      write(ctx.pc, out);
      return ctx.pc + out.length;
    }
    case 'D24': {
      const out = fixedWidthValues(args, 3, ctx, op);
      write(ctx.pc, out);
      return ctx.pc + out.length;
    }
    case 'DEFD':
    case 'DD':
    case 'DWORD': {
      const out = fixedWidthValues(args, 4, ctx, op);
      write(ctx.pc, out);
      return ctx.pc + out.length;
    }
    case 'DS':
    case 'DEFS':
    case 'BLOCK': {
      const { count, fill } = blockArgs(args, ctx, op, false);
      const out = Array.from({ length: Math.max(0, count) }, () => fill & 0xff);
      write(ctx.pc, out);
      return ctx.pc + out.length;
    }
    case 'ALIGN': {
      const { next, fill } = alignArgs(args, ctx, false);
      write(ctx.pc, Array.from({ length: Math.max(0, next - ctx.pc) }, () => fill & 0xff));
      return next;
    }
    default:
      return ctx.pc;
  }
}

// --- Table-driven encoding (ADR-0025 / W12 Phase C2) -------------------------
// The generated opcode table (the single authority, projected from
// dna/domain/z80-opcodes.yaml via C1) is the encode source: a canonical
// mnemonic+operands string maps to one row's bytes. The hand-coded per-mnemonic
// encoders are being migrated onto it incrementally.
//   SLICE 1 (C2.1): forms whose bytes are fully literal — no n/nn/e/d slot — i.e.
//     LD r,r', the ALU A,r register group, CB register rotates/BIT/RES/SET,
//     index-half transfers, etc. These need only an exact canonical-syntax match;
//     the emitted bytes ARE the table's literal bytes.
//   SLICE 2 (C2.2): rows carrying one immediate operand — an `n` (8-bit) or `nn`
//     (16-bit LE pair) slot and NO e/d displacement (those land in C2.3). The
//     row's canonical syntax fixes which operand positions are concrete (a
//     register / condition / (HL) / (C) / …) and which is the immediate; an input
//     matches when every concrete position is byte-equal and the immediate
//     position is a plain expression, which then fills the byte template. The
//     immediate is validated (not parenthesized memory, not a register, not an
//     (IX+d)/(IY+d) ref) so it cannot shadow LD r,r', the reg16 convenience forms,
//     or the displacement forms.
//   SLICE 3 (C2.3): the `e` relative-branch and `d` (IX+d)/(IY+d) displacement
//     slots, matched by the same slot machinery (see SLOT_OPCODE_ROWS below).
// What the table does not spell falls back to the hand-coded encoders below: the
// non-ISA convenience forms (LD BC,DE / LD IX,IY pseudo-copies, SLI, the XH/HX
// index-half synonyms, `ADD n`, `JP HL`, `IN F,(C)`) and operand spellings other
// than the canonical text (`[HL]` for `(HL)`, `rst 0x10` for `RST 10H`). The C4
// round-trip oracle + the ASM-EMIT fixtures keep both paths byte-identical.

function tableSyntaxKey(syntax: string): string {
  const space = syntax.indexOf(' ');
  if (space < 0) return upper(syntax);
  const mnemonic = upper(syntax.slice(0, space));
  const operands = syntax
    .slice(space + 1)
    .split(',')
    .map((operand) => upper(operand))
    .join(',');
  return `${mnemonic} ${operands}`;
}

// Canonical syntax (no parameter slot) -> literal opcode bytes.
const LITERAL_OPCODE_BYTES: ReadonlyMap<string, readonly number[]> = (() => {
  const index = new Map<string, readonly number[]>();
  for (const entry of Z80_OPCODE_TABLE) {
    const values: number[] = [];
    let hasSlot = false;
    for (const byte of entry.bytes) {
      if ('parameter' in byte) {
        hasSlot = true;
        break;
      }
      values.push(byte.value);
    }
    if (hasSlot) continue;
    index.set(tableSyntaxKey(entry.canonicalSyntax), values);
  }
  return index;
})();

// --- Slot-bearing rows (C2.2 + C2.3): match a row's slots, fill the template.
// A canonical operand is either concrete (a register / condition / (HL) / (C) /
// bit number / …, matched byte-equal) or one of the parameter slots:
//   imm  — `n` (8-bit) or `nn` (16-bit LE), bare or parenthesised (C2.2)
//   rel  — `e`, the relative-branch target (C2.3)
//   index— `(IX+d)` / `(IY+d)`, register-specific index displacement (C2.3)
// A row may carry more than one slot (only `LD (IX+d),n`, with both index `d`
// and immediate `n`); each is captured from its operand then poured into the
// byte template in positional order.
type SlotOperand =
  | { readonly slot: 'concrete'; readonly text: string }
  | { readonly slot: 'imm'; readonly width: 'n' | 'nn'; readonly paren: boolean }
  | { readonly slot: 'rel' }
  | { readonly slot: 'index'; readonly reg: 'IX' | 'IY' };

interface SlotRow {
  readonly operands: readonly SlotOperand[];
  readonly bytes: readonly OpcodeByte[];
}

function parseSlotOperand(text: string): SlotOperand {
  if (text === 'n') return { slot: 'imm', width: 'n', paren: false };
  if (text === 'nn') return { slot: 'imm', width: 'nn', paren: false };
  if (text === '(n)') return { slot: 'imm', width: 'n', paren: true };
  if (text === '(nn)') return { slot: 'imm', width: 'nn', paren: true };
  if (text === 'e') return { slot: 'rel' };
  if (text === '(IX+d)') return { slot: 'index', reg: 'IX' };
  if (text === '(IY+d)') return { slot: 'index', reg: 'IY' };
  return { slot: 'concrete', text: upper(text) };
}

// Mnemonic -> every slot-bearing row for that mnemonic. Slot tokens are
// case-sensitive lowercase in the canonical syntax (register `E` is not slot `e`),
// so the raw operand text — not the upper-cased key — is parsed for slot detection.
const SLOT_OPCODE_ROWS: ReadonlyMap<string, readonly SlotRow[]> = (() => {
  const byMnemonic = new Map<string, SlotRow[]>();
  for (const entry of Z80_OPCODE_TABLE) {
    const hasSlot = entry.bytes.some((byte) => 'parameter' in byte);
    if (!hasSlot) continue; // literal row -> C2.1
    const space = entry.canonicalSyntax.indexOf(' ');
    const mnemonic = upper(space < 0 ? entry.canonicalSyntax : entry.canonicalSyntax.slice(0, space));
    const operandText = space < 0 ? '' : entry.canonicalSyntax.slice(space + 1);
    const operands = operandText.split(',').map((operand) => parseSlotOperand(operand.trim()));
    const rows = byMnemonic.get(mnemonic) ?? [];
    rows.push({ operands, bytes: entry.bytes });
    byMnemonic.set(mnemonic, rows);
  }
  return byMnemonic;
})();

// A bare immediate slot (n/nn) or relative target (e) accepts only a plain
// expression — never a parenthesised memory operand, a register, or an
// (IX+d)/(IY+d) reference — so it cannot shadow LD r,r' / the reg16 convenience
// forms / the displacement forms.
function isImmediateOperand(text: string): boolean {
  return !memoryOperand(text) && !reg8Info(text) && !rpInfo(text);
}

// The expression captured for each slot family of a single matched row.
interface SlotValues {
  imm?: string;
  rel?: string;
  disp?: string;
}

function relativeByte(targetExpr: string, ctx: EvalContext): number {
  const target = evalExpr(targetExpr, ctx);
  // An unresolved target is already reported ("Label not found"); a range check
  // against a placeholder 0 only added a misleading "out of range" error.
  if (target === undefined) return 0;
  const offset = target - ((ctx.pc + 2) & 0xffff);
  const signed = offset < -128 ? offset + 0x10000 : offset > 127 ? offset - 0x10000 : offset;
  if (ctx.strict && (signed < -128 || signed > 127)) {
    fail(ctx, `Relative branch out of range: ${targetExpr}`);
  }
  return signed & 0xff;
}

function fillSlotBytes(bytes: readonly OpcodeByte[], values: SlotValues, ctx: EvalContext): number[] {
  // Evaluate each slot expression once (range diagnostics fire a single time).
  const params = bytes.filter((byte) => 'parameter' in byte).map((byte) => byte.parameter);
  const pair = params.includes('nn-low') ? word(values.imm!, ctx) : undefined;
  const byteValue = params.includes('n') ? u8(values.imm!, ctx) : 0;
  const dispValue = params.includes('d') ? evalDisp(values.disp!, ctx) : 0;
  const relValue = params.includes('e') ? relativeByte(values.rel!, ctx) : 0;
  const out: number[] = [];
  for (const byte of bytes) {
    if (!('parameter' in byte)) out.push(byte.value);
    else if (byte.parameter === 'n') out.push(byteValue);
    else if (byte.parameter === 'nn-low') out.push(pair![0]!);
    else if (byte.parameter === 'nn-high') out.push(pair![1]!);
    else if (byte.parameter === 'd') out.push(dispValue);
    else if (byte.parameter === 'e') out.push(relValue);
  }
  return out;
}

function encodeSlotFromTable(op: string, args: string[], ctx: EvalContext): number[] | undefined {
  const rows = SLOT_OPCODE_ROWS.get(upper(op));
  if (!rows) return undefined;
  for (const row of rows) {
    if (row.operands.length !== args.length) continue;
    const values: SlotValues = {};
    let matched = true;
    for (let i = 0; i < args.length && matched; i++) {
      const template = row.operands[i]!;
      const arg = args[i]!;
      switch (template.slot) {
        case 'concrete':
          if (upper(arg) !== template.text) matched = false;
          break;
        case 'imm':
          if (template.paren) {
            const mem = memInfo(arg);
            // I/O ports ((n)) accept round parens only; square brackets are an
            // address-only convenience (sjasmplus rejects [port] I/O syntax).
            if (!mem || mem.kind !== 'ABS' || (template.width === 'n' && mem.bracket)) matched = false;
            else values.imm = mem.expr;
          } else if (isImmediateOperand(arg)) {
            values.imm = arg;
          } else {
            matched = false;
          }
          break;
        case 'rel':
          if (isImmediateOperand(arg)) values.rel = arg;
          else matched = false;
          break;
        case 'index': {
          const idx = indexedMem(arg);
          const wantPrefix = template.reg === 'IX' ? 0xdd : 0xfd;
          if (!idx || idx.prefix !== wantPrefix) matched = false;
          else values.disp = idx.disp;
          break;
        }
      }
    }
    if (matched) return fillSlotBytes(row.bytes, values, ctx);
  }
  return undefined;
}

function encodeFromTable(op: string, args: string[], ctx: EvalContext): number[] | undefined {
  const key = args.length === 0 ? upper(op) : `${upper(op)} ${args.map((arg) => upper(arg)).join(',')}`;
  const literal = LITERAL_OPCODE_BYTES.get(key);
  if (literal) return [...literal];
  return encodeSlotFromTable(op, args, ctx);
}

function encodeInstruction(op: string, argsText: string, ctx: EvalContext): number[] | undefined {
  const signature = `${op}${argsText ? ' ' + normalizeSpaces(argsText).toUpperCase() : ''}`;
  const noArg = NO_ARG_OPS.get(signature) ?? (!argsText ? NO_ARG_OPS.get(op) : undefined);
  if (noArg) return [...noArg];

  const args = splitArgs(argsText).map(normalizeOperand);
  // `ret z,` / `push bc,` used to drop the empty operand and assemble silently.
  if (args.includes('')) return fail(ctx, `${op} has an empty operand: ${argsText}`);
  const fromTable = encodeFromTable(op, args, ctx);
  if (fromTable) return fromTable;
  try {
    switch (op) {
      case 'LD':
        return encodeLd(args, ctx);
      case 'INC':
        return encodeIncDec(args, ctx, false);
      case 'DEC':
        return encodeIncDec(args, ctx, true);
      case 'ADD':
        return encodeAdd(args, ctx);
      case 'ADC':
      case 'SBC':
        return encodeAdcSbc(op, args, ctx);
      case 'SUB':
      case 'AND':
      case 'XOR':
      case 'OR':
      case 'CP':
        return encodeAlu(op, args, ctx);
      case 'JP':
        return encodeJp(args, ctx);
      case 'JR':
        return encodeJr(args, ctx);
      case 'DJNZ':
        if (!expectArgs('DJNZ', args, 1, ctx)) return undefined;
        return rel8(0x10, args[0], ctx);
      case 'CALL':
        return encodeCall(args, ctx);
      case 'RET':
        return encodeRet(args, ctx);
      case 'RST':
        // A bare `rst` used to assemble silently as RST 0, and `rst 8,1` dropped the 1.
        if (!expectArgs('RST', args, 1, ctx)) return undefined;
        return [0xc7 + (rstValue(args[0]!, ctx) << 3)];
      case 'PUSH':
        return encodePushPop(args, false, ctx);
      case 'POP':
        return encodePushPop(args, true, ctx);
      case 'EX':
        return encodeEx(args, ctx);
      case 'BIT':
      case 'RES':
      case 'SET':
        return encodeBitResSet(op, args, ctx);
      case 'RLC':
      case 'RRC':
      case 'RL':
      case 'RR':
      case 'SLA':
      case 'SRA':
      case 'SLL':
      case 'SLI':
      case 'SRL':
        return encodeRotate(op, args, ctx);
      case 'IN':
        return encodeIn(args, ctx);
      case 'OUT':
        return encodeOut(args, ctx);
      case 'IM':
        return encodeIm(args, ctx);
      default:
        return fail(ctx, `Unsupported instruction: ${op}${argsText ? ' ' + argsText : ''}`);
    }
  } catch (err) {
    return fail(ctx, (err as Error).message);
  }
}

function encodeLd(args: string[], ctx: EvalContext): number[] | undefined {
  if (!expectArgs('LD', args, 2, ctx)) return undefined;
  const dst = args[0]!;
  const src = args[1]!;
  const d8 = reg8Info(dst);
  const s8 = reg8Info(src);
  if (d8 && s8) {
    if (invalidLdReg8Pair(d8, s8)) return fail(ctx, `Unsupported LD form: ${args.join(', ')}`);
    const prefix = mergePrefix(ctx, d8.prefix, s8.prefix);
    const out = pref(prefix, 0x40 + d8.code * 8 + s8.code);
    if (s8.disp !== undefined) out.push(evalDisp(s8.disp, ctx));
    else if (d8.disp !== undefined) out.push(evalDisp(d8.disp, ctx));
    return out;
  }

  const dstMem = memInfo(dst);
  const srcMem = memInfo(src);
  if (dstMem?.kind === 'BC' && upper(src) === 'A') return [0x02];
  if (dstMem?.kind === 'DE' && upper(src) === 'A') return [0x12];
  if (upper(dst) === 'A' && srcMem?.kind === 'BC') return [0x0a];
  if (upper(dst) === 'A' && srcMem?.kind === 'DE') return [0x1a];
  if (dstMem?.kind === 'ABS' && upper(src) === 'A') return [0x32, ...word(dstMem.expr, ctx)];
  if (upper(dst) === 'A' && srcMem?.kind === 'ABS') return [0x3a, ...word(srcMem.expr, ctx)];
  if (upper(dst) === 'I' && upper(src) === 'A') return [0xed, 0x47];
  if (upper(dst) === 'R' && upper(src) === 'A') return [0xed, 0x4f];
  if (upper(dst) === 'A' && upper(src) === 'I') return [0xed, 0x57];
  if (upper(dst) === 'A' && upper(src) === 'R') return [0xed, 0x5f];
  if (d8) {
    const out = pref(d8.prefix, 0x06 + d8.code * 8);
    if (d8.disp !== undefined) out.push(evalDisp(d8.disp, ctx));
    out.push(u8(src, ctx));
    return out;
  }

  const dstRp = rpInfo(dst);
  const srcRp = rpInfo(src);
  if (upper(dst) === 'SP' && srcRp && (upper(src) === 'HL' || upper(src) === 'IX' || upper(src) === 'IY')) {
    return pref(srcRp.prefix, 0xf9);
  }
  const copy16 = encodeLd16Copy(dst, src, ctx);
  if (copy16) return copy16;
  if (dstRp && !srcMem) return [...pref(dstRp.prefix, 0x01 + dstRp.code * 0x10), ...word(src, ctx)];
  if (dstMem?.kind === 'ABS' && srcRp) return ldMemRp(dstMem.expr, srcRp, false, ctx);
  if (dstRp && srcMem?.kind === 'ABS') return ldMemRp(srcMem.expr, dstRp, true, ctx);

  return fail(ctx, `Unsupported LD form: ${args.join(', ')}`);
}

function encodeLd16Copy(dst: string, src: string, ctx: EvalContext): number[] | undefined {
  const dstInfo = copy16Info(dst);
  const srcInfo = copy16Info(src);
  if (!dstInfo || !srcInfo) return undefined;

  const dstStack = dstInfo.name === 'HL' || dstInfo.name === 'IX' || dstInfo.name === 'IY';
  const srcStack = srcInfo.name === 'HL' || srcInfo.name === 'IX' || srcInfo.name === 'IY';
  if (dstInfo.name !== srcInfo.name && dstStack && srcStack) {
    return [...pref(srcInfo.prefix, 0xe5), ...pref(dstInfo.prefix, 0xe1)];
  }

  const high = encodeLd([dstInfo.high, srcInfo.high], ctx);
  const low = encodeLd([dstInfo.low, srcInfo.low], ctx);
  if (!high || !low) return undefined;
  return [...high, ...low];
}

function copy16Info(text: string): { name: string; high: string; low: string; prefix?: 0xdd | 0xfd } | undefined {
  switch (upper(text)) {
    case 'BC':
      return { name: 'BC', high: 'B', low: 'C' };
    case 'DE':
      return { name: 'DE', high: 'D', low: 'E' };
    case 'HL':
      return { name: 'HL', high: 'H', low: 'L' };
    case 'IX':
      return { name: 'IX', high: 'IXH', low: 'IXL', prefix: 0xdd };
    case 'IY':
      return { name: 'IY', high: 'IYH', low: 'IYL', prefix: 0xfd };
    default:
      return undefined;
  }
}

function ldMemRp(expr: string, rp: RpInfo, load: boolean, ctx: EvalContext): number[] {
  if (rp.prefix) return [...pref(rp.prefix, load ? 0x2a : 0x22), ...word(expr, ctx)];
  if (rp.name === 'HL') return [load ? 0x2a : 0x22, ...word(expr, ctx)];
  return [0xed, (load ? 0x4b : 0x43) + rp.code * 0x10, ...word(expr, ctx)];
}

function encodeIncDec(args: string[], ctx: EvalContext, dec: boolean): number[] | undefined {
  if (!expectArgs(dec ? 'DEC' : 'INC', args, 1, ctx)) return undefined;
  const r = reg8Info(args[0]!);
  if (r) {
    const out = pref(r.prefix, (dec ? 0x05 : 0x04) + r.code * 8);
    if (r.disp !== undefined) out.push(evalDisp(r.disp, ctx));
    return out;
  }
  const rp = rpInfo(args[0]!);
  if (rp) return pref(rp.prefix, (dec ? 0x0b : 0x03) + rp.code * 0x10);
  return fail(ctx, `Unsupported ${dec ? 'DEC' : 'INC'} form: ${args.join(', ')}`);
}

function encodeAdd(args: string[], ctx: EvalContext): number[] | undefined {
  if (args.length === 1) return encodeAlu('ADD', [args[0]!], ctx);
  if (!expectArgs('ADD', args, 2, ctx)) return undefined;
  const dst = upper(args[0]!);
  if (dst === 'A') return encodeAlu('ADD', [args[1]!], ctx);
  const rp = rpInfo(args[0]!);
  const src = rpInfo(args[1]!);
  if (rp && src && (rp.name === 'HL' || rp.name === 'IX' || rp.name === 'IY')) {
    if (rp.name === 'HL' && src.prefix) return fail(ctx, `Cannot ADD HL,${src.name}`);
    if ((rp.name === 'IX' || rp.name === 'IY') && src.name === 'HL' && !src.prefix) {
      return fail(ctx, `Cannot ADD ${rp.name},HL`);
    }
    const prefix = mergePrefix(ctx, rp.prefix, src.name === rp.name ? rp.prefix : src.prefix);
    const srcCode = src.name === rp.name ? 2 : src.code;
    if (src.prefix && src.prefix !== rp.prefix) return fail(ctx, `Cannot mix ${rp.name} and ${src.name}`);
    return pref(prefix, 0x09 + srcCode * 0x10);
  }
  return fail(ctx, `Unsupported ADD form: ${args.join(', ')}`);
}

function encodeAdcSbc(op: string, args: string[], ctx: EvalContext): number[] | undefined {
  if (args.length === 1) return encodeAlu(op, [args[0]!], ctx);
  if (!expectArgs(op, args, 2, ctx)) return undefined;
  const dst = upper(args[0]!);
  if (dst === 'A') return encodeAlu(op, [args[1]!], ctx);
  if (dst === 'HL') {
    const src = rpInfo(args[1]!);
    if (!src || src.prefix) return fail(ctx, `Unsupported ${op} HL form: ${args.join(', ')}`);
    return [0xed, (op === 'ADC' ? 0x4a : 0x42) + src.code * 0x10];
  }
  return fail(ctx, `Unsupported ${op} form: ${args.join(', ')}`);
}

function encodeAlu(op: string, args: string[], ctx: EvalContext): number[] | undefined {
  const spec = ALU_BASE.get(op)!;
  if (!expectArgs(op, args, 1, ctx)) return undefined;
  const src = reg8Info(args[0]!);
  if (src) {
    const out = pref(src.prefix, spec.reg + src.code);
    if (src.disp !== undefined) out.push(evalDisp(src.disp, ctx));
    return out;
  }
  return [spec.imm, u8(args[0]!, ctx)];
}

function encodeJp(args: string[], ctx: EvalContext): number[] | undefined {
  if (args.length === 1) {
    const mem = memInfo(args[0]!);
    if (mem?.kind === 'HL') return [0xe9];
    if (mem?.kind === 'IX') return [0xdd, 0xe9];
    if (mem?.kind === 'IY') return [0xfd, 0xe9];
    const rp = rpInfo(args[0]!);
    if (rp?.name === 'HL') return [0xe9];
    if (rp?.name === 'IX') return [0xdd, 0xe9];
    if (rp?.name === 'IY') return [0xfd, 0xe9];
    return [0xc3, ...word(args[0]!, ctx)];
  }
  if (args.length === 2) {
    const c = cond(args[0]!, ctx);
    return [0xc2 + c * 8, ...word(args[1]!, ctx)];
  }
  return fail(ctx, `Unsupported JP form: ${args.join(', ')}`);
}

function encodeJr(args: string[], ctx: EvalContext): number[] | undefined {
  if (args.length === 1) return rel8(0x18, args[0], ctx);
  if (args.length === 2) {
    const c = JR_CC.indexOf(upper(args[0]!));
    if (c < 0) return fail(ctx, `JR only supports NZ/Z/NC/C conditions in Z80: ${args[0]}`);
    return rel8(0x20 + c * 8, args[1], ctx);
  }
  return fail(ctx, `Unsupported JR form: ${args.join(', ')}`);
}

function encodeCall(args: string[], ctx: EvalContext): number[] | undefined {
  if (args.length === 1) return [0xcd, ...word(args[0]!, ctx)];
  if (args.length === 2) return [0xc4 + cond(args[0]!, ctx) * 8, ...word(args[1]!, ctx)];
  return fail(ctx, `Unsupported CALL form: ${args.join(', ')}`);
}

function encodeRet(args: string[], ctx: EvalContext): number[] | undefined {
  // A bare RET is in NO_ARG_OPS; only the conditional form reaches here.
  if (args.length === 1) return [0xc0 + cond(args[0]!, ctx) * 8];
  return fail(ctx, `Unsupported RET form: ${args.join(', ')}`);
}

function encodePushPop(args: string[], pop: boolean, ctx: EvalContext): number[] | undefined {
  if (!expectArgs(pop ? 'POP' : 'PUSH', args, 1, ctx)) return undefined;
  const rp = rp2Info(args[0]!);
  if (!rp) return fail(ctx, `Unsupported ${pop ? 'POP' : 'PUSH'} operand: ${args[0]}`);
  return pref(rp.prefix, (pop ? 0xc1 : 0xc5) + rp.code * 0x10);
}

function encodeEx(args: string[], ctx: EvalContext): number[] | undefined {
  if (!expectArgs('EX', args, 2, ctx)) return undefined;
  // EX DE,HL and EX AF,AF' are matched earlier (NO_ARG_OPS or the opcode table).
  const mem = memInfo(args[0]!);
  const rp = rpInfo(args[1]!);
  if (mem?.kind === 'SP' && rp && (rp.name === 'HL' || rp.name === 'IX' || rp.name === 'IY')) {
    return pref(rp.prefix, 0xe3);
  }
  return fail(ctx, `Unsupported EX form: ${args.join(', ')}`);
}

function encodeBitResSet(op: string, args: string[], ctx: EvalContext): number[] | undefined {
  if (args.length !== 2 && args.length !== 3) {
    return fail(ctx, `${op} expects 2 or 3 operand(s), got ${args.length}`);
  }
  if (args.length === 3 && op === 'BIT') return fail(ctx, 'BIT does not support a copy-register operand');
  const bit = evalExpr(args[0]!, ctx) ?? 0;
  if (bit < 0 || bit > 7) return fail(ctx, `${op} bit must be 0..7`);
  const target = reg8Info(args[1]!);
  if (!target) return fail(ctx, `Unsupported ${op} target: ${args[1]}`);
  const copy = args[2] !== undefined ? reg8Info(args[2]) : undefined;
  if (args.length === 3) {
    if (target.disp === undefined) return fail(ctx, `${op} copy-register form is only valid for indexed memory`);
    if (!copy || copy.disp !== undefined) return fail(ctx, `Unsupported ${op} copy-register: ${args[2]}`);
  }
  const group = op === 'BIT' ? 0x40 : op === 'RES' ? 0x80 : 0xc0;
  const opcode = group + bit * 8 + (copy?.code ?? target.code);
  if (target.disp !== undefined) return [target.prefix!, 0xcb, evalDisp(target.disp, ctx), opcode];
  return [0xcb, opcode];
}

function encodeRotate(op: string, args: string[], ctx: EvalContext): number[] | undefined {
  if (args.length < 1 || args.length > 2) return fail(ctx, `Unsupported ${op} form: ${args.join(', ')}`);
  const target = reg8Info(args[0]!);
  if (!target) return fail(ctx, `Unsupported ${op} target: ${args[0]}`);
  const copy = args[1] !== undefined ? reg8Info(args[1]) : undefined;
  const code = ROT_BASE.get(op)! + (copy?.code ?? target.code);
  if (target.disp !== undefined) return [target.prefix!, 0xcb, evalDisp(target.disp, ctx), code];
  if (copy) return fail(ctx, `${op} copy-register form is only valid for indexed memory`);
  return [0xcb, code];
}

function encodeIn(args: string[], ctx: EvalContext): number[] | undefined {
  if (args.length === 1) {
    const port = memInfo(args[0]!);
    if (port?.kind === 'C') return [0xed, 0x70];
    return fail(ctx, `Unsupported IN form: ${args.join(', ')}`);
  }
  if (!expectArgs('IN', args, 2, ctx)) return undefined;
  const dst = reg8Info(args[0]!);
  const port = memInfo(args[1]!);
  if (upper(args[0]!) === 'A' && port?.kind === 'ABS' && !port.bracket) return [0xdb, u8(port.expr, ctx)];
  if (upper(args[0]!) === 'F' && port?.kind === 'C') return [0xed, 0x70];
  if (dst && port?.kind === 'C') return [0xed, 0x40 + dst.code * 8];
  return fail(ctx, `Unsupported IN form: ${args.join(', ')}`);
}

function encodeOut(args: string[], ctx: EvalContext): number[] | undefined {
  if (!expectArgs('OUT', args, 2, ctx)) return undefined;
  const port = memInfo(args[0]!);
  const src = reg8Info(args[1]!);
  if (port?.kind === 'ABS' && !port.bracket && upper(args[1]!) === 'A') return [0xd3, u8(port.expr, ctx)];
  if (port?.kind === 'C' && src) return [0xed, 0x41 + src.code * 8];
  if (port?.kind === 'C' && normalizeSpaces(args[1]!) === '0') return [0xed, 0x71];
  return fail(ctx, `Unsupported OUT form: ${args.join(', ')}`);
}

function encodeIm(args: string[], ctx: EvalContext): number[] | undefined {
  if (!expectArgs('IM', args, 1, ctx)) return undefined;
  const mode = evalExpr(args[0]!, ctx) ?? 0;
  if (mode === 0) return [0xed, 0x46];
  if (mode === 1) return [0xed, 0x56];
  if (mode === 2) return [0xed, 0x5e];
  return fail(ctx, `Unsupported IM mode: ${args[0]}`);
}

interface Reg8Info {
  code: number;
  prefix?: 0xdd | 0xfd;
  disp?: string;
  plainHalf?: boolean;
  indexHalf?: boolean;
}

interface RpInfo {
  name: string;
  code: number;
  prefix?: 0xdd | 0xfd;
}

type MemInfo =
  | { kind: 'ABS'; expr: string; bracket: boolean }
  | { kind: 'BC' | 'DE' | 'HL' | 'SP' | 'IX' | 'IY' | 'C'; bracket: boolean };

function reg8Info(text: string): Reg8Info | undefined {
  const t = upper(text);
  const reg = REG8.indexOf(t);
  if (reg >= 0) return { code: reg, ...(t === 'H' || t === 'L' ? { plainHalf: true } : {}) };
  const mem = memoryOperand(text);
  if (mem?.bracket && upper(mem.inner) === 'HL') return { code: 6 };
  const indexHalf = INDEX_HALF_REGS.get(t);
  if (indexHalf) return { ...indexHalf, indexHalf: true };
  const ix = indexedMem(text);
  if (ix) return { code: 6, prefix: ix.prefix, disp: ix.disp };
  return undefined;
}

function invalidLdReg8Pair(dst: Reg8Info, src: Reg8Info): boolean {
  if (dst.code === 6 && src.code === 6) return true;
  if ((dst.indexHalf && src.code === 6) || (src.indexHalf && dst.code === 6)) return true;
  if ((dst.indexHalf && src.plainHalf) || (src.indexHalf && dst.plainHalf)) return true;
  return false;
}

function rpInfo(text: string): RpInfo | undefined {
  const t = upper(text);
  const code = RP.indexOf(t);
  if (code >= 0) return { name: t, code };
  if (t === 'IX') return { name: 'IX', code: 2, prefix: 0xdd };
  if (t === 'IY') return { name: 'IY', code: 2, prefix: 0xfd };
  return undefined;
}

function rp2Info(text: string): RpInfo | undefined {
  const t = upper(text);
  const code = RP2.indexOf(t);
  if (code >= 0) return { name: t, code };
  if (t === 'IX') return { name: 'IX', code: 2, prefix: 0xdd };
  if (t === 'IY') return { name: 'IY', code: 2, prefix: 0xfd };
  return undefined;
}

function memInfo(text: string): MemInfo | undefined {
  const operand = memoryOperand(text);
  if (!operand) return undefined;
  const inner = operand.inner;
  const u = upper(inner);
  const registerKinds = operand.bracket ? ['BC', 'DE', 'HL', 'SP', 'IX', 'IY'] : ['BC', 'DE', 'HL', 'SP', 'IX', 'IY', 'C'];
  if (registerKinds.includes(u)) {
    return { kind: u as 'BC' | 'DE' | 'HL' | 'SP' | 'IX' | 'IY' | 'C', bracket: operand.bracket };
  }
  if (indexedMem(text)) return undefined;
  return { kind: 'ABS', expr: inner, bracket: operand.bracket };
}

function indexedMem(text: string): { prefix: 0xdd | 0xfd; disp: string } | undefined {
  const operand = memoryOperand(text);
  if (!operand) return undefined;
  // IX/IY must stand alone or be followed by a +/- displacement: a label such as
  // `ixcount` is an absolute address, not `(IX+count)`.
  const m = operand.inner.match(/^(IX|IY)(?=\s*(?:[+-]|$))(.*)$/i);
  if (!m) return undefined;
  const rest = m[2]!.trim();
  return { prefix: upper(m[1]!) === 'IX' ? 0xdd : 0xfd, disp: rest || '0' };
}

/**
 * `( hl )` -> `(hl)` and `[ hl ]` -> `[hl]`. Whitespace just inside a memory operand's
 * brackets is insignificant, but the opcode-table keys and the register lookups compare
 * operand text, so `ld a,( hl )` failed while `ld a,( ix+5 )` and `ld a,[ hl ]` worked.
 */
function normalizeOperand(text: string): string {
  const mem = memoryOperand(text);
  if (!mem) return text;
  return mem.bracket ? `[${mem.inner}]` : `(${mem.inner})`;
}

function memoryOperand(text: string): { inner: string; bracket: boolean } | undefined {
  const t = normalizeSpaces(text);
  if (t.startsWith('(') && t.endsWith(')')) return { inner: t.slice(1, -1).trim(), bracket: false };
  if (t.startsWith('[') && t.endsWith(']')) return { inner: t.slice(1, -1).trim(), bracket: true };
  return undefined;
}

function cond(text: string, ctx: EvalContext): number {
  const c = CC.indexOf(upper(text));
  if (c < 0) {
    fail(ctx, `Unknown condition: ${text}`);
    return 0;
  }
  return c;
}

function rel8(op: number, targetExpr: string | undefined, ctx: EvalContext): number[] | undefined {
  if (targetExpr === undefined) return fail(ctx, 'Missing relative branch target');
  return [op, relativeByte(targetExpr, ctx)];
}

function rstValue(text: string, ctx: EvalContext): number {
  const value = evalExpr(text, ctx) ?? 0;
  if (value % 8 !== 0 || value < 0 || value > 0x38) {
    fail(ctx, `RST target must be one of 0x00..0x38: ${text}`);
    return 0;
  }
  return value / 8;
}

function u8(expr: string, ctx: EvalContext): number {
  const value = evalExpr(expr, ctx) ?? 0;
  if (ctx.strict && (value < -128 || value > 0xff) && !readsAsNegativeByte(expr, value, ctx)) {
    fail(ctx, `8-bit value out of range: ${expr}`);
  }
  return value & 0xff;
}

/**
 * Whether an out-of-range 8-bit value is really a negative byte stored in 16 bits.
 * Expressions read true (`1==1`, `!0`) as 0xFFFF, and symbols keep 16 bits, so
 * `X EQU -1` reads as 0xFFFF; an 8-bit slot stores those as 0xFF. A literal 0xFFFF
 * (`db 0xFFFF`, `ld a,65535`) does not fit and must be an error, so rather than
 * exempting every 0xFFFF the expression is re-read in the signed view (true = -1,
 * symbols keep their negative value) and the value passes only when it is exactly
 * the 16-bit two's complement of a signed byte. The emitted byte is `value & 0xFF`
 * either way; only the range check changes.
 */
function readsAsNegativeByte(expr: string, value: number, ctx: EvalContext): boolean {
  if (value < 0xff80 || value > 0xffff) return false;
  const signed = evalSignedView(expr, ctx);
  return signed !== undefined && signed >= -128 && signed <= -1 && value === signed + 0x10000;
}

/** Evaluates `expr` in the signed view (diagnostics are left to the normal evaluation). */
function evalSignedView(expr: string, ctx: EvalContext): number | undefined {
  return new ExprParser(expr, ctx, true).parse();
}

/**
 * Records the signed-view value of a symbol just defined from `expr` (EQU, DEFL, `=`,
 * DEFINE), so a later 8-bit use of `X EQU -1` still reads as -1.
 */
function recordSignedValue(ctx: EvalContext, key: string, expr: string): void {
  if (!ctx.negativeSymbols) return;
  const signed = evalSignedView(expr, ctx);
  if (signed !== undefined && signed < 0) ctx.negativeSymbols.set(key, signed);
  else ctx.negativeSymbols.delete(key);
}

function word(expr: string, ctx: EvalContext): number[] {
  const value = evalExpr(expr, ctx) ?? 0;
  if (ctx.strict && (value < -0x8000 || value > 0xffff)) {
    fail(ctx, `16-bit value out of range: ${expr}`);
  }
  return [value & 0xff, (value >> 8) & 0xff];
}

function pushInt(out: number[], value: number, width: 2 | 3 | 4): void {
  const modulo = 2 ** (width * 8);
  let normalized = Math.trunc(value) % modulo;
  if (normalized < 0) normalized += modulo;
  for (let i = 0; i < width; i++) out.push(Math.floor(normalized / 2 ** (i * 8)) & 0xff);
}

function evalDisp(expr: string, ctx: EvalContext): number {
  const value = evalExpr(expr, ctx) ?? 0;
  // `X EQU -2` reads as 0xFFFE: accept it as the displacement -2 (see readsAsNegativeByte).
  if (ctx.strict && (value < -128 || value > 127) && !readsAsNegativeByte(expr, value, ctx)) {
    fail(ctx, `Index displacement out of range: ${expr}`);
  }
  return value & 0xff;
}

function pref(prefix: 0xdd | 0xfd | undefined, opcode: number): number[] {
  return prefix ? [prefix, opcode] : [opcode];
}

function mergePrefix(
  ctx: EvalContext,
  a: 0xdd | 0xfd | undefined,
  b: 0xdd | 0xfd | undefined
): 0xdd | 0xfd | undefined {
  if (a && b && a !== b) {
    fail(ctx, 'Cannot mix IX and IY operands in one instruction');
    return a;
  }
  return a ?? b;
}

function checkAssert(argsText: string, ctx: EvalContext): void {
  const parts = splitArgs(argsText);
  if (parts.length === 0) {
    fail(ctx, 'ASSERT expects an expression');
    return;
  }
  const value = evalExpr(parts[0]!, ctx);
  if (!ctx.strict || value === undefined || value !== 0) return;
  const message = parts.length > 1 ? formatDirectiveParts(parts.slice(1), ctx) : parts[0]!;
  fail(ctx, `ASSERT failed: ${message}`);
}

function displayMessage(argsText: string, ctx: EvalContext): void {
  if (!ctx.strict) return;
  warn(ctx, `DISPLAY: ${formatDirectiveParts(splitArgs(argsText), ctx)}`);
}

function formatDirectiveParts(parts: string[], ctx: EvalContext): string {
  return parts.map((part) => formatDirectivePart(part, ctx)).join('');
}

function formatDirectivePart(part: string, ctx: EvalContext): string {
  const t = part.trim();
  if (isStringLiteral(t)) {
    return String.fromCharCode(...decodeString(t, ctx));
  }
  const value = evalExpr(t, ctx);
  if (value === undefined) return t;
  return `0x${(value & 0xffff).toString(16).toUpperCase()}`;
}

function readIncbinBytes(argsText: string, ctx: EvalContext, op = 'INCBIN'): number[] {
  const parts = splitArgs(argsText);
  const target = parts[0] ? parseIncludeTarget(parts[0]) : undefined;
  if (!target) {
    fail(ctx, `${op} expects a quoted file path`);
    return [];
  }
  const file = resolveDataFile(ctx.loc, target, ctx, op);
  if (!file) return [];
  const data = readFileSync(file);
  const offset = parts[1] ? (evalExpr(parts[1]!, ctx) ?? 0) : 0;
  const requestedLength = parts[2] ? (evalExpr(parts[2]!, ctx) ?? 0) : data.length - offset;
  if (ctx.strict) {
    if (offset < 0 || offset > data.length) {
      fail(ctx, `${op} offset out of range: ${parts[1]} (the file has ${data.length} byte(s))`);
    } else if (parts[2] && (requestedLength < 0 || offset + requestedLength > data.length)) {
      // A length past the end of the file used to be clamped silently.
      fail(ctx, `${op} length out of range: ${parts[2]} (${data.length - offset} byte(s) available from offset ${offset})`);
    }
  }
  const start = Math.max(0, Math.min(offset, data.length));
  const end = Math.max(start, Math.min(start + Math.max(0, requestedLength), data.length));
  return [...data.subarray(start, end)];
}

function emitSavebinArtifact(
  argsText: string,
  ctx: EvalContext,
  bytes: number[],
  origin: number,
  artifacts: OutputArtifact[],
  deviceEnabled: boolean
): void {
  if (!deviceEnabled) {
    fail(ctx, 'SAVEBIN requires DEVICE emulation mode');
    return;
  }

  const parsed = parseSavebin(argsText, ctx);
  if (!parsed) return;
  artifacts.push({
    kind: 'bin',
    path: parsed.path,
    bytes: Uint8Array.from(memorySlice(bytes, origin, parsed.start, parsed.length)),
    start: parsed.start,
    length: parsed.length,
  });
}

function parseSavebin(
  argsText: string,
  ctx: EvalContext
): { path: string; start: number; length: number } | undefined {
  const parts = splitArgs(argsText);
  if (parts.length < 2 || parts.length > 3) {
    fail(ctx, `SAVEBIN expects 2 or 3 argument(s), got ${parts.length}`);
    return undefined;
  }
  const target = parseIncludeTarget(parts[0]!);
  if (!target || target.searchOnly) {
    fail(ctx, 'SAVEBIN expects a quoted file path');
    return undefined;
  }
  // The artifact path is written relative to the output directory; reject
  // absolute paths and '..' escapes so an untrusted source cannot write outside it.
  if (isAbsolute(target.path) || /^[A-Za-z]:/.test(target.path) || target.path.split(/[\\/]+/).includes('..')) {
    fail(ctx, `SAVEBIN path must stay within the output directory: ${target.path}`);
    return undefined;
  }
  const start = evalExpr(parts[1]!, ctx);
  if (start === undefined) return undefined;
  const length = parts[2] !== undefined ? evalExpr(parts[2]!, ctx) : 0x10000 - start;
  if (length === undefined) return undefined;
  const normalizedStart = Math.trunc(start);
  const normalizedLength = Math.trunc(length);
  if (normalizedStart < 0 || normalizedStart > 0xffff) {
    fail(ctx, `SAVEBIN start address out of range: ${parts[1]}`);
    return undefined;
  }
  if (normalizedLength < 0 || normalizedStart + normalizedLength > 0x10000) {
    fail(ctx, `SAVEBIN length out of range: ${parts[2] ?? '(default)'}`);
    return undefined;
  }
  return { path: target.path, start: normalizedStart, length: normalizedLength };
}

function memorySlice(bytes: number[], origin: number, start: number, length: number): number[] {
  const out = new Array<number>(length).fill(0);
  for (let i = 0; i < length; i++) {
    const idx = start + i - origin;
    if (idx >= 0 && idx < bytes.length) out[i] = bytes[idx]! & 0xff;
  }
  return out;
}

function resolveDataFile(loc: SourceLine, target: IncludeTarget, ctx: EvalContext, op = 'INCBIN'): string | undefined {
  const candidates = target.searchOnly ? [] : [resolve(includeBaseDir(loc, ctx.cwd), target.path)];
  candidates.push(...ctx.includePaths.map((dir) => resolve(dir, target.path)));
  let blocked = false;
  for (const candidate of candidates) {
    if (!isFile(candidate)) continue;
    if (ctx.sandbox && ctx.roots && !isWithinRoots(candidate, ctx.roots)) {
      blocked = true;
      continue;
    }
    return candidate;
  }
  if (ctx.strict) {
    fail(
      ctx,
      blocked
        ? `${op} path is outside the sandbox roots: ${target.path}`
        : `${op} file not found: ${target.path}`
    );
  }
  return undefined;
}

function dbValues(argsText: string, ctx: EvalContext, op = 'DB'): number[] {
  const out: number[] = [];
  for (const arg of dataArgs(argsText, ctx, op)) {
    const t = arg.trim();
    if (isStringLiteral(t)) {
      out.push(...decodeString(t, ctx).map((c) => c & 0xff));
    } else {
      out.push(u8(t, ctx));
    }
  }
  return out;
}

function dzValues(argsText: string, ctx: EvalContext): number[] {
  return [...dbValues(argsText, ctx, 'DZ'), 0];
}

function dcValues(argsText: string, ctx: EvalContext): number[] {
  const out = dbValues(argsText, ctx, 'DC');
  if (out.length > 0) out[out.length - 1] = out[out.length - 1]! | 0x80;
  return out;
}

function fixedWidthValues(argsText: string, width: 2 | 3 | 4, ctx: EvalContext, op: string): number[] {
  const out: number[] = [];
  for (const arg of dataArgs(argsText, ctx, op)) {
    pushInt(out, fixedWidthValue(arg, width, ctx), width);
  }
  return out;
}

function fixedWidthValue(expr: string, width: 2 | 3 | 4, ctx: EvalContext): number {
  const value = evalExpr(expr, ctx) ?? 0;
  const max = 2 ** (width * 8) - 1;
  const min = -(2 ** (width * 8 - 1));
  if (ctx.strict && (value < min || value > max)) {
    fail(ctx, `${width * 8}-bit value out of range: ${expr}`);
  }
  return value;
}

function blockArgs(
  argsText: string,
  ctx: EvalContext,
  op: string,
  reportDiagnostics = true
): { count: number; fill: number } {
  const parts = splitArgs(argsText);
  if (parts.length === 0) {
    if (reportDiagnostics) fail(ctx, `${op} expects a length`);
    return { count: 0, fill: 0 };
  }
  if (parts.length > 2) {
    if (reportDiagnostics) fail(ctx, `${op} expects 1 or 2 argument(s), got ${parts.length}`);
  }
  const rawCount = Math.trunc(evalExpr(parts[0]!, ctx) ?? 0);
  const count = rawCount < 0 ? 0 : rawCount;
  if (rawCount < 0 && reportDiagnostics) warn(ctx, `${op} length is negative; emitting no bytes`);
  const fill = parts[1] !== undefined ? (evalExpr(parts[1]!, ctx) ?? 0) & 0xff : 0;
  return { count, fill };
}

function alignArgs(argsText: string, ctx: EvalContext, reportDiagnostics = true): { next: number; fill: number } {
  const parts = splitArgs(argsText);
  if (parts.length > 2) {
    if (reportDiagnostics) fail(ctx, `ALIGN expects 0, 1, or 2 argument(s), got ${parts.length}`);
  }
  const boundary = Math.trunc(evalExpr(parts[0] ?? '1', ctx) ?? 1);
  if (boundary <= 0) {
    if (reportDiagnostics) fail(ctx, `ALIGN boundary must be positive: ${parts[0] ?? boundary}`);
    return { next: ctx.pc, fill: 0 };
  }
  if ((boundary & (boundary - 1)) !== 0 || boundary > 0x8000) {
    if (reportDiagnostics) fail(ctx, `ALIGN boundary must be a power of two from 1 to 32768: ${parts[0] ?? boundary}`);
    return { next: ctx.pc, fill: 0 };
  }
  const fill = parts[1] !== undefined ? (evalExpr(parts[1]!, ctx) ?? 0) & 0xff : 0;
  return { next: alignAddress(ctx.pc, boundary), fill };
}

function dataArgs(argsText: string, ctx: EvalContext, op: string): string[] {
  const parts = splitArgs(argsText);
  if (parts.length === 0) fail(ctx, `${op} expects at least one value`);
  return parts;
}

function splitArgs(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (opensQuote(text, i)) {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  // After a comma the tail is an element even when empty: `db 1,` has an empty second
  // value (an error) instead of silently assembling as `db 1`.
  const tail = text.slice(start).trim();
  if (tail || out.length > 0) out.push(tail);
  return out;
}

/** Whether a comma-separated argument list has an empty element (`1,`, `1,,2`, `,1`). */
function hasEmptyArgument(text: string): boolean {
  return splitArgs(text).some((part) => part === '');
}

function stripComment(text: string): string {
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (opensQuote(text, i)) quote = ch;
    else if (ch === ';') return text.slice(0, i);
  }
  return text;
}

/**
 * Whether `text` is exactly ONE quoted literal. Checking only the first and last
 * characters made `'a'-'A'` (an expression over two char literals) a 5-byte string.
 */
function isStringLiteral(text: string): boolean {
  return /^"(?:[^"\\]|\\.)*"$/.test(text) || /^'(?:[^'\\]|\\.)*'$/.test(text);
}

function decodeString(text: string, ctx?: EvalContext): number[] {
  const body = text.slice(1, -1);
  const quote = text.charAt(0);
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      out.push(ch.charCodeAt(0));
      continue;
    }
    const n = body[++i];
    if (n === undefined) {
      if (ctx?.strict) fail(ctx, 'Unsupported string escape: trailing backslash');
    } else if (n === 'n') out.push(10);
    else if (n === 'r') out.push(13);
    else if (n === 't') out.push(9);
    else if (n === '\\') out.push(92);
    else if (n === quote) out.push(n.charCodeAt(0));
    else {
      if (ctx?.strict) fail(ctx, `Unsupported string escape: \\${n}`);
      out.push(n.charCodeAt(0));
    }
  }
  return out;
}

function evalExpr(text: string, ctx: EvalContext): number | undefined {
  const parser = new ExprParser(text, ctx);
  const value = parser.parse();
  if (parser.layoutUses.length > 0) {
    // No value: `$` / an address read as 0 here would silently pick the wrong branch.
    if (ctx.strict) ctx.diagnostics.push(diag(ctx.loc, beforeLayoutMessage(ctx.beforeLayout!.directive, parser.layoutUses)));
    return undefined;
  }
  if (ctx.strict) {
    for (const error of parser.syntaxErrors) {
      ctx.diagnostics.push(diag(ctx.loc, error));
    }
    for (const missing of parser.missing) {
      const hint = suggestLabel(missing, [...ctx.symbols.keys()]);
      ctx.diagnostics.push({
        ...diag(ctx.loc, `Label not found: ${missing}`),
        ...(hint ? { hint } : {}),
      });
    }
  }
  return value;
}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'id'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'eof'; value: '' };

class ExprParser {
  readonly tokens: Token[];
  pos = 0;
  missing: string[] = [];
  syntaxErrors: string[] = [];
  /** `$` and code labels read while evaluating before layout (see EvalContext.beforeLayout). */
  layoutUses: string[] = [];
  /** How many operands failed to resolve (a missing symbol, or a layoutUses entry). */
  private unresolved = 0;

  /**
   * `signedView` evaluates the "signed view" used only by the 8-bit range check (see
   * readsAsNegativeByte): true is -1 instead of 0xFFFF and a symbol whose defining value
   * was negative reads as that negative value instead of its 16-bit stored form.
   */
  constructor(
    private readonly text: string,
    private readonly ctx: EvalContext,
    private readonly signedView = false
  ) {
    this.tokens = tokenizeExpr(text);
  }

  private bool(value: boolean): number {
    if (!value) return 0;
    return this.signedView ? -1 : 0xffff;
  }

  parse(): number | undefined {
    const value = this.parseLogicalOr();
    const trailing = this.peek();
    if (trailing.kind !== 'eof') {
      this.syntaxErrors.push(`Unexpected token '${trailing.value}' in expression: ${this.text}`);
    }
    if (value === undefined && this.unresolved === 0 && this.syntaxErrors.length === 0) {
      this.syntaxErrors.push(`Invalid expression: ${this.text}`);
    }
    return value;
  }

  /**
   * Reports a binary operator's missing right operand. An operand that is present but
   * unresolved (`1+nothere`) is not missing: "Label not found" already covers it, and
   * the extra "Missing right operand after '+'" was misleading.
   */
  private requireRight(right: number | undefined, unresolvedBefore: number, op: string | number): void {
    if (right === undefined && this.unresolved === unresolvedBefore) {
      this.syntaxErrors.push(`Missing right operand after '${op}'`);
    }
  }

  private parseLogicalOr(): number | undefined {
    let left = this.parseLogicalAnd();
    while (this.peek().value === '||') {
      this.take('||');
      const before = this.unresolved;
      const right = this.parseLogicalAnd();
      this.requireRight(right, before, '||');
      left = this.bool((left ?? 0) !== 0 || (right ?? 0) !== 0);
    }
    return left;
  }

  private parseLogicalAnd(): number | undefined {
    let left = this.parseOr();
    while (this.peek().value === '&&') {
      this.take('&&');
      const before = this.unresolved;
      const right = this.parseOr();
      this.requireRight(right, before, '&&');
      left = this.bool((left ?? 0) !== 0 && (right ?? 0) !== 0);
    }
    return left;
  }

  private parseCompare(): number | undefined {
    let left = this.parseShift();
    while (['==', '!=', '<', '<=', '>', '>='].includes(String(this.peek().value))) {
      const op = this.take().value;
      const before = this.unresolved;
      const parsedRight = this.parseShift();
      this.requireRight(parsedRight, before, op);
      const lhs = left ?? 0;
      const right = parsedRight ?? 0;
      if (op === '==') left = this.bool(lhs === right);
      else if (op === '!=') left = this.bool(lhs !== right);
      else if (op === '<') left = this.bool(lhs < right);
      else if (op === '<=') left = this.bool(lhs <= right);
      else if (op === '>') left = this.bool(lhs > right);
      else left = this.bool(lhs >= right);
    }
    return left;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: 'eof', value: '' };
  }

  private take(value?: string): Token {
    const t = this.peek();
    if (value !== undefined && t.value !== value) return { kind: 'eof', value: '' };
    this.pos++;
    return t;
  }

  private parseOr(): number | undefined {
    let left = this.parseXor();
    while (this.peek().value === '|') {
      this.take('|');
      const before = this.unresolved;
      const right = this.parseXor();
      this.requireRight(right, before, '|');
      left = (left ?? 0) | (right ?? 0);
    }
    return left;
  }

  private parseXor(): number | undefined {
    let left = this.parseAnd();
    while (this.peek().value === '^') {
      this.take('^');
      const before = this.unresolved;
      const right = this.parseAnd();
      this.requireRight(right, before, '^');
      left = (left ?? 0) ^ (right ?? 0);
    }
    return left;
  }

  private parseAnd(): number | undefined {
    let left = this.parseCompare();
    while (this.peek().value === '&') {
      this.take('&');
      const before = this.unresolved;
      const right = this.parseCompare();
      this.requireRight(right, before, '&');
      left = (left ?? 0) & (right ?? 0);
    }
    return left;
  }

  private parseShift(): number | undefined {
    let left = this.parseAdd();
    while (this.peek().value === '<<' || this.peek().value === '>>' || keyword(this.peek(), 'SHL') || keyword(this.peek(), 'SHR')) {
      const op = this.take().value;
      const before = this.unresolved;
      const right = this.parseAdd();
      this.requireRight(right, before, op);
      left = op === '<<' || upper(String(op)) === 'SHL' ? (left ?? 0) << (right ?? 0) : (left ?? 0) >> (right ?? 0);
    }
    return left;
  }

  private parseAdd(): number | undefined {
    let left = this.parseMul();
    while (this.peek().value === '+' || this.peek().value === '-') {
      const op = this.take().value;
      const before = this.unresolved;
      const right = this.parseMul();
      this.requireRight(right, before, op);
      left = op === '+' ? (left ?? 0) + (right ?? 0) : (left ?? 0) - (right ?? 0);
    }
    return left;
  }

  private parseMul(): number | undefined {
    let left = this.parseUnary();
    while (['*', '/', '%'].includes(String(this.peek().value)) || keyword(this.peek(), 'MOD')) {
      const op = this.take().value;
      const before = this.unresolved;
      const parsedRight = this.parseUnary();
      this.requireRight(parsedRight, before, op);
      const right = parsedRight ?? 0;
      if (op === '*') left = (left ?? 0) * right;
      else if (op === '/') {
        // Flag in strict mode (the final emit pass); stay lenient (0) during
        // non-strict layout passes where a forward reference may still be 0. An
        // unresolved divisor is reported as such, not as a division by zero.
        if (parsedRight === 0) this.syntaxErrors.push('Division by zero');
        left = right === 0 ? 0 : Math.trunc((left ?? 0) / right);
      } else {
        if (parsedRight === 0) this.syntaxErrors.push('Modulo by zero');
        left = right === 0 ? 0 : (left ?? 0) % right;
      }
    }
    return left;
  }

  private parseUnary(): number | undefined {
    if (this.peek().value === '+') {
      this.take('+');
      return this.parseUnary();
    }
    if (this.peek().value === '-') {
      this.take('-');
      return -(this.parseUnary() ?? 0);
    }
    if (this.peek().value === '~') {
      this.take('~');
      return ~(this.parseUnary() ?? 0);
    }
    if (this.peek().value === '!') {
      this.take('!');
      return this.bool((this.parseUnary() ?? 0) === 0);
    }
    if (keyword(this.peek(), 'LOW')) {
      this.take();
      const value = this.parseUnary();
      return value === undefined ? undefined : value & 0xff;
    }
    if (keyword(this.peek(), 'HIGH')) {
      this.take();
      const value = this.parseUnary();
      return value === undefined ? undefined : (value >> 8) & 0xff;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number | undefined {
    const t = this.take();
    if (t.kind === 'num') return t.value;
    if (t.kind === 'id') {
      const resolved = lookupSymbol(t.value, this.ctx, this.signedView);
      if (resolved.value !== undefined) return resolved.value;
      this.unresolved++;
      const layout = this.ctx.beforeLayout;
      if (
        layout &&
        symbolCandidates(t.value, this.ctx.currentGlobal, this.ctx.moduleScope).some((key) => layout.layoutSymbols.has(key))
      ) {
        if (!this.layoutUses.includes(t.value)) this.layoutUses.push(t.value);
        return undefined;
      }
      if (!this.missing.includes(resolved.missing)) this.missing.push(resolved.missing);
      return undefined;
    }
    if (t.value === '$') {
      if (this.ctx.beforeLayout) {
        this.unresolved++;
        if (!this.layoutUses.includes('$')) this.layoutUses.push('$');
        return undefined;
      }
      return this.ctx.pc;
    }
    if (t.value === '(') {
      const value = this.parseLogicalOr();
      this.take(')');
      return value;
    }
    return undefined;
  }
}

/** Operators spelled as words; the tokenizer reads them as identifiers. */
const OPERATOR_KEYWORDS = new Set(['LOW', 'HIGH', 'SHL', 'SHR', 'MOD']);

/**
 * Whether the token before the cursor ends an operand (a number, a symbol, `$` or a
 * closing parenthesis). After an operand, `%` is the modulo operator rather than the
 * prefix of a binary literal: `7%10` is 7 MOD 10, while `%1010` and `1+%1010` are binary.
 */
function endsOperand(out: Token[]): boolean {
  const last = out[out.length - 1];
  if (!last) return false;
  if (last.kind === 'id') return !OPERATOR_KEYWORDS.has(upper(last.value));
  return last.kind === 'num' || last.value === ')' || last.value === '$';
}

function tokenizeExpr(text: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '$') {
      const m = text.slice(i + 1).match(/^[0-9a-fA-F]+/);
      if (m) {
        out.push({ kind: 'num', value: parseInt(m[0], 16) });
        i += 1 + m[0].length;
      } else {
        out.push({ kind: 'op', value: '$' });
        i++;
      }
      continue;
    }
    if (ch === '#') {
      const m = text.slice(i + 1).match(/^[0-9a-fA-F]+/);
      if (m) {
        out.push({ kind: 'num', value: parseInt(m[0], 16) });
        i += 1 + m[0].length;
        continue;
      }
    }
    if (ch === '%' && !endsOperand(out)) {
      const m = text.slice(i + 1).match(/^[01]+/);
      if (m) {
        out.push({ kind: 'num', value: parseInt(m[0], 2) });
        i += 1 + m[0].length;
        continue;
      }
    }
    // A hex literal with an `h` suffix wins over the `0b` binary prefix: `0B0h` is 0xB0
    // and `0B1Fh` is 0xB1F, not `0b0` / `0b1` followed by a stray token.
    const hexSuffix = text.slice(i).match(/^[0-9][0-9a-fA-F]*[hH](?![A-Za-z0-9_.])/);
    if (hexSuffix) {
      out.push({ kind: 'num', value: parseInt(hexSuffix[0].slice(0, -1), 16) });
      i += hexSuffix[0].length;
      continue;
    }
    const binaryPrefix = text.slice(i).match(/^0[bB][01]+/);
    if (binaryPrefix) {
      out.push({ kind: 'num', value: parseInt(binaryPrefix[0].slice(2), 2) });
      i += binaryPrefix[0].length;
      continue;
    }
    const binarySuffix = text.slice(i).match(/^[01]+[bB]\b/);
    if (binarySuffix) {
      out.push({ kind: 'num', value: parseInt(binarySuffix[0].slice(0, -1), 2) });
      i += binarySuffix[0].length;
      continue;
    }
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end > i + 1) {
        out.push({ kind: 'num', value: decodeString(text.slice(i, end + 1).replace(/^'/, '"').replace(/'$/, '"'))[0] ?? 0 });
        i = end + 1;
        continue;
      }
    }
    if (ch === '"') {
      const end = text.indexOf('"', i + 1);
      if (end > i + 1) {
        out.push({ kind: 'num', value: decodeString(text.slice(i, end + 1))[0] ?? 0 });
        i = end + 1;
        continue;
      }
    }
    const num = text.slice(i).match(/^(0x[0-9a-fA-F]+|[0-9][0-9a-fA-F]*[hH]|\d+)/);
    if (num) {
      const raw = num[0];
      const value = raw.startsWith('0x')
        ? parseInt(raw.slice(2), 16)
        : /[hH]$/.test(raw)
          ? parseInt(raw.slice(0, -1), 16)
          : parseInt(raw, 10);
      out.push({ kind: 'num', value });
      i += raw.length;
      continue;
    }
    const id = text.slice(i).match(/^[A-Za-z_.][A-Za-z0-9_.]*/);
    if (id) {
      out.push({ kind: 'id', value: id[0] });
      i += id[0].length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (['<<', '>>', '==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      out.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if ('+-*/%&|^~()<>=!'.includes(ch)) {
      out.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    out.push({ kind: 'op', value: ch });
    i++;
  }
  out.push({ kind: 'eof', value: '' });
  return out;
}

function keyword(token: Token, value: string): boolean {
  return token.kind === 'id' && upper(token.value) === value;
}

function qualifyLabel(label: string, currentGlobal: string, moduleScope: string): string {
  if (label.startsWith('.')) return currentGlobal ? `${currentGlobal}${label}` : label;
  return moduleScope ? `${moduleScope}.${label}` : label;
}

function lookupSymbol(
  label: string,
  ctx: Pick<EvalContext, 'symbols' | 'negativeSymbols' | 'currentGlobal' | 'moduleScope'>,
  signedView = false
): { value: number | undefined; missing: string } {
  const candidates = symbolCandidates(label, ctx.currentGlobal, ctx.moduleScope);
  for (const key of candidates) {
    const value = ctx.symbols.get(key);
    if (value !== undefined) {
      return { value: signedView ? (ctx.negativeSymbols?.get(key) ?? value) : value, missing: key };
    }
  }
  return { value: undefined, missing: candidates[0] ?? label };
}

function symbolCandidates(label: string, currentGlobal: string, moduleScope: string): string[] {
  if (label.startsWith('.')) {
    return currentGlobal ? [`${currentGlobal}${label}`] : [label];
  }
  const candidates: string[] = [];
  if (moduleScope) candidates.push(`${moduleScope}.${label}`);
  candidates.push(label);
  return [...new Set(candidates)];
}

function alignAddress(pc: number, boundary: number): number {
  if (boundary <= 1) return pc;
  return Math.ceil(pc / boundary) * boundary;
}

function makeSld(symbols: SymbolDef[], sourceMap: SourceMapEntry[], sourceLines: SourceLine[]): string {
  const lines = ['|SLD.data.version|1'];
  // Any whitespace after DEVICE (a tab too), like the layout pass that validated it.
  const device = sourceLines.find((l) => /^DEVICE\s/i.test(stripComment(l.text).trim()));
  if (device) {
    lines.push(
      `${device.file}|${device.line}||0|-1|-1|Z|pages.size:16384,pages.count:4,slots.count:4,slots.adr:0,16384,32768,49152`
    );
  }
  for (const s of symbols) {
    lines.push(`${s.file}|${s.line}||0|2|${s.value}|${s.kind}|${s.name}`);
  }
  for (const m of sourceMap) {
    lines.push(`${m.file}|${m.line}||0|2|${m.addr}|T|`);
  }
  return lines.join('\n') + '\n';
}

function emptyResult(errors: Diagnostic[]): AssembleResult {
  return {
    ok: false,
    bytes: new Uint8Array(),
    origin: 0,
    symbols: [],
    sourceMap: [],
    artifacts: [],
    sld: '|SLD.data.version|1\n',
    errors,
    warnings: [],
  };
}

function resultFromLayout(layout: LayoutResult, bytes: Uint8Array, sourceMap: SourceMapEntry[]): AssembleResult {
  return {
    ok: false,
    bytes,
    origin: layout.origin,
    symbols: [...layout.definitions.values()],
    sourceMap,
    artifacts: [],
    sld: '',
    errors: layout.errors,
    warnings: layout.warnings,
  };
}

function diag(loc: SourceLine, message: string): Diagnostic {
  return {
    file: loc.file,
    line: loc.line,
    severity: 'error',
    message: message + macroCallSuffix(loc),
    sourceLine: loc.text.trimEnd(),
  };
}

/**
 * ` (in macro Pair called at line 7)` for a line produced by a macro expansion: the
 * diagnostic points at the macro body line, and this names the invocation that
 * supplied the arguments (the whole chain for nested macros, innermost first).
 */
function macroCallSuffix(loc: SourceLine): string {
  if (!loc.macroStack || loc.macroStack.length === 0) return '';
  const calls = loc.macroStack.map((call) => {
    const where = call.file === loc.file ? `line ${call.line}` : `${basename(call.file)}:${call.line}`;
    return `in macro ${call.name} called at ${where}`;
  });
  return ` (${calls.join(', ')})`;
}

function warn(ctx: EvalContext, message: string): void {
  if (!ctx.strict) return;
  ctx.warnings.push({
    ...diag(ctx.loc, message),
    severity: 'warning',
  });
}

function fail(ctx: EvalContext, message: string): undefined {
  if (ctx.strict) ctx.diagnostics.push(diag(ctx.loc, message));
  return undefined;
}

/**
 * Whether `args` has exactly `count` operands; reports the arity error otherwise. The
 * encoders stop on `false`: reading a missing operand used to leak a JavaScript
 * "Cannot read properties of undefined" error as a second diagnostic.
 */
function expectArgs(op: string, args: string[], count: number, ctx: EvalContext): boolean {
  if (args.length === count) return true;
  fail(ctx, `${op} expects ${count} operand(s), got ${args.length}`);
  return false;
}

function upper(text: string): string {
  return normalizeSpaces(text).toUpperCase();
}

function normalizeSpaces(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function uniqueDiagnostics(items: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const item of items) {
    const key = `${item.file}:${item.line}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sameSymbolValues(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [name, value] of a) {
    if (b.get(name) !== value) return false;
  }
  return true;
}

function suggestLabel(missing: string, labels: string[]): string | undefined {
  let best: { label: string; distance: number } | undefined;
  for (const label of labels) {
    const distance = levenshtein(missing.toLowerCase(), label.toLowerCase());
    if (distance <= 2 && (!best || distance < best.distance)) best = { label, distance };
  }
  return best ? `Did you mean '${best.label}'?` : undefined;
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}
