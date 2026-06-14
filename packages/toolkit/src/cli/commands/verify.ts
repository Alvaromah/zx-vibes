import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from '../../build/sjasmplus.js';
import { Watchdog } from '../../core/detect.js';
import { Machine } from '../../core/machine.js';
import { screenshotPNG } from '../../core/screen.js';
import { screenText } from '../../core/screen-text.js';
import { EXIT, emit, parseAddress, userError } from '../output.js';
import {
  configuredAssembler,
  configuredEntry,
  configuredOrg,
  configuredOutDir,
  loadProjectConfig,
  resolveProjectPath,
} from '../config.js';
import { runTestSuite } from './test-cmd.js';

export interface VerifyCommandOptions {
  json: boolean;
  screenshot?: string;
}

export async function verifyCommand(opts: VerifyCommandOptions): Promise<number> {
  const loaded = loadProjectConfig();
  const entry = configuredEntry(undefined, loaded.config);
  if (!entry) {
    throw userError('No entry configured. Add "entry" to zx.config.json or run zxs build <file>.', 'verify');
  }

  const outDir = configuredOutDir(undefined, loaded.config);
  const assembler = configuredAssembler(undefined, loaded.config);
  if (!assembler) {
    throw userError(`Unknown assembler backend: ${loaded.config.assembler}`, 'verify');
  }

  const buildResult = await build(resolveProjectPath(entry), { outDir, assembler });
  let runReport: Record<string, unknown> | undefined;
  let testReport: Awaited<ReturnType<typeof runTestSuite>> | undefined;
  let screenshotPath: string | undefined;

  if (buildResult.ok && buildResult.outputs.bin) {
    const machine = Machine.boot();
    machine.loadBinary(new Uint8Array(readFileSync(buildResult.outputs.bin)), parseAddress(configuredOrg(undefined, loaded.config)));
    const wd = new Watchdog();
    wd.attach(machine);
    machine.resetAudioActivity();
    const outcome = machine.run({ frames: 300, watchdog: wd });
    const audio = machine.getAudioActivity();
    wd.detach();
    const text = screenText(machine);
    screenshotPath = opts.screenshot ?? join('.zxs', 'verify-screen.png');
    mkdirSync(dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, screenshotPNG(machine));
    runReport = {
      ok: !outcome.hang,
      status: outcome.hang ? 'hang' : 'ok',
      framesRun: outcome.framesRun,
      haltSynced: wd.haltSynced(outcome.framesRun),
      screen: { nonBlankCells: text.nonBlankCells, png: screenshotPath },
      audio,
      ...(outcome.hang ? { hang: outcome.hang } : {}),
    };
  }

  if (existsSync('tests')) {
    testReport = await runTestSuite('tests');
  }

  const ok = buildResult.ok && (runReport?.ok === true) && (testReport ? testReport.failed === 0 : true);
  emit(
    {
      ok,
      stage: 'verify',
      build: {
        ok: buildResult.ok,
        errors: buildResult.errors,
        warnings: buildResult.warnings,
        outputs: buildResult.outputs,
        assembler,
      },
      ...(runReport ? { run: runReport } : {}),
      ...(testReport ? { tests: testReport } : {}),
    },
    opts.json,
    () => {
      const lines = [
        buildResult.ok ? `build: OK (${assembler})` : `build: failed (${buildResult.errors.length} errors)`,
      ];
      if (runReport) lines.push(`run: ${runReport.ok ? 'OK' : 'failed'} (${screenshotPath})`);
      if (testReport) lines.push(`tests: ${testReport.passed}/${testReport.total} passed`);
      return lines.join('\n');
    }
  );
  return ok ? EXIT.OK : EXIT.USER_ERROR;
}
