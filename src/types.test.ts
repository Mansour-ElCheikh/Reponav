/**
 * Compilation tests for types exported from src/types.ts.
 * Tests that FlowStep, FlowAnomaly, FlowSequence, and AnalysisReport.flows
 * satisfy the Component 002 contract from epic-007.
 */
import { describe, it, expect } from 'vitest';
import type { FlowStep, FlowAnomaly, FlowSequence, AnalysisReport, AnalysisReportSummary } from './types';

// ─── Task 13: FlowStep compiles with filePath, fileCategory, layer ────────

describe('FlowStep type (T13)', () => {
    it('has filePath, fileCategory, and layer fields', () => {
        const step: FlowStep = {
            filePath: 'src/controllers/user.ts',
            fileCategory: 'controller',
            layer: 2,
        };
        expect(step.filePath).toBe('src/controllers/user.ts');
        expect(step.fileCategory).toBe('controller');
        expect(step.layer).toBe(2);
    });

    it('accepts optional symbolName field', () => {
        const step: FlowStep = {
            filePath: 'src/services/user.ts',
            fileCategory: 'service',
            layer: 3,
            symbolName: 'UserService',
        };
        expect(step.symbolName).toBe('UserService');
    });
});

// ─── Task 14: FlowAnomaly compiles with fromFile, toFile, direction ───────

describe('FlowAnomaly type (T14)', () => {
    it('has fromFile, toFile, and backward direction', () => {
        const anomaly: FlowAnomaly = {
            fromFile: 'src/services/user.ts',
            toFile: 'src/controllers/user.ts',
            direction: 'backward',
        };
        expect(anomaly.fromFile).toBe('src/services/user.ts');
        expect(anomaly.toFile).toBe('src/controllers/user.ts');
        expect(anomaly.direction).toBe('backward');
    });

    it('accepts skip-layer direction', () => {
        const anomaly: FlowAnomaly = {
            fromFile: 'src/controllers/user.ts',
            toFile: 'src/db/userRepo.ts',
            direction: 'skip-layer',
        };
        expect(anomaly.direction).toBe('skip-layer');
    });
});

// ─── Task 15: FlowSequence compiles with id, entryPoint, steps, anomalies ─

describe('FlowSequence type (T15)', () => {
    it('has id, entryPoint, steps, and anomalies fields', () => {
        const seq: FlowSequence = {
            id: 'src/routes/users.ts',
            entryPoint: 'src/routes/users.ts',
            steps: [],
            anomalies: [],
        };
        expect(seq.id).toBeDefined();
        expect(seq.entryPoint).toBeDefined();
        expect(Array.isArray(seq.steps)).toBe(true);
        expect(Array.isArray(seq.anomalies)).toBe(true);
    });

    it('steps and anomalies are typed correctly', () => {
        const step: FlowStep = { filePath: 'a.ts', fileCategory: 'entry', layer: 1 };
        const anomaly: FlowAnomaly = { fromFile: 'a.ts', toFile: 'b.ts', direction: 'skip-layer' };
        const seq: FlowSequence = {
            id: 'a.ts',
            entryPoint: 'a.ts',
            steps: [step],
            anomalies: [anomaly],
        };
        expect(seq.steps[0].filePath).toBe('a.ts');
        expect(seq.anomalies[0].fromFile).toBe('a.ts');
    });
});

// ─── Task 16: AnalysisReport.flows is optional FlowSequence[] ────────────

describe('AnalysisReport.flows field (T16)', () => {
    it('flows field is absent from a partial report object', () => {
        const report = {} as Partial<AnalysisReport>;
        expect(report.flows).toBeUndefined();
    });

    it('flows field accepts FlowSequence array', () => {
        const seq: FlowSequence = {
            id: 'entry.ts',
            entryPoint: 'entry.ts',
            steps: [],
            anomalies: [],
        };
        const report = { flows: [seq] } as Partial<AnalysisReport>;
        expect(report.flows).toHaveLength(1);
    });

    it('accepts optional tooling flow metadata on the summary shape', () => {
        const report: AnalysisReportSummary = {
            frameworks: [],
            metrics: {
                totalFiles: 0,
                totalLines: 0,
            },
            dependencyGraph: {
                edges: [],
            },
            toolingFlowCount: 2,
            toolingEntryPoints: ['bin/reponav.ts', 'bin/mcp.ts'],
        };
        expect(report.toolingFlowCount).toBe(2);
        expect(report.toolingEntryPoints).toEqual(['bin/reponav.ts', 'bin/mcp.ts']);
    });
});
