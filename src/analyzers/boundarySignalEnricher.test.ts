import { describe, it, expect } from 'vitest';
import type { FileClassification } from '../types';
import type { ImportEdge } from '../types';
import { boundaryRoleLookup } from './boundaryRoleLookup';
import { enrichWithBoundarySignals } from './boundarySignalEnricher';

/** Builds a minimal ImportEdge for test convenience. */
function edge(source: string, target: string): ImportEdge {
    return { source, target, specifiers: [], isDynamic: false, rawStatement: `import '${target}'` };
}

/** Builds a minimal FileClassification for test convenience. */
function classification(path: string, category: FileClassification['category'], confidence: FileClassification['confidence'] = 'low'): FileClassification {
    return { path, category, confidence, reason: 'test' };
}

describe('enrichWithBoundarySignals — upgrades unknown files', () => {
    it.each<readonly [string, string, string, FileClassification['category']]>([
        ['/app/crud.py', 'sqlalchemy', 'sqlalchemy', 'service'],
        ['/app/schemas.py', 'pydantic', 'pydantic', 'model'],
        ['/app/dependencies.py', 'fastapi', 'fastapi', 'service'],
        ['/app/db.ts', 'pg', 'node_modules/pg', 'service'],
        ['/app/queue.ts', 'amqplib', 'node_modules/amqplib', 'service'],
        ['/app/auth.ts', 'jsonwebtoken', 'node_modules/jsonwebtoken', 'middleware'],
    ])('upgrades %s when it imports %s', (filePath, packageName, target, expectedCategory) => {
        const classifications = [classification(filePath, 'unknown')];
        const edges = [edge(filePath, target)];
        const result = enrichWithBoundarySignals(classifications, edges, boundaryRoleLookup);
        expect(result[0].category).toBe(expectedCategory);
        expect(packageName.length).toBeGreaterThan(0);
    });

    it('sets confidence to low on upgraded entries', () => {
        const classifications = [classification('/app/db.ts', 'unknown')];
        const edges = [edge('/app/db.ts', 'sqlalchemy')];
        const result = enrichWithBoundarySignals(classifications, edges, boundaryRoleLookup);
        expect(result[0].confidence).toBe('low');
    });
});

describe('enrichWithBoundarySignals — does not override Pass 1/2 results', () => {
    it('does not touch a file already classified as model by Pass 1', () => {
        const classifications = [classification('/app/models.py', 'model', 'high')];
        const edges = [edge('/app/models.py', 'sqlalchemy')];
        const result = enrichWithBoundarySignals(classifications, edges, boundaryRoleLookup);
        expect(result[0].category).toBe('model');
        expect(result[0].confidence).toBe('high');
    });

    it('does not upgrade a medium-confidence Pass 1 classification', () => {
        const classifications = [classification('/app/routes.py', 'route', 'medium')];
        const edges = [edge('/app/routes.py', 'fastapi')];
        const result = enrichWithBoundarySignals(classifications, edges, boundaryRoleLookup);
        expect(result[0].category).toBe('route');
    });
});

describe('enrichWithBoundarySignals — no matching imports', () => {
    it('leaves unknown file without matching imports as unknown', () => {
        const classifications = [classification('/app/helpers.py', 'unknown')];
        const edges = [edge('/app/helpers.py', 'os')];
        const result = enrichWithBoundarySignals(classifications, edges, boundaryRoleLookup);
        expect(result[0].category).toBe('unknown');
    });

    it('leaves unknown file with no imports at all as unknown', () => {
        const classifications = [classification('/app/constants.py', 'unknown')];
        const result = enrichWithBoundarySignals(classifications, [], boundaryRoleLookup);
        expect(result[0].category).toBe('unknown');
    });
});

describe('enrichWithBoundarySignals — tie-breaking', () => {
    it('uses dominant role when one role has more matches', () => {
        const classifications = [classification('/app/mixed.py', 'unknown')];
        const edges = [
            edge('/app/mixed.py', 'sqlalchemy'),
            edge('/app/mixed.py', 'node_modules/mongoose'),
            edge('/app/mixed.py', 'pydantic'),
        ];
        // 2 persistence vs 1 validation — persistence wins → service
        const result = enrichWithBoundarySignals(classifications, edges, boundaryRoleLookup);
        expect(result[0].category).toBe('service');
    });
});
