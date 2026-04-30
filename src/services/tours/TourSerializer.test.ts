import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Tour } from '../../types';
import { TourSerializer } from './TourSerializer';

const tempDirs: string[] = [];

function makeTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reponav-tour-serializer-'));
    tempDirs.push(dir);
    return dir;
}

function makeTour(id: string, createdAt: string): Tour {
    return {
        id,
        query: `Tour ${id}`,
        tourType: 'overview',
        steps: [],
        graph: { nodes: [], edges: [] },
        analysisSnapshot: {
            frameworks: [],
            entryPoints: [],
            totalFiles: 0,
            totalEdges: 0,
            circularCount: 0,
        },
        createdAt,
        aiGenerated: true,
    } as Tour;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('TourSerializer', () => {
    it('saves and loads a tour round-trip', () => {
        const workspace = makeTempWorkspace();
        const serializer = new TourSerializer(workspace);
        const tour = makeTour('tour-1', '2026-04-17T00:00:00.000Z');

        const filePath = serializer.save(tour);
        const loaded = serializer.load('tour-1');

        expect(fs.existsSync(filePath)).toBe(true);
        expect(loaded?.id).toBe('tour-1');
        expect(loaded?.query).toBe('Tour tour-1');
    });

    it('lists saved tours newest-first', () => {
        const workspace = makeTempWorkspace();
        const serializer = new TourSerializer(workspace);
        serializer.save(makeTour('tour-old', '2026-04-16T00:00:00.000Z'));
        serializer.save(makeTour('tour-new', '2026-04-17T00:00:00.000Z'));

        const summaries = serializer.listAll();

        expect(summaries).toHaveLength(2);
        expect(summaries[0].id).toBe('tour-new');
        expect(summaries[1].id).toBe('tour-old');
    });

    it('deletes an existing saved tour', () => {
        const workspace = makeTempWorkspace();
        const serializer = new TourSerializer(workspace);
        serializer.save(makeTour('tour-delete', '2026-04-17T00:00:00.000Z'));

        const deleted = serializer.delete('tour-delete');
        const loaded = serializer.load('tour-delete');

        expect(deleted).toBe(true);
        expect(loaded).toBeNull();
    });
});