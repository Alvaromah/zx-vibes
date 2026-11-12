---
"@zx-vibes/machine": patch
"@zx-vibes/cpu": patch
"@zx-vibes/ula": patch
---

Fix the published type declarations so TypeScript consumers can call the cores
the way they actually work. No runtime behaviour changed.

The `.d.mts` files are generated from the source by `types:gen`, but the sources
had little or no JSDoc, so tsc typed each options object from its default values
alone and dropped every option without a default:

- `@zx-vibes/machine`: `new Machine({ memory })`, `createMachine({ memory })` and
  `writeZ80({ memory })` failed to type-check (TS2353); `machine.registers.pc` was
  an error (`registers` was typed `{}`); the `ix`/`de`/`flag` options of
  `edgeLoad`, `edgeLoadWithDeck` and `instantLoad` were rejected; `readZ80()`'s
  registers had no `pc`; `decompressZ80`'s optional length was required. With
  `skipLibCheck: false` the declaration files themselves reported 14 errors.
- `@zx-vibes/cpu`: `step()` required a `clock`, which is optional.
- `@zx-vibes/ula`: `floatingBusByte()` was typed as always returning a number, but
  its `value` is `null` inside the display-fetch window.

`types:gen` in the three packages also deletes the old `.d.mts` first: tsc
otherwise resolved each sibling import to the existing declaration and only ever
re-emitted `index.d.mts`.
