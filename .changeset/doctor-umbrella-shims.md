---
"@zx-vibes/toolkit": patch
"zx-vibes": patch
---

`doctor`: resolve the `zxs` shims that `npm install -g zx-vibes` actually writes.

The `zxs-path` check recognised only shims targeting `@zx-vibes/toolkit/bin/zxs.js`
— the layout a monorepo `npm link` produces. A real global install of the umbrella
package writes shims targeting `zx-vibes/bin/zxs.js` instead, so the check fell back
to reporting the shim directory as the installation root and left `cliPresent` unset.
The ambiguity check still worked, but the "incomplete installation (missing
`dist/cli.js`)" branch could never fire for the documented install path.

Both shim families now resolve to the toolkit root, whether npm nests the toolkit
under the umbrella package or hoists it, so the completeness check applies to
`npm install -g zx-vibes` as well.
