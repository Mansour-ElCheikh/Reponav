import { describe, it, expect } from 'vitest';
import type { BoundaryRole } from '../types';
import { boundaryRoleLookup } from './boundaryRoleLookup';

describe('boundaryRoleLookup', () => {
    it('exports a Map with 150 or more entries', () => {
        expect(boundaryRoleLookup.size).toBeGreaterThanOrEqual(150);
    });

    it.each<readonly [string, BoundaryRole]>([
        ['pg', 'persistence'],
        ['mongoose', 'persistence'],
        ['typeorm', 'persistence'],
        ['express', 'http'],
        ['fastify', 'http'],
        ['axios', 'http'],
        ['amqplib', 'messaging'],
        ['kafkajs', 'messaging'],
        ['jsonwebtoken', 'auth'],
        ['passport', 'auth'],
        ['zod', 'validation'],
        ['joi', 'validation'],
        ['@opentelemetry/api', 'observability'],
        ['winston', 'observability'],
        ['stripe', 'external-integration'],
        ['twilio', 'external-integration'],
        ['vscode', 'external-integration'],
        ['@types/vscode', 'external-integration'],
        ['@modelcontextprotocol/sdk', 'http'],
        ['tree-sitter', 'external-integration'],
        ['web-tree-sitter', 'external-integration'],
    ])('maps %s to %s', (packageName, role) => {
        expect(boundaryRoleLookup.get(packageName)).toBe<BoundaryRole>(role);
    });

    it('values are all valid BoundaryRole strings', () => {
        const validRoles = new Set<BoundaryRole>([
            'persistence', 'http', 'messaging', 'auth', 'validation', 'observability', 'external-integration',
        ]);
        for (const [, role] of boundaryRoleLookup) {
            expect(validRoles.has(role)).toBe(true);
        }
    });
});
