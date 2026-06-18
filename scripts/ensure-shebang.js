import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const silent = args.includes('--silent');
const files = args.filter((arg) => arg !== '--silent');
const shebang = '#!/usr/bin/env node\n';

if (files.length === 0) {
  console.error('usage: node scripts/ensure-shebang.js [--silent] <file> [...]');
  process.exit(1);
}

for (const file of files) {
  const current = readFileSync(file, 'utf8');
  // Strip a leading BOM (U+FEFF) and match any node shebang regardless of CRLF/LF
  // so we don't prepend a second shebang to a file that already has one.
  const withoutBom = current.charCodeAt(0) === 0xfeff ? current.slice(1) : current;
  if (!/^#!.*\bnode\b/.test(withoutBom)) {
    writeFileSync(file, shebang + withoutBom);
    if (!silent) console.log(`added shebang: ${file}`);
  }
  try {
    chmodSync(file, 0o755);
  } catch {
    // Windows may not apply POSIX mode bits; npm still records bin entries.
  }
}
