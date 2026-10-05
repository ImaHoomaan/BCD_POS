import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 120000,
    // better-sqlite3 is a native module; run test files in separate processes-safe threads.
    pool: 'forks',
  },
});
