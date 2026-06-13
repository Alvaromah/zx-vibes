# zx-vibes — Code Review Findings

**Date:** 2026-06-13
**Scope:** Full monorepo review for bugs, correctness issues, security risks, and
maintainability hazards across all five packages (`emulator`, `asm`, `toolkit`,
`create-zx-vibes`, `zx-vibes`) plus build/CI/packaging configuration.

## How to read this

Findings are grouped **by area** and, inside each area, ordered **by priority**
(Critical → High → Medium → Low). Each item gives a `file:line` reference, the
concrete reason it is a problem, and a suggested fix.

Severity legend:

| Level | Meaning |
|-------|---------|
| **Critical** | Breaks a core use case in production, or a real security exposure. |
| **High** | Wrong results / crashes / pipeline failures under normal use. |
| **Medium** | Incorrect in edge cases, robustness gaps, or accuracy deviations. |
| **Low** | Minor correctness/accuracy nits, dead code, cosmetic. |

Items marked **(verified)** were inspected directly against the source during
this review. Items marked **(needs verification)** are plausible from analysis
but were not exhaustively confirmed (e.g. behaviour against a reference
emulator/assembler).

---

## Top priorities (fix these first)

1. **Published CLI bins are dead on a real install** — every `zx-vibes` bin imports
   through a hardcoded `../node_modules/...` path. *(Critical — §6)*
2. **MCP server allows arbitrary host file read/write** — no path confinement on
   tool inputs. *(Critical — §5)*
3. **Scaffolded projects ship broken documentation links** — both generators copy
   reference docs to `docs/reference/` but every template `CLAUDE.md` links to
   `docs/*.md`. *(High — §6)*
4. **Root `lint` cannot succeed** — ESLint missing/misconfigured across packages.
   *(High — §7)*
5. **All prefixed Z80 instructions over-count T-states by 4** — systemic timing
   error in the CPU decoder. *(High — §1)*
6. **`.z80` v2/v3 snapshots load as garbage** — loader assumes v1 and never checks
   the version. *(High — §2)*

---

## 1. Emulator — CPU core
`packages/emulator/src/{core,decoder,instructions}`

### High

- **[High]** Every prefixed instruction over-counts T-states by 4 *(verified)* —
  `src/decoder/instruction-decoder.js:726, 738, 750, 931`
  - `executeCBInstruction`/`executeEDInstruction`/`executeDDInstruction`/
    `executeFDInstruction` all `return 4 + handler(...)`, but the handlers already
    return the **full documented totals** including the prefix. Verified examples:
    `IndexedInstructions.loadRegFromIndexed` returns `19` (`indexed.js:49`) →
    decoder reports `23` for `LD r,(IX+d)` (correct is 19); `addIndex` returns `15`
    → `19` for `ADD IX,rr` (correct 15); `incIndexed` returns `23` → `27`;
    `jumpIndexed` returns `8` → `12` for `JP (IX)`; `BitInstructions.processRegister`
    returns `8` → `12` for `RLC B` (correct 8); `processHL` returns `15` → `19` for
    `RLC (HL)`. The one accidentally-correct case is CB `BIT`, because `bitTest`
    returns the cost *without* the prefix (4/8). Net effect: nearly the entire
    CB/ED/DD/FD set reports `+4` T-states, breaking any timing-sensitive Spectrum
    code (border/multicolor effects, beeper pitch, contended-memory routines) and
    skewing the toolkit's frame loop (69888 T-states/frame).
  - Fix: pick one convention. Simplest: drop the `4 +` in the four dispatchers
    (handlers already include the prefix), then re-audit the inline undocumented
    DD/FD cases (which return `8`/`11` and are currently correct as totals).

### Medium

- **[Medium]** `reset()` enables interrupts and sets IM 1, contrary to real Z80
  reset *(verified)* — `src/core/cpu.js:74-77`
  - On power-on/RESET the Z80 clears IFF1/IFF2 (interrupts disabled) and sets
    IM 0. Here `reset()` sets `iff1 = iff2 = true` and `interruptMode = 1`. The 48K
    ROM issues `DI`/`IM 1` early so it is usually masked, but combined with snapshot
    loading (which may not set IFF) a restored program can run with interrupts in
    the wrong state.
  - Fix: `this.iff1 = false; this.iff2 = false; this.interruptMode = 0;`

