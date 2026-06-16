import { readFileSync } from 'node:fs';

interface PackageMetadata {
  name: string;
  version: string;
}

const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as PackageMetadata;

export const name = packageMetadata.name;
export const version = packageMetadata.version;
