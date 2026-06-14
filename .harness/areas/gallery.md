# gallery

Last updated: 2026-06-14

## Paths

- `gallery/`
- `packages/toolkit/gallery/`

## Role

Static playable gallery for generated ZX Spectrum games and artifacts.

## Owns

- Root GitHub Pages source under `gallery/`.
- Toolkit-shipped gallery assets under `packages/toolkit/gallery/`.
- Game metadata, screenshots, transcripts, and `.z80` snapshots.
- Browser player HTML/CSS/JS and ROM copyright notices.

## Stack

- Languages: HTML, CSS, JavaScript, JSON.
- Deployment: GitHub Pages workflow uploads root `gallery/`.

## Important commands

```bash
pnpm dlx serve gallery
```

No dedicated test/build script is currently recorded for root gallery-only
changes.

## Important files or directories

- `gallery/index.html`
- `gallery/player.html`
- `gallery/style.css`
- `gallery/zxgeneration.esm.js`
- `gallery/games/index.json`
- `gallery/games/*/`
- `packages/toolkit/gallery/`
- `.github/workflows/pages.yml`

## External dependencies

- GitHub Pages deployment.
- Browser runtime for player behavior.
- Emulator bundle and ROM asset licensing context.

## Known gotchas

- Root `gallery/` is the deployment source. Toolkit also contains gallery
  assets; determine whether a change needs both locations.
- Large binary artifacts should be intentional and provenance should stay clear.
- Keep ROM copyright notices with ROM/player assets.

## Validation expectations

- For visual/player changes, serve `gallery/` locally and inspect in a browser.
- For deployment changes, include `distribution` and review
  `.github/workflows/pages.yml`.

## Recent area notes

- Root harness initialized this area on 2026-06-14.