- **[Medium]** Maskable interrupt is serviced while halted even when disabled
  *(verified)* — `src/core/cpu.js:117`
  - `if (this.iff1 || this.halted)` accepts and services a maskable INT whenever the
    CPU is halted, regardless of `iff1`. On real hardware HALT only resumes on an
    *enabled* interrupt (or NMI); a masked INT must not be taken. Also the interrupt
    path never increments R.
  - Fix: gate on `iff1` (`if (this.iff1) { this.halted = false; ... }`) and increment
    R on acceptance.

- **[Medium]** `EI` enables interrupts immediately instead of after the next
  instruction *(needs verification of impact)* — `src/instructions/misc.js` (`ei()`)
  - A real Z80 defers interrupt acceptance until *after* the instruction following
    `EI`. Setting `iff1=iff2=true` immediately makes `EI`/`RET` ISR tails and
    `EI`/`HALT` patterns interruptible one instruction too early.
  - Fix: set an `eiPending` flag and enable the flip-flops at the start of the next
    `execute()` before the interrupt check.

### Low

- **[Low]** Deprecated `setStateNested` turns a restored `IM 0` into `IM 1`
  *(verified)* — `src/core/cpu.js:195`
  - `this.interruptMode = state.cpu.interruptMode || 1` coerces a legitimate `0` to
    `1`. (The non-deprecated `setState` correctly uses `!== undefined` guards.)
  - Fix: use `!== undefined` checks, mirroring `setState`.

- **[Low]** Undocumented flag accuracy gaps *(needs verification against FUSE/ZEXALL)*
  — `src/instructions/logical.js` (SCF/CCF, DAA), DDCB `BIT` in `src/instructions/indexed.js:221`
  - SCF/CCF set F3/F5 purely from `A` (Zilog NMOS sets them from `A | F`); DDCB `BIT`
    takes F3/F5 from the read value rather than the high byte of the computed
    address; the post-subtraction half-carry in `DAA` is a heuristic. These only
    matter for flag-exhaustive test suites, not typical games.
  - Fix: align with the chosen reference model if bit-exact flags are a goal.

- **[Low]** Dead/commented debug code and leftover "Fixed:"/"Added missing property"
  comments — `src/core/cpu.js:96-101, 306, 309`
  - Cosmetic; safe to remove.

---

## 2. Emulator — Machine & peripherals
`packages/emulator/src/{spectrum,interfaces,utils,index.js}`

### High

- **[High]** `.z80` loader assumes v1 and corrupts v2/v3 snapshots *(verified)* —
  `src/spectrum/snapshot.js:65, 72-94`
  - The loader reads a fixed 30-byte v1 header and never checks the version marker
    (v2/v3 set `PC == 0` in the v1 header and carry an extended header + paged memory
    blocks). Loading a common v2/v3 `.z80` reads the extended header as RAM → garbage,
    with no error. Additionally, in `_decompress` an `ED ED 00 vv` run (`count === 0`)
    falls through and is written as literal bytes instead of being consumed, and the
    decompressor does not stop at the `00 ED ED 00` end-of-data marker. For
    well-formed v1 this is benign (it stops at 49152 output bytes), but the format
    is mishandled in general.
  - Fix: detect `PC == 0` and parse (or explicitly reject) v2/v3; in `_decompress`
    always consume `ED ED count value` (count 0 → fill nothing) and honour the end
    marker.

### Medium

