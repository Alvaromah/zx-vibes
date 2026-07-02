# Oracle Capture Harness

This directory contains the W0 oracle capture harness for `R-W0-06`.

The oracle is the sibling worktree `../zx-vibes`. Captures are for
tie-breaking and product extraction only; they are not a standing authority over
the DNA. The default capture plan pins the oracle commit and rejects dirty
worktrees so captured command snapshots and byte hashes are reproducible.

```bash
pnpm run oracle:capture -- --list
pnpm run oracle:capture -- --case ORACLE-CLI-ZXS-HELP-001
pnpm run oracle:capture:self-test
```

Default outputs go to `.cache/oracle-captures/`, which is intentionally ignored.
Commit a captured artifact only when it has been promoted into an explicit DNA
fixture or product specification with provenance.
