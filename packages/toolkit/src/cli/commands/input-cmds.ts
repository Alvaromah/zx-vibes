import { KeyPlanRunner, compileTypeText } from '../../core/input.js';
import { EXIT, emit, hex, parseCount, userError } from '../output.js';
import { loadSessionMachine, saveSessionMachine } from '../session.js';

/** Press a key in the current session: down, hold N frames, up, settle. */
export function keyCommand(
  key: string,
  opts: { hold: string; state?: string; json: boolean }
): number {
  const m = loadSessionMachine(opts.state);
  if (!m) {
    throw userError('No session state found. Run `zxs run` first.', 'key');
  }
  const hold = parseCount(opts.hold, 'hold frames');

  m.setKey(key, true);
  m.run({ frames: hold });
  m.setKey(key, false);
  m.run({ frames: 2 });

  const statePath = saveSessionMachine(m, opts.state);
  const pc = m.cpu.registers.getPC();
  emit(
    {
      ok: true,
      stage: 'key',
      key: key.toUpperCase(),
      heldFrames: hold,
      pc: hex(pc),
      statePath,
      next: ['zxs screen --text'],
    },
    opts.json,
    () => `pressed ${key.toUpperCase()} for ${hold} frames — PC=${hex(pc)}`
  );
  return EXIT.OK;
}

/** Type text into the current session via the key matrix. */
export function typeCommand(
  text: string,
  opts: { framesPerKey: string; state?: string; json: boolean }
): number {
  const m = loadSessionMachine(opts.state);
  if (!m) {
    throw userError('No session state found. Run `zxs run` first.', 'type');
  }

  const framesPerKey = parseCount(opts.framesPerKey, 'frames per key');
  const events = compileTypeText(text, { framesPerKey });
  const runner = new KeyPlanRunner(events, m);
  runner.applyDue(0);
  m.run({ frames: runner.planFrames + 5, onFrame: (f) => runner.applyDue(f) });

  const statePath = saveSessionMachine(m, opts.state);
  emit(
    {
      ok: true,
      stage: 'type',
      text,
      keystrokes: events.length / 2,
      framesRun: runner.planFrames + 5,
      statePath,
      next: ['zxs screen --text'],
    },
    opts.json,
    () => `typed ${JSON.stringify(text)} (${events.length / 2} keystrokes)`
  );
  return EXIT.OK;
}
