---
"@zx-vibes/toolkit": minor
"zx-vibes": minor
---

Screenshots can show the border. `zxs run --screenshot <file> --border` and
`zxs verify --border` write the 320×240 frame the preview player shows: the screen
inside a border whose rows take the colour each raster line started with during the
run's last frame. Border stripes and the bands a ROM `SAVE` paints (red/cyan for the
pilot tone, blue/yellow for the data) now appear in a headless capture. Without
`--border`, screenshots stay 256×192, so existing baselines and `screenDiff` are
unchanged. `--border` without `--screenshot` is an error.
