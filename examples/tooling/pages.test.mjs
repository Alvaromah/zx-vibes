// Headless tests of the demo pages' own inline scripts — the very code the HTML ships,
// extracted from the page and run in Node: medium.html's BASIC auto-typer (typed into
// the real ROM through the bundle's machine) and full.html's tape deck controls (run
// in a vm against stub DOM elements and a stub ZXSpectrum).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { create } from './browser-entry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const page = (name) => readFileSync(join(HERE, '..', name), 'utf8');

/** The page's inline (non-src) script. */
function inlineScript(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1, 'one inline script');
  return scripts[0];
}

// --- medium.html: the BASIC auto-typer ----------------------------------------

/** medium.html's programToSteps, extracted between its typer markers. */
function loadTyper() {
  const html = page('medium.html');
  const begin = html.indexOf('// ---- BASIC typer (begin)');
  const end = html.indexOf('// ---- BASIC typer (end) ----');
  assert.ok(begin > 0 && end > begin, 'typer markers present');
  return new Function(`${html.slice(begin, end)}\nreturn programToSteps;`)();
}

/** Type `steps` into a booted machine the way the page does (press, release). */
function typeIntoRom(steps) {
  const zx = create();
  const run = (n) => { for (let i = 0; i < n; i += 1) zx.machine.runFrame(); };
  run(120);
  for (const keys of [['CAPS'], ...steps]) { // the page's priming CAPS tap first
    for (const k of keys) zx.pressed.add(k);
    run(5);   // ~90 ms held
    zx.pressed.clear();
    run(8);   // ~150 ms released
  }
  return zx;
}

/** The body of the first BASIC line in the program area (after number + length). */
function firstLineBody(zx) {
  const mem = zx.machine.memory;
  const prog = mem[0x5c53] | (mem[0x5c54] << 8); // PROG
  const length = mem[prog + 2] | (mem[prog + 3] << 8);
  return [...mem.subarray(prog + 4, prog + 4 + length)];
}

const codes = (text) => [...text].map((c) => c.charCodeAt(0));

test('medium.html typer: quoted text is typed letter by letter, not tokenized', () => {
  const programToSteps = loadTyper();
  assert.deepEqual(programToSteps('10 PRINT "go to bed"'), [
    ['1'], ['0'], ['P'],
    ['SYM', 'P'], ['G'], ['O'], ['SPACE'], ['T'], ['O'], ['SPACE'], ['B'], ['E'], ['D'], ['SYM', 'P'],
    ['ENTER'],
  ]);
  // A ':' inside a string does not start a statement; one outside it does.
  assert.deepEqual(programToSteps('10 PRINT "a:print"').slice(3, 11), [
    ['SYM', 'P'], ['A'], ['SYM', 'Z'], ['P'], ['R'], ['I'], ['N'], ['T'],
  ]);
});

test('medium.html typer: "go to bed" reaches the real ROM as text, GO TO after it as a keyword', () => {
  const programToSteps = loadTyper();
  const zx = typeIntoRom(programToSteps('10 PRINT "go to bed":GO TO 10'));
  const body = firstLineBody(zx);
  // PRINT "go to bed" : GO TO 10 (then the number's hidden 5-byte form and ENTER).
  assert.deepEqual(body.slice(0, 16), [0xf5, 0x22, ...codes('go to bed'), 0x22, 0x3a, 0xec, 0x31, 0x30]);
  assert.equal(body.at(-1), 0x0d);
});

// --- full.html: the tape deck controls ------------------------------------------

/** Run full.html's script against stub elements and a recording ZXSpectrum stub. */
function openFullPage({ insertThrows = false } = {}) {
  const calls = [];
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id, textContent: '', disabled: false, value: '', files: null, dataset: {}, style: {},
        onclick: null, onchange: null,
        classList: { toggle() {}, add() {}, remove() {} },
        addEventListener() {}, click() {}, querySelectorAll: () => [],
      });
    }
    return elements.get(id);
  };
  const zx = {
    pressed: new Set(),
    attach() { return this; },
    start() { calls.push('start'); return this; },
    stop() { return this; },
    reset() { calls.push('reset'); return this; },
    setSound() { return this; },
    insertTape(bytes, { name }) {
      if (insertThrows) throw new Error('not a tape');
      calls.push(`insertTape:${name}`);
      return this;
    },
    playTape() { calls.push('playTape'); return this; },
    ejectTape() { calls.push('ejectTape'); return this; },
    async fastLoadTape(bytes, { name }) { calls.push(`fastLoadTape:${name}`); return this; },
    loadSnapshot() { return this; },
    isTapePlaying: () => false,
    tapeProgress: () => 0,
    setJoystick() { return this; },
  };
  const context = vm.createContext({
    document: { getElementById: element },
    ZXSpectrum: { create: () => zx },
    addEventListener() {},
    requestAnimationFrame() {},
    setTimeout: (fn) => setImmediate(fn), // the page's sleeps elapse at once
    atob,
    Uint8Array,
  });
  vm.runInContext(inlineScript(page('full.html')), context);
  const status = () => element('tapeStatus').textContent;
  const settle = async (done) => {
    for (let i = 0; i < 200 && !done(); i += 1) await new Promise((r) => setImmediate(r));
  };
  return { calls, element, status, settle };
}

test('full.html: Reset keeps the inserted tape and says so', () => {
  const p = openFullPage();
  p.element('reset').onclick();
  assert.ok(p.calls.includes('reset'));
  assert.equal(p.status(), 'Tape ready: “zx vibes”.');
});

test('full.html: Eject empties the deck — Load no longer re-inserts the ejected tape', async () => {
  const p = openFullPage();
  p.element('eject').onclick();
  assert.ok(p.calls.includes('ejectTape'));
  assert.match(p.status(), /^Tape ejected/);
  assert.equal(p.element('loadSample').disabled, true);
  assert.equal(p.element('fast').disabled, true);
  p.element('loadSample').onclick();
  p.element('fast').onclick();
  await p.settle(() => false);
  assert.ok(!p.calls.some((c) => c.startsWith('insertTape') || c.startsWith('fastLoadTape')), p.calls.join());
  assert.match(p.status(), /^No tape inserted/);
  p.element('reset').onclick();
  assert.equal(p.status(), 'No tape inserted.');
});

test('full.html: Load inserts the tape before rebooting, then types LOAD "" and plays', async () => {
  const p = openFullPage();
  p.element('loadSample').onclick();
  await p.settle(() => p.calls.includes('playTape'));
  const order = p.calls.filter((c) => c === 'reset' || c === 'playTape' || c.startsWith('insertTape'));
  assert.deepEqual(order, ['insertTape:zx vibes', 'reset', 'playTape']);
  assert.equal(p.status(), 'Loading "zx vibes"…');
});

test('full.html: a file that is not a tape is reported without rebooting the machine', async () => {
  const p = openFullPage({ insertThrows: true });
  const input = p.element('file');
  input.files = [{ name: 'broken.tzx', arrayBuffer: async () => new ArrayBuffer(3) }];
  await input.onchange();
  assert.equal(p.status(), 'Could not load "broken": not a tape');
  assert.ok(!p.calls.includes('reset'), 'no reboot for a bad file');
  assert.equal(p.element('loadSample').disabled, false, 'the sample is still in the deck');
});
