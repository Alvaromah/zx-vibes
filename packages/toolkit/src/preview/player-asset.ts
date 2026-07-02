// Bundled-player asset location + the served HTML page — cli.md CLI-PROD-PREVIEW-001,
// toolkit-runtime.md RT-PROD-PREVIEW-001.
//
// The browser player is bundled (tsup.player.config.ts) to `assets/preview/player.js`,
// beside the 48K ROM asset, and located here the same way `rom.ts` finds the ROM: a bounded
// walk up from this module (works from both `dist/` and `src/` under test). The HTML page is
// a small, minimal shell (no elaborate UI — D4 says spend effort on the server) that hosts
// the <canvas> and loads the bundled ES module, which does all the emulation/render/input.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAYER_ASSET = join('assets', 'preview', 'player.js');

let cachedPlayerPath: string | undefined;

/**
 * Locate the bundled browser player (`assets/preview/player.js`). Built by
 * `pnpm --filter @zx-vibes/toolkit run build` (the player bundle step). Missing → a clear
 * error telling the operator to build, never a silent 404 of broken JS.
 */
export function findPlayerBundlePath(): string {
  if (cachedPlayerPath && existsSync(cachedPlayerPath)) return cachedPlayerPath;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, PLAYER_ASSET);
    if (existsSync(candidate)) {
      cachedPlayerPath = candidate;
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate the bundled preview player (${PLAYER_ASSET}). ` +
      'Run `pnpm --filter @zx-vibes/toolkit run build` to produce it.',
  );
}

/** The bundled player JS source (read fresh each call so `--watch` rebuilds are picked up). */
export function readPlayerBundle(): string {
  return readFileSync(findPlayerBundlePath(), 'utf8');
}

/** Whether the bundled player exists (so the server can fail loud at startup if not built). */
export function playerBundleExists(): boolean {
  try {
    findPlayerBundlePath();
    return true;
  } catch {
    return false;
  }
}

/**
 * The minimal HTML page served at `/`. It hosts a 256x192 <canvas> (CSS-scaled with
 * pixelated rendering) and loads the bundled player ES module, which fetches the program
 * + ROM and runs the reconstructed machine. The `label` is a short Incidental caption.
 */
export function playerHtml(label: string): string {
  const caption = escapeHtml(label);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>zxs preview — ${caption}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #111; color: #ddd; font: 13px/1.4 system-ui, sans-serif;
         display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px; }
  #frame { padding: 24px; border-radius: 4px; background: #000; line-height: 0; }
  #screen { width: 512px; height: 384px; image-rendering: pixelated; display: block; }
  .meta { opacity: 0.75; }
  code { color: #9cf; }
</style>
</head>
<body>
  <div class="meta">zxs preview · <span id="status">loading…</span></div>
  <div id="frame"><canvas id="screen" width="256" height="192"></canvas></div>
  <div class="meta">${caption} — host keys drive the 48K matrix; <code>--watch</code> live-reloads.</div>
  <script type="module" src="player.js"></script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
