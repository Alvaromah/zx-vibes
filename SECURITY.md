# Security Policy

## Supported versions

Only the latest published version of each package (`zx-vibes`,
`@zx-vibes/toolkit`, `@zx-vibes/asm`, `@zx-vibes/cpu`, `@zx-vibes/ula`,
`@zx-vibes/machine`) receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/Alvaromah/zx-vibes/security/advisories/new)
("Report a vulnerability"). Do not open a public issue for security reports.

You can expect an initial response within a week. Once a fix is available, the
advisory will be published together with patched package versions.

## Scope notes

- The `zxs preview` server binds to localhost and is intended for local
  development only; exposing it to untrusted networks is out of scope.
- The MCP server (`zxs-mcp`) executes with the invoking user's privileges and
  is intended to be run by a local coding agent; treat its configuration files
  (`.mcp.json`, `.codex/config.toml`) as trusted input.
