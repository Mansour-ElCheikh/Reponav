import { describe, expect, it } from 'vitest';
import { DEAD_CODE_COLOR, DEAD_CODE_SIZE_MULTIPLIER } from './sigmaDeadCodeOverlay';
import { buildSigmaReducerPair } from './sigmaGraphReducerPair';

describe('buildSigmaReducerPair', () => {
    it('hides edges that touch nodes hidden by the node reducer', () => {
        const reducers = buildSigmaReducerPair({
            filterState: { showTestFiles: false, showCircularOnly: false },
            selectedNodeId: null,
            activeSubFilter: null,
            highlightedType: null,
            activeStepFiles: new Set(),
            upstreamNodes: new Set(),
            downstreamNodes: new Set(),
            circularNodes: undefined,
            selectionCircularNodes: new Set(),
            deadCodeFileSet: undefined,
            showCouplingEdges: true,
            showFlowEdges: true,
            flowPairKeys: new Set(),
            nodeTypeMap: new Map(),
        });

        const hiddenTestNode = reducers.nodeReducer('src/app.test.ts', {
            nodeType: 'test',
            label: 'src/app.test.ts',
            color: '#38bdf8',
            size: 7,
            originalSize: 7,
        });
        expect(hiddenTestNode).toEqual(expect.objectContaining({ hidden: true }));

        const edgeState = reducers.edgeReducer('src/app.ts→src/app.test.ts', {
            isCircular: false,
            isCoupling: false,
        }, 'src/app.ts', 'src/app.test.ts');
        expect(edgeState).toEqual(expect.objectContaining({ hidden: true }));
    });

    it('suppresses duplicate import edges for visible flow pairs', () => {
        const reducers = buildSigmaReducerPair({
            filterState: { showTestFiles: true, showCircularOnly: false },
            selectedNodeId: null,
            activeSubFilter: null,
            highlightedType: null,
            activeStepFiles: new Set(),
            upstreamNodes: new Set(),
            downstreamNodes: new Set(),
            circularNodes: undefined,
            selectionCircularNodes: new Set(),
            deadCodeFileSet: undefined,
            showCouplingEdges: true,
            showFlowEdges: true,
            flowPairKeys: new Set(['src/a.ts→src/b.ts']),
            nodeTypeMap: new Map(),
        });

        const edgeState = reducers.edgeReducer('src/a.ts→src/b.ts', {
            isCircular: false,
            isCoupling: false,
        }, 'src/a.ts', 'src/b.ts');
        expect(edgeState).toEqual(expect.objectContaining({ hidden: true }));
    });

    it('applies coupling override before default edge visuals', () => {
        const reducers = buildSigmaReducerPair({
            filterState: { showTestFiles: true, showCircularOnly: false },
            selectedNodeId: 'src/a.ts',
            activeSubFilter: null,
            highlightedType: null,
            activeStepFiles: new Set(),
            upstreamNodes: new Set(),
            downstreamNodes: new Set(),
            circularNodes: undefined,
            selectionCircularNodes: new Set(),
            deadCodeFileSet: undefined,
            showCouplingEdges: true,
            showFlowEdges: true,
            flowPairKeys: new Set(),
            nodeTypeMap: new Map(),
        });

        const edgeState = reducers.edgeReducer('coupling:src/a.ts→src/b.ts', {
            isCoupling: true,
            color: '#94a3b8',
            size: 1.5,
        }, 'src/a.ts', 'src/b.ts');
        expect(edgeState).toEqual(expect.objectContaining({ zIndex: -1 }));
    });

    it('applies dead-code overlay when the node remains eligible after base reducer checks', () => {
        const reducers = buildSigmaReducerPair({
            filterState: { showTestFiles: true, showCircularOnly: false },
            selectedNodeId: 'src/selected.ts',
            activeSubFilter: null,
            highlightedType: null,
            activeStepFiles: new Set(),
            upstreamNodes: new Set(['src/upstream.ts']),
            downstreamNodes: new Set(),
            circularNodes: undefined,
            selectionCircularNodes: new Set(),
            deadCodeFileSet: new Set(['src/dead.ts']),
            showCouplingEdges: true,
            showFlowEdges: true,
            flowPairKeys: new Set(),
            nodeTypeMap: new Map(),
        });

        const nodeState = reducers.nodeReducer('src/dead.ts', {
            nodeType: 'service',
            label: 'src/dead.ts',
            color: '#22c55e',
            size: 10,
            originalSize: 10,
        });

        expect(nodeState).toEqual(expect.objectContaining({
            color: DEAD_CODE_COLOR,
            size: 10 * DEAD_CODE_SIZE_MULTIPLIER,
        }));
    });
});