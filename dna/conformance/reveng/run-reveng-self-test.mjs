#!/usr/bin/env node
// Reverse-engineering ADD-ON self-test (cli.md CLI-PROD-REVENG-001 / CLI-PROD-GFX-003,
// ADR-0027 D5) — the conformance counterpart of the toolkit vitest `reveng.test.ts`, run
// against the REAL built `zxs` CLI bin so it proves the wired add-on, not just the in-process
// services. It INDEPENDENTLY GATES the optional add-on (D5): it is a standalone runner, so the
// reveng module is verified as a separable unit rather than folded into the core toolkit gate.
//
// Dependency-free on purpose (mirrors dna/conformance/mcp/run-mcp-self-test.mjs): it drives the
// spawned CLI directly and crafts a deterministic `.z80` via the core `@zx-vibes/machine`
// `writeZ80` codec (a routine `CALL 0x9000 ; RET` at 0x8000 + an "X" sprite at 0x9000).
//
// Asserts:
//   - `snapshot info` preserves the LEGACY `{ format, version, hardwareMode, … }` shape,
//   - `snapshot mem`/`ram` dump memory regions,
//   - `scan --bytes`/`--imm` find a known opcode + immediate,
//   - `xref` finds + classifies a reference to an address,
//   - reveng `gfx find` locates graphics-like data and `gfx blit-linear` writes a real PNG,
//   - `.sna` fails loud (W4-GAP-03, no core codec),
//   - the add-on is OPTIONAL and its ABSENCE is the documented default (CLI-PROD-FREE-003):
//     it is OPT-IN via `ZXS_REVENG` (the mounted-path checks below set `ZXS_REVENG=on`), and
//     `ZXS_REVENG=off` (or unset) yields a pure-core CLI (no `snapshot`; reveng `gfx find`
//     fails loud "not installed").

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const TOOLKIT = join(REPO_ROOT, 'packages', 'toolkit');
const CLI_BIN = join(TOOLKIT, 'bin', 'zxs.js');
const MACHINE = join(REPO_ROOT, 'packages', 'machine', 'src', 'index.mjs');

const SPRITE = [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81]; // an "X" — all non-blank/non-solid
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let failures = 0;
function check(cond, message) {
  if (cond) {
    console.log(`  ok  ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${message}`);
  }
}

/**
 * Run the real `zxs` CLI bin in `--json` mode; return `{ code, json }`. The reverse-engineering
 * add-on is OFF by default (CLI-PROD-FREE-003); this self-test targets the add-on, so its CLI
 * invocations OPT IN by default (`ZXS_REVENG=on`) to exercise the mounted path. The optional-gate
 * checks pass an explicit `env` (`{ ZXS_REVENG: 'off' }`) to prove the pure-core surface.
 */
function runCli(args, cwd, env) {
  try {
    const out = execFileSync(process.execPath, [CLI_BIN, ...args, '--json'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(env ?? { ZXS_REVENG: 'on' }) },
    });
    return { code: 0, json: parseJson(out) };
  } catch (error) {
    return { code: error.status ?? 1, json: parseJson((error.stdout || '').toString()) };
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text.trim());
  } catch {
    return {};
  }
}

