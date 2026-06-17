# ZX Vibes Manual

![ZX Vibes sticker logo](/zx-vibes-logo.png)

This manual is the source-of-truth walkthrough for building a ZX Spectrum 48K
project with the published zx-vibes packages. It covers installation, project
creation, agent use, optional MCP setup, the manual CLI loop, debugging,
testing, previewing, and troubleshooting.

Use it when you are making a game or small Spectrum program. If you are
modifying the zx-vibes monorepo itself, use the repository workflow in the root
README instead.

## Start Here

<div class="manual-grid">
  <a href="./installation"><strong>Installation</strong>Check Node, pnpm, and terminal prerequisites before creating a project.</a>
  <a href="./create-project"><strong>Create a Project</strong>Generate a game or platformer starter and understand the files it writes.</a>
  <a href="./first-build"><strong>First Build</strong>Run the build, emulator, screen inspection, tests, and verify loop.</a>
  <a href="./agent-workflow"><strong>Agent Workflow</strong>Give Codex, Claude Code, or another coding agent the right local context.</a>
</div>

## Manual Sections

- [Installation](./installation.md)
- [Create a Project](./create-project.md)
- [First Build](./first-build.md)
- [Agent Workflow](./agent-workflow.md)
- [MCP](./mcp.md)
- [Manual CLI Workflow](./manual-workflow.md)
- [Debugging](./debugging.md)
- [Testing](./testing.md)
- [Preview and Play](./preview-play.md)
- [Troubleshooting](./troubleshooting.md)

## What zx-vibes Provides

- `pnpm create zx-vibes` to scaffold a working Spectrum project.
- `zxs build`, `zxs run`, `zxs verify`, and `zxs preview` for the local loop.
- `zxs boot` and `zxs play` for browser playback of a clean 48K machine,
  snapshots, and tape files.
- Snapshot, memory, graphics, disassembly, scan, and xref commands for
  inspection and reverse-engineering workflows.
- `zxs-mcp` for Codex, Claude, and other MCP-capable coding agents.
- A default embedded Z80 assembler from `@zx-vibes/asm`, also exposed as
  `zxasm`.
- Local reference docs and project-local agent skills copied into generated
  projects.

The intended workflow is deliberately short: edit assembly, build, run in the
emulator, inspect what happened, add or update tests, and verify before calling
the task done.
