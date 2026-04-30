import { describe, expect, it } from 'vitest';
import type { EntryPoint, SymbolInfo } from '../types';
import { isSymbolEnrichmentCandidate, mergeSymbolEnrichment } from './symbolEnrichment';

function makeSymbol(overrides: Partial<SymbolInfo> = {}): SymbolInfo {
    return {
        name: 'helper',
        kind: 'function',
        filePath: 'src/index.ts',
        lineStart: 1,
        lineEnd: 1,
        isExported: false,
        isEntryPoint: false,
        ...overrides,
    };
}

describe('symbolEnrichment helpers', () => {
    it('mergeSymbolEnrichment adds overlay-only metadata without replacing deterministic symbol identity', () => {
        const baseSymbols = [makeSymbol()];
        const enrichedSymbols = [makeSymbol({ signature: 'helper(): number' })];

        const merged = mergeSymbolEnrichment(baseSymbols, enrichedSymbols, []);

        expect(merged).toHaveLength(1);
        expect(merged[0]).toEqual(
            expect.objectContaining({
                name: 'helper',
                signature: 'helper(): number',
                isExported: false,
            })
        );
    });

    it('mergeSymbolEnrichment promotes entry-point files after merge', () => {
        const baseSymbols = [makeSymbol({ filePath: 'src/main.ts' })];
        const entryPoints: EntryPoint[] = [{
            file: 'src/main.ts',
            type: 'main',
            confidence: 'high',
            reason: 'cli entry point',
        }];

        const merged = mergeSymbolEnrichment(baseSymbols, [], entryPoints);

        expect(merged[0]?.isEntryPoint).toBe(true);
    });

    it('isSymbolEnrichmentCandidate only includes supported source extensions', () => {
        expect(isSymbolEnrichmentCandidate('src/index.ts')).toBe(true);
        expect(isSymbolEnrichmentCandidate('src/app.py')).toBe(true);
        expect(isSymbolEnrichmentCandidate('README.md')).toBe(false);
        expect(isSymbolEnrichmentCandidate('package.json')).toBe(false);
    });
});