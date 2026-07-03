#!/usr/bin/env node
// gen-scaffold-templates.mjs — regenerate the scaffold template content module
// (packages/toolkit/src/scaffold/templates.ts) from the starter projects.
//
// `zxs new` embeds its playable game/platformer sources as string constants (the npm
// package ships only bin/dist/assets, so it cannot read starters/ at runtime). The source
// of truth is starters/: edit a starter, then run `pnpm run gen:scaffold-templates`.
// `pnpm run check:templates` (in check:drift) fails RED if the committed module drifts
// from starters/, so the two cannot silently diverge.
//
// Repo culture: every claim has a self-test — this is the generator half of that pair.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

/** Exported constant name -> starter source file (project-relative). Order is stable. */
export const TEMPLATE_SOURCES = {
  LIB_SCREEN_ASM: 'starters/game/lib/screen.asm',
  LIB_KEYS_ASM: 'starters/game/lib/keys.asm',
  GAME_MAIN_ASM: 'starters/game/src/main.asm',
  PLATFORMER_MAIN_ASM: 'starters/platformer/src/main.asm',
  GAME_SMOKE_TEST_JSON: 'starters/game/tests/smoke.test.json',
  PLATFORMER_SMOKE_TEST_JSON: 'starters/platformer/tests/smoke.test.json',
};

/** Where the generated module is written. */
export const TEMPLATES_OUT = path.join(repoRoot, 'packages/toolkit/src/scaffold/templates.ts');

const HEADER = `// packages/toolkit/src/scaffold/templates.ts — GENERATED, DO NOT EDIT BY HAND.
//
// Byte-faithful scaffold template content backing \`zxs new\` (scaffold.ts). Generated from
// starters/ by \`pnpm run gen:scaffold-templates\` and pinned by \`pnpm run check:templates\`
// (part of check:drift). The npm package ships only bin/dist/assets, so template content
// must be embedded here rather than read from starters/ at runtime.
//
// Source of truth is starters/: edit the starter, then regenerate. \`__NAME__\` in a
// main.asm header is substituted with the project name by the scaffold.

`;

/**
 * Render the module text from the current starter sources. Content is emitted as a raw
 * template literal, which is only valid when the source has no backtick / \${ / backslash;
 * we refuse to emit otherwise rather than risk a silently-corrupted embed.
 */
export function renderTemplatesModule() {
  let body = '';
  for (const [name, rel] of Object.entries(TEMPLATE_SOURCES)) {
    const raw = readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
    if (raw.includes('`') || raw.includes('${') || raw.includes('\\')) {
      throw new Error(`${rel} contains a backtick, \${, or backslash — cannot embed as a raw template literal`);
    }
    body += `export const ${name} = \`${raw}\`;\n\n`;
  }
  return HEADER + body;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  writeFileSync(TEMPLATES_OUT, renderTemplatesModule(), 'utf8');
  console.log(`regenerated ${path.relative(repoRoot, TEMPLATES_OUT)} from starters/`);
}
