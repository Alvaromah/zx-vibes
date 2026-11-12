// `zxs preview` (default project mode) loads the build where `run`/`verify` do: the
// source's first ORG, else the configured `org` (cli.md CLI-PROD-CONV-ORIGIN-001).
// Before, the preview always used the configured `org`, so a source with `ORG 0x9000`
// ran from 0x8000 in the browser while `zxs run` ran it from 0x9000.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePreviewProgram } from '../src/preview/program.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-preview-origin-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function project(source: string): void {
  writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'main.asm', org: '0x8000' }));
  writeFileSync(join(dir, 'main.asm'), source);
}

describe('preview load origin (CLI-PROD-CONV-ORIGIN-001)', () => {
  it('serves a source with ORG 0x9000 at 0x9000, not the configured 0x8000', () => {
    project('    ORG 0x9000\nstart:\n    jp start\n');
    const program = resolvePreviewProgram({ cwd: dir });
    expect(program.kind).toBe('bin');
    expect(program.org).toBe(0x9000);
    expect(Array.from(program.bytes)).toEqual([0xc3, 0x00, 0x90]);
  });

  it('serves a source without ORG at the configured org', () => {
    project('    ret\n');
    const program = resolvePreviewProgram({ cwd: dir });
    expect(program.org).toBe(0x8000);
    expect(Array.from(program.bytes)).toEqual([0xc9]);
  });
});
