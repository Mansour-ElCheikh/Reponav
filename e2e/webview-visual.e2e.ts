/**
 * Batch 3 — Visual snapshot baselines
 *
 * Uses Playwright's toHaveScreenshot() to lock in the visual appearance
 * of key UI states. Run once to generate baselines; subsequent runs diff
 * against them.
 *
 * Snapshots are stored in e2e/__snapshots__/ and committed to git so CI
 * can detect visual regressions.
 *
 * To regenerate all baselines:
 *   npx playwright test webview-visual.e2e.ts --update-snapshots
 */

import { test, expect } from '@playwright/test';
import path from 'path';

const HARNESS_URL = 'file://' + path.resolve(__dirname, 'harness/index.html');

// ─── Fixture ──────────────────────────────────────────────────────────────────

const VISUAL_TOUR = {
    id: 'e2e-visual-1',
    query: 'architecture overview',
    tourType: 'architecture',
    steps: [
        {
            order: 1, title: 'Extension Entry',
            what_it_does: 'Bootstraps all commands and providers.',
            why_it_matters: 'Nothing runs without it.',
            watch_out: 'Must handle activation events carefully.',
            files: ['src/extension.ts'],
            highlights: [], relationships: [],
        },
        {
            order: 2, title: 'AI Tour Generator',
            what_it_does: 'Orchestrates the LLM tour pipeline.',
            why_it_matters: 'Core product intelligence.',
            watch_out: 'May fall back to structural-only.',
            files: ['src/ai/tourGenerator.ts'],
            highlights: [], relationships: [],
        },
    ],
    graph: {
        nodes: [
            { id: 'src/extension.ts', label: 'extension.ts', type: 'entry', weight: 10 },
            { id: 'src/ai/tourGenerator.ts', label: 'tourGenerator.ts', type: 'service', weight: 8 },
            { id: 'src/db/RepoDatabase.ts', label: 'RepoDatabase.ts', type: 'model', weight: 6 },
            { id: 'src/commands/commandHandlers.ts', label: 'commandHandlers.ts', type: 'controller', weight: 5 },
        ],
        edges: [
            { source: 'src/extension.ts', target: 'src/ai/tourGenerator.ts', label: 'imports' },
            { source: 'src/extension.ts', target: 'src/db/RepoDatabase.ts', label: 'imports' },
            { source: 'src/extension.ts', target: 'src/commands/commandHandlers.ts', label: 'imports' },
        ],
    },
    analysisSnapshot: {
        frameworks: ['node', 'vscode'],
        entryPoints: ['src/extension.ts'],
        totalFiles: 4,
        totalEdges: 3,
    },
    createdAt: '2026-04-04T00:00:00.000Z',
    aiGenerated: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForReady(page: import('@playwright/test').Page) {
    await page.goto(HARNESS_URL);
    await page.waitForFunction(
        () => Array.isArray((window as any).__postedMessages) &&
            (window as any).__postedMessages.some((m: { type: string }) => m.type === 'ready'),
        { timeout: 10000 },
    );
}

async function deliverTour(page: import('@playwright/test').Page, tour: unknown) {
    await page.evaluate((t) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'tourGenerated', tour: t } }));
    }, tour);
    await expect(page.locator('canvas.sigma-nodes')).toBeVisible({ timeout: 10000 });
    // Wait one extra frame for the graph layout passes to finish settling
    await page.waitForTimeout(400);
}

async function openGraphTools(page: import('@playwright/test').Page) {
    await page.getByTestId('graph-tools-trigger').click();
    await expect(page.getByTestId('graph-hud-group-visibility')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(100);
}

// ─── Snapshot config ─────────────────────────────────────────────────────────
// maxDiffPixelRatio: 0.02 = up to 2% of pixels may differ (handles font rendering
// differences between machines while still catching real regressions).
const SNAP_OPTS = { maxDiffPixelRatio: 0.02 };

// ─── Tests ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
    await waitForReady(page);
    // Fixed viewport so snapshots are deterministic
    await page.setViewportSize({ width: 1280, height: 800 });
});

test('visual: empty state (no tour)', async ({ page }) => {
    await expect(page).toHaveScreenshot('empty-state.png', SNAP_OPTS);
});

test('visual: loading state', async ({ page }) => {
    await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'tourGenerating', status: 'Scanning workspace...' },
        }));
    });
    await expect(page.locator('[data-testid="loading-state"]')).toBeVisible({ timeout: 5000 });
    // Brief pause for CSS animations to settle to first keyframe
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('loading-state.png', SNAP_OPTS);
});

test('visual: error state', async ({ page }) => {
    await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'error', message: 'Failed to analyse repository: permission denied' },
        }));
    });
    await expect(page.getByText('permission denied')).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveScreenshot('error-state.png', SNAP_OPTS);
});

test('visual: graph canvas — full tour loaded, step 1', async ({ page }) => {
    await deliverTour(page, VISUAL_TOUR);
    await expect(page).toHaveScreenshot('graph-step-1.png', SNAP_OPTS);
});

test('visual: graph canvas — step 2 active', async ({ page }) => {
    await deliverTour(page, VISUAL_TOUR);
    await page.locator('[data-testid="step-nav-item-1"]').click();
    await page.waitForTimeout(150);
    await expect(page).toHaveScreenshot('graph-step-2.png', SNAP_OPTS);
});

test('visual: node type legend panel — open', async ({ page }) => {
    await deliverTour(page, VISUAL_TOUR);
    const legend = page.locator('.node-type-legend');
    await expect(legend).toBeVisible({ timeout: 5000 });
    await expect(legend).toHaveScreenshot('node-type-legend-open.png', SNAP_OPTS);
});

test('visual: node type legend panel — collapsed', async ({ page }) => {
    await deliverTour(page, VISUAL_TOUR);
    await page.locator('.node-type-legend-toggle').click();
    await page.waitForTimeout(100);
    const legend = page.locator('.node-type-legend');
    await expect(legend).toHaveScreenshot('node-type-legend-collapsed.png', SNAP_OPTS);
});

test('visual: graph filter bar', async ({ page }) => {
    await deliverTour(page, VISUAL_TOUR);
    await openGraphTools(page);
    const filters = page.locator('[data-testid="graph-hud"]');
    await expect(filters).toBeVisible({ timeout: 5000 });
    await expect(filters).toHaveScreenshot('graph-filters.png', SNAP_OPTS);
});

test('visual: step panel header', async ({ page }) => {
    await deliverTour(page, VISUAL_TOUR);
    const header = page.locator('[data-testid="sidebar-region-header"]');
    await expect(header).toBeVisible({ timeout: 5000 });
    await expect(header).toHaveScreenshot('step-panel-header.png', SNAP_OPTS);
});
