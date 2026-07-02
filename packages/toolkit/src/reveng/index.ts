// The reverse-engineering ADD-ON (cli.md CLI-PROD-REVENG-001, ADR-0027 D5; CLI-PROD-FREE-003).
//
// A self-contained, OPTIONAL module — NOT part of the core command set (CLI-PROD-CMDSET-001)
// and NOT an MCP tool (mcp-tools.md MCP-PROD-RULE-SUBSET-001). It inspects THIRD-PARTY games
// (an agent building its own rarely needs it), preserving the legacy `snapshot info` JSON
// shape. It is mounted on top of the core registry by `registerRevengAddon`, which is the
// single opt-in seam: core (`createRegistry`) never references it, so its absence is the
// documented default and removing this one mount call removes the whole add-on (D5).
//
// Independently gated (D5): the add-on has its own conformance self-test
// (`dna/conformance/reveng/run-reveng-self-test.mjs`, wired into `conformance:check:toolkit`),
// so it is verified as a separable unit rather than folded into the core toolkit gate.

import type { CommandRegistry } from '../registry.js';
import { setRevengGfxHandler } from '../gfx/reveng-hook.js';
import { snapshotCommand, configureSnapshotCommand } from './snapshot.js';
import { scanCommand, configureScanCommand } from './scan.js';
import { xrefCommand, configureXrefCommand } from './xref.js';
import { revengGfxHandler } from './gfx-reveng.js';

/** The optional reverse-engineering top-level commands (NOT in the core CLI-PROD-CMDSET-001 set). */
export const REVENG_COMMANDS: ReadonlyArray<{ name: string; summary: string }> = [
  { name: 'snapshot', summary: '[reveng add-on] Inspect a third-party snapshot (info | mem | ram)' },
  { name: 'scan', summary: '[reveng add-on] Opcode / immediate-range memory search' },
  { name: 'xref', summary: '[reveng add-on] Find static references to an address' },
];

/**
 * Mount the reverse-engineering add-on onto a registry: register `snapshot` / `scan` /
 * `xref`, and install the reveng `gfx find` / `gfx blit-linear` handler into the core
 * `gfx` hook. This is the ONLY coupling point between core and the add-on; call it (the
 * CLI does, gated) to enable the add-on, omit it to run pure core.
 */
export function registerRevengAddon(registry: CommandRegistry): void {
  registry.register({ name: 'snapshot', summary: REVENG_COMMANDS[0]!.summary, run: snapshotCommand, configure: configureSnapshotCommand });
  registry.register({ name: 'scan', summary: REVENG_COMMANDS[1]!.summary, run: scanCommand, configure: configureScanCommand });
  registry.register({ name: 'xref', summary: REVENG_COMMANDS[2]!.summary, run: xrefCommand, configure: configureXrefCommand });
  setRevengGfxHandler(revengGfxHandler);
}

export {
  runSnapshotInfo,
  runSnapshotMem,
  runSnapshotRam,
  snapshotCommand,
  configureSnapshotCommand,
  DEFAULT_SNAPSHOT_MEM_LEN,
  SNAPSHOT_RAM_INLINE_CAP,
  type SnapshotEnvelope,
  type SnapshotInfoEnvelope,
  type SnapshotDumpEnvelope,
  type SnapshotInfoOptions,
  type SnapshotMemOptions,
  type SnapshotRamOptions,
} from './snapshot.js';
export {
  runScanBytes,
  runScanImm,
  scanCommand,
  configureScanCommand,
  parsePattern,
  type ScanEnvelope,
  type ScanByteMatch,
  type ScanImmMatch,
  type ScanBytesOptions,
  type ScanImmOptions,
} from './scan.js';
export {
  runXref,
  xrefCommand,
  configureXrefCommand,
  type XrefEnvelope,
  type XrefEntry,
  type XrefKind,
  type XrefOptions,
} from './xref.js';
export {
  runGfxFind,
  runGfxBlitLinear,
  graphicsScore,
  revengGfxHandler,
  FIND_DEFAULT_WINDOW,
  FIND_DEFAULT_STRIDE,
  FIND_DEFAULT_TOP,
  FIND_DEFAULT_MIN_SCORE,
  type GfxFindEnvelope,
  type GfxFindCandidate,
  type GfxFindOptions,
  type GfxBlitEnvelope,
  type GfxBlitOptions,
} from './gfx-reveng.js';
export {
  loadRevengImage,
  loadSnapshotFile,
  snaUnsupported,
  DEFAULT_BIN_ORG,
  type RevengImage,
  type RevengSource,
  type RevengSourceOptions,
} from './snapshot-source.js';
