# Spectral

**AI agents for the ZX Spectrum.**

Spectral is a toolchain that lets AI coding agents (Claude Code, Codex, and
friends) write ZX Spectrum 48K games autonomously, with a real feedback loop:

```
assemble → run headless → observe (screenshot + state) → debug → iterate
```

It is built on [zx-generation](https://github.com/alvaromah/zx-generation), a
cycle-accurate ZX Spectrum emulator in pure JavaScript — itself 100%
LLM-generated. An LLM-written emulator, running LLM-written games.

## Quick start

```bash
npm install
npm run build
node dist/cli/index.js doctor          # check Node, ROM, and assembler backends

# The agent loop, end to end:
node dist/cli/index.js build game.asm
node dist/cli/index.js run --bin build/game.bin --org 0x8000 \
    --frames 300 --screenshot screen.png --json
```

Every command supports `--json` for machine-readable output. Exit codes:
`0` ok · `1` build/user error · `2` hang detected · `3` environment problem.

By default `zxs build` uses [sjasmplus](https://github.com/z00m128/sjasmplus)
≥ 1.20 on your PATH (`zxs doctor` tells you how to install it). Use the
embedded backend when you want the current starter/recipe workflow without an
external assembler binary.

Spectral also ships an embedded TypeScript assembler MVP for the current
starter/recipe workflow:

```bash
node dist/cli/index.js build game.asm --assembler spectral
# or for zxs test / MCP-driven sessions:
ZXS_ASSEMBLER=spectral node dist/cli/index.js test recipes
```

The embedded backend emits the same raw `.bin` plus SLD symbols used by the
debugger. It is intentionally narrower than full sjasmplus compatibility.

## How fast?

The emulator runs headless in-process — no sockets, no external emulator
binaries. On an Apple Silicon laptop: **~6,600 frames/second, 132× real
hardware (~463 MHz Z80-equivalent)**. Running 5 emulated seconds of a game
costs ~40ms.

## MCP server

`zxs-mcp` exposes the same toolkit over the Model Context Protocol with a
persistent live machine — and `zx_screen` returns the display as an image, so
Claude literally *sees* the Spectrum screen. The repo ships a project-scoped
`.mcp.json`; open it with Claude Code (after `npm run build`) and ask:

> load build/bounce.bin and tell me what's on the screen

Tools: `zx_build`, `zx_run`, `zx_screen`, `zx_inspect`, `zx_debug`
(breakpoints/watchpoints/step/disasm/trace), `zx_keys`, `zx_state`.

## Status

- ✅ **Phase 0 — walking skeleton**: headless 48K Spectrum in Node (boots the
  real ROM), `zxs build` (JSON diagnostics + did-you-mean hints), `zxs run`,
  PNG screenshots, `doctor`/`bench`, deterministic golden tests
- ✅ **Phase 1 — agent feedback loop**: `.zxs/` sessions resumable across
  processes, frame-accurate key plans, ROM-font screen OCR (cheap text eyes),
  hang watchdog (di-halt / tight-loop / rom-error / sp-corrupt / pc-in-rom,
  exit code 2), SNA load + `.z80` export
- ✅ **Phase 2 — debugger & tracer**: full Z80 disassembler (round-trip
  verified), SLD symbols (breakpoints by label or `file.asm:line`),
  watchpoints, `step --over`, hot-spot tracing — all symbolicated
- ✅ **Phase 3 — MCP server**: persistent machine over stdio, screen as image
  content
- ✅ **Phase 4 — knowledge layer**: `zxs new` scaffolding (working skeleton +
  agent playbook), 8 reference docs, CI-tested recipe cookbook, `zxs test`
  declarative runner — **milestone passed: an AI agent built
  [a playable Pong](examples/pong-by-agent/) unassisted in ~8 iterations**
- ⏳ **Phase 5 — hardening & launch**: pc-in-rom watchdog ✅, recipe cookbook
  complete (12/12) ✅, [gallery site](gallery/) ✅ (`npx serve gallery` —
  play the agents' games in your browser); left: GitHub/npm publish,
  upstream PRs, the time-lapse video

## License

MIT. The bundled 48K ROM ships with zx-generation under Amstrad's
long-standing emulator-distribution permission.
