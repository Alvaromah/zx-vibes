// @zx-vibes/toolkit — public API barrel.
//
// Slice 1 of the v2 regeneration: the skeleton + the three foundational primitive
// services (output envelope, config, stateless session). The build/run/verify/
// observe/preview/scaffold/mcp/reveng services land in later slices and are
// exposed here as they arrive.

// Output envelope + exit codes (cli.md CLI-PROD-CONV-JSON-*, CLI-PROD-OUT-*;
// errors.md ERR-PROD-MODEL-*, ERR-PROD-EXIT-001, ERR-PROD-CLIERR-001).
export {
  ExitCode,
  CliError,
  userError,
  envError,
  hangError,
  successEnvelope,
  errorEnvelope,
  toErrorEnvelope,
  categoryExitCode,
  printEnvelope,
  defaultStreams,
  type ErrorCategory,
  type Envelope,
  type SuccessEnvelope,
  type ErrorEnvelope,
  type OutputStreams,
  type PrintOptions,
} from './output/envelope.js';

// Config service (config-schema.md CFG-PROD-*; toolkit-runtime.md RT-PROD-CONFIG-001).
export {
  CONFIG_FILE,
  DEFAULT_ORG,
  DEFAULT_ASSEMBLER,
  DEFAULT_OUT_DIR,
  loadProjectConfig,
  normalizeAssembler,
  resolveConfig,
  requireEntry,
  type Assembler,
  type ZxProjectConfig,
  type ResolvedConfig,
  type ConfigFlags,
  type ResolveOptions,
} from './config/config.js';

// Stateless session over @zx-vibes/machine (toolkit-runtime.md RT-PROD-SESSION-*).
export {
  Session,
  createSession,
  bootFreshMachine,
  loadBinMachine,
  loadBytesMachine,
  DEFAULT_BIN_ORG,
  FRESH_SOURCE,
  type MachineSource,
  type SessionOptions,
} from './runtime/session.js';
export { loadRom, romBootMemory, ROM_SIZE } from './runtime/rom.js';

// Run service (cli.md CLI-PROD-RUN-*, CLI-PROD-OUT-RUN-*; toolkit-runtime.md
// RT-PROD-RUN-*; errors.md ERR-PROD-HANG-*).
export {
  runProgram,
  runCommand,
  configureRunCommand,
  buildRunEnvelope,
  DEFAULT_FRAMES,
  UNTIL_BREAK_MIN_FRAMES,
  CPU_CLOCK_HZ,
  type RunParams,
  type RunResult,
  type RunStatus,
  type RunAudio,
  type RunBoot,
  type RunExit,
  type RunEnvelope,
  type RunSuccessEnvelope,
  type RunHangEnvelope,
} from './runtime/run.js';
export { HostIo, DEFAULT_BORDER, type BeeperEdge } from './runtime/io-device.js';
export {
  type HangKind,
  type HangVerdict,
  type HangStats,
  definiteHang,
  probableHang,
} from './runtime/hang.js';
export {
  parseKeySchedule,
  parseJoySchedule,
  keysPressedAt,
  joyByteAt,
  keyboardByte,
  joyByte,
  planFrames,
  normalizeKeyToken,
  DEFAULT_HOLD,
  type KeyEvent,
  type JoyEvent,
} from './runtime/schedule.js';

// Observe primitives (cli.md CLI-PROD-REGS-001 / CLI-PROD-SCREEN-001; shared with
// the standalone observe commands in a later slice).
export {
  readRegisters,
  decodeFlags,
  type RegisterSnapshot,
  type FlagBits,
} from './observe/registers.js';
export {
  readScreenImage,
  summarizeScreen,
  nonBlankCells,
  nonBlankCellsImage,
  attrNonBlankCount,
  hashBytes,
  SCREEN_IMAGE_SIZE,
  SCREEN_BASE,
  DEFAULT_ATTR,
  type ScreenSummary,
  // Framebuffer renderer + OCR (screen-render.md SCREEN-FRAMEBUFFER-001 /
  // SCREEN-PALETTE-001; the shared seam for Slice 7's screen png/base64 + diff).
  FRAME_WIDTH,
  FRAME_HEIGHT,
  FRAME_SIZE,
  PALETTE_RGB,
  paletteRgb,
  framePixelOn,
  framePixelIndex,
  framePixelRgb,
  renderIndexFrame,
  renderRgbaImage,
  diffPixelCount,
  romFontGlyphs,
  ocrScreenRows,
  screenIncludesText,
  type RgbaImage,
} from './observe/screen.js';

// Address / range argument parsing (cli.md CLI-PROD-CONV-ADDR-001 / -RANGE-001).
export { parseAddress, parseNumber, parseRange, type AddressRange } from './util/address.js';

// Build service (cli.md CLI-PROD-BUILD-*, CLI-PROD-OUT-BUILD-*; toolkit-runtime.md
// RT-PROD-BUILD-001; errors.md ERR-PROD-ASM-*).
export {
  runBuild,
  buildCommand,
  configureBuildCommand,
  type BuildOptions,
  type BuildEnvelope,
  type BuildSuccessEnvelope,
  type BuildErrorEnvelope,
  type BuildOutputs,
  type BuildDiagnostic,
} from './build/build.js';
// Loadable-format seam (cli.md CLI-PROD-BUILD-003; toolkit-runtime.md RT-PROD-FORMATS-001).
export {
  deferredFormatsEmitter,
  realFormatsEmitter,
  requestedFormats,
  tapImageBytes,
  scrImageBytes,
  z80SnapshotBytes,
  tapeCodeHeader,
  FORMAT_KINDS,
  TAP_HEADER_FLAG,
  TAP_DATA_FLAG,
  TAPE_TYPE_CODE,
  TAPE_HEADER_LENGTH,
  type FormatKind,
  type FormatRequest,
  type FormatArtifact,
  type FormatsContext,
  type FormatsEmitter,
} from './build/formats.js';

// Declarative test runner + assertion engine (cli.md CLI-PROD-TEST-001 /
// CLI-PROD-OUT-TEST-001; toolkit-runtime.md RT-PROD-TEST-*; recipes-and-assertions.md).
export {
  runTestSuite,
  runSpec,
  discoverSpecs,
  testCommand,
  configureTestCommand,
  buildTestEnvelope,
  DEFAULT_TEST_FRAMES,
  SKIP_DIRS,
  type SpecResult,
  type SuiteResult,
  type TestEnvelope,
  type TestSuccessEnvelope,
  type TestErrorEnvelope,
} from './test/runner.js';
export {
  evaluateAssertion,
  asAssertion,
  collectCheckpointFrames,
  ASSERTION_REFERENCE,
  ASSERTION_TYPES,
  type RawAssertion,
  type AssertStatus,
  type Snapshot,
  type RunContext,
  type AssertionDoc,
} from './test/assertions.js';

// Verify acceptance pipeline (cli.md CLI-PROD-VERIFY-*, CLI-PROD-OUT-VERIFY-*,
// CLI-PROD-RULE-VERIFY-001; toolkit-runtime.md RT-PROD-VERIFY-*). Composes the real
// `run` report (`runProgram` + `buildRunEnvelope`) — not a trimmed re-implementation.
export {
  runVerify,
  verifyCommand,
  configureVerifyCommand,
  DEFAULT_VERIFY_SCREENSHOT,
  TESTS_DIR,
  type VerifyOptions,
  type VerifyEnvelope,
  type VerifySuccessEnvelope,
  type VerifyErrorEnvelope,
} from './verify/verify.js';
// Screenshot codec — the one PNG path (cli.md CLI-PROD-RULE-SCREENSHOT-001): encode/decode
// + the `--scale` zoom, shared by `screen --png`/`--base64`/`--diff`, `run --screenshot`,
// `verify`, and the `screenDiff` assertion.
export { encodePng, decodePng, scaleRgba, writePng, captureScreenshot } from './observe/screenshot.js';

// Read-only observe command group (Slice 7a) — cli.md CLI-PROD-SCREEN/REGS/MEM/DISASM/
// STEP/TRACE/SYMBOLS/COVERAGE-*, toolkit-runtime.md RT-PROD-OBSERVE-001.
export {
  resolveObserveMachine,
  type ObserveBoot,
  type ObserveSource,
  type ObserveSourceOptions,
  type SymbolDef,
  type SourceMapEntry,
} from './observe/source.js';
export {
  runScreen,
  screenCommand,
  configureScreenCommand,
  type ScreenEnvelope,
  type ScreenSuccessEnvelope,
  type ScreenErrorEnvelope,
  type ScreenDiff,
  type ScreenOptions,
} from './observe/screen-command.js';
export {
  runRegs,
  runRegsSet,
  setRegister,
  regsCommand,
  configureRegsCommand,
  type RegsEnvelope,
  type RegsSetEnvelope,
  type RegsOptions,
  type RegsSetOptions,
} from './observe/regs-command.js';
export {
  runMemRead,
  runMemDump,
  runMemWrite,
  runMemLoad,
  memCommand,
  configureMemCommand,
  hexBytes,
  asciiBytes,
  parseHexBytes,
  DEFAULT_MEM_LEN,
  type MemEnvelope,
  type MemReadOptions,
  type MemDumpOptions,
  type MemWriteOptions,
  type MemLoadOptions,
} from './observe/memory.js';
export {
  runDisasm,
  disasmCommand,
  configureDisasmCommand,
  resolveDisasmSpec,
  DEFAULT_DISASM_COUNT,
  type DisasmEnvelope,
  type DisasmEntry,
  type DisasmOptions,
} from './observe/disasm.js';
export {
  runStep,
  stepCommand,
  configureStepCommand,
  DEFAULT_STEPS,
  type StepEnvelope,
  type StepEntry,
  type StepOptions,
} from './observe/step.js';
export {
  runTrace,
  traceCommand,
  configureTraceCommand,
  DEFAULT_TRACE_FRAMES,
  DEFAULT_TRACE_TOP,
  DEFAULT_TRACE_LAST,
  type TraceEnvelope,
  type TraceHotspot,
  type TraceLine,
  type TraceOptions,
} from './observe/trace.js';
export {
  runSymbols,
  symbolsCommand,
  configureSymbolsCommand,
  type SymbolsEnvelope,
  type SymbolsDumpEnvelope,
  type SymbolsGetEnvelope,
  type SymbolEntry,
  type SymbolsOptions,
} from './observe/symbols.js';
export {
  runCoverage,
  coverageCommand,
  configureCoverageCommand,
  DEFAULT_COVERAGE_FRAMES,
  type CoverageEnvelope,
  type CoverageRoutine,
  type CoverageOptions,
} from './observe/coverage.js';

// Input + persistent-debug command group (Slice 7b) — cli.md CLI-PROD-INPUT-* /
// CLI-PROD-STATE-* / CLI-PROD-BREAK-* / CLI-PROD-WATCH-*; toolkit-runtime.md
// RT-PROD-SESSION-*; file-formats.md FF-ZXSTATE-001; mcp-tools.md MCP-PROD-RULE-INTEROP-001.
export {
  // The `.zxstate` session codec (the CLI↔MCP interop contract).
  serializeZxState,
  deserializeZxState,
  ZXSTATE_EMULATOR_ID,
  ZXSTATE_FORMAT,
  ZXSTATE_VERSION,
  type SessionState,
} from './state/zxstate.js';
export {
  // The persistent breakpoint/watchpoint store.
  emptyDebugStore,
  normalizeDebugStore,
  addBreakpoint,
  addWatchpoint,
  removeBreakpoints,
  removeWatchpoints,
  type Breakpoint,
  type Watchpoint,
  type DebugStore,
} from './state/debug-store.js';
export {
  // On-disk persistence + the mutation-session helper.
  openSession,
  loadSession,
  saveSession,
  sessionExists,
  loadDebugStore,
  saveDebugStore,
  debugStorePath,
  defaultStatePath,
  ZXS_DIR,
  DEBUG_STORE_FILE,
  DEFAULT_STATE_PATH,
  type OpenSessionOptions,
  type MutationSession,
} from './state/persist.js';
export {
  // `state` command (save/load/reset/export-z80).
  runStateSave,
  runStateLoad,
  runStateReset,
  runStateExportZ80,
  runStateExportTap,
  runStateExportScr,
  exportZ80Bytes,
  stateCommand,
  configureStateCommand,
  type StateEnvelope,
  type StateCommonOptions,
} from './state/state-command.js';
export {
  // `break` + `watch` commands.
  breakCommand,
  configureBreakCommand,
  watchCommand,
  configureWatchCommand,
  resolveBreakSpec,
  type BreakEnvelope,
  type WatchEnvelope,
} from './state/debug-command.js';
export {
  // `key` + `type` input commands.
  runKey,
  runType,
  keyCommand,
  typeCommand,
  configureKeyCommand,
  configureTypeCommand,
  DEFAULT_FRAMES_PER_KEY,
  INPUT_SETTLE_FRAMES,
  type InputEnvelope,
} from './input/input-command.js';

// Preview server + bundled core player (Slice 8b) — cli.md CLI-PROD-PREVIEW-001/002,
// CLI-PROD-RULE-PREVIEW-PORT-001 / -OWN-001; toolkit-runtime.md RT-PROD-PREVIEW-001..005.
export {
  resolvePreviewProgram,
  programMeta,
  type PreviewProgram,
  type PreviewProgramMeta,
  type ResolveProgramOptions,
} from './preview/program.js';
export {
  createPreviewServer,
  DEFAULT_PREVIEW_PORT,
  DEFAULT_PORT_ATTEMPTS,
  PREVIEW_HOST,
  type PreviewServer,
  type PreviewServerOptions,
} from './preview/server.js';
export {
  previewRecordPath,
  readPreviewRecord,
  writePreviewRecord,
  removePreviewRecord,
  pingServer,
  stopServer,
  newToken,
  baseUrlFor,
  PREVIEW_OWNER,
  PREVIEW_RECORD_FILE,
  ZXS_DIR as PREVIEW_ZXS_DIR,
  type PreviewRecord,
  type StopOutcome,
} from './preview/lifecycle.js';
export { SourceWatcher, DEFAULT_WATCH_INTERVAL_MS } from './preview/watch.js';
export {
  findPlayerBundlePath,
  readPlayerBundle,
  playerBundleExists,
  playerHtml,
} from './preview/player-asset.js';
export {
  previewCommand,
  configurePreviewCommand,
  runPreviewList,
  runPreviewStop,
  type PreviewParams,
} from './preview/preview-command.js';

// Project scaffold command group (Slice 9) — cli.md CLI-PROD-NEW-001 / INIT-001 / CLEAN-001,
// CLI-PROD-OUT-NEW-001, CLI-PROD-EDGE-004; config-schema.md CFG-PROD-*; knowledge-pack.md
// KP-PROD-CONTENT-PLAYBOOK-001. Emits a MINIMAL verify-passing project; the rich starter
// templates + SCAFFOLD-VERIFY-001 belong to W5 (`create-zx-vibes` / `starters/`).
export {
  runNew,
  runInit,
  runClean,
  newCommand,
  initCommand,
  cleanCommand,
  configureNewCommand,
  configureInitCommand,
  configureCleanCommand,
  DEFAULT_TEMPLATE,
  TOOLKIT_ID,
  SCAFFOLD_ENTRY,
  ENTRY_ASM,
  SMOKE_TEST_JSON,
  GITIGNORE,
  PLAYBOOK,
  type NewOptions,
  type InitOptions,
  type CleanOptions,
  type NewEnvelope,
  type InitEnvelope,
  type CleanEnvelope,
} from './scaffold/scaffold.js';

