# Product

The surface invented by this project. It exists only in the oracle repo (code,
docs, tests) and is mined **once** into this directory (constraint C4), then the
oracle becomes disposable for this knowledge.

Authoring rules (`../../specs-plan.md` §5.2):

- Produced by a single extraction pass over the oracle (`../../../zx-vibes`).
- Reuse the existing tests, `golden/`, and `fixtures/` as the primary source of
  observable behavior; port them, do not reinvent from memory.
- Contract-tier behavior (flags, formats, exit codes, schemas) MUST be captured
  exactly. Provenance is typically `contract` or `manual`.

Planned files:

```text
overview.md  glossary.md
assembler.md  cli.md  mcp-tools.md  toolkit-runtime.md
scaffolding.md  gallery.md
zxstate-format.md  config-schema.md  recipes-and-assertions.md
compatibility.md  errors.md
```

Use the per-spec template in `../../specs-plan.md` §5.3 (note the `Degrees of
freedom` and `Provenance` sections).
