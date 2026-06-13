import { writeFileSync } from 'node:fs';
import { screenshotPNG } from '../../core/screen.js';
import { screenText } from '../../core/screen-text.js';
import { EXIT, emit, ensureParentDir, userError } from '../output.js';
import { loadSessionMachine } from '../session.js';

export interface ScreenCommandOptions {
  png?: string;
  text: boolean;
  attrs: boolean;
  state?: string;
  json: boolean;
}

/** Observe the current session's screen without running anything. */
export function screenCommand(opts: ScreenCommandOptions): number {
  const m = loadSessionMachine(opts.state);
  if (!m) {
    throw userError('No session state found (.zxs/state.zxstate). Run `zxs run` first.', 'screen');
  }

  let pngPath: string | undefined;
  if (opts.png) {
    ensureParentDir(opts.png);
    writeFileSync(opts.png, screenshotPNG(m));
    pngPath = opts.png;
  }

  const text = screenText(m);
  const result = {
    ok: true,
    stage: 'screen',
    nonBlankCells: text.nonBlankCells,
    borderColor: text.borderColor,
    rows: text.rows,
    ...(opts.attrs ? { attrs: text.attrs } : {}),
    ...(pngPath !== undefined ? { png: pngPath } : {}),
  };

  emit(result, opts.json, () => {
    const lines: string[] = [];
    lines.push('┌' + '─'.repeat(32) + '┐');
    lines.push(...text.rows.map((r) => `│${r}│`));
    lines.push('└' + '─'.repeat(32) + '┘');
    lines.push(`${text.nonBlankCells} non-blank cells · border ${text.borderColor}`);
    if (opts.attrs) {
      for (const a of text.attrs.slice(0, 8)) {
        lines.push(
          `attr 0x${a.attr.toString(16).padStart(2, '0')}: ink ${a.ink} paper ${a.paper}` +
            `${a.bright ? ' BRIGHT' : ''}${a.flash ? ' FLASH' : ''} × ${a.count} cells`
        );
      }
    }
    if (pngPath) lines.push(`saved ${pngPath}`);
    return lines.join('\n');
  });
  return EXIT.OK;
}