// Environment + agent-config command group (Slice 11a) — cli.md CLI-PROD-DOCTOR-001 /
// CLI-PROD-OUT-DOCTOR-001 / CLI-PROD-SETUP-001; errors.md ERR-PROD-ENV-001 (exit 3);
// knowledge-pack.md KP-PROD-PKG-001 / KP-PROD-CONTENT-PLAYBOOK-001.
export {
  runDoctor,
  doctorCommand,
  configureDoctorCommand,
  MIN_NODE_MAJOR,
  type DoctorEnvelope,
  type DoctorSuccessEnvelope,
  type DoctorErrorEnvelope,
  type DoctorCheck,
  type DoctorOptions,
} from './doctor/doctor.js';
export {
  runSetup,
  setupCommand,
  configureSetupCommand,
  normalizeAgent,
  MCP_SERVER_NAME,
  MCP_SERVER_COMMAND,
  SKILL_NAME,
  DEFERRED_PACK_CONTENT,
  type SetupAgent,
  type SetupEnvelope,
  type SetupOptions,
} from './setup/setup.js';

// Core graphics decode (Slice 11a) — cli.md CLI-PROD-GFX-001/002/003; toolkit-runtime.md
// RT-PROD-OBSERVE-001 (the one screenshot encoder). `gfx linear` / `gfx attrs` decode the
// agent's own Spectrum graphics data TO a PNG; reveng `find`/`blit-linear` = Slice 11b.
export {
  runGfxLinear,
  runGfxAttrs,
  gfxCommand,
  configureGfxCommand,
  GFX_PRESETS,
  ATTR_FILE_ADDR,
  DEFAULT_INK,
  DEFAULT_PAPER,
  type GfxEnvelope,
  type GfxLinearOptions,
  type GfxAttrsOptions,
  type PresetGeometry,
} from './gfx/gfx.js';

// The optional reverse-engineering gfx hook (cli.md CLI-PROD-GFX-003 / CLI-PROD-REVENG-001):
// the dependency-inversion seam core `gfx` consults for `find`/`blit-linear` (add-on-filled).
export {
  setRevengGfxHandler,
  getRevengGfxHandler,
  clearRevengGfxHandler,
  type RevengGfxHandler,
  type RevengGfxEnvelope,
} from './gfx/reveng-hook.js';

// The optional reverse-engineering ADD-ON (Slice 11b) — cli.md CLI-PROD-REVENG-001,
// ADR-0027 D5; CLI-PROD-FREE-003. `snapshot`/`scan`/`xref` + reveng `gfx find`/`blit-linear`,
// mounted onto the registry by `registerRevengAddon` (NOT core, NOT an MCP tool).
export {
  registerRevengAddon,
  REVENG_COMMANDS,
  runSnapshotInfo,
  runSnapshotMem,
  runSnapshotRam,
  snapshotCommand,
  configureSnapshotCommand,
  runScanBytes,
  runScanImm,
  scanCommand,
  configureScanCommand,
  parsePattern,
  runXref,
  xrefCommand,
  configureXrefCommand,
  runGfxFind,
  runGfxBlitLinear,
  graphicsScore,
  revengGfxHandler,
  loadRevengImage,
  loadSnapshotFile,
  snaUnsupported,
  DEFAULT_BIN_ORG as REVENG_DEFAULT_BIN_ORG,
  type SnapshotEnvelope,
  type SnapshotInfoEnvelope,
  type SnapshotDumpEnvelope,
  type ScanEnvelope,
  type ScanByteMatch,
  type ScanImmMatch,
  type XrefEnvelope,
  type XrefEntry,
  type XrefKind,
  type GfxFindEnvelope,
  type GfxFindCandidate,
  type GfxBlitEnvelope,
  type RevengImage,
  type RevengSource,
  type RevengSourceOptions,
} from './reveng/index.js';

// Command registry + CLI dispatcher (cli.md CLI-PROD-CMDSET-001, CLI-PROD-PKG-004).
export {
  CommandRegistry,
  createRegistry,
  DEFERRED_COMMANDS,
  type CommandSpec,
  type CommandHandler,
  type CommandContext,
} from './registry.js';
export { runCli, readVersion, revengAddonEnabled, type RunCliOptions } from './cli.js';
export { runMcp, type RunMcpOptions } from './mcp.js';
