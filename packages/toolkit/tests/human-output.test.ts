// Human-mode (non-`--json`) output says what went wrong and shows what was asked for
// (wording is Incidental, cli.md CLI-PROD-FREE-001; `--json` is untouched). A failing
// `build`/`test`/`verify` used to print only "error: Assembly failed: 1 error(s)", and
// `disasm`/`regs`/`trace` printed their payload as a JSON blob cut at 120 characters
// (or, for trace, just a count).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { ASSERTION_REFERENCE } from '../src/test/assertions.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-human-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run `zxs <argv>` in human mode; returns exit code, stdout, stderr. */
async function human(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const code = await runCli(argv, { streams: { out: (t) => out.push(t), err: (t) => err.push(t) } });
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    process.chdir(prev);
  }
}

function project(source: string): void {
  writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'main.asm' }));
  writeFileSync(join(dir, 'main.asm'), source);
}

const OK = ['    ORG 0x8000', 'main:', '    ld a, 1', '    ei', 'idle:', '    halt', '    jr idle', ''].join('\n');

describe('a failure explains itself on stderr', () => {
  it('build: each diagnostic with file:line and the source line', async () => {
    project('    ORG 0x8000\n    ld a, 1\n    bogus_op 3\n');
    const { code, out, err } = await human(['build']);
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(err).toMatch(/^error: Assembly failed: 1 error\(s\)/);
    expect(err).toMatch(/main\.asm:3: /);
    expect(err).toContain('bogus_op 3');
  });

  it('test: each failing spec and why', async () => {
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'p.asm'), OK);
    writeFileSync(
      join(dir, 'tests', 'p.test.json'),
      JSON.stringify({ build: 'p.asm', frames: 5, assert: [{ type: 'borderColor', equals: 3 }] }),
    );
    const { code, err } = await human(['test', 'tests']);
    expect(code).toBe(1);
    expect(err).toContain('FAIL tests/p.test.json');
    expect(err).toMatch(/borderColor/);
  });

  it('run: the hang verdict and its likely cause', async () => {
    project('    ORG 0x8000\n    di\n    halt\n');
    const { code, err } = await human(['run']);
    expect(code).toBe(2);
    expect(err).toMatch(/hang: di-halt at PC 0x8001 \(definite\)/);
    expect(err).toMatch(/likely cause: /);
  });

  it('verify: which stage failed, with its own details', async () => {
    project('    ORG 0x8000\n    ld a, 1\n    bogus_op 3\n');
    const { code, err } = await human(['verify']);
    expect(code).toBe(1);
    expect(err).toContain('build failed:');
    expect(err).toMatch(/ {4}main\.asm:3: /);
  });
});

describe('the observe payloads print whole', () => {
  it('disasm: one line per instruction, labelled, nothing cut', async () => {
    project(OK);
    const { code, out } = await human(['disasm', 'main', '--count', '4']);
    expect(code).toBe(0);
    expect(out).not.toContain('…');
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^disasm: .*instructions=4/);
    expect(out).toMatch(/ {2}8000 {2}3E 01 +LD A,0x01 {2}; main/i);
    expect(out).toMatch(/ {2}8003 {2}76 +HALT {2}; idle/i);
  });

  it('regs: the register file as a block', async () => {
    project(OK);
    const { out } = await human(['regs']);
    expect(out).not.toContain('…');
    expect(out).toMatch(/PC=8000 SP=FFFF AF=FFFF/);
    expect(out).toMatch(/AF'=FFFF .* IM=0 IFF1=0 IFF2=0/);
    expect(out).toMatch(/flags: SZ5H3PNC/);
  });

  it('trace: the hot-spots and the tail as listings, plus the profile table', async () => {
    project(OK);
    const { out } = await human(['trace', '--frames', '2', '--top', '2', '--last', '3', '--profile']);
    expect(out).toMatch(/^trace: .*top=2 last=3/);
    expect(out).toMatch(/top:\n {2}8003 +x\d+ {2}HALT/);
    expect(out).toContain('last:');
    expect(out).toMatch(/profile: active [\d.]+% {2}HALT idle [\d.]+%/);
  });
});

describe('lists a human reads item by item print one per line', () => {
  it('test --list-assertions: the whole reference, one line per type', async () => {
    const { code, out } = await human(['test', '--list-assertions']);
    expect(code).toBe(0);
    const [line, header, ...rows] = out.trimEnd().split('\n');
    expect(line).toBe(`test: assertions=${ASSERTION_REFERENCE.length}`);
    expect(header).toBe('assertions:');
    expect(rows).toHaveLength(ASSERTION_REFERENCE.length);
    ASSERTION_REFERENCE.forEach((doc, i) => {
      expect(rows[i]!.startsWith(`  ${doc.type} `)).toBe(true);
      expect(rows[i]).toContain(`{ ${doc.fields.join(', ')} }`);
      expect(rows[i]).toContain(doc.description);
    });
    expect(out).toContain('frameBudget');
    expect(out).toContain('{ maxOverrunFrames?, requireMeasured? }');
  });

  it('new: the next steps, not their count', async () => {
    const { code, out } = await human(['new', 'pong']);
    expect(code).toBe(0);
    const lines = out.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^new: name=pong dir=pong template=game files=\d+$/);
    expect(lines[0]).not.toContain('next=');
    expect(lines.slice(1)).toEqual(['next:', '  cd pong', '  zxs verify', '  zxs preview --watch']);
  });
});

describe('run: the frame budget names the late frames', () => {
  it('prints a compact frameBudget with the overrun frames', async () => {
    // Late on exactly two frames (the CLI-RUN-OVERRUNS-001 fixture program).
    project([
      '    ORG 0x8000',
      '    ld sp, 0xFF00',
      '    ei',
      'main:',
      '    halt',
      '    ld hl, count',
      '    inc (hl)',
      '    ld a, (hl)',
      '    cp 10',
      '    jr z, slow',
      '    cp 20',
      '    jr nz, main',
      'slow:',
      '    ld bc, 3000',
      'delay:',
      '    dec bc',
      '    ld a, b',
      '    or c',
      '    jr nz, delay',
      '    jr main',
      'count:',
      '    defb 0',
      '',
    ].join('\n'));
    const { code, out } = await human(['run', '--frames', '40']);
    expect(code).toBe(0);
    expect(out).toMatch(/frameBudget=\{measured=40 overruns=2 frames=10,21 worst=\d+T@21\}/);
  });
});

describe('doctor: a failing check explains itself', () => {
  it('prints each failing check with its detail (the fix)', async () => {
    // A registration only npx's PATH could start (CLI-PROD-DOCTOR-003).
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { 'zx-vibes': { command: 'zxs-mcp-missing' } } }));
    const { code, err } = await human(['doctor']);
    expect(code).toBe(3);
    expect(err).toMatch(/^error: Environment check failed: mcp-command/);
    expect(err).toContain('FAIL mcp-command: .mcp.json starts zx-vibes with `zxs-mcp-missing`');
    expect(err).toContain('zxs setup --agent claude --force');
  });
});
