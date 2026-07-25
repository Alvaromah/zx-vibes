#!/usr/bin/env node
// check-knowledge-pack-drift.mjs — anti-drift gate for the embedded knowledge pack.
//
// `zxs setup` installs the knowledge pack from string constants in
// packages/toolkit/src/setup/pack-content.ts, generated from the DNA (reference/
// from dna/domain/ + product render specs, skills/ and recipes/ from dna/product/)
// by gen-knowledge-pack.mjs. If someone edits the DNA without regenerating — or
// edits the generated module by hand — the installed knowledge silently diverges
// from the conformance-gated truth it claims to carry (the exact rot
// KP-PROD-SCOPE-002 forbids). This gate fails RED the moment they drift, and it
// re-runs the generator's traceability check (KP-PROD-RULE-TRACE-001) on the way.
//
// Repo culture: every claim has a self-test — this is the check half of the
// gen-knowledge-pack.mjs pair (sibling of check:templates / gen:scaffold-templates).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderPackModule, PACK_OUT } from './gen-knowledge-pack.mjs';

const expected = renderPackModule();
const actual = readFileSync(PACK_OUT, 'utf8').replace(/\r\n/g, '\n');

if (expected !== actual) {
  const rel = path.relative(process.cwd(), PACK_OUT).split('\\').join('/');
  console.error(`knowledge-pack drift: ${rel} is out of sync with the DNA sources.`);
  console.error('Run `pnpm run gen:knowledge-pack` after editing dna/domain/, dna/product/skills/, or dna/product/recipes/.');
  process.exit(1);
}

console.log('knowledge pack: pack-content.ts is in sync with the DNA (reference + skills + recipes).');
