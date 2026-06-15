# zxs test assertions

List the supported vocabulary with:

```bash
zxs test --list-assertions
zxs test --list-assertions --json
```

Assertions live in `test.json` or `*.test.json` files under `assert`.

| Type | Fields | Use |
|---|---|---|
| `status` | `equals: "ok" | "hang"` | Expected run result. |
| `haltSynced` | `equals: boolean` | Main loop stayed aligned to `HALT`/frame cadence. |
| `screenChanged` | `equals: boolean` | Screen bitmap or attributes changed after load. |
| `cellsNonBlank` | `min?`, `max?` | Count 8x8 cells with at least one set bitmap pixel. |
| `attrNonBlank` | `min?`, `max?` | Count attribute cells changed from default `0x38`. |
| `coloredCells` | `min?`, `max?` | Alias of `attrNonBlank` for colour-only screens. |
| `screenIncludes` | `text` | Check ROM-font/OCR text rows. |
| `memEquals` | `addr`, `hex` | Exact memory bytes. |
| `regEquals` | `reg`, `value` | CPU register value. |
| `pixelAt` | `x`, `y`, `set` | One bitmap pixel. |
| `borderColor` | `equals: 0..7` | ULA border colour. |
| `beeperEdges` | `min?`, `max?` | Speaker bit-4 transitions on port `0xFE`. |
| `portFEWrites` | `min?`, `max?` | Writes to ULA port `0xFE`. |

Prefer assertions that match the intent of the feature. A sprite test should
usually check one or two pixels plus broad screen activity; a colour-only
effect should use `attrNonBlank` or `coloredCells`, not `cellsNonBlank`.

Input schedules in tests use the same relative format as `zxs run --keys`:

```json
{
  "keys": "10:P*30,50:SPACE*5"
}
```

Frame numbers are relative to the start of that test run, not to earlier CLI
commands.
