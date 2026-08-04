import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            exclude: ['src/index.ts'],
            include: ['src/**/*.ts'],
            provider: 'v8',
            reporter: ['text', 'json-summary'],
            thresholds: {
                branches: 90,
                functions: 95,
                lines: 95,
                statements: 95,
            },
        },
        include: ['test/**/*.test.ts'],
        testTimeout: 10_000,
    },
});
