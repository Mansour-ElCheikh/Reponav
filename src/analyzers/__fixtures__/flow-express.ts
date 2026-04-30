/**
 * Express fixture for flow-detection precision testing (Task 10).
 *
 * Models a typical Express REST API with:
 *   routes/*.ts (route/controller) → services/*.ts (service) → db/*.ts (persistence)
 * Plus one middleware and one utility (not entry points).
 *
 * 10 expected FlowSequences (one per route file × service fanout path).
 * True-positive check: detectFlows must return ≥ 8 of these 10 entry paths.
 */

import type { FileClassification } from '../../../src/types';
import type { CondensationDag } from '../layerDag';

// ─── File classifications ────────────────────────────────────────────────────

export const expressClassifications: FileClassification[] = [
    // Routes (entry points)
    { path: 'routes/userRoutes.ts',    category: 'route',       confidence: 'high', reason: 'express router' },
    { path: 'routes/orderRoutes.ts',   category: 'route',       confidence: 'high', reason: 'express router' },
    { path: 'routes/productRoutes.ts', category: 'route',       confidence: 'high', reason: 'express router' },
    // Controllers (also entry points)
    { path: 'controllers/userCtrl.ts',    category: 'controller', confidence: 'high', reason: 'req/res handler' },
    { path: 'controllers/orderCtrl.ts',   category: 'controller', confidence: 'high', reason: 'req/res handler' },
    { path: 'controllers/productCtrl.ts', category: 'controller', confidence: 'high', reason: 'req/res handler' },
    // Services
    { path: 'services/userService.ts',    category: 'service', confidence: 'high', reason: 'business logic' },
    { path: 'services/orderService.ts',   category: 'service', confidence: 'high', reason: 'business logic' },
    { path: 'services/productService.ts', category: 'service', confidence: 'high', reason: 'business logic' },
    // Persistence
    { path: 'db/userRepo.ts',    category: 'service', confidence: 'high', reason: 'sequelize model' },
    { path: 'db/orderRepo.ts',   category: 'service', confidence: 'high', reason: 'sequelize model' },
    // Cross-cutting (not entry points)
    { path: 'middleware/auth.ts', category: 'middleware', confidence: 'high', reason: 'express middleware' },
    { path: 'utils/logger.ts',    category: 'utility',    confidence: 'high', reason: 'shared util' },
];

// Component indices for the DAG below
const R_USER = 0;   // routes/userRoutes.ts
const R_ORDER = 1;  // routes/orderRoutes.ts
const R_PROD = 2;   // routes/productRoutes.ts
const C_USER = 3;   // controllers/userCtrl.ts
const C_ORDER = 4;  // controllers/orderCtrl.ts
const C_PROD = 5;   // controllers/productCtrl.ts
const S_USER = 6;   // services/userService.ts
const S_ORDER = 7;  // services/orderService.ts
const S_PROD = 8;   // services/productService.ts
const DB_USER = 9;  // db/userRepo.ts
const DB_ORDER = 10;// db/orderRepo.ts
const MW_AUTH = 11; // middleware/auth.ts
const UTIL_LOG = 12;// utils/logger.ts

const SERVICE_LAYER = 3;
const PERSISTENCE_LAYER = 5;

export const expressDag: CondensationDag = {
    components: expressClassifications.map(c => [c.path]),
    dagEdges: [
        // Routes → Controllers
        { from: R_USER,  to: C_USER },
        { from: R_ORDER, to: C_ORDER },
        { from: R_PROD,  to: C_PROD },
        // Controllers → Services
        { from: C_USER,  to: S_USER },
        { from: C_ORDER, to: S_ORDER },
        { from: C_PROD,  to: S_PROD },
        // Services → DB
        { from: S_USER,  to: DB_USER },
        { from: S_ORDER, to: DB_ORDER },
        { from: S_PROD,  to: DB_USER },  // productService also uses userRepo
        // Middleware (not reachable from routes in this graph — sidecar)
        { from: MW_AUTH, to: S_USER },
        // Utilities accessible from services
        { from: S_USER,  to: UTIL_LOG },
        { from: S_ORDER, to: UTIL_LOG },
    ],
};

export const expressLayers = new Map<string, number>([
    ['routes/userRoutes.ts',       1],
    ['routes/orderRoutes.ts',      1],
    ['routes/productRoutes.ts',    1],
    ['controllers/userCtrl.ts',    2],
    ['controllers/orderCtrl.ts',   2],
    ['controllers/productCtrl.ts', 2],
    ['services/userService.ts',    SERVICE_LAYER],
    ['services/orderService.ts',   SERVICE_LAYER],
    ['services/productService.ts', SERVICE_LAYER],
    ['db/userRepo.ts',             PERSISTENCE_LAYER],
    ['db/orderRepo.ts',            PERSISTENCE_LAYER],
    ['middleware/auth.ts',         2],
    ['utils/logger.ts',            0], // exempt (utility)
]);

/**
 * The 6 entry-point paths (routes + controllers) that detectFlows must all find.
 * Precision test: all 6 must appear in the detected sequences.
 */
export const expressExpectedEntryPoints = [
    'routes/userRoutes.ts',
    'routes/orderRoutes.ts',
    'routes/productRoutes.ts',
    'controllers/userCtrl.ts',
    'controllers/orderCtrl.ts',
    'controllers/productCtrl.ts',
];
