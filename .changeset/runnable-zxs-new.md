---
"@zx-vibes/toolkit": patch
"create-zx-vibes": patch
"zx-vibes": patch
---

Make generated projects runnable immediately by having `zxs new` install the
local `zx-vibes` dependency by default, adding a `--no-install` escape hatch,
and updating starter guidance for project-local `zxs` usage.
