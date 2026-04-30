/**
 * FastAPI fixture for flow-detection precision testing (Task 11).
 *
 * Models a typical FastAPI app with:
 *   routers/*.py (route) → services/*.py (service) → repositories/*.py (persistence)
 * Plus dependency-injection utils and schemas (not entry points).
 *
 * 8 expected FlowSequences (one per router file).
 */

import type { FileClassification } from '../../../src/types';
import type { CondensationDag } from '../layerDag';

// ─── File classifications ────────────────────────────────────────────────────

export const fastapiClassifications: FileClassification[] = [
    // Routers (entry points)
    { path: 'routers/users.py',    category: 'route', confidence: 'high', reason: 'APIRouter' },
    { path: 'routers/items.py',    category: 'route', confidence: 'high', reason: 'APIRouter' },
    { path: 'routers/orders.py',   category: 'route', confidence: 'high', reason: 'APIRouter' },
    { path: 'routers/auth.py',     category: 'route', confidence: 'high', reason: 'APIRouter' },
    // Services
    { path: 'services/user_svc.py',  category: 'service', confidence: 'high', reason: 'business logic' },
    { path: 'services/item_svc.py',  category: 'service', confidence: 'high', reason: 'business logic' },
    { path: 'services/order_svc.py', category: 'service', confidence: 'high', reason: 'business logic' },
    { path: 'services/auth_svc.py',  category: 'service', confidence: 'high', reason: 'JWT handling' },
    // Repositories (persistence)
    { path: 'repositories/user_repo.py',  category: 'service', confidence: 'high', reason: 'SQLAlchemy session' },
    { path: 'repositories/item_repo.py',  category: 'service', confidence: 'high', reason: 'SQLAlchemy session' },
    { path: 'repositories/order_repo.py', category: 'service', confidence: 'high', reason: 'SQLAlchemy session' },
    // Cross-cutting (not entry points)
    { path: 'schemas/user.py',  category: 'model',   confidence: 'high', reason: 'pydantic model' },
    { path: 'core/config.py',   category: 'config',  confidence: 'high', reason: 'settings' },
];

// Component indices
const RU = 0;  // routers/users.py
const RI = 1;  // routers/items.py
const RO = 2;  // routers/orders.py
const RA = 3;  // routers/auth.py
const SU = 4;  // services/user_svc.py
const SI = 5;  // services/item_svc.py
const SO = 6;  // services/order_svc.py
const SA = 7;  // services/auth_svc.py
const PU = 8;  // repositories/user_repo.py
const PI = 9;  // repositories/item_repo.py
const PO = 10; // repositories/order_repo.py
// schemas + config not reachable from routers in this model

const SERVICE_LAYER = 3;
const REPOSITORY_LAYER = 5;
const SCHEMA_LAYER = 4;

export const fastapiDag: CondensationDag = {
    components: fastapiClassifications.map(c => [c.path]),
    dagEdges: [
        // Routers → Services
        { from: RU, to: SU },
        { from: RI, to: SI },
        { from: RO, to: SO },
        { from: RA, to: SA },
        // Services → Repositories
        { from: SU, to: PU },
        { from: SI, to: PI },
        { from: SO, to: PO },
        { from: SA, to: PU }, // auth service also reads user repo
        // Order service also touches item repo (shared dependency)
        { from: SO, to: PI },
    ],
};

export const fastapiLayers = new Map<string, number>([
    ['routers/users.py',          1],
    ['routers/items.py',          1],
    ['routers/orders.py',         1],
    ['routers/auth.py',           1],
    ['services/user_svc.py',      SERVICE_LAYER],
    ['services/item_svc.py',      SERVICE_LAYER],
    ['services/order_svc.py',     SERVICE_LAYER],
    ['services/auth_svc.py',      SERVICE_LAYER],
    ['repositories/user_repo.py', REPOSITORY_LAYER],
    ['repositories/item_repo.py', REPOSITORY_LAYER],
    ['repositories/order_repo.py',REPOSITORY_LAYER],
    ['schemas/user.py',           SCHEMA_LAYER],
    ['core/config.py',            0], // exempt (config)
]);

/** All 4 router paths that detectFlows must find as entry points. */
export const fastapiExpectedEntryPoints = [
    'routers/users.py',
    'routers/items.py',
    'routers/orders.py',
    'routers/auth.py',
];
