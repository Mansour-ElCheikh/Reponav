import { describe, it, expect } from 'vitest';
import type { ImportEdge } from '../types';
import { classifyBoundaryRoles } from './boundaryRoleClassifier';
import { boundaryRoleLookup } from './boundaryRoleLookup';

/** Builds a minimal ImportEdge for test convenience. */
function edge(source: string, target: string): ImportEdge {
    return { source, target, specifiers: [], isDynamic: false, rawStatement: `import '${target}'` };
}

describe('classifyBoundaryRoles — happy path', () => {
    it('returns http role for file importing express', () => {
        const edges: ImportEdge[] = [edge('/app/server.ts', 'node_modules/express')];
        const result = classifyBoundaryRoles(edges, boundaryRoleLookup);
        expect(result).toEqual([
            { filePath: '/app/server.ts', role: 'http', evidence: 'imports express' },
        ]);
    });

    it('returns persistence role for file importing pg', () => {
        const edges: ImportEdge[] = [edge('/app/db.ts', 'node_modules/pg')];
        const result = classifyBoundaryRoles(edges, boundaryRoleLookup);
        expect(result).toEqual([
            { filePath: '/app/db.ts', role: 'persistence', evidence: 'imports pg' },
        ]);
    });
});

describe('classifyBoundaryRoles — multi-role', () => {
    it('returns the role with the most matching imports when one dominates', () => {
        const edges: ImportEdge[] = [
            edge('/app/both.ts', 'node_modules/express'),
            edge('/app/both.ts', 'node_modules/fastify'),
            edge('/app/both.ts', 'node_modules/pg'),
        ];
        const result = classifyBoundaryRoles(edges, boundaryRoleLookup);
        // 2 http matches vs 1 persistence — http wins
        const roles = result.filter(r => r.filePath === '/app/both.ts').map(r => r.role);
        expect(roles).toContain('http');
    });

    it('returns both roles when tied', () => {
        const edges: ImportEdge[] = [
            edge('/app/both.ts', 'node_modules/express'),
            edge('/app/both.ts', 'node_modules/pg'),
        ];
        const result = classifyBoundaryRoles(edges, boundaryRoleLookup);
        const roles = result.filter(r => r.filePath === '/app/both.ts').map(r => r.role);
        expect(roles).toContain('http');
        expect(roles).toContain('persistence');
    });
});

describe('classifyBoundaryRoles — unknown packages', () => {
    it('returns empty array for file importing only unknown packages', () => {
        const edges: ImportEdge[] = [edge('/app/util.ts', 'node_modules/lodash')];
        const result = classifyBoundaryRoles(edges, boundaryRoleLookup);
        expect(result).toHaveLength(0);
    });

    it('does not crash on empty edges array', () => {
        const result = classifyBoundaryRoles([], boundaryRoleLookup);
        expect(result).toHaveLength(0);
    });
});

describe('classifyBoundaryRoles — performance', () => {
    it('completes in ≤100ms for 1000-file equivalent fixture', () => {
        // Simulate 1K files × ~3 edges each = 3K edges
        const edges: ImportEdge[] = [];
        const packages = ['express', 'pg', 'lodash', 'zod', 'winston', 'stripe', 'jsonwebtoken'];
        for (let i = 0; i < 1000; i++) {
            for (const pkg of packages.slice(0, 3)) {
                edges.push(edge(`/app/file${i}.ts`, `node_modules/${pkg}`));
            }
        }
        const start = performance.now();
        classifyBoundaryRoles(edges, boundaryRoleLookup);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(100);
    });
});
