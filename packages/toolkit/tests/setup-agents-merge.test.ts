// `zxs setup --agent codex` points an existing AGENTS.md at the installed knowledge pack
// (cli.md CLI-PROD-SETUP-001, knowledge-pack.md KP-PROD-PKG-001). `zxs new`/`init` write
// AGENTS.md (the bare playbook) first; setup used to report it `skipped`, so Codex — whose
// only entry point is AGENTS.md — never learned where `.codex/zx-vibes/` was.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/scaffold/scaffold.js';
import { runSetup } from '../src/setup/setup.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-setup-agents-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const agents = (): string => readFileSync(join(dir, 'AGENTS.md'), 'utf8');

describe('setup --agent codex merges the pack pointer into an existing AGENTS.md', () => {
  it('after `zxs init` wrote the playbook, setup appends the pack section and keeps the rest', () => {
    runInit({ cwd: dir });
    const before = agents();
    expect(before).not.toContain('.codex/zx-vibes/');

    const env = runSetup({ agent: 'codex', cwd: dir });
    expect(env.installed).toContain('AGENTS.md');
    expect(env.skipped).not.toContain('AGENTS.md');
    const after = agents();
    expect(after.startsWith(before)).toBe(true);
    expect(after).toContain('## The knowledge pack');
    expect(after).toContain('.codex/zx-vibes/');
  });

  it('keeps a user-written AGENTS.md (CRLF too) and only appends', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# My rules\r\nAlways test.', 'utf8');
    runSetup({ agent: 'codex', cwd: dir });
    const after = agents();
    expect(after.startsWith('# My rules\r\nAlways test.\r\n')).toBe(true);
    expect(after).toContain('.codex/zx-vibes/');
    expect(after).not.toMatch(/[^\r]\n/); // stays CRLF throughout
  });

  it('is idempotent: a second run skips it; --force rewrites the full playbook', () => {
    runInit({ cwd: dir });
    runSetup({ agent: 'codex', cwd: dir });
    const merged = agents();
    const again = runSetup({ agent: 'codex', cwd: dir });
    expect(again.skipped).toContain('AGENTS.md');
    expect(agents()).toBe(merged);

    writeFileSync(join(dir, 'AGENTS.md'), 'stale', 'utf8');
    const forced = runSetup({ agent: 'codex', cwd: dir, force: true });
    expect(forced.installed).toContain('AGENTS.md');
    expect(agents()).toMatch(/^# Agent Playbook/);
    expect(agents()).toContain('.codex/zx-vibes/');
  });
});
