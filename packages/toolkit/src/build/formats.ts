// Loadable-format seam for `build` — cli.md CLI-PROD-BUILD-003,
// toolkit-runtime.md RT-PROD-FORMATS-001, file-formats.md codecs.
//
// `zxs build` can additionally emit loadable `.tap`/`.scr`/`.z80` artifacts via
// `--tap`/`--scr`/`--z80` (CLI-PROD-BUILD-003). Those are OPT-IN flags, not part
// of the default `bin`+`sld` build (CLI-PROD-BUILD-001/002), so they are deferred
// to the **formats slice** without contradicting the spec.
//
// This file is the typed seam the build service calls. The slice ships a
// `deferredFormatsEmitter` whose `supported` set is empty: a requested format is
// rejected up front with a clear "not implemented yet" error (no silent
// breakage, errors.md ERR-PROD-NOSILENT-001) rather than silently producing no
// `.tap`. The formats slice replaces this with a real emitter (non-empty
// `supported`, a working `emit`) backed by the `@zx-vibes/machine` codecs; the
// build's `outputs.artifacts` array already carries whatever it returns.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import type { AssembleResult } from '@zx-vibes/asm';
import { serializeTap, writeZ80, type Machine } from '@zx-vibes/machine';
import { readScreenImage } from '../observe/screen.js';
import { DEFAULT_BORDER } from '../runtime/io-device.js';
import { loadBytesMachine } from '../runtime/session.js';

/** The loadable artifact kinds `build` can emit (CLI-PROD-BUILD-003). */
export type FormatKind = 'tap' | 'scr' | 'z80';

export const FORMAT_KINDS: readonly FormatKind[] = ['tap', 'scr', 'z80'];

/**
 * Requested loadable outputs. Each flag is either absent, `true` (emit beside the
 * binary at the default name), or a string path (emit there). Mirrors the
 * `--tap [path]` / `--scr [path]` / `--z80 [path]` CLI flag shape.
 */
export interface FormatRequest {
  tap?: string | boolean | undefined;
  scr?: string | boolean | undefined;
  z80?: string | boolean | undefined;
}

/** One emitted loadable artifact: its kind and the absolute path written. */
export interface FormatArtifact {
  kind: FormatKind;
  path: string;
}

/**
 * What an emitter needs to build loadable artifacts from a successful assemble:
 * the assembled bytes/origin/symbols (`result`), where the binary landed, and the
 * output directory. The formats slice consumes this; the deferred stub ignores it.
 */
export interface FormatsContext {
  cwd: string;
  /** Absolute, resolved output directory (`outDir`). */
  outDir: string;
  /** The entry path (used to derive default artifact names). */
  entry: string;
  /** Absolute path of the written `.bin` (the binary the formats wrap). */
  binPath: string;
  /** The assembler result (bytes, origin, symbols, sld). */
  result: AssembleResult;
}

/**
 * Builds loadable `.tap`/`.scr`/`.z80` artifacts from a built binary
 * (RT-PROD-FORMATS-001). `supported` names the kinds this emitter can produce;
 * the build service rejects any requested kind not in `supported` BEFORE
 * assembling, so a deferred kind never half-builds.
 */
export interface FormatsEmitter {
  /** The format kinds this emitter can produce (empty in the deferred stub). */
  readonly supported: ReadonlySet<FormatKind>;
  /** Emit the requested artifacts after a successful assemble. */
  emit(request: FormatRequest, context: FormatsContext): FormatArtifact[];
}

/** The format kinds a request actually asks for (truthy flag value). */
export function requestedFormats(request: FormatRequest | undefined): FormatKind[] {
  if (!request) return [];
  return FORMAT_KINDS.filter((kind) => {
    const value = request[kind];
    return value === true || (typeof value === 'string' && value.length > 0);
  });
}

