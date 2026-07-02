# Project Config (`zx.config.json`) Product Surface

The per-project configuration the toolkit reads to build/run/verify a project.
Consumed by the runtime (`toolkit-runtime.md` RT-PROD-CONFIG) and the CLI/MCP
build path. Mined once from the oracle
(`../../../zx-vibes/packages/toolkit/src/cli/config.ts`); contract-tier (fields,
defaults, resolution precedence, validation) captured exactly.

## Purpose

- [id: CFG-PROD-SCOPE-001] `zx.config.json` records a project's build defaults (entry, origin, assembler backend, output directory) plus informational metadata, so toolkit commands work with no flags. [provenance: contract]

## Public Behavior

- [id: CFG-PROD-FILE-001] The config file is `zx.config.json` in the project root (the current working directory). [provenance: contract]
- [id: CFG-PROD-FILE-002] When `zx.config.json` is absent, the toolkit uses an empty config (all defaults) — its absence is not an error. [provenance: contract]
- [id: CFG-PROD-FILE-003] When present but not valid JSON, loading fails as a user error (exit 1) with a message naming `zx.config.json`. [provenance: contract]
- [id: CFG-PROD-FILE-004] Every field is optional; there is no required field in the file itself (a missing `entry` is only an error at build time if not supplied by a CLI argument). [provenance: contract]

## Fields

- [id: CFG-PROD-FIELD-ENTRY-001] `entry` (string) — path to the entry `.asm` file (e.g. `src/main.asm`). No default; the build needs it from `entry` or a CLI file argument. [provenance: contract]
- [id: CFG-PROD-FIELD-ORG-001] `org` (string) — load/origin address as a hex string; default `"0x8000"`. [provenance: contract]
- [id: CFG-PROD-FIELD-ASM-001] `assembler` (`"builtin"` | `"sjasmplus"`) — the assembler backend; default `"builtin"` = the embedded `@zx-vibes/asm` (ADR-0027 D3). The legacy value `"spectral"` is accepted as a deprecated back-compat alias for `"builtin"`; `"sjasmplus"` is the external escape hatch. [provenance: decision:ADR-0027]
- [id: CFG-PROD-FIELD-OUTDIR-001] `outDir` (string) — output directory for `.bin`/`.sld`; default `"build"`. [provenance: contract]
- [id: CFG-PROD-FIELD-NAME-001] `name` (string) — project name; informational metadata, not validated or enforced. [provenance: contract]
- [id: CFG-PROD-FIELD-TEMPLATE-001] `template` (string) — the starter template a project was generated from (e.g. `game`); informational metadata. [provenance: contract]
- [id: CFG-PROD-FIELD-TOOLKIT-001] `toolkit` (string) — the toolkit/package the project uses (e.g. `zx-vibes`); informational metadata. [provenance: contract]

## Rules

- [id: CFG-PROD-RESOLVE-001] Each resolvable value follows the precedence **CLI flag > environment variable > `zx.config.json` > built-in default**. [provenance: contract]
- [id: CFG-PROD-RESOLVE-002] `assembler` additionally honors the `ZXS_ASSEMBLER` environment variable between the CLI flag and the config value, and is matched case-insensitively; an empty/absent value resolves to `"builtin"`, and the legacy `"spectral"` resolves to `"builtin"` (ADR-0027). [provenance: decision:ADR-0027]
- [id: CFG-PROD-RESOLVE-003] `outDir` defaults to `"build"` and `org` to `"0x8000"` when neither a CLI value nor a config value is present. [provenance: contract]

## Errors

- [id: CFG-PROD-ERR-001] An unknown `assembler` backend (not `builtin`/`spectral`/`sjasmplus`, via flag/env/config) is reported by `build` as an error and exits 1 (USER_ERROR). [provenance: decision:ADR-0027]
- [id: CFG-PROD-ERR-002] A build with no resolvable `entry` (neither CLI argument nor config) is a user error (exit 1) advising to pass a file or add `entry` to `zx.config.json`. [provenance: contract]

## Degrees of freedom

- [id: CFG-PROD-FREE-001] `name`, `template`, and `toolkit` are informational metadata: their values are not validated or enforced by the toolkit (Incidental). [provenance: decision:ADR-0001]
- [id: CFG-PROD-FREE-002] The config is not validated by a schema library (validation is per-field/per-command); additional unknown keys are ignored rather than rejected. [provenance: contract]

## Provenance

- The schema, resolution precedence, and validation mechanism are `contract`, mined
  once from the oracle (`src/cli/config.ts`: the `ZxProjectConfig` type,
  `loadProjectConfig`, the `configured*`/`normalizeAssembler` resolvers;
  `commands/build.ts` for the entry/assembler validation). The **assembler default
  rename** — `spectral` → `builtin` (embedded `@zx-vibes/asm`), with `spectral` kept
  as a deprecated back-compat alias — is `decision:ADR-0027` (D3). One row is
  `decision:ADR-0001` (Incidental). No `UNKNOWN`. Cross-references: `cli.md`
  (`build` flags), `toolkit-runtime.md` (RT-PROD-CONFIG).

## Examples

```json
{
  "name": "arkanoid",
  "entry": "src/main.asm",
  "org": "0x8000",
  "assembler": "builtin",
  "outDir": "build",
  "template": "game",
  "toolkit": "zx-vibes"
}
```

```json
{ "entry": "src/main.asm", "toolkit": "@zx-vibes/toolkit" }
```

## Acceptance criteria

- [id: CFG-PROD-AC-DEFAULTS-001] A regenerated toolkit MUST apply the documented defaults (`org` `0x8000`, `assembler` `builtin`, `outDir` `build`) and the CLI>env>config>default precedence, treating the legacy `spectral` as an alias of `builtin`; a `conformance/cli/` snapshot can assert a build's resolved entry/outDir under a known config. [provenance: decision:ADR-0027]
- [id: CFG-PROD-AC-ABSENT-001] With no `zx.config.json`, toolkit commands MUST run on defaults (absence is not an error); with invalid JSON they MUST fail as a user error (exit 1). [provenance: contract]
