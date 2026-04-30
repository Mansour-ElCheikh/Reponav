import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: false,
        setupFiles: path.resolve(__dirname, 'src', 'test', 'setup.ts'),
        include: [
            'src/**/*.test.ts',
            'src/**/*.test.tsx',
        ],
    },
    build: {
        outDir: path.resolve(__dirname, '..', 'dist', 'webview'),
        rollupOptions: {
            input: path.resolve(__dirname, 'src', 'main.tsx'),
            output: {
                entryFileNames: 'index.js',
                assetFileNames: 'index.[ext]',
                chunkFileNames: '[name].js',
            },
        },
        cssCodeSplit: false,
        sourcemap: false,
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify(mode === 'test' ? 'test' : 'production'),
    },
}));
