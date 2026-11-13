#!/usr/bin/env node
// check-playbooks-drift.mjs — anti-drift gate for the hand-written agent playbooks.
//
// Two texts tell an agent how to work in a zx-vibes project, and neither is generated:
//   - `PLAYBOOK` in packages/toolkit/src/scaffold/scaffold.ts, which `zxs new` writes as
//     AGENTS.md/CLAUDE.md and `zxs setup` installs;
//   - starters/{game,platformer}/AGENT_PLAYBOOK.md, the starter projects' playbook.
// They are different on purpose (a starter has a package.json, a Makefile and lib/), but
// they state the same facts about the loop, the frame budget and how a program is entered.
// This gate fails RED when the two starter playbooks stop being one text, or when a fact in
// PLAYBOOK_FACTS is missing from any playbook. When you add a fact to both, add it here.
//
// Repo culture: every check has a self-test — check-playbooks-drift-self-test.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SCAFFOLD_SOURCE = 'packages/toolkit/src/scaffold/scaffold.ts';
export const STARTER_PLAYBOOKS = [
  'starters/game/AGENT_PLAYBOOK.md',
  'starters/platformer/AGENT_PLAYBOOK.md',
];

/**
 * Facts every playbook must state, matched against normalised text (markdown emphasis
 * and backticks removed, whitespace collapsed, lower case), so line wrapping and
 * formatting may differ between the playbooks but the fact may not go missing.
 */
export const PLAYBOOK_FACTS = [
  ['never-report-success', /never report success without (?:having )?run(?:ning)? and look(?:ing|ed)/],
  ['run-status-ok', /status(?::| must be )"ok"/],
  ['run-halt-synced', /haltsynced(?::| must be )true/],
  ['run-no-overruns', /framebudget\.overrunframes(?::| must be )0/],
  ['budget-starts-at-first-halt', /measurement starts at the first halt that an interrupt resumes/],
  ['budget-one-off-work-counts', /one-off work such as drawing a title or building a level included/],
  [
    'budget-set-up-remedies',
    /do slow set-up before your first halt, split it across frames, or anchor (?:the|a) spec with waitfor/,
  ],
  ['entry-power-on-no-rom-start-up', /starts at its org from the power-on state, without the rom's start-up/],
  ['entry-system-variables-zero', /the system variables are zero/],
  ['entry-rom-keyboard', /no key for the first 256 frames, then wrong codes/],
  ['entry-rom-routines-crash', /rom routines that need the system variables \(rst 0x10 printing\) crash/],
  ['entry-own-keyboard-and-print', /read the keyboard ports.{0,40} and print with your own routine/],
  ['loop-state-reset', /zxs state reset/],
  ['loop-run-state', /zxs run --state \.zxs\/state\.zxstate/],
  ['loop-screen-text-state', /zxs screen --text --state \.zxs\/state\.zxstate/],
  ['gate-verify', /zxs verify/],
];

/** The text of `export const PLAYBOOK = \`…\`;` in scaffold.ts, template escapes undone. */
export function extractPlaybook(source) {
  const opener = 'export const PLAYBOOK = `';
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`${SCAFFOLD_SOURCE}: no \`export const PLAYBOOK = \`…\`\` found`);
  let text = '';
  for (let i = start + opener.length; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      text += source[i + 1] ?? '';
      i += 1;
    } else if (ch === '`') {
      return text;
    } else if (ch === '$' && source[i + 1] === '{') {
      throw new Error(`${SCAFFOLD_SOURCE}: PLAYBOOK interpolates \${…}; this check reads it as plain text`);
    } else {
      text += ch;
    }
  }
  throw new Error(`${SCAFFOLD_SOURCE}: PLAYBOOK template literal is not closed`);
}

export function normalise(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\*\*|`/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Problems with the given playbooks: `playbook` is the PLAYBOOK text, `starters` maps a
 * starter playbook's path to its text. Returns [] when they agree.
 */
export function checkPlaybooks({ playbook, starters, facts = PLAYBOOK_FACTS }) {
  const problems = [];
  const entries = Object.entries(starters);
  const [firstPath, firstText] = entries[0] ?? [];
  for (const [file, text] of entries.slice(1)) {
    if (text.replace(/\r\n/g, '\n') !== firstText.replace(/\r\n/g, '\n')) {
      problems.push(`${file} differs from ${firstPath}: the starter playbooks are one text`);
    }
  }
  const texts = [[`PLAYBOOK in ${SCAFFOLD_SOURCE}`, playbook], ...entries];
  for (const [label, text] of texts) {
    const flat = normalise(text);
    for (const [id, pattern] of facts) {
      if (!pattern.test(flat)) problems.push(`${label} no longer states fact '${id}' (${pattern})`);
    }
  }
  return problems;
}

/** Read the real files. */
export function readPlaybooks(root = repoRoot) {
  const playbook = extractPlaybook(readFileSync(path.join(root, SCAFFOLD_SOURCE), 'utf8'));
  const starters = Object.fromEntries(
    STARTER_PLAYBOOKS.map((file) => [file, readFileSync(path.join(root, file), 'utf8')]),
  );
  return { playbook, starters };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (invokedDirectly) {
  const problems = checkPlaybooks(readPlaybooks());
  if (problems.length > 0) {
    console.error('playbook drift:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      'Bring the playbooks back in line (or, for a fact that changed on purpose, update PLAYBOOK_FACTS in scripts/check-playbooks-drift.mjs).',
    );
    process.exit(1);
  }
  console.log(
    `playbooks: ${STARTER_PLAYBOOKS.length} starter copies identical; ${PLAYBOOK_FACTS.length} shared facts in PLAYBOOK and the starters.`,
  );
}