async function main() {
  if (!existsSync(join(TOOLKIT, 'dist', 'cli.js'))) {
    console.log('  building @zx-vibes/toolkit (dist missing) ...');
    execFileSync('pnpm', ['--filter', '@zx-vibes/toolkit', 'run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  }

  const { writeZ80 } = await import(pathToFileURL(MACHINE).href);
  const dir = mkdtempSync(join(tmpdir(), 'zxs-reveng-selftest-'));
  try {
    // A deterministic snapshot: CALL 0x9000 ; RET at 0x8000, sprite at 0x9000.
    const memory = new Uint8Array(0x10000);
    memory.set([0xcd, 0x00, 0x90, 0xc9], 0x8000);
    memory.set(SPRITE, 0x9000);
    const z80 = writeZ80({ registers: { pc: 0x8000, sp: 0xff00, i: 0x3f, im: 1, iff1: 1 }, memory, border: 3 });
    writeFileSync(join(dir, 'game.z80'), Buffer.from(z80));
    writeFileSync(join(dir, 'game.sna'), Buffer.alloc(49179)); // a real .sna is 49179 bytes

    // -- snapshot info: LEGACY shape ----------------------------------------
    console.log('snapshot info (legacy shape):');
    const info = runCli(['snapshot', 'info', 'game.z80'], dir);
    check(info.code === 0, 'snapshot info exits 0');
    check(info.json.ok === true && info.json.stage === 'snapshot' && info.json.op === 'info', 'envelope { ok, stage:snapshot, op:info }');
    check(info.json.format === 'z80', 'format === "z80" (pinned)');
    check(info.json.version === 3, 'version === 3 (pinned; writeZ80 emits v3)');
    check(info.json.hardwareMode === '48K', 'hardwareMode === "48K" (pinned)');
    check(info.json.border === 3, 'border preserved (3)');
    check(info.json.registers && info.json.registers.pc === 0x8000, 'registers.pc === 0x8000');

    // -- snapshot mem / ram --------------------------------------------------
    console.log('snapshot mem / ram:');
    const mem = runCli(['snapshot', 'mem', 'game.z80', '0x9000', '--len', '8'], dir);
    check(mem.code === 0 && JSON.stringify(mem.json.bytes) === JSON.stringify(SPRITE), 'snapshot mem reads the sprite bytes');
    const ram = runCli(['snapshot', 'ram', 'game.z80', '--range', '0x8000-0x8003'], dir);
    check(ram.code === 0 && JSON.stringify(ram.json.bytes) === JSON.stringify([0xcd, 0x00, 0x90, 0xc9]), 'snapshot ram dumps the range');

    // -- scan: opcode + immediate -------------------------------------------
    console.log('scan (opcode + immediate):');
    const scanBytes = runCli(['scan', '--z80', 'game.z80', '--bytes', 'CD ?? 90'], dir);
    check(scanBytes.code === 0 && scanBytes.json.count === 1 && scanBytes.json.matches[0].addr === 0x8000, 'scan --bytes finds the CALL at 0x8000');
    const scanImm = runCli(['scan', '--z80', 'game.z80', '--imm', '0x9000-0x9000', '--range', '0x8000-0x8010'], dir);
    check(scanImm.code === 0 && scanImm.json.count === 1 && scanImm.json.matches[0].value === 0x9000, 'scan --imm finds the 0x9000 operand');

    // -- xref ----------------------------------------------------------------
    console.log('xref (static reference finder):');
    const xref = runCli(['xref', '0x9000', '--z80', 'game.z80', '--range', '0x8000-0x8010'], dir);
    check(xref.code === 0 && xref.json.count === 1, 'xref finds one reference to 0x9000');
    check(xref.json.refs[0].addr === 0x8000 && xref.json.refs[0].kind === 'call', 'the reference is the CALL at 0x8000 (kind:call)');

    // -- reveng gfx find + blit-linear --------------------------------------
    console.log('reveng gfx (find + blit-linear):');
    const find = runCli(['gfx', 'find', '--z80', 'game.z80', '--range', '0x8ff0-0x9010', '--window', '8', '--stride', '1', '--top', '3'], dir);
    check(find.code === 0 && find.json.op === 'find', 'gfx find exits 0 with op:find');
    check(find.json.candidates.length > 0 && find.json.candidates[0].addr === 0x9000, 'gfx find ranks the sprite (0x9000) highest');
    const blit = runCli(['gfx', 'blit-linear', '--z80', 'game.z80', '--addr', '0x9000', '--width', '8', '--height', '8', '--out', 'sprite.png'], dir);
    check(blit.code === 0 && blit.json.op === 'blit-linear' && blit.json.width === 8 && blit.json.height === 8, 'gfx blit-linear exits 0 (8×8)');
    const png = existsSync(join(dir, 'sprite.png')) ? readFileSync(join(dir, 'sprite.png')) : Buffer.alloc(0);
    check(png.length > PNG_SIGNATURE.length && png.subarray(0, 8).equals(PNG_SIGNATURE), 'gfx blit-linear wrote a real PNG (signature + non-empty)');

    // -- .sna fail-loud (W4-GAP-03) -----------------------------------------
    console.log('.sna fail-loud (W4-GAP-03):');
    const sna = runCli(['snapshot', 'info', 'game.sna'], dir);
    check(sna.code === 1 && sna.json.ok === false, 'snapshot info on a .sna exits 1');
    check(/\.sna codec|W4-GAP-03/i.test(sna.json.error?.message ?? ''), 'the error names the .sna codec gap');

    // -- the add-on is OPTIONAL (ZXS_REVENG=off → pure core) ----------------
    console.log('add-on is optional (ZXS_REVENG=off):');
    const off = runCli(['snapshot', 'info', 'game.z80'], dir, { ZXS_REVENG: 'off' });
    check(off.code === 1 && /unknown command/i.test(off.json.error?.message ?? ''), 'with the add-on off, `snapshot` is not a command');
    const offGfx = runCli(['gfx', 'find', '--z80', 'game.z80'], dir, { ZXS_REVENG: 'off' });
    check(offGfx.code === 1 && /not.*installed|add-on/i.test(offGfx.json.error?.message ?? ''), 'with the add-on off, reveng `gfx find` fails loud "not installed"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\nreveng add-on self-test FAILED: ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nreveng add-on self-test passed (snapshot info/mem/ram, scan, xref, gfx find/blit-linear, .sna fail-loud, optional gate).');
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
