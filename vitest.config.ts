import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/choice/mediaProjection.ts', 'src/app/**', 'src/media/scrubMath.ts'],
    },
  },
});
