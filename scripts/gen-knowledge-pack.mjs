#!/usr/bin/env node
// gen-knowledge-pack.mjs — regenerate the embedded knowledge-pack content module
// (packages/toolkit/src/setup/pack-content.ts) from the DNA sources.
//
// The knowledge pack (knowledge-pack.md KP-PROD-*) is the toolkit's P1 moat:
//   - reference/  GENERATED from dna/domain/ + the product render specs
//                 (KP-PROD-SOURCE-REF-001 — never hand-copied, so it cannot drift
//                 from the conformance-gated truth);
//   - skills/     authored in dna/product/skills/ (KP-PROD-SOURCE-SKILLS-001),
//                 each REQUIRED to cite the reference it teaches
//                 (KP-PROD-RULE-TRACE-001 — enforced here, a build error otherwise);
//   - recipes/    authored in dna/product/recipes/<name>/{README.md,demo.asm,test.json},
//                 CI-gated by packages/toolkit/tests/recipes.test.ts running each
//                 test.json through the real DSL (KP-PROD-SOURCE-RECIPES-001).
//
// `zxs setup` installs the embedded files (the npm package cannot read dna/ at
// runtime — same constraint and pattern as gen-scaffold-templates.mjs).
// `pnpm run check:knowledge-pack` (in check:drift) fails RED if the committed
// module drifts from the DNA sources.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

/**
 * Reference docs: pack path -> DNA source (KP-PROD-SOURCE-REF-001's mapping).
 * Domain docs are the hardware truth; the four render/policy specs + palette
 * come from dna/product/ per the same clause. Order is stable.
 */
export const REFERENCE_SOURCES = {
  'reference/memory-map.md': 'dna/domain/memory-map.md',
  'reference/ula-timing.md': 'dna/domain/ula-timing.md',
  'reference/z80-opcodes.md': 'dna/domain/z80-opcodes.md',
  'reference/file-formats.md': 'dna/domain/file-formats.md',
  'reference/tape-loading.md': 'dna/domain/tape-loading.md',
  'reference/peripherals.md': 'dna/domain/peripherals.md',
  'reference/host-io-port-fe.md': 'dna/domain/host-io-port-fe.md',
  'reference/machine-execution.md': 'dna/domain/machine-execution.md',
  'reference/screen-render.md': 'dna/product/screen-render.md',
  'reference/raster-border.md': 'dna/product/raster-border.md',
  'reference/keyboard-input.md': 'dna/product/keyboard-input.md',
  'reference/beeper-output.md': 'dna/product/beeper-output.md',
  'reference/palette.yaml': 'dna/product/palette.yaml',
};

/** Authored skills dir (hub + spokes) and recipes dir. */
export const SKILLS_DIR = 'dna/product/skills';
export const RECIPES_DIR = 'dna/product/recipes';

/** Where the generated module is written. */
export const PACK_OUT = path.join(repoRoot, 'packages/toolkit/src/setup/pack-content.ts');

const HEADER = `// packages/toolkit/src/setup/pack-content.ts — GENERATED, DO NOT EDIT BY HAND.
//
// The embedded knowledge-pack content \`zxs setup\` installs (knowledge-pack.md
// KP-PROD-*). Generated from the DNA by \`pnpm run gen:knowledge-pack\` and pinned
// by \`pnpm run check:knowledge-pack\` (part of check:drift):
//   - reference/ is GENERATED from dna/domain/ + the product render specs
//     (KP-PROD-SOURCE-REF-001) — edit the DNA, never this module;
//   - skills/ are authored in dna/product/skills/ (KP-PROD-SOURCE-SKILLS-001);
//   - recipes/ are authored in dna/product/recipes/ and CI-gated by
//     tests/recipes.test.ts (KP-PROD-SOURCE-RECIPES-001).

/** One installable knowledge-pack file (path is pack-relative, POSIX separators). */
export interface PackFile {
  path: string;
  content: string;
}

`;

function read(rel) {
  return readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** The generated-provenance banner every reference doc carries (KP-PROD-AC-TRACE-001). */
function generatedBanner(sourceRel, commentOpen, commentClose) {
  return (
    `${commentOpen} GENERATED from ${sourceRel} by scripts/gen-knowledge-pack.mjs ` +
    `(KP-PROD-SOURCE-REF-001). Do not edit: the DNA is the source of truth. ${commentClose}\n\n`
  );
}

/** Collect the full pack file list from the DNA sources (deterministic order). */
export function collectPackFiles() {
  const files = [];

  // reference/ — generated (banner + verbatim DNA content, so every [id:] claim
  // in the reference traces to its DNA source by construction).
  for (const [packPath, sourceRel] of Object.entries(REFERENCE_SOURCES)) {
    const banner = packPath.endsWith('.yaml')
      ? generatedBanner(sourceRel, '#', '')
      : generatedBanner(sourceRel, '<!--', '-->');
    files.push({ path: packPath, content: banner + read(sourceRel) });
  }

  // skills/ — authored spokes + hub, installed verbatim. Each non-hub skill must
  // cite the reference it teaches (KP-PROD-RULE-TRACE-001): a skill with no
  // ../reference/ (or hub-relative reference/) link is a provenance FAILURE.
  const skillNames = readdirSync(path.join(repoRoot, SKILLS_DIR))
    .filter((n) => n.endsWith('.md'))
    .sort();
  for (const name of skillNames) {
    const content = read(`${SKILLS_DIR}/${name}`);
    if (name !== 'INDEX.md' && !content.includes('../reference/')) {
      throw new Error(
        `${SKILLS_DIR}/${name} cites no reference doc (KP-PROD-RULE-TRACE-001: ` +
          'every skill must cite the reference it teaches — link ../reference/<doc>.md)',
      );
    }
    files.push({ path: `skills/${name}`, content });
  }

  // recipes/ — routine + demo + proof triples, installed verbatim.
  const recipeNames = readdirSync(path.join(repoRoot, RECIPES_DIR), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const recipe of recipeNames) {
    for (const file of ['README.md', 'demo.asm', 'test.json']) {
      files.push({ path: `recipes/${recipe}/${file}`, content: read(`${RECIPES_DIR}/${recipe}/${file}`) });
    }
  }

  return files;
}

/** Render the module text (JSON-escaped strings: safe for backticks/code fences). */
export function renderPackModule() {
  const files = collectPackFiles();
  let body = 'export const PACK_FILES: readonly PackFile[] = [\n';
  for (const file of files) {
    body += `  { path: ${JSON.stringify(file.path)}, content: ${JSON.stringify(file.content)} },\n`;
  }
  body += '];\n';
  return HEADER + body;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  writeFileSync(PACK_OUT, renderPackModule(), 'utf8');
  const count = collectPackFiles().length;
  console.log(`regenerated ${path.relative(repoRoot, PACK_OUT)} from the DNA (${count} pack files)`);
}
