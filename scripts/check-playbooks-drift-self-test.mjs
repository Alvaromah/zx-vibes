#!/usr/bin/env node
// check-playbooks-drift-self-test.mjs — proves check-playbooks-drift.mjs can fail: the real
// playbooks pass, and each kind of drift it guards against is reported.
import assert from 'node:assert/strict';
import {
  checkPlaybooks,
  extractPlaybook,
  PLAYBOOK_FACTS,
  readPlaybooks,
  STARTER_PLAYBOOKS,
} from './check-playbooks-drift.mjs';

const real = readPlaybooks();
let cases = 0;

// 1. The committed playbooks agree.
assert.deepEqual(checkPlaybooks(real), [], 'the committed playbooks should pass');
cases += 1;

// 2. Every fact is actually stated (a pattern that matched nothing would make the check vacuous).
assert.ok(PLAYBOOK_FACTS.length >= 10, 'the fact list should not be empty');
cases += 1;

// 3. A fact dropped from PLAYBOOK is reported, naming the fact.
const withoutEntry = real.playbook.replace(/without the ROM's start-up/, 'after the ROM start-up');
assert.notEqual(withoutEntry, real.playbook, 'self-test fixture: PLAYBOOK wording changed under the self-test');
const dropped = checkPlaybooks({ ...real, playbook: withoutEntry });
assert.equal(dropped.length, 1);
assert.match(dropped[0], /PLAYBOOK .*'entry-power-on-no-rom-start-up'/);
cases += 1;

// 4. A fact dropped from one starter is reported for that starter (and as a starter diff).
const [gamePath, platformerPath] = STARTER_PLAYBOOKS;
const reworded = real.starters[platformerPath].replace(/no key for the\s+first 256 frames/, 'no key at first');
assert.notEqual(reworded, real.starters[platformerPath], 'self-test fixture: starter wording changed');
const starterDrift = checkPlaybooks({ ...real, starters: { ...real.starters, [platformerPath]: reworded } });
assert.ok(starterDrift.some((p) => p.startsWith(`${platformerPath} differs from ${gamePath}`)));
assert.ok(starterDrift.some((p) => p.startsWith(platformerPath) && p.includes("'entry-rom-keyboard'")));
cases += 1;

// 5. Line wrapping, CRLF and markdown emphasis are not drift.
const rewrapped = real.starters[gamePath].replace(/\n/g, '\r\n');
assert.deepEqual(
  checkPlaybooks({ playbook: real.playbook.replace(/ /g, '\n'), starters: { [gamePath]: rewrapped, [platformerPath]: rewrapped } }),
  [],
);
cases += 1;

// 6. The PLAYBOOK extractor undoes template escapes and refuses interpolation.
assert.equal(extractPlaybook('export const PLAYBOOK = `a \\`b\\` c`;\n'), 'a `b` c');
assert.throws(() => extractPlaybook('export const PLAYBOOK = `a ${x}`;'), /interpolates/);
assert.throws(() => extractPlaybook('const OTHER = `x`;'), /no `export const PLAYBOOK/);
cases += 1;

console.log(`check-playbooks-drift self-test: ${cases} cases passed`);
