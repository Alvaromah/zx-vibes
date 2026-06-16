# zx-vibes

## 0.1.3

### Patch Changes

- a606951: Make generated projects runnable immediately by having `zxs new` install the
  local `zx-vibes` dependency by default, adding a `--no-install` escape hatch,
  and updating starter guidance for project-local `zxs` usage.
- Updated dependencies [ea0a2b7]
- Updated dependencies
- Updated dependencies [7cb76cd]
- Updated dependencies [a606951]
  - @zx-vibes/toolkit@0.2.0

## 0.1.2

### Patch Changes

- c813e18: Keep `zxs --version` synced with package metadata, document preview options in CLI regression tests, and let `zxs preview` fall forward to the next available port unless `--strict-port` is used.
- Updated dependencies [c813e18]
  - @zx-vibes/toolkit@0.1.2

## 0.1.1

### Patch Changes

- cf30399: Use source-controlled bin wrappers for CLI entrypoints so fresh workspace installs can create package shims before built `dist/` files exist, and document local clone and tarball workflows.
- Updated dependencies [5af5826]
- Updated dependencies [cf30399]
  - @zx-vibes/toolkit@0.1.1
  - @zx-vibes/asm@0.1.1
