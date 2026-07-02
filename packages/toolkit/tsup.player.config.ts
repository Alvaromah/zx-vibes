import { defineConfig } from 'tsup';

// Browser bundle for the bundled CORE preview player (cli.md CLI-PROD-PREVIEW-001,
// toolkit-runtime.md RT-PROD-PREVIEW-001). It bundles `player/main.js` together with the
// RECONSTRUCTED cores (@zx-vibes/machine + @zx-vibes/ula, forced in-bundle via `noExternal`)
// into a single browser ES module the preview server serves at `/player.js`. The output
// lands beside the 48K ROM asset (assets/preview/player.js) so the server locates it the
// same way it locates the ROM, and it ships in the published tarball (package.json `files`
// includes `assets`). `clean:false` so it never wipes the committed ROM asset.
export default defineConfig({
  entry: { player: 'player/main.js' },
  outDir: 'assets/preview',
  format: ['esm'],
  platform: 'browser',
  target: 'es2020',
  noExternal: [/@zx-vibes\//],
  bundle: true,
  clean: false,
  splitting: false,
  sourcemap: false,
  dts: false,
  minify: false,
});
