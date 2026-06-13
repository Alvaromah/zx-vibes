# Spectral Gallery

Static site: ZX Spectrum 48K games written by AI agents, playable in the
browser via [zx-generation](https://github.com/alvaromah/zx-generation)
(itself LLM-generated — emulator and games alike).

No build step. Serve the directory over HTTP (`file://` won't work —
the pages fetch JSON/snapshots):

```bash
npx serve gallery          # or: python3 -m http.server -d gallery 8080
```

GitHub Pages: point Pages at this directory (or copy it to the Pages
branch) — everything is relative paths.

## Adding a game

1. Create `games/<id>/` with:
   - `meta.json` — copy the shape from `games/pong-by-agent/meta.json`
     (title, agent model, prompt, effort, controls, file names).
   - `game.z80` — a running snapshot: `zxs run` the game to a good moment,
     then `zxs state export --z80 game.z80`.
   - `screen.png` — `zxs screen --png` or the run's `--screenshot`.
   - `transcript.md` — the agent transcript, or a provenance summary
     while the full transcript is pending.
2. Append the `<id>` to `games/index.json`.

The provenance contract is the point of the gallery: every entry states
prompt, model, iteration count and how it was verified. Don't add games
without it.

## Vendored files

- `zxgeneration.esm.js` — zx-generation browser bundle (MIT, pinned copy
  of the version in package-lock; re-copy from
  `node_modules/zx-generation/dist/` when bumping the pin).
- `48k.rom` — ZX Spectrum 48K ROM; see `ROM-COPYRIGHT.md` for the
  distribution terms (distributed unmodified, without charge, as part of
  an emulator package).
