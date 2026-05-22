import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/vitest/**/*.test.ts', 'tests/vitest/**/*.test.tsx'],
    globals: true,
    setupFiles: ['tests/vitest/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '.webpack/',
        'out/',
        'src/**/*.d.ts',
      ],
      lines: 50,
      functions: 50,
      branches: 50,
      statements: 50,
    },
  },
});