- **[Medium]** FLASH runs at half speed *(verified)* — `src/spectrum/display.js:96,165`
  - `FLASH_FRAMES = 32` toggles INK/PAPER every 32 frames; the ZX Spectrum toggles
    every **16** frames (the full flash cycle is 32 frames). The comment ("about 0.64
    seconds") confirms the wrong period.
  - Fix: `this.FLASH_FRAMES = 16`.

- **[Medium]** Render loop is decoupled from the emulation loop; FLASH advances per
  rendered frame *(needs verification)* — `src/spectrum/spectrum.js:605-668`,
  `display.js` flash counter
  - `requestAnimationFrame`-driven `renderDisplay()` runs independently of the
    fixed-step `runFrame()` accumulator, so the screen can be read mid-frame and
    `flashCounter` is incremented per *render*, not per emulated frame — making FLASH
    timing depend on display FPS (on top of the period bug above).
  - Fix: render once at the end of each emulated frame, or at least advance
    `flashCounter` per emulated frame.

- **[Medium]** Per-scanline border colours only applied on frames with a border write
  *(needs verification)* — `src/spectrum/spectrum.js:664-668`
  - `renderDisplay` gates passing `getScanlineBorderColors()` on `isBorderColorChanged()`,
    so a static multicolor border falls back to the solid colour on frames without a
    write → flicker between striped and solid.
  - Fix: always pass the per-scanline buffer (it already holds the state).

- **[Medium]** `loadSnapshot` turns a black border into white *(verified pattern)* —
  `src/spectrum/spectrum.js:~750`
  - `borderColor: data.ula.borderColor || 7` coerces a legitimate `0` (black) to `7`
    (white). Also RAM with a length other than 49152 is silently ignored.
  - Fix: use `?? 7`; warn on unexpected RAM length.

- **[Medium]** `_setupTouchKeyboard` can throw in headless/Node *(needs verification)*
  — `src/spectrum/spectrum.js:237-253`
  - Calls `document.createElement` and `this.canvas.parentNode.insertBefore(...)`
    with no `typeof document === 'undefined'` guard and no null-parent check. Safe on
    the `'auto'` default, but `touchKeyboard: true` in Node (or a parentless canvas)
    throws.
  - Fix: guard for missing `document` and a null `parentNode`.

### Low

- **[Low]** Beeper edges not clamped to the frame window *(needs verification)* —
  `src/spectrum/spectrum.js`, `src/spectrum/audio-worklet.js:100-118`
  - The worklet path stores edge T-states without clamping to `[0, frameTStates]`;
    the basic `sound.js` path guards non-decreasing edges but the worklet does not.
  - Fix: clamp and assert monotonic edges in `setBeeperState`.

- **[Low]** Beeper MIC bit ignored on the fallback path / callbacks not re-pointed
  after a runtime worklet fallback *(needs verification)* —
  `src/spectrum/sound.js:164`, `spectrum.js:541-551`
  - Fallback uses only bit 4 (speaker), and after a runtime fallback `setPortWriteCallback`
    is never re-registered; relies on the `onSpeakerChange` closure still working.

- **[Low]** Dead code in `reset()` and `setKey` — `src/spectrum/spectrum.js:453-465`,
  `src/spectrum/ula.js:112`
  - Attribute memory is filled twice (`fill(0x38)` then a redundant loop), an unused
    `screenMem` is read, and `ula.setKey` reads an `oldValue` it never uses.

- **[Low]** Tape pilot-pulse count may be doubled *(needs verification)* —
  `src/spectrum/tape.js:776-789, 910-923`
  - The `edgeCount >= pilotPulses * 2` checks look like they double the pilot length;
    verify against a real loader.

---

## 3. Assembler / Disassembler
`packages/asm/src`

> Core Z80 encodings were spot-checked and are correct: little-endian 16-bit
> emission, `JR`/`DJNZ` signed displacement with `-128..127` range error, `IX+d`
> displacement range, register/condition tables, CB/ED/DD/FD prefixes, and DDCB/FDCB
> displacement-before-opcode ordering.

### High

- **[High]** Disassembler corrupts instructions that cross the `0xFFFF` boundary
  *(needs verification)* — `src/disasm.ts:49-50, 86`, `src/cli.ts:54-57`
  - `disassembleOne` deliberately advances its read pointer with `& 0x1ffff` to flow
    past `0xFFFF`, but the CLI reader is `(addr) => bytes[addr - org] ?? 0`, so a read
    at `addr >= 0x10000` produces a large negative index → `undefined` → `0`. An
    instruction spanning the wrap is silently decoded with zero bytes for the wrapped
    portion, so the printed bytes/mnemonic diverge from the binary.
  - Fix: index the source buffer consistently (`bytes[(addr - org) & 0xffff]`) or have
    the reader signal end-of-data.

### Medium

- **[Medium]** Bitwise vs. comparison operator precedence differs from C convention
  *(needs verification against sjasmplus)* — `src/assembler.ts:2401-2461`
  - The recursive-descent chain makes `& ^ |` bind **tighter** than the comparison
    operators (`==`, `!=`, `<`, …); in C (and most assemblers) bitwise operators bind
    *looser* than comparisons. So `a == b & c` evaluates as `a == (b & c)` here vs.
    `(a == b) & c` in C. Mixed bitwise/comparison expressions without parentheses will
    assemble to different bytes than sjasmplus.
    *(Note: shift-vs-add precedence is consistent with C — `1 << 2 + 3` → `1 << 5` in
    both — so that combination is fine.)*
  - Fix: confirm sjasmplus's table and reorder the descent to match; add tests for
    mixed-operator expressions.

- **[Medium]** No convergence check across layout passes *(needs verification)* —
  `src/assembler.ts:~401`
  - Layout runs a fixed 5 passes; if instruction sizes are still changing at the last
    pass (size-varying expressions on forward refs), the final emit uses stale
    addresses with **no** "failed to converge" diagnostic.
  - Fix: compare symbol values between the last two passes and error if not stable.

- **[Medium]** Inconsistent range checking on byte/word emission *(needs verification)*
  — `src/assembler.ts:2031-2042` (`u8`, `word`)
  - `u8` only range-checks in strict mode and exempts a magic `0xffff` sentinel (used
    for boolean truthiness), so `LD A, 0xFFFF` silently truncates to `0xFF`; `word`
    never range-checks, so `LD HL, 0x12345` silently truncates. `evalDisp` does check,
    making the behaviour inconsistent.
  - Fix: drop the magic-value exemption, carry boolean results as a typed value, and
    add a strict-mode out-of-range warning for `word`.

### Low

- **[Low]** `ALIGN` accepts non-power-of-two boundaries *(needs verification)* —
  `src/assembler.ts:2249-2261, 2682-2685`
  - sjasmplus requires a power-of-two boundary; this accepts any positive value and
    has no upper bound, diverging from the compatibility contract.

- **[Low]** CLI `disasm` accepts `NaN` for `--org`/`--count` silently — `src/cli.ts:54-57, 81-84`
  - `--org foo` → `NaN` makes every read `undefined → 0` (all-zero disassembly);
    `--count foo` → `NaN` loops zero times. No validation, no non-zero exit.
  - Fix: validate parsed numbers and exit non-zero on `NaN`.

- **[Low]** String escape handling drops a trailing lone `\` and doesn't support `\0`
  / `\xNN` *(needs verification)* — `src/assembler.ts:2312-2328`

---

## 4. Toolkit — core
`packages/toolkit/src/core`

> The headless loop faithfully mirrors the emulator's own `runFrame`; the missing
> per-interrupt cycle accounting is parity with upstream, not a new bug.

### High

- **[High]** `tStatesIntoFrame` not advanced when a run stops on a watchpoint or
  after-instruction hang *(verified by analysis)* — `src/core/run-loop.ts:125-150`
  - The watchpoint and `afterInstruction` early returns happen *before* the
    `m.tStatesIntoFrame += elapsed` at lines 149-150, even though the ULA clock was
    already advanced via `ula.addCycles(elapsed)`. After such a stop, the toolkit's
    frame clock and the ULA's scanline clock disagree by one instruction's T-states,
    so resuming mid-frame is misaligned.
  - Fix: move the `tStatesIntoFrame`/`tstatesRun` update up to right after
    `ula.addCycles`, before the watch/watchdog checks.

- **[High]** Watchpoint and Watchdog both monkey-patch `memory.write` and can clobber
  each other *(needs verification)* — `src/core/trace.ts:85-122`, `src/core/detect.ts:48-68`
  - Both capture `mem.write.bind(mem)` as "the original" and replace `mem.write`. When
    both are active for one run (the run options allow it), the second `attach` wraps
    the first's wrapper; detaching in the wrong order leaves a dangling wrapper and
    `mem.write` is never cleanly restored, silently breaking screen-write counting or
    watchpoint detection.
  - Fix: compose a single write interceptor owned by the run loop, or guard against
    double-patching and verify ownership on detach.

### Medium

- **[Medium]** SNA/Z80 loading does not reset the frame/cycle clocks like state
  loading does *(verified)* — `src/core/state.ts:148-189` (`applySna`),
  `src/core/machine.ts:87-95` (`loadSna`/`loadZ80`)
  - `applyState` resets `cpu.cycles`, `frameCount`, and `tStatesIntoFrame`; the SNA/Z80
    paths restore CPU/ULA/RAM but leave those stale. After loading onto a
    previously-run machine, tape sync (`tape.update(cpu.cycles)`) sees a huge delta and
    the next frame boundary lands at the wrong instant.
  - Fix: reset `cpu.cycles = 0; m.frameCount = 0; m.tStatesIntoFrame = 0` in the SNA/Z80
    loaders (or derive `tStatesIntoFrame` from the restored ULA counter).

- **[Medium]** `parseKeysSpec` accepts a degenerate `hold` of 0 *(verified)* —
  `src/core/input.ts:28, 34-35, 76-78`
  - `*0` yields a `down` and `up` on the same frame; `sortEvents` orders `up` before
    `down` at equal frames, so the key release precedes the press and the keypress is
    swallowed — a `*0` spec silently does nothing.
  - Fix: reject `hold < 1` (or clamp to 1).

### Low

- **[Low]** Unsafe non-null assertion in `nearestLabel` *(needs verification)* —
  `src/core/symbols.ts:126`
  - `this.addrToLabelExact.get(labelAddr)!` is safe only as long as `sortedAddrs` is
    derived solely from `addrToLabelExact`; returns `undefined` cast to `string`
    otherwise.

- **[Low]** Unbounded counters — `src/core/trace.ts:21`, `src/core/state.ts`
  - `Tracer.hist` is a `Uint32Array` that wraps after 2³² hits on a single hot PC;
    `cpu.cycles` grows unbounded across restores. Practically unreachable, but noted.

---

## 5. Toolkit — CLI & MCP
`packages/toolkit/src/{cli,mcp}`

> Good: the assembler backend is invoked with `execFile` (no shell), so there is no
> command-injection vector through sjasmplus arguments.

### Critical

- **[Critical]** MCP tools allow arbitrary host file read/write *(verified)* —
  `src/mcp/server.ts:248-261, 569, 573-583`
  - `zx_run` passes `args.bin/sna/z80/tap` straight into `readFileSync(...)`; `zx_state`
    passes `file` straight into `writeStateFile`/`readStateFile`/`writeFileSync`. None
    are confined to the project directory, so an MCP client (or a prompt-injected agent)
    can read any file the process can read (`../../.ssh/id_rsa`) by loading it as a
    "binary", and overwrite any file via `save`/`export-z80`. Classic confused-deputy
    over stdio with the user's full privileges.
  - Fix: resolve every incoming path against a configured project root and reject paths
    that escape it; refuse absolute paths and `..` segments.

### High

- **[High]** `bench` hangs forever on a non-numeric `--frames` *(verified by analysis)*
  — `src/cli/commands/bench.ts:9,15`
  - `parseInt(opts.frames, 10)` → `NaN`, passed as `{ frames: NaN, maxFrames: NaN }`.
    In the run loop both stop conditions compare against `NaN` (always false) with no
    watchdog, so the loop never terminates — the CLI pins a core indefinitely.
  - Fix: validate `Number.isInteger(frames) && frames > 0`; never derive `maxFrames`
    from an unvalidated value.

- **[High]** Unvalidated `parseInt` silently overrides budgets across commands
  *(verified pattern)* — `src/cli/commands/run.ts:43`, `debug-cmds.ts:187,264,294+`,
  `input-cmds.ts:15,51`, `inspect-cmds.ts:19`, `preview.ts:63`
  - A bad numeric option yields `NaN`; because the loop only stops on `frames` when
    `opts.frames !== undefined`, runs silently fall back to the 5000-frame default and
    report a misleading "ran 5000 frames"; `preview` `listen(NaN)` binds a random port
    while still printing the requested one.
  - Fix: a shared `parseCount(value, name)` helper that errors on non-finite/negative.

- **[High]** `preview` HTTP server leaks and races *(verified)* —
  `src/cli/commands/preview.ts:46-67, 81-88`
  - The server is never closed; the function returns `EXIT.OK` *before* `listen`'s
    callback runs; there is no `server.on('error')`, so `EADDRINUSE` is an unhandled
    rejection. Also the bundle-existence check runs *after* boot + snapshot build +
    writing `game.z80`/`index.html`, wasting work and leaving stale files when the
    bundle is missing.
  - Fix: check existence first; add an error handler; resolve from inside the `listen`
    callback.

- **[High]** Uncaught `JSON.parse` on config/state/session files breaks the `--json`
  contract *(verified)* — `src/cli/config.ts:26`, `src/cli/session.ts:15,74`,
  `src/mcp/server.ts:574`
  - A malformed `zx.config.json`/`state.zxstate`/`session.json` throws; in `--json`
    mode the agent receives no JSON document, violating the one-document-per-command
    contract.
  - Fix: wrap these parses, validate the shape (zod), and emit structured errors.

### Medium

- **[Medium]** Arbitrary, unguarded write paths shared with the MCP layer — `screen.ts:25`,
  `run.ts:109`, `state-cmds.ts:18,58`, `debug-cmds.ts:323`
  - `writeFileSync(opts.png, …)` etc. take paths verbatim and don't `mkdirSync` the
    parent (unlike `verify.ts:53`), so a missing dir throws `ENOENT` (uncaught → breaks
    JSON output); via MCP these become an arbitrary-write primitive.

- **[Medium]** MCP `step-over`/`trace` block the single-threaded event loop —
  `src/mcp/server.ts:453-474, 497-502`
  - `count` up to 256 × `maxFrames: 500` per step-over = up to 128 000 frames run
    synchronously, stalling all other MCP requests. No aggregate cap/timeout.

- **[Medium]** MCP responses leak absolute host paths — `src/mcp/server.ts:207-212, 414, 569-583`
  - `zx_build`/`zx_state` echo absolute `.bin`/`.sld`/state paths, leaking the
    server's filesystem layout to the client.

- **[Medium]** `mem read --len` accepts negative/`NaN` lengths — `src/cli/commands/inspect-cmds.ts:19`
  - `Math.min(parseInt(...), 0x10000)` has no lower floor: `-5` reaches
    `new Uint8Array(-5)` → uncaught `RangeError`; `NaN` → length 0 silently.

- **[Medium]** `regs set` silently masks out-of-range values — `src/cli/commands/inspect-cmds.ts:124-129`
  - An 8-bit register given `0x1FF` is masked to `0xFF`, `IM` given `4` becomes `0`,
    yet the echoed result shows the input value, not what was stored.

### Low

- **[Low]** Top-level handler downgrades all errors to `USER_ERROR` and emits no JSON —
  `src/cli/index.ts:351-354`
  - Environment failures become exit 1 (should be `ENV_ERROR`), and `--json` callers
    get a bare `error:` line.

- **[Low]** `setup --write-global` writes a `.bak` on every idempotent re-run —
  `src/cli/commands/setup.ts:18-26`
  - A backup is created even when the section already exists and no write happens.

---

## 6. create-zx-vibes & zx-vibes (umbrella)
`packages/create-zx-vibes`, `packages/zx-vibes`

### Critical

- **[Critical]** Wrapper bins import through a hardcoded `../node_modules/...` path
  *(verified)* — `packages/zx-vibes/bin/{zxs,zxs-mcp,zx-vibes}.js:2`, `bin/zxasm.js:2`
  - e.g. `import '../node_modules/@zx-vibes/toolkit/dist/cli/index.js'`. This resolves
    only because the pnpm workspace symlinks the dependency under the package. The
    published tarball ships just `bin/`+`dist/`; on a real npm install dependencies are
    hoisted to the consumer's `node_modules`, so this path does not exist and **every**
    bin (`zxs`, `zxs-mcp`, `zxasm`, `zx-vibes`) fails with `ERR_MODULE_NOT_FOUND`.
  - Fix: import by bare specifier (`@zx-vibes/toolkit/...`) **and** add the needed
    subpaths to each consumed package's `exports` (today `@zx-vibes/toolkit` and
    `@zx-vibes/asm` only expose `.`, so a subpath import would otherwise be rejected
    with `ERR_PACKAGE_PATH_NOT_EXPORTED`). Add export keys like `"./cli"`, `"./mcp"`.

### High

- **[High]** Scaffolded projects have broken documentation links *(verified)* —
  `packages/create-zx-vibes/src/index.ts:50-51`, `packages/toolkit/src/cli/commands/new.ts:58-61`,
  template `CLAUDE.md` files (e.g. `starters/game/CLAUDE.md:27-31`, `templates/game/CLAUDE.md:27-31`)
  - Both generators copy reference docs to `<project>/docs/reference/`, but every
    template `CLAUDE.md` links to `docs/common-bugs.md`, `docs/screen-layout.md`,
    `docs/keyboard-input.md`, `docs/attributes-and-colour.md`. The files actually land
    at `docs/reference/…`, so every link in every generated project is broken —
    defeating the point of shipping the docs to the agent.
  - Fix: either flatten the copy to `<project>/docs/` or update the `CLAUDE.md`
    templates to `docs/reference/…`.

### Medium

- **[Medium]** `sync-assets.js` deletes the destination before checking the source
  *(verified)* — `packages/create-zx-vibes/scripts/sync-assets.js:9-13`
  - The loop does `rmSync(dest, { recursive, force })` then `cpSync(src, dest)`. If the
    repo-root `starters`/`docs` is missing/moved, the destructive `rmSync` still runs
    and then `cpSync` throws — leaving the package with **no** templates/docs. Since
    this runs in `prepack`, a bad sync can publish a generator with no starters.
  - Fix: `if (!existsSync(src)) throw …` *before* removing the destination.

- **[Medium]** `pnpm install` failure handling swallows ENOENT and orphans the project
  *(verified)* — `packages/create-zx-vibes/src/index.ts:53-58`
  - Only `result.status ?? 1` is inspected; `result.error` (pnpm not on PATH) is
    ignored, and any failure `throw`s after files were already written, leaving a
    half-created directory with a generic message.
  - Fix: check `result.error` first; downgrade install failure to a "run pnpm install
    manually" warning rather than throwing.

- **[Medium]** Default `--install` depends on `zx-vibes@^0.1.0` being published
  *(needs verification)* — `packages/create-zx-vibes/src/index.ts:53-57`, `starters/game/package.json`
  - The scaffolded `package.json` lists `zx-vibes` as a devDependency, so the default
    `pnpm install` fails if that version isn't on the registry, and the closing guidance
    redundantly tells the user to `pnpm add -D zx-vibes`.
  - Fix: make `--install` opt-in until published, and drop the redundant `pnpm add`
    line.

### Low

- **[Low]** `packageRoot()` walks up 6 levels for `starters` *(needs verification)* —
  `packages/create-zx-vibes/src/index.ts:26-33`
  - Correct in the published layout, but a missing `starters` would let it match an
    unrelated `starters` dir higher up. Anchor to the package's own `package.json`.

- **[Low]** `spawnSync('pnpm', …, { shell: win32 })` — `packages/create-zx-vibes/src/index.ts:54`
  - Args are static and `cwd` is resolved, so no injection today; the shape relies
    entirely on the name regex as a hard boundary.

---

## 7. Build, CI & packaging
root + per-package config

### High

- **[High]** Root `lint` cannot succeed *(verified)* — root `package.json:16`,
  `packages/toolkit/package.json:57`, `packages/asm/package.json:34`
  - `@zx-vibes/toolkit` `lint` runs `eslint` but ESLint is not a dependency and there
    is no config; `@zx-vibes/asm` pins ESLint v9 but ships no flat `eslint.config.*`
    (v9 errors without one); `@zx-vibes/emulator` uses ESLint v8 + legacy `.eslintrc.json`.
    The chained root `lint` fails at the first package, and the two ESLint majors can't
    share config.
  - Fix: standardize on one ESLint major, add the matching config to each package, and
    ensure each `lint` script resolves before chaining.

### Medium

- **[Medium]** Emulator `exports` serves source to ESM and a UMD bundle to everyone else
  *(verified)* — `packages/emulator/package.json:8-13`
  - `".": { "import": "./src/index.js", "default": "./dist/zxgeneration.umd.min.js" }`.
    `import` consumers get raw, un-transpiled source; everyone else gets a minified UMD
    bundle (the wrong module shape for `import()`). The toolkit happens to work because
    it runs the source under Node ESM and supplies its own ambient types
    (`src/types/zx-generation.d.ts`), but external consumers and bundlers get
    inconsistent code.
  - Fix: point `import` at `./dist/zxgeneration.esm.js`, add a `require`/UMD fallback,
    keep `./src/*` as an explicit deep-import escape hatch, and add a `types` field.

- **[Medium]** `typecheck` skips the emulator while `build`/`test`/`pack` include it —
  root `package.json:13-17`
  - The lowest package in the graph is never type/contract-checked, so a green
    `pnpm run verify` overstates confidence.

- **[Medium]** `prepare`/`prepack` cause redundant rebuilds and call `npm` inside a pnpm
  workspace — `packages/asm/package.json:29-31`, `packages/emulator/package.json:31`,
  `packages/toolkit/package.json:53-54`
  - `prepare: npm run build` runs on every `pnpm install` (2–3× rebuilds) and mixing
    `npm` into a pnpm workspace can resolve the wrong binary/lockfile context and fire
    before `workspace:*` links settle.
  - Fix: drop `prepare`; rely on the explicit CI `build` and `prepack` with `pnpm`.

- **[Medium]** `release.yml` builds/publishes without `typecheck` —
  `.github/workflows/release.yml:25-26`
  - Combined with the broken lint and missing emulator types, a type-broken release can
    ship. CI/release also run only on Node 22 while everything targets `>=20`, so the
    engine floor (Node 20) is never exercised.
  - Fix: add `typecheck` (and lint once fixed) to release; add Node 20 to the CI matrix.

- **[Medium]** Hand-maintained build order and tsup shebang on the library entry —
  root `package.json:13`, `packages/{toolkit,asm,create-zx-vibes}/tsup.config.ts`
  - The build chain is hardcoded rather than topological (`pnpm -r build`), and the
    tsup banner prepends `#!/usr/bin/env node` to **every** ESM output including the
    importable `dist/index.js`.
  - Fix: use topological build; scope the shebang banner to bin entries only.

- **[Medium]** Duplicated pnpm build-allowlist with an unrecognized key — root
  `package.json:24-28`, `pnpm-workspace.yaml:4-7`
  - `onlyBuiltDependencies` is declared in two places and the workspace file adds a
    non-standard `allowBuilds:` block (likely ignored), inviting drift.

### Low

- **[Low]** Mixed test runners (Jest in emulator, Vitest elsewhere) and inconsistent
  repository-URL casing (`alvaromah` vs `Alvaromah`) / homepages across packages.

---

## 8. Cross-cutting: asset duplication & consistency

### Medium

- **[Medium]** Reference docs, starters, and the gallery are vendored in three places
  with only a partial sync — `docs/`, `starters/`, `gallery/` vs
  `packages/toolkit/{docs,templates,gallery}` vs `packages/create-zx-vibes/{docs,starters}`
  - `create-zx-vibes/scripts/sync-assets.js` only syncs `starters` + `docs` from the
    repo root into `create-zx-vibes`; nothing syncs the toolkit's `docs/reference`,
    `templates`, or `gallery`, so those copies drift independently. This duplication is
    also the root cause that lets the `CLAUDE.md` doc-path bug exist in two generators
    at once.
  - Fix: pick one source of truth and sync all consumers from it (extend the sync
    script to cover the toolkit copies), and run the sync in CI to detect drift.

- **[Medium]** `create-zx-vibes` publishes `starters`/`docs` that are generated at build
  time and currently untracked — `packages/create-zx-vibes/package.json:26-34`
  - `files` lists `starters`/`docs`, but they only exist after `sync-assets.js` runs in
    `build`/`prepack`. A publish that skips that step ships an empty generator. Add a
    `prepublishOnly` guard (or commit the synced assets).

### Low

- **[Low]** `pages.yml` deploys the root `gallery` and only triggers on `gallery/**`
  — `.github/workflows/pages.yml:6,29`
  - If `packages/toolkit/gallery` is meant to be canonical, edits there neither trigger
    nor publish. Confirm the source of truth and align the workflow.

---

## Appendix — checked and found correct (to reduce noise)

- ZX Spectrum non-linear screen address decode, attribute INK/PAPER/BRIGHT/FLASH decode,
  screen/attribute memory offsets (`0x1800`/`0x1B00`), and ROM write-protection
  (writes below `0x4000` ignored) in the emulator display/memory.
- Keyboard matrix half-row mapping (including the reversed row 4 ordering).
- Assembler: little-endian 16-bit emission, `JR`/`DJNZ` signed displacement with range
  error, `IX+d` displacement range, register/condition tables, DDCB/FDCB displacement
  ordering, `IN F,(C)`/`OUT (C),0` special case, `$` as current address, duplicate-label
  detection.
- Assembler shift-vs-add precedence matches C (`1 << 2 + 3` → `1 << 5`).
- Toolkit assembler invocation uses `execFile` (no shell injection).
- The `gitignore → .gitignore` rename convention in both generators, and the files the
  generators copy do exist in the template trees.
