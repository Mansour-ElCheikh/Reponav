import { describe, expect, it } from 'vitest';
import type { EntryPoint } from '../types';
import type { FlowSequence } from '../types';
import { inferEntrySurface, partitionEntryPointsBySurface, partitionFlowsByEntrySurface } from './entrySurface';

describe('inferEntrySurface', () => {
    it('classifies app/runtime roots as runtime', () => {
        expect(inferEntrySurface('src/main.ts')).toBe('runtime');
        expect(inferEntrySurface('src/routes/users.ts')).toBe('runtime');
    });

    it('classifies tool and operational roots as tooling', () => {
        expect(inferEntrySurface('bin/reponav.ts')).toBe('tooling');
        expect(inferEntrySurface('scripts/smoke/index.js')).toBe('tooling');
        expect(inferEntrySurface('presentation/src/index.ts')).toBe('tooling');
    });
});

describe('partitionFlowsByEntrySurface', () => {
    it('splits flows by their analyzer-assigned entry surface', () => {
        const flows: FlowSequence[] = [
            { id: 'runtime', entryPoint: 'src/routes/users.ts', entrySurface: 'runtime', steps: [], anomalies: [] },
            { id: 'tooling', entryPoint: 'bin/reponav.ts', entrySurface: 'tooling', steps: [], anomalies: [] },
        ];

        const result = partitionFlowsByEntrySurface(flows);

        expect(result.runtimeFlows.map((flow) => flow.entryPoint)).toEqual(['src/routes/users.ts']);
        expect(result.toolingFlows.map((flow) => flow.entryPoint)).toEqual(['bin/reponav.ts']);
    });
});

describe('partitionEntryPointsBySurface', () => {
    it('splits runtime entry points from tooling launch surfaces', () => {
        const entryPoints: EntryPoint[] = [
            { file: 'src/main.ts', type: 'main', entrySurface: 'runtime', confidence: 'high', reason: 'app bootstrap' },
            { file: 'bin/reponav.ts', type: 'cli', entrySurface: 'tooling', confidence: 'high', reason: 'cli entry' },
            { file: 'scripts/smoke/index.js', type: 'cli', confidence: 'medium', reason: 'tooling script' },
        ];

        const result = partitionEntryPointsBySurface(entryPoints);

        expect(result.runtimeEntryPoints).toEqual(['src/main.ts']);
        expect(result.launchSurfaces).toEqual(['bin/reponav.ts', 'scripts/smoke/index.js']);
    });
});