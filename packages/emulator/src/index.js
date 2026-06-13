/**
 * ZXGeneration public entry point.
 *
 * Most users want only ZXSpectrum; the rest of the surface is exported for
 * headless / embedded use (custom front-ends, testing rigs, tooling that
 * composes the machine from parts).
 */
export { ZXSpectrum } from './spectrum/spectrum.js';

// The machine, by parts
export { Z80 } from './core/cpu.js';
export { Registers } from './core/registers.js';
export { Flags } from './core/flags.js';
export { SpectrumMemory } from './spectrum/memory.js';
export { SpectrumULA, SPECTRUM_KEYS, PC_KEY_MAP } from './spectrum/ula.js';
export { SpectrumDisplay } from './spectrum/display.js';
export { SpectrumSound } from './spectrum/sound.js';
export { Z80SnapshotLoader } from './spectrum/snapshot.js';
export { Tape } from './spectrum/tape.js';
