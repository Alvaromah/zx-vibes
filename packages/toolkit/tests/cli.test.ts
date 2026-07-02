import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import type { OutputStreams } from '../src/output/envelope.js';

function capture(): { streams: OutputStreams; out: () => string; err: () => string } {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  return {
    streams: { out: (t) => outChunks.push(t), err: (t) => errChunks.push(t) },
    out: () => outChunks.join(''),
    err: () => errChunks.join(''),
  };
}

describe('zxs dispatcher — envelope wired end-to-end (CLI-PROD-CONV-JSON-001)', () => {
  it('version --json prints a single success envelope and exits 0', async () => {
    const cap = capture();
    const code = await runCli(['version', '--json'], { streams: cap.streams });
    expect(code).toBe(0);
    const lines = cap.out().trim().split('\n');
    expect(lines).toHaveLength(1);
    const envelope = JSON.parse(lines[0] as string);
    expect(envelope.ok).toBe(true);
    expect(envelope.stage).toBe('version');
    expect(typeof envelope.version).toBe('string');
    expect(cap.err()).toBe('');
  });

  it('an incomplete command emits a USER_ERROR envelope and exits 1', async () => {
    const cap = capture();
    // Bare `gfx` (no sub-command) is a USER_ERROR: core gfx needs `gfx linear` / `gfx attrs`.
    const code = await runCli(['gfx', '--json'], { streams: cap.streams });
    expect(code).toBe(1);
    const envelope = JSON.parse(cap.out().trim());
    expect(envelope).toMatchObject({
      ok: false,
      stage: 'gfx',
      error: { exitCode: 1 },
    });
  });

  it('an unknown command is a USER_ERROR (exit 1)', async () => {
    const cap = capture();
    const code = await runCli(['frobnicate', '--json'], { streams: cap.streams });
    expect(code).toBe(1);
    const envelope = JSON.parse(cap.out().trim());
    expect(envelope.ok).toBe(false);
    expect(envelope.error.exitCode).toBe(1);
  });

  it('--version exits 0 cleanly', async () => {
    const cap = capture();
    const code = await runCli(['--version'], { streams: cap.streams });
    expect(code).toBe(0);
  });

  it('bare invocation shows help (human) and exits 0', async () => {
    const cap = capture();
    const code = await runCli([], { streams: cap.streams });
    expect(code).toBe(0);
    expect(cap.out()).toContain('zxs');
  });
});

// The `zxs-mcp` server (formerly a stub here) is the real MCP server as of Slice 10;
// its catalog, delegation, and CLI interop are covered by `mcp.test.ts`.
