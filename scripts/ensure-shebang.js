import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const silent = args.includes('--silent');
const files = args.filter((arg) => arg !== '--silent');
const shebang = '#!/usr/bin/env node\n';

if (files.length === 0) {
  console.error('usage: node scripts/ensure-shebang.js [--silent] <file> [...]');
  process.exitCode = 1;
}

for (const file of files) {
  const current = readFileSync(file, 'utf8');
  if (!current.startsWith(shebang)) {
    writeFileSync(file, shebang + current);
    if (!silent) console.log(`added shebang: ${file}`);
  }
  try {
    chmodSync(file, 0o755);
  } catch {
    // Windows may not apply POSIX mode bits; npm still records bin entries.
  }
}
