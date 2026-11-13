---
"@zx-vibes/toolkit": patch
"zx-vibes": patch
---

Human (non-`--json`) output prints the lists people read instead of counting them:

- `zxs new`, `zxs init` and `zxs setup` print their `next` steps (and `setup` its
  `deferred` notes) one per line under the summary line, instead of `next=3`.
- `zxs test --list-assertions` prints the assertion reference, one aligned line per
  type with its fields and description, instead of `assertions=17`.

`--json` output is unchanged.
