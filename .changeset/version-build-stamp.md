---
"@zx-vibes/toolkit": minor
"zx-vibes": minor
---

`zxs --version` tells a local build from the npm release of the same version.

- A toolkit packed by the repository's `pnpm run pack` prints its version with
  the commit it was built from as semver build metadata, e.g. `0.8.0+325992e`
  (`.dirty` when tracked files had uncommitted changes). `zxs version` and the MCP
  server's reported version say the same.
- Published packages print the bare version: `pnpm publish` runs the same prepack
  without `ZXS_BUILD_STAMP`, which only `pnpm run pack` sets. The library's
  `readVersion()` still returns the manifest version.
