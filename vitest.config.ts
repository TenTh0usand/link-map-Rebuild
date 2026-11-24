import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(rootDir, 'src'),
        },
    },
    server: {
        watch: {
            ignored: ['**/.output/**', '**/.wxt/**', '**/node_modules/**'],
        },
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        teardownTimeout: 2000,
    },
});
