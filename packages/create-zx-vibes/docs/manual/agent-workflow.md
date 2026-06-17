# Agent Workflow

Open the generated project directory in your coding agent. The project root
contains the instructions the agent should read first:

- `AGENTS.md` for Codex-style agents.
- `CLAUDE.md` for Claude Code and Claude-compatible workflows.
- `docs/agents/skills/INDEX.md` as the router for local topic skills.

Agents should prefer local project context over web searches:

- Read `AGENTS.md` or `CLAUDE.md`.
- Load only the needed skill from `docs/agents/skills/INDEX.md`.
- Use `docs/reference/` for ZX Spectrum details.
- Use `lib/` helper routines before writing primitives from scratch.
- Keep running `npm run build`, targeted `zxs run`, screen inspection, tests,
  and `npm run verify`.

## Useful Prompts

A good first prompt is concrete and includes the feedback loop:

```text
Create a simple ZX Spectrum arcade game in this project.
Use the local AGENTS.md instructions and local docs.
Build it, run it, inspect the screen, add or update tests, and iterate until
npm run verify passes.
```

For a smaller change:

```text
Add a player sprite controlled with QAOP and Space.
After each source change, run the zx-vibes build/run/screen loop and verify the
project before reporting success.
```

For debugging:

```text
The game now hangs after a few seconds.
Use zxs run --json, zxs regs, zxs trace, and the local debug/reference docs to
find the cause. Do not change unrelated code.
```

## Agent Guardrails

Ask the agent to report:

- The files changed.
- The commands it ran.
- Any screenshots or screen text it inspected.
- The final `npm run verify` result.
- Any known limitation or follow-up.

That handoff matters because assembly can fail visually even when it builds,
and an agent can otherwise over-trust a successful compile.
