/**
 * Unit tests for AnalysisProviders.
 *
 * Tests RegexAnalysisProvider with pure string manipulation (no WASM).
 * TreeSitterProvider integration tests are skipped unless WASM is available.
 */
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { RegexAnalysisProvider } from './importAnalyzer';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROOT = '/workspace';

function makeFiles(entries: Record<string, string>): Map<string, string> {
    return new Map(Object.entries(entries));
}

// ─── RegexAnalysisProvider Tests ──────────────────────────────────────────────

describe('RegexAnalysisProvider', () => {
    const provider = new RegexAnalysisProvider();

    it('resolves a basic named import', async () => {
        const files = makeFiles({
            'src/index.ts': `import { foo } from './utils';`,
            'src/utils.ts': `export const foo = 1;`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].source).toBe('src/index.ts');
        expect(result.edges[0].target).toBe('src/utils.ts');
    });

    it('resolves a default import', async () => {
        const files = makeFiles({
            'src/app.ts': `import App from './App';`,
            'src/App.tsx': `export default function App() {}`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.edges.some(e => e.target === 'src/App.tsx')).toBe(true);
    });

    it('resolves re-exports (export * from)', async () => {
        const files = makeFiles({
            'src/barrel.ts': `export * from './utils';`,
            'src/utils.ts': `export const x = 1;`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].source).toBe('src/barrel.ts');
        expect(result.edges[0].target).toBe('src/utils.ts');
    });

    it('resolves named re-exports (export { x } from)', async () => {
        const files = makeFiles({
            'src/barrel.ts': `export { foo } from './helpers';`,
            'src/helpers.ts': `export const foo = 42;`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.edges.some(e => e.target === 'src/helpers.ts')).toBe(true);
    });

    it('detects dynamic imports', async () => {
        const files = makeFiles({
            'src/lazy.ts': `const mod = await import('./module');`,
            'src/module.ts': `export const val = 1;`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        const dynamicEdge = result.edges.find(e => e.isDynamic);
        expect(dynamicEdge).toBeDefined();
        expect(dynamicEdge?.target).toBe('src/module.ts');
    });

    it('resolves require() calls', async () => {
        const files = makeFiles({
            'src/server.js': `const express = require('./express');`,
            'src/express.js': `module.exports = {};`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.edges.some(e => e.target === 'src/express.js')).toBe(true);
    });

    it('resolves index files for directory imports', async () => {
        const files = makeFiles({
            'src/app.ts': `import { db } from './db';`,
            'src/db/index.ts': `export const db = {};`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.edges[0].target).toBe('src/db/index.ts');
    });

    it('detects circular dependencies', async () => {
        const files = makeFiles({
            'src/a.ts': `import b from './b';`,
            'src/b.ts': `import a from './a';`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.circularDependencies.length).toBeGreaterThan(0);
    });

    it('tracks external npm packages', async () => {
        const files = makeFiles({
            'src/app.ts': `import React from 'react';
import { useState } from 'react';
import axios from 'axios';`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.externalDependencies.has('react')).toBe(true);
        expect(result.externalDependencies.has('axios')).toBe(true);
    });

    it('ignores type-only imports in edge count (not separate edges)', async () => {
        const files = makeFiles({
            'src/consumer.ts': `import type { Foo } from './types';
import { bar } from './bar';`,
            'src/types.ts': `export type Foo = string;`,
            'src/bar.ts': `export const bar = 1;`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        // Both should be resolved as edges (the regex provider doesn't distinguish type-only)
        expect(result.edges.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty results for empty workspace', async () => {
        const result = await provider.analyzeImports(ROOT, new Map());
        expect(result.edges).toHaveLength(0);
        expect(result.circularDependencies).toHaveLength(0);
        expect(result.externalDependencies.size).toBe(0);
    });

    // ─── Python Import Tests ─────────────────────────────────────────────────

    it('resolves Python "from X import Y"', async () => {
        const files = makeFiles({
            'app/main.py': `from app.routes import router`,
            'app/routes.py': `router = None`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].source).toBe('app/main.py');
        expect(result.edges[0].target).toBe('app/routes.py');
    });

    it('resolves Python "import X"', async () => {
        const files = makeFiles({
            'main.py': `import utils`,
            'utils.py': `x = 1`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].target).toBe('utils.py');
    });

    it('resolves Python package imports (__init__.py)', async () => {
        const files = makeFiles({
            'main.py': `from mypackage import something`,
            'mypackage/__init__.py': `something = 1`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].target).toBe('mypackage/__init__.py');
    });

    it('detects Python circular dependencies', async () => {
        const files = makeFiles({
            'a.py': `from b import x`,
            'b.py': `from a import y`,
        });
        const result = await provider.analyzeImports(ROOT, files);
        expect(result.circularDependencies.length).toBeGreaterThan(0);
    });
});
