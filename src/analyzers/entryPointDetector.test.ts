import { describe, it, expect } from 'vitest';
import { detectEntryPoints } from './entryPointDetector';

describe('detectEntryPoints — heuristic exclusions', () => {
    it.each<readonly [string, string]>([
        ['src/extension.test.ts', 'import { describe } from "vitest"; describe("x", () => {});'],
        ['src/index.test.ts', '// commander. cli test'],
        ['src/app.spec.ts', 'import { describe } from "vitest"; describe("x", () => {});'],
        ['docs/ARCHITECTURE.md', 'FastAPI(app) and server.listen(3000) appear in prose only'],
        ['presentation/slides.md', 'Example snippet: app.listen(4000) inside a talk slide'],
        ['scripts/serve-presentation.js', 'const app = express(); app.listen(3030);'],
        ['tsconfig.json', '{"compilerOptions": {}}'],
        ['playwright.config.ts', 'import { defineConfig } from "@playwright/test"; export default defineConfig({});'],
        ['esbuild.js', 'const esbuild = require("esbuild"); esbuild.build({});'],
        ['vite.config.ts', 'import { defineConfig } from "vite"; export default defineConfig({});'],
    ])('does not return %s as an entry point', async (filePath, content) => {
        const files = new Map([[filePath, content]]);
        const result = await detectEntryPoints(files);
        expect(result.map(e => e.file)).not.toContain(filePath);
    });
});

// ─── Task 5: Real entry files still detected ─────────────────────────────────

describe('detectEntryPoints — real entries still detected', () => {
    it('keeps the current high-confidence type ordering for mixed entry surfaces', async () => {
        const files = new Map([
            ['package.json', JSON.stringify({ name: 'app', main: 'src/main.ts', bin: { app: 'bin/reponav.ts' } })],
            ['src/main.ts', '// main entry'],
            ['bin/reponav.ts', '#!/usr/bin/env node\n// cli entry'],
            ['app/page.tsx', 'export default function Page() { return null; }'],
            ['next.config.ts', 'export default {};'],
        ]);

        const result = await detectEntryPoints(files);

        expect(result.map((entry) => entry.file)).toEqual([
            'app/page.tsx',
            'bin/reponav.ts',
            'next.config.ts',
            'src/main.ts',
        ]);
    });

    it('detects bin/reponav.ts via package.json bin field', async () => {
        const files = new Map([
            ['package.json', JSON.stringify({
                name: 'reponav',
                bin: { reponav: 'bin/reponav.ts' },
            })],
            ['bin/reponav.ts', '#!/usr/bin/env node\n// cli entry'],
            ['tsconfig.json', '{"compilerOptions":{}}'],
            ['src/index.test.ts', 'describe("x", () => {})'],
        ]);
        const result = await detectEntryPoints(files);
        expect(result.map(e => e.file)).toContain('bin/reponav.ts');
        expect(result.find((entry) => entry.file === 'bin/reponav.ts')?.entrySurface).toBe('tooling');
    });

    it('manifest-based detection (package.json) is unaffected by the heuristic filter', async () => {
        // package.json itself should be parsed, not excluded
        const files = new Map([
            ['package.json', JSON.stringify({ name: 'app', main: 'src/main.ts' })],
            ['src/main.ts', '// main entry'],
        ]);
        const result = await detectEntryPoints(files);
        expect(result.map(e => e.file)).toContain('src/main.ts');
        expect(result.find((entry) => entry.file === 'src/main.ts')?.entrySurface).toBe('runtime');
    });

    it('does not treat TypeScript analyzer internals as Python app entries because of doc comments', async () => {
        const files = new Map([
            ['src/analyzers/TreeSitterProvider.ts', [
                '/**',
                ' * - import_from_statement: `from fastapi import FastAPI`',
                ' */',
                'export class TreeSitterProvider {}',
            ].join('\n')],
        ]);

        const result = await detectEntryPoints(files);
        expect(result.map((entry) => entry.file)).not.toContain('src/analyzers/TreeSitterProvider.ts');
    });

    it('does not treat local arg.property access as CLI framework usage', async () => {
        const files = new Map([
            ['src/analyzers/TreeSitterProvider.ts', [
                'const arg = argsNode.namedChildren[0];',
                'if (arg && arg.type === "string") {',
                '  return arg.text;',
                '}',
            ].join('\n')],
        ]);

        const result = await detectEntryPoints(files);
        expect(result.map((entry) => entry.file)).not.toContain('src/analyzers/TreeSitterProvider.ts');
    });

    it('still detects Python app initialization from real Python source files', async () => {
        const files = new Map([
            ['app.py', 'from fastapi import FastAPI\napp = FastAPI()\n'],
        ]);

        const result = await detectEntryPoints(files);
        expect(result.map((entry) => entry.file)).toContain('app.py');
    });
});