// ===========================================================================
// Real emitter — the loadable `.tap`/`.scr`/`.z80` byte producers + the
// FormatsEmitter the build service and `state export` route through. Every byte
// layout is DELEGATED to the `@zx-vibes/machine` codecs (serializeTap / writeZ80)
// and the existing screen primitive (readScreenImage); the toolkit only
// orchestrates which bytes to wrap and where to write them. (file-formats.md
// FF-TAP-001 / FF-SCR-001 / FF-Z80-001 -> domain/file-formats.md FMT-TAP-* /
// FMT-SCR-* + snapshot-z80.md; the `.tap` two-block structure traces to the DNA
// tape acceptance harness dna/conformance/tape/run-tape-edge-load-accept.mjs.)
// ===========================================================================

/** `.tap` block-type (flag) bytes (FMT-TAP-FLAG-001): 0x00 header, 0xFF data. */
export const TAP_HEADER_FLAG = 0x00;
export const TAP_DATA_FLAG = 0xff;
/** Standard ZX tape header file type for a CODE block (`SAVE "name" CODE`). */
export const TAPE_TYPE_CODE = 3;
/** Length of the standard ZX tape header: type(1) + name(10) + 3 LE words. */
export const TAPE_HEADER_LENGTH = 17;
/** The CODE header's param2 (the ROM SAVE "...CODE" default), carried verbatim. */
const TAPE_CODE_PARAM2 = 0x8000;

/**
 * Build the 17-byte standard ZX tape header for a CODE block — the data carried in
 * a header block (flag 0x00): `type(1) + name(10, space-padded) + length(2 LE) +
 * param1(2 LE) + param2(2 LE)`. For CODE, `param1` is the load address. This is the
 * exact header layout the DNA tape acceptance harness pins
 * (`dna/conformance/tape/run-tape-edge-load-accept.mjs` `tapeHeader17`); the toolkit
 * does not invent any byte. The fields are not interpreted by `edgeLoad`/`instantLoad`
 * (which take the register contract directly) — they make the tape a faithful
 * `SAVE "name" CODE` image that round-trips through `parseTap`.
 */
export function tapeCodeHeader(name: string, length: number, loadAddress: number): Uint8Array {
  const h = new Uint8Array(TAPE_HEADER_LENGTH);
  h[0] = TAPE_TYPE_CODE & 0xff;
  const padded = (name + ' '.repeat(10)).slice(0, 10);
  for (let i = 0; i < 10; i += 1) h[1 + i] = padded.charCodeAt(i) & 0xff;
  h[11] = length & 0xff;
  h[12] = (length >> 8) & 0xff;
  h[13] = loadAddress & 0xff;
  h[14] = (loadAddress >> 8) & 0xff;
  h[15] = TAPE_CODE_PARAM2 & 0xff;
  h[16] = (TAPE_CODE_PARAM2 >> 8) & 0xff;
  return h;
}

/**
 * Wrap a code image as a loadable `.tap`: a header block (flag 0x00, the 17-byte CODE
 * header) followed by a data block (flag 0xFF, the program bytes), serialized by the
 * core `serializeTap` (FMT-TAP-* — `[len LE][flag][data][XOR checksum]`, the length
 * prefix + per-block checksum delegated to the codec). This is exactly what a real
 * `SAVE "name" CODE` produces and what the DNA tape acceptance harness builds; it
 * round-trips through `parseTap` and the data block edge-/instant-loads to
 * `loadAddress`.
 */
export function tapImageBytes(options: {
  bytes: Uint8Array;
  loadAddress: number;
  name: string;
}): Uint8Array {
  const header = tapeCodeHeader(options.name, options.bytes.length, options.loadAddress);
  return serializeTap([
    { flag: TAP_HEADER_FLAG, data: header },
    { flag: TAP_DATA_FLAG, data: options.bytes },
  ]);
}

/**
 * The 6912-byte `.scr` screen image (display file + attribute file) — a raw copy of
 * memory `0x4000`–`0x5AFF` (FMT-SCR-*). Delegated to the existing screen primitive
 * (`readScreenImage`), which is byte-identical to the framebuffer input.
 */
