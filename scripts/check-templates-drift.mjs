#!/usr/bin/env node
// check-templates-drift.mjs — anti-drift gate for the scaffold template module.
//
// `zxs new` embeds its playable starter sources as string constants in
// packages/toolkit/src/scaffold/templates.ts, generated from starters/ (the npm package
// cannot read starters/ at runtime). If someone edits a starter without regenerating —
// or edits the generated module by hand — the scaffold silently diverges from the starter
// it claims to mirror, and the game smoke suites (which assert exact on-screen pixels) can
// disagree between the two. This gate fails RED the moment they drift.
//
// Repo culture: every claim has a self-test — this is the check half of the
// gen-scaffold-templates.mjs pair (sibling of check:opcode-table / gen:opcode-table).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderTemplatesModule, TEMPLATES_OUT } from './gen-scaffold-templates.mjs';

const expected = renderTemplatesModule();
const actual = readFileSync(TEMPLATES_OUT, 'utf8').replace(/\r\n/g, '\n');

if (expected !== actual) {
  const rel = path.relative(process.cwd(), TEMPLATES_OUT).split('\\').join('/');
  console.error(`scaffold template drift: ${rel} is out of sync with starters/.`);
  console.error('Run `pnpm run gen:scaffold-templates` after editing starters/ (or reconcile the two by hand).');
  process.exit(1);
}

console.log('scaffold templates: templates.ts is in sync with starters/ (game + platformer).');
