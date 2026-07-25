// Recipe corpus CI gate — knowledge-pack.md KP-PROD-SOURCE-RECIPES-001: "a recipe
// whose test.json fails is a red build, so the few-shot the skills cite is always
// green". Materializes every embedded recipe (pack-content.ts, generated from
// dna/product/recipes/) into a temp dir and runs its test.json through the REAL
// declarative DSL runner — the same engine `zxs test` uses. Also pins the
// growth-order mandate (KP-PROD-AC-GROW-001: scrolling + collision present FIRST)
// and the pack's structural invariants (a README/demo/proof triple per recipe,
// every skill citing reference/ — KP-PROD-RULE-TRACE-001).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PACK_FILES } from '../src/setup/pack-content.js';
import { runTestSuite } from '../src/test/runner.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-recipes-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The embedded recipe names (from the recipes/<name>/... pack paths). */
function recipeNames(): string[] {
  const names = new Set<string>();
  for (const file of PACK_FILES) {
    const match = /^recipes\/([^/]+)\//.exec(file.path);
    if (match) names.add(match[1]!);
  }
  return [...names].sort();
}

/** Write every pack file of one recipe into the temp dir; returns the recipe dir. */
function materialize(recipe: string): string {
  for (const file of PACK_FILES) {
    if (!file.path.startsWith(`recipes/${recipe}/`)) continue;
    const abs = join(dir, ...file.path.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content, 'utf8');
  }
  return join(dir, 'recipes', recipe);
}

describe('knowledge-pack recipes (KP-PROD-SOURCE-RECIPES-001 / KP-PROD-AC-GROW-001)', () => {
  it('the growth-order mandate holds: scrolling + collision recipes exist', () => {
    const names = recipeNames();
    expect(names).toContain('scroll-row-left');
    expect(names).toContain('tile-collision');
  });

  it('every recipe is a README + demo + proof triple', () => {
    for (const recipe of recipeNames()) {
      const paths = PACK_FILES.filter((f) => f.path.startsWith(`recipes/${recipe}/`)).map((f) => f.path);
      expect(paths).toContain(`recipes/${recipe}/README.md`);
      expect(paths).toContain(`recipes/${recipe}/demo.asm`);
      expect(paths).toContain(`recipes/${recipe}/test.json`);
    }
  });

  it('every recipe test.json is GREEN under the real DSL runner', () => {
    for (const recipe of recipeNames()) {
      const recipeDir = materialize(recipe);
      const suite = runTestSuite(recipeDir, recipeDir);
      expect(suite.total, `${recipe}: expected exactly one spec`).toBe(1);
      expect(
        suite.ok,
        `${recipe} failed: ${JSON.stringify(suite.results.flatMap((r) => r.failures))}`,
      ).toBe(true);
    }
  });

  it('every skill cites the reference it teaches (KP-PROD-RULE-TRACE-001)', () => {
    const skills = PACK_FILES.filter(
      (f) => f.path.startsWith('skills/') && f.path !== 'skills/INDEX.md',
    );
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.content, `${skill.path} cites no ../reference/ doc`).toContain('../reference/');
    }
  });

  it('every reference doc carries its generated-provenance banner (KP-PROD-AC-TRACE-001)', () => {
    const refs = PACK_FILES.filter((f) => f.path.startsWith('reference/'));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.content, `${ref.path} lacks the GENERATED banner`).toMatch(
        /GENERATED from dna\/(domain|product)\//,
      );
    }
  });
});
