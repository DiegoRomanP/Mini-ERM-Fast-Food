import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],

    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/server.ts', 'src/plugins/**', 'src/**/*.d.ts'],
      reporter: ['text', 'html'],
    },
  },
});
