import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['apps/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'contract', include: ['tests/contract/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'adapter', include: ['tests/adapters/**/*.test.ts'], environment: 'node', testTimeout: 90000, hookTimeout: 90000 } },
      { test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 15000, hookTimeout: 15000 } }
    ]
  }
});
