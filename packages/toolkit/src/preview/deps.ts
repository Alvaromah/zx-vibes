// The source files `preview --watch` polls for the default (project) mode —
// toolkit-runtime.md RT-PROD-PREVIEW-005 ("polls source for changes").
//
// The set is the BUILD'S DEPENDENCIES, not a directory listing: the config, the
// entry, every file the entry pulls in through INCLUDE (recursively) and every
// INCBIN/BINARY/INSERT data file — wherever they live, so the scaffold's
// `INCLUDE "../lib/screen.asm"` is watched — plus every source file the last
// successful build's SLD attributes code or symbols to. A target that does not
// exist yet is watched too: creating it is a change. The set is recomputed after
// every rebuild, so a newly added INCLUDE is picked up without a restart. Build
// outputs (anything under `outDir`) are never watched — a rebuild rewrites them.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { resolveConfig } from '../config/config.js';

/** The project config file name (config-schema.md). */
const CONFIG_FILE = 'zx.config.json';
/** Bound on scanned source files (a runaway include graph cannot stall the poller). */
const MAX_SCANNED_FILES = 500;

/** The quoted/angled target of an INCLUDE/INCBIN-family directive on one line. */
const DIRECTIVE_RE = /(?:^|[\s:])(INCLUDE|INCBIN|BINARY|INSERT)\s+("[^"]+"|'[^']+'|<[^>]+>)/i;

/** A line with its `;` comment removed (quote-aware, like the assembler). */
function stripComment(text: string): string {
  let quote: string | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ';') return text.slice(0, i);
  }
  return text;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Every file an assembly of `entry` (an absolute path) reads, found by following
 * its INCLUDE/INCBIN/BINARY/INSERT directives. A quoted target resolves against the
 * including file's directory, as the assembler does; an `<angled>` target (an
 * include-path search, which the toolkit build does not configure) is skipped.
 * The result is a superset: conditional assembly is not evaluated.
 */
export function scanAsmDependencies(entry: string): string[] {
  const found = new Set<string>([entry]);
  const queue = [entry];
  let scanned = 0;
  while (queue.length > 0 && scanned < MAX_SCANNED_FILES) {
    const file = queue.shift()!;
    if (!isFile(file)) continue;
    scanned += 1;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split(/\r\n|\r|\n/)) {
      const match = DIRECTIVE_RE.exec(stripComment(raw));
      if (!match) continue;
      const target = match[2]!;
      if (target.startsWith('<')) continue;
      const path = resolve(dirname(file), target.slice(1, -1));
      if (found.has(path)) continue;
      found.add(path);
      if (match[1]!.toUpperCase() === 'INCLUDE') queue.push(path);
    }
  }
  return [...found];
}

/** The absolute source paths named in an SLD file (its first `|`-field). */
export function sldSourceFiles(sld: string): string[] {
  const files = new Set<string>();
  for (const line of sld.split(/\r\n|\r|\n/)) {
    const file = line.split('|', 1)[0] ?? '';
    if (file.length > 0 && isAbsolute(file)) files.add(file);
  }
  return [...files];
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * The project-mode watch set for `cwd` (see the module comment). Never throws: an
 * unreadable config still watches `zx.config.json`, so fixing it triggers a rebuild.
 */
export function projectWatchPaths(cwd: string): string[] {
  const root = resolve(cwd);
  const paths = new Set<string>([resolve(root, CONFIG_FILE)]);
  let entry: string | undefined;
  let outDir: string | undefined;
  try {
    const resolved = resolveConfig({ cwd: root });
    entry = resolved.entry ? resolve(root, resolved.entry) : undefined;
    outDir = resolve(root, resolved.outDir);
  } catch {
    return [...paths];
  }
  if (entry === undefined) return [...paths];
  for (const path of scanAsmDependencies(entry)) paths.add(path);
  // The files the last good build attributed code or symbols to (its SLD).
  const sld = resolve(outDir, `${basename(entry, extname(entry))}.sld`);
  if (existsSync(sld)) {
    try {
      for (const path of sldSourceFiles(readFileSync(sld, 'utf8'))) paths.add(path);
    } catch {
      /* unreadable SLD: the directive scan still covers the sources */
    }
  }
  return [...paths].filter((path) => path === entry || !isInside(path, outDir!));
}
