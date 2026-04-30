import { describe, it, expect, vi } from 'vitest';
import { FederationAnalyzer } from './federationAnalyzer';
import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisReport, FederatedRepo } from '../types';

vi.mock('fs');

describe('FederationAnalyzer', () => {
    const analyzer = new FederationAnalyzer();

    describe('detectSisterRepos', () => {
        it('should detect NPM and Go sister repositories in parent directory', async () => {
            const mockEntries = [
                { isDirectory: () => true, name: 'sister-npm' },
                { isDirectory: () => true, name: 'sister-go' },
                { isDirectory: () => false, name: 'file.txt' },
                { isDirectory: () => true, name: 'current-repo' },
            ];

            vi.mocked(fs.readdirSync).mockReturnValue(mockEntries as any);
            vi.mocked(fs.existsSync).mockImplementation((p: string) => {
                if (p.includes('sister-npm/package.json')) return true;
                if (p.includes('sister-go/go.mod')) return true;
                return false;
            });

            const sisters = await analyzer.detectSisterRepos('/root/current-repo');

            expect(sisters).toHaveLength(2);
            expect(sisters.find(s => s.name === 'sister-npm')?.type).toBe('npm');
            expect(sisters.find(s => s.name === 'sister-go')?.type).toBe('go');
        });
    });

    describe('buildCrossRepoEdges', () => {
        it('should create an edge when an import targets a sister repo path', async () => {
            const sisters: FederatedRepo[] = [
                { name: 'auth-service', path: '/root/auth-service', type: 'npm' }
            ];

            const mockReport: AnalysisReport = {
                workspaceRoot: '/root/main-app',
                dependencyGraph: {
                    edges: [
                        { 
                            source: 'src/app.ts', 
                            target: '../../auth-service/src/index.ts', // Points out of current repo
                            specifiers: [], isDynamic: false, rawStatement: '' 
                        }
                    ]
                }
            } as any;

            const edges = await analyzer.buildCrossRepoEdges(mockReport, sisters);

            expect(edges).toHaveLength(1);
            expect(edges[0].targetRepo).toBe('auth-service');
            expect(edges[0].targetFile).toBe('src/index.ts');
        });

        it('should ignore imports that stay within the repository', async () => {
            const sisters: FederatedRepo[] = [
                { name: 'other', path: '/root/other', type: 'npm' }
            ];

            const mockReport: AnalysisReport = {
                workspaceRoot: '/root/main-app',
                dependencyGraph: {
                    edges: [
                        { source: 'src/app.ts', target: './utils.ts', specifiers: [], isDynamic: false, rawStatement: '' }
                    ]
                }
            } as any;

            const edges = await analyzer.buildCrossRepoEdges(mockReport, sisters);
            expect(edges).toHaveLength(0);
        });

        it('detects cross-repo edge via sister repo package.json name', async () => {
            const sisters: FederatedRepo[] = [
                { name: 'auth-service', path: '/root/auth-service', type: 'npm' }
            ];

            vi.mocked(fs.existsSync).mockImplementation((p: string) => p.includes('package.json'));
            vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
                if (p.includes('auth-service/package.json')) return JSON.stringify({ name: '@myorg/auth' });
                if (p.includes('main-app/tsconfig.json')) return JSON.stringify({});
                return '{}';
            });

            const mockReport: AnalysisReport = {
                workspaceRoot: '/root/main-app',
                dependencyGraph: {
                    edges: [
                        { source: 'src/app.ts', target: '@myorg/auth', specifiers: [], isDynamic: false, rawStatement: '' },
                        { source: 'src/app.ts', target: '@myorg/auth/login', specifiers: [], isDynamic: false, rawStatement: '' },
                    ]
                }
            } as any;

            const edges = await analyzer.buildCrossRepoEdges(mockReport, sisters);

            expect(edges).toHaveLength(2);
            expect(edges[0].targetRepo).toBe('auth-service');
            expect(edges[0].targetFile).toBe('');
            expect(edges[1].targetFile).toBe('login');
        });

        it('detects cross-repo edge via tsconfig path alias', async () => {
            const sisters: FederatedRepo[] = [
                { name: 'shared-lib', path: '/root/shared-lib', type: 'npm' }
            ];

            vi.mocked(fs.existsSync).mockImplementation((p: string) => p.includes('tsconfig.json'));
            vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
                if (p.includes('tsconfig.json')) {
                    return JSON.stringify({
                        compilerOptions: { paths: { '@shared/*': ['../shared-lib/src/*'] } }
                    });
                }
                return '{}';
            });

            const mockReport: AnalysisReport = {
                workspaceRoot: '/root/main-app',
                dependencyGraph: {
                    edges: [
                        { source: 'src/app.ts', target: '@shared/utils', specifiers: [], isDynamic: false, rawStatement: '' },
                    ]
                }
            } as any;

            const edges = await analyzer.buildCrossRepoEdges(mockReport, sisters);

            expect(edges).toHaveLength(1);
            expect(edges[0].targetRepo).toBe('shared-lib');
        });
    });
});
