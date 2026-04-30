/**
 * TourSerializer — Saves/loads tours as `.reponav.json` files
 *
 * Enables team sharing by writing tours to trackable files in the workspace.
 * Tour files are stored at `.reponav/tours/<tour_id>.json`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Tour } from '../../types';

const TOURS_DIR = '.reponav/tours';

/** Persists generated tours to workspace-local JSON files and reloads them later. */
export class TourSerializer {
    private toursDir: string;

    constructor(private readonly workspaceRoot: string) {
        this.toursDir = path.join(workspaceRoot, TOURS_DIR);
    }

    /**
     * Save a tour to a JSON file.
     */
    save(tour: Tour): string {
        if (!fs.existsSync(this.toursDir)) {
            fs.mkdirSync(this.toursDir, { recursive: true });
        }

        const filePath = path.join(this.toursDir, `${tour.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(tour, null, 2), 'utf-8');
        return filePath;
    }

    /**
     * Load a single tour from a JSON file.
     */
    load(tourId: string): Tour | null {
        const filePath = path.join(this.toursDir, `${tourId}.json`);
        if (!fs.existsSync(filePath)) return null;
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content) as Tour;
        } catch {
            return null;
        }
    }

    /**
     * List all saved tours (metadata only — id, query, type, date).
     */
    listAll(): TourSummary[] {
        if (!fs.existsSync(this.toursDir)) return [];
        const files = fs.readdirSync(this.toursDir).filter((f) => f.endsWith('.json'));
        const summaries: TourSummary[] = [];

        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(this.toursDir, file), 'utf-8');
                const tour = JSON.parse(content) as Tour;
                summaries.push({
                    id: tour.id,
                    query: tour.query,
                    tourType: tour.tourType,
                    stepCount: tour.steps.length,
                    nodeCount: tour.graph.nodes.length,
                    createdAt: tour.createdAt,
                });
            } catch {
                // Skip corrupted files
            }
        }

        return summaries.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }

    /**
     * Delete a saved tour.
     */
    delete(tourId: string): boolean {
        const filePath = path.join(this.toursDir, `${tourId}.json`);
        if (!fs.existsSync(filePath)) return false;
        fs.unlinkSync(filePath);
        return true;
    }
}

export interface TourSummary {
    id: string;
    query: string;
    tourType: string;
    stepCount: number;
    nodeCount: number;
    createdAt: string;
}
