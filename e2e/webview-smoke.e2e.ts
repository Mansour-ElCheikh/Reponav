import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * Minimal Tour fixture matching the shared/types.ts Tour interface.
 * Steps are empty — the type guard validates each step field strictly,
 * and the smoke tests only need to verify graph rendering (not step navigation).
 */
const FIXTURE_TOUR = {
    id: 'e2e-smoke-1',
    query: 'architecture overview',
    tourType: 'architecture',
    steps: [],
    graph: {
        nodes: [
            { id: 'src/extension.ts', label: 'extension.ts', type: 'entry' },
            { id: 'src/ai/tourGenerator.ts', label: 'tourGenerator.ts', type: 'service' },
            { id: 'src/db/RepoDatabase.ts', label: 'RepoDatabase.ts', type: 'db' },
        ],
        edges: [
            { source: 'src/extension.ts', target: 'src/ai/tourGenerator.ts', label: 'imports' },
            { source: 'src/extension.ts', target: 'src/db/RepoDatabase.ts', label: 'imports' },
        ],
    },
    analysisSnapshot: {
        frameworks: ['node'],
        entryPoints: ['src/extension.ts'],
        totalFiles: 3,
        totalEdges: 2,
    },
    createdAt: new Date().toISOString(),
    aiGenerated: false,
};

const HARNESS_URL = 'file://' + path.resolve(__dirname, 'harness/index.html');

async function openGraphTools(page: import('@playwright/test').Page) {
    await page.getByTestId('graph-tools-trigger').click();
    await expect(page.getByTestId('graph-hud-group-visibility')).toBeVisible({ timeout: 5000 });
}

test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS_URL);
    // Wait for React to mount and fire the 'ready' message — this confirms
    // useRepoNavState's useEffect listener is registered before we send messages
    await page.waitForFunction(
        () => Array.isArray((window as any).__postedMessages) &&
              (window as any).__postedMessages.some((m: { type: string }) => m.type === 'ready'),
        { timeout: 10000 }
    );
});

test('webview mounts React app without crash', async ({ page }) => {
    // The root div should be populated by React
    const root = page.locator('#root');
    await expect(root).not.toBeEmpty();
});

test('webview renders query bar after mount', async ({ page }) => {
    // QueryBar is always rendered in the UI shell
    const queryInput = page.locator('input[placeholder], textarea[placeholder], [data-testid="query-bar"], .query-bar, input[type="text"]');
    await expect(queryInput.first()).toBeVisible({ timeout: 8000 });
});

test('webview renders graph after tourGenerated message', async ({ page }) => {
    // Post a tourGenerated message to simulate the extension delivering a tour
    await page.evaluate((tour) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'tourGenerated', tour },
        }));
    }, FIXTURE_TOUR);

    // Sigma renders multiple canvas elements (edges, nodes, labels, mouse).
    // Wait for the sigma-nodes canvas specifically — it's the most meaningful signal.
    await expect(page.locator('canvas.sigma-nodes')).toBeVisible({ timeout: 10000 });
});

test('webview shows error state on error message', async ({ page }) => {
    await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'error', message: 'E2E test error signal' },
        }));
    });
    // The app should surface an error indication — text or an element
    await expect(page.getByText('E2E test error signal')).toBeVisible({ timeout: 5000 });
});

test('webview posts ready message on mount', async ({ page }) => {
    // beforeEach already waited for the ready message — just verify it's present
    const posted = await page.evaluate(() => (window as any).__postedMessages ?? []);
    const readyMsg = (posted as { type: string }[]).find(m => m.type === 'ready');
    expect(readyMsg).toBeTruthy();
});

test('graph filter controls render after tourGenerated', async ({ page }) => {
    await page.evaluate((tour) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'tourGenerated', tour } }));
    }, FIXTURE_TOUR);

    await expect(page.locator('canvas.sigma-nodes')).toBeVisible({ timeout: 10000 });

    await openGraphTools(page);

    const filters = page.locator('[data-testid="graph-hud"]');
    await expect(filters).toBeVisible({ timeout: 5000 });
    await expect(filters.getByText('Show tests')).toBeVisible();
    await expect(filters.getByText('Circular only')).toBeVisible();
    await expect(filters.getByText('Group by dir')).toBeVisible();
});

test('test and circular filters are disabled when tour has no test nodes or circular edges', async ({ page }) => {
    await page.evaluate((tour) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'tourGenerated', tour } }));
    }, FIXTURE_TOUR);

    await expect(page.locator('canvas.sigma-nodes')).toBeVisible({ timeout: 10000 });

    await openGraphTools(page);

    // FIXTURE_TOUR has no test-type nodes and no circular edges — both filters must be disabled
    const showTests = page.getByTestId('visibility-control-show-tests');
    const circularOnly = page.getByTestId('visibility-control-circular-only');
    await expect(showTests).toBeDisabled({ timeout: 5000 });
    await expect(circularOnly).toBeDisabled({ timeout: 5000 });
});
