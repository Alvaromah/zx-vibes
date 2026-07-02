import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Some tests compose full build+run pipelines; the 5s default flakes on
    // slow CI runners. Real emulator hangs are caught by the toolkit's own
    // hang detection, not the test timeout.
    testTimeout: 30_000,
  },
});
