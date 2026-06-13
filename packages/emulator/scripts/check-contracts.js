const expectedExports = [
  'Flags',
  'PC_KEY_MAP',
  'Registers',
  'SPECTRUM_KEYS',
  'SpectrumDisplay',
  'SpectrumMemory',
  'SpectrumSound',
  'SpectrumULA',
  'Tape',
  'Z80',
  'Z80SnapshotLoader',
  'ZXSpectrum',
];

const moduleExports = await import('../src/index.js');
const missing = expectedExports.filter((name) => moduleExports[name] === undefined);

if (missing.length) {
  console.error(`Missing emulator exports: ${missing.join(', ')}`);
  process.exitCode = 1;
}
