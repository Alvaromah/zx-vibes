import { babel } from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

const banner = `/**
 * ZXGeneration - ZX Spectrum Emulator
 * @version ${process.env.npm_package_version || '1.0.0'}
 * @license MIT
 */`;

export default [
  // ES Module build
  {
    input: 'src/index.js',
    output: {
      file: 'dist/zxgeneration.esm.js',
      format: 'es',
      banner,
      sourcemap: true,
    },
    plugins: [
      nodeResolve(),
      babel({
        babelHelpers: 'bundled',
        exclude: 'node_modules/**',
      }),
    ],
  },
  // UMD build (for browsers)
  {
    input: 'src/index.js',
    output: {
      file: 'dist/zxgeneration.umd.js',
      format: 'umd',
      name: 'ZXGeneration',
      banner,
      sourcemap: true,
    },
    plugins: [
      nodeResolve(),
      babel({
        babelHelpers: 'bundled',
        exclude: 'node_modules/**',
      }),
    ],
  },
  // Minified UMD build
  {
    input: 'src/index.js',
    output: {
      file: 'dist/zxgeneration.umd.min.js',
      format: 'umd',
      name: 'ZXGeneration',
      banner,
      sourcemap: true,
    },
    plugins: [
      nodeResolve(),
      babel({
        babelHelpers: 'bundled',
        exclude: 'node_modules/**',
      }),
      terser({
        format: {
          comments: false,
          preamble: banner,
        },
      }),
    ],
  },
  // Standalone worklet file
  {
    input: 'src/spectrum/audio-worklet.js',
    output: {
      file: 'dist/audio-worklet.js',
      format: 'es',
    },
    plugins: [terser()],
  },
];