/**
 * Batch 2 — Behavioural E2E scenarios
 *
 * Covers:
 * - Multi-step tour delivery + step navigation
 * - Loading state lifecycle (tourGenerating → tourGenerated)
 * - Graph filter toggles (show-tests, group-by-dir)
 * - Circular-dep filter (enabled only when graph has circular edges)
 * - requestTour message posted on query submit
 * - Node type color legend renders and collapses
 * - savedTours message renders saved tour list
 */

import { test, expect } from '@playwright/test';
import path from 'path';

const HARNESS_URL = 'file://' + path.resolve(__dirname, 'harness/index.html');

// ─── Shared fixtures ──────────────────────────────────────────────────────────

/** A tour fixture with two steps and a test node so all filter toggles are active. */
const MULTI_STEP_TOUR = {
    id: 'e2e-multi-1',
    query: 'data flow overview',
    tourType: 'architecture',
    steps: [
        {
            order: 1, title: 'Entry Point',
            what_it_does: 'Bootstraps the extension.', why_it_matters: 'First file loaded.',
            watch_out: 'Must activate on correct event.', files: ['src/extension.ts'],
            highlights: [], relationships: [],
        },
        {
            order: 2, title: 'Tour Generator',
            what_it_does: 'Calls the LLM provider.', why_it_matters: 'Core AI logic.',
            watch_out: 'May time out.', files: ['src/ai/tourGenerator.ts'],
            highlights: [], relationships: [],
        },
    ],
    graph: {
        nodes: [
            { id: 'src/extension.ts', label: 'extension.ts', type: 'entry' },
            { id: 'src/ai/tourGenerator.ts', label: 'tourGenerator.ts', type: 'service' },
            { id: 'src/ai/tourGenerator.test.ts', label: 'tourGenerator.test.ts', type: 'test' },
        ],
        edges: [
            { source: 'src/extension.ts', target: 'src/ai/tourGenerator.ts', label: 'imports' },
        ],
    },
    analysisSnapshot: { frameworks: ['node'], entryPoints: ['src/extension.ts'], totalFiles: 3, totalEdges: 1 },
    createdAt: new Date().toISOString(),
    aiGenerated: false,
};

/** Tour where an edge is circular (self-referential for simplicity in fixture). */
const CIRCULAR_TOUR = {
    id: 'e2e-circular-1',
    query: 'circular dep check',
    tourType: 'architecture',
    steps: [],
    graph: {
        nodes: [
            { id: 'src/a.ts', label: 'a.ts', type: 'service' },
            { id: 'src/b.ts', label: 'b.ts', type: 'service' },
        ],
        edges: [
            { source: 'src/a.ts', target: 'src/b.ts', label: 'imports', isCircular: false },
            { source: 'src/b.ts', target: 'src/a.ts', label: 'imports', isCircular: true },
        ],
    },
    analysisSnapshot: { frameworks: [], entryPoints: [], totalFiles: 2, totalEdges: 2 },
    createdAt: new Date().toISOString(),
    aiGenerated: false,
};

/** Minimal analysis report fixture carrying flow sequences for Sigma flow overlay. */
const FLOW_REPORT = {
    frameworks: [{ name: 'node', type: 'runtime' }],
    metrics: { totalFiles: 3, totalLines: 120 },
    dependencyGraph: {
        edges: [{ source: 'src/extension.ts', target: 'src/ai/tourGenerator.ts' }],
    },
    flowCount: 1,
    flows: [
        {
            id: 'flow-e2e-1',
            entryPoint: 'src/extension.ts',
            steps: [
                // Use absolute style paths to verify runtime path resolution in overlay mode
                { filePath: '/Users/test/repo/src/extension.ts', fileCategory: 'entry', layer: 0 },
                { filePath: '/Users/test/repo/src/ai/tourGenerator.ts', fileCategory: 'service', layer: 1 },
            ],
            anomalies: [],
        },
    ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
}

async function deliverAnalysis(page: import('@playwright/test').Page, report: unknown) {
    await page.evaluate((r) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysisComplete', report: r } }));
    }, report);
}

async function openGraphTools(page: import('@playwright/test').Page) {
    await page.getByTestId('graph-tools-trigger').click();
    await expect(page.getByTestId('graph-hud-group-visibility')).toBeVisible({ timeout: 5000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => { await waitForReady(page); });

// ── Loading state ─────────────────────────────────────────────────────────────

test('loading state appears on tourGenerating message', async ({ page }) => {
    await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'tourGenerating', status: 'Scanning workspace...' },
        }));
    });
    await expect(page.locator('[data-testid="loading-state"]')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Generating Tour' })).toBeVisible();
});

test('loading state disappears after tour delivered', async ({ page }) => {
    await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'tourGenerating', status: 'Scanning workspace...' },
        }));
    });
    await expect(page.locator('[data-testid="loading-state"]')).toBeVisible({ timeout: 5000 });

    await deliverTour(page, MULTI_STEP_TOUR);

    await expect(page.locator('[data-testid="loading-state"]')).not.toBeVisible({ timeout: 5000 });
});

// ── Step panel ────────────────────────────────────────────────────────────────

test('step panel renders with correct step count after tour', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR);
    await expect(page.locator('[data-testid="step-panel"]')).toBeVisible({ timeout: 5000 });
    // Two step nav buttons expected
    await expect(page.locator('[data-testid="step-nav"] button')).toHaveCount(2, { timeout: 5000 });
});

test('tour bar shows tour query without duplicating it in the sidebar header', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR);
    await expect(page.locator('.tour-query')).toContainText('data flow overview');
    await expect(page.locator('[data-testid="sidebar-region-header"]')).not.toContainText('data flow overview');
});

test('clicking second step nav button advances to step 2', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR);
    // Step 1 content visible initially
    await expect(page.locator('[data-testid="step-content"]')).toContainText('Entry Point');

    // Click step 2
    await page.locator('[data-testid="step-nav-item-1"]').click();
    await expect(page.locator('[data-testid="step-content"]')).toContainText('Tour Generator', { timeout: 3000 });
});

test('step 1 nav button has active class initially', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR);
    const step0 = page.locator('[data-testid="step-nav-item-0"]');
    await expect(step0).toHaveClass(/active/, { timeout: 3000 });
});

// ── Graph filters ─────────────────────────────────────────────────────────────

test('graph filter bar is visible after tour delivered', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR);
    await openGraphTools(page);
    await expect(page.getByTestId('graph-hud')).toBeVisible({ timeout: 5000 });
});

test('"show tests" toggle is enabled and active when graph has test nodes', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR); // fixture has a test node
    await openGraphTools(page);
    const cb = page.getByTestId('visibility-control-show-tests');
    await expect(cb).not.toBeDisabled({ timeout: 5000 });
    await expect(cb).toHaveAttribute('aria-pressed', 'true');
});

test('"circular only" toggle is disabled when graph has no circular edges', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR); // no circular edges
    await openGraphTools(page);
    await expect(page.getByTestId('visibility-control-circular-only')).toBeDisabled({ timeout: 5000 });
});

test('"circular only" toggle is enabled when graph has circular edges', async ({ page }) => {
    await deliverTour(page, CIRCULAR_TOUR);
    await openGraphTools(page);
    await expect(page.getByTestId('visibility-control-circular-only')).not.toBeDisabled({ timeout: 5000 });
});

test('"group by dir" toggle flips pressed state on click', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR);
    await openGraphTools(page);
    const cb = page.getByTestId('layout-control-group-dirs');
    await expect(cb).toHaveAttribute('aria-pressed', 'false', { timeout: 3000 });
    await cb.click();
    await expect(cb).toHaveAttribute('aria-pressed', 'true', { timeout: 3000 });
    await cb.click();
    await expect(cb).toHaveAttribute('aria-pressed', 'false', { timeout: 3000 });
});

test('flow overlay renders on the canvas layer and hides when flow toggle is off', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR);
    await deliverAnalysis(page, FLOW_REPORT);

    await openGraphTools(page);

    const flowToggle = page.getByTestId('analysis-control-flow-edges');
    await expect(flowToggle).not.toBeDisabled({ timeout: 5000 });
    await expect(flowToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });

    const flowOverlay = page.getByTestId('flow-overlay');
    await expect(flowOverlay).toBeVisible({ timeout: 5000 });
    await expect.poll(async () => page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="flow-overlay"]') as HTMLCanvasElement | null;
        if (!canvas) return 0;
        const context = canvas.getContext('2d');
        if (!context) return 0;
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let drawnPixelCount = 0;
        for (let index = 3; index < data.length; index += 4) {
            if (data[index] > 0) drawnPixelCount++;
        }
        return drawnPixelCount;
    }), { timeout: 5000 }).toBeGreaterThan(0);

    await flowToggle.click();
    await expect(flowToggle).toHaveAttribute('aria-pressed', 'false', { timeout: 3000 });
    await expect(flowOverlay).toHaveCSS('visibility', 'hidden');
});

// ── Node type legend ──────────────────────────────────────────────────────────

test('node type legend renders after tour delivered', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR);
    await expect(page.locator('.node-type-legend')).toBeVisible({ timeout: 5000 });
});

test('node type legend shows only types present in graph', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR); // entry, service, test
    const items = page.locator('.node-type-legend-item');
    // At least 1 entry, exactly the types from the fixture (entry, service, test)
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
});

test('node type legend collapses and expands on toggle button click', async ({ page }) => {
    await deliverTour(page, MULTI_STEP_TOUR);
    const list = page.locator('.node-type-legend-list');
    await expect(list).toBeVisible({ timeout: 5000 });

    await page.locator('.node-type-legend-toggle').click();
    await expect(list).not.toBeVisible({ timeout: 3000 });

    await page.locator('.node-type-legend-toggle').click();
    await expect(list).toBeVisible({ timeout: 3000 });
});

// ── requestTour message ───────────────────────────────────────────────────────

test('query bar submits requestTour message to extension', async ({ page }) => {
    // Find the query input and submit
    const input = page.locator('input[type="text"], textarea').first();
    await input.fill('show me the auth flow');
    // Submit — try Enter key first
    await input.press('Enter');

    // Check __postedMessages for requestTour
    const posted = await page.evaluate(() => (window as any).__postedMessages ?? []);
    const msg = (posted as Array<{ type: string; query?: string }>)
        .find(m => m.type === 'requestTour');
    expect(msg).toBeTruthy();
    if (msg) expect(msg.query).toBe('show me the auth flow');
});

// ── savedTours message ────────────────────────────────────────────────────────

test('savedTours message renders saved tour entries', async ({ page }) => {
    await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'savedTours',
                tours: [
                    { id: 'saved-1', query: 'auth overview', tourType: 'architecture', stepCount: 3, createdAt: new Date().toISOString() },
                    { id: 'saved-2', query: 'db schema tour', tourType: 'data-flow', stepCount: 5, createdAt: new Date().toISOString() },
                ],
            },
        }));
    });
    await expect(page.getByText('auth overview')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('db schema tour')).toBeVisible({ timeout: 5000 });
});
