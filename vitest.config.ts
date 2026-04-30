import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        include: ['src/**/*.test.ts', 'bin/**/*.test.ts'],
        testTimeout: 10000,
        coverage: {
            provider: 'v8',
            reportsDirectory: './coverage',
            reporter: ['text', 'json', 'json-summary', 'lcov'],
            include: ['src/**/*.ts', 'bin/**/*.ts'],
            exclude: [
                '**/*.test.ts',
                '**/*.integration.test.ts',
                'src/governance/**',
                'src/services/{ciProfile,parallel,planNextStep}*',
                'webview/**',
            ],
        },
    },
});