export function scrImageBytes(machine: Machine): Uint8Array {
  return readScreenImage(machine);
}

/**
 * A `.z80` **version 3** snapshot of a machine via the core `writeZ80` (FF-Z80-001).
 * This is the `build --z80` path: CLI-PROD-BUILD-003 is spec-silent on version, so the
 * core's v3 is correct here (W4-GAP-02). It is DISTINCT from `state export --z80`, which
 * the toolkit emits as v1 (`exportZ80Bytes`); the two `.z80` paths legitimately differ.
 * Round-trips through `readZ80` (`version === 3`), reproducing RAM + PC + border.
 */
export function z80SnapshotBytes(machine: Machine, border: number = DEFAULT_BORDER): Uint8Array {
  return writeZ80({ registers: machine.registers, memory: machine.memory, border });
}

/** Default `.tap`/`.scr`/`.z80` name (≤10 char tape name) derived from the entry stem. */
function tapeName(entry: string): string {
  const stem = basename(entry, extname(entry));
  return stem.length > 0 ? stem : 'program';
}

/**
 * The absolute path to write a requested format to: an explicit `--<kind> <path>`
 * (resolved against `cwd`), else beside the binary with the same stem and a
 * `.<kind>` extension (the default `--<kind>` flag form).
 */
function formatTargetPath(
  value: string | boolean | undefined,
  kind: FormatKind,
  context: FormatsContext,
): string {
  if (typeof value === 'string' && value.length > 0) {
    return resolve(context.cwd, value);
  }
  const stem = context.binPath
    ? context.binPath.replace(/\.[^.\\/]*$/, '')
    : resolve(context.outDir, basename(context.entry, extname(context.entry)));
  return `${stem}.${kind}`;
}

/**
 * The real loadable-format emitter (RT-PROD-FORMATS-001): supports `tap`/`scr`/`z80`,
 * all produced from the build's assembled bytes. `.scr`/`.z80` are taken from a machine
 * with the program loaded at its origin (PC = origin) — the same `loadBytesMachine`
 * boot every observe command uses — so the `.z80` carries RAM + PC and the `.scr`
 * captures the program's screen memory. `.tap` wraps the bytes as a CODE tape. Each
 * artifact is written to disk and returned with its absolute path; the build service
 * normalizes those into `outputs.artifacts`.
 */
export const realFormatsEmitter: FormatsEmitter = {
  supported: new Set<FormatKind>(FORMAT_KINDS),
  emit(request, context): FormatArtifact[] {
    const wanted = requestedFormats(request);
    if (wanted.length === 0) return [];
    // Only build the machine when a machine-backed format (.scr/.z80) is requested.
    const needsMachine = wanted.includes('scr') || wanted.includes('z80');
    const machine = needsMachine
      ? loadBytesMachine(context.result.bytes, context.result.origin)
      : undefined;
    const name = tapeName(context.entry);

    const artifacts: FormatArtifact[] = [];
    for (const kind of wanted) {
      let bytes: Uint8Array;
      switch (kind) {
        case 'tap':
          bytes = tapImageBytes({
            bytes: context.result.bytes,
            loadAddress: context.result.origin,
            name,
          });
          break;
        case 'scr':
          bytes = scrImageBytes(machine!);
          break;
        case 'z80':
          bytes = z80SnapshotBytes(machine!);
          break;
      }
      const target = formatTargetPath(request[kind], kind, context);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      artifacts.push({ kind, path: target });
    }
    return artifacts;
  },
};

/**
 * The pre-formats-slice stub: produces nothing and supports nothing. Retained for the
 * historical seam (and as a "reject every loadable format" emitter a caller can inject);
 * the build service now defaults to {@link realFormatsEmitter}.
 */
export const deferredFormatsEmitter: FormatsEmitter = {
  supported: new Set<FormatKind>(),
  emit(): FormatArtifact[] {
    return [];
  },
};
