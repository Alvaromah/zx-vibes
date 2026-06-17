# Troubleshooting

| Problem | First action |
| --- | --- |
| `zxs` is not found | Use `npm run doctor`, or install the global program with `npm install -g zx-vibes`. |
| Build errors mention labels or directives | Read `docs/reference/assembler-syntax.md`. |
| The run exits with hang status | Read the `likelyCause` field and `docs/reference/common-bugs.md`. |
| Keyboard input does nothing | Check `docs/reference/keyboard-input.md`; Spectrum keys are active-low. |
| Sprites or text draw in the wrong place | Check `docs/reference/screen-layout.md`. |
| Colours bleed between cells | Check `docs/reference/attributes-and-colour.md`. |
| Sound is expected but silent | Check `audio.beeperEdges` and `docs/reference/sound.md`. |
| Preview port is busy | Use the printed fallback URL or pass `--strict-port` to fail fast. |
| MCP tools do not start | Run from the project root and check `pnpm exec zxs-mcp`. |

## Clean Recovery

When a generated project gets into a confusing state:

```bash
npm install
npm run doctor
npm run build
npm test
npm run verify
```

If `doctor` fails, fix that first. If build fails, read the assembler message
before changing runtime code. If build passes but verify fails, inspect the run
JSON and screen output before changing tests.

## Useful Local Docs

Generated projects include local documentation so humans and agents do not have
to leave the project for common Spectrum questions:

- `docs/reference/assembler-syntax.md`
- `docs/reference/common-bugs.md`
- `docs/reference/memory-map.md`
- `docs/reference/screen-layout.md`
- `docs/reference/keyboard-input.md`
- `docs/reference/attributes-and-colour.md`
- `docs/reference/interrupts-and-timing.md`
- `docs/reference/sound.md`
- `docs/reference/testing-assertions.md`
- `docs/agents/skills/INDEX.md`

Use the local copies first because they describe the assembler, emulator, and
project conventions that zx-vibes expects.
