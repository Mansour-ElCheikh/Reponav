import { Tour } from '../types';
import { LLMProvider, LLMResponse, FinishReason } from './LLMProvider';

const MOCK_TOUR: Tour & { isMock: boolean } = {
    isMock: true,
    id: "mock-" + Date.now().toString(),
    query: "Mock Architecture Tour",
    tourType: "overview",
    createdAt: new Date().toISOString(),
    analysisSnapshot: {
        frameworks: ["React", "TypeScript", "Node.js"],
        entryPoints: ["src/extension.ts"],
        totalFiles: 45,
        totalEdges: 120,
        circularCount: 0,
    },
    steps: [
        {
            order: 1,
            title: "Database Layer — RepoDatabase",
            what_it_does: "The application uses SQLite to cache generated tours, retrieval chunks, and supporting repository metadata on disk. The RepoDatabase class manages connections, schema migrations, and provides typed query methods for tour persistence and BM25 full-text search.",
            why_it_matters: "All persistent state is stored locally, which solves the slow initial loading problem and means your tours are saved across sessions. Without this layer, every tour generation would require a fresh LLM call.",
            watch_out: "Ensure you close the database connection when the extension deactivates. WASM compilation for sql.js takes 300-500ms on first open — subsequent opens reuse the compiled module.",
            files: ["src/db/RepoDatabase.ts"],
            highlights: [{ file: "src/db/RepoDatabase.ts", lines: [10, 20] }],
            relationships: []
        },
        {
            order: 2,
            title: "Analysis Providers — TreeSitterProvider",
            what_it_does: "TreeSitterProvider uses Tree-sitter WASM bindings to parse source files into ASTs, accurately extracting imports, exported symbols, and their source locations. It implements the AnalysisProvider interface, allowing swappable analysis backends.",
            why_it_matters: "AST-based analysis is much more accurate than regex for resolving path aliases, destructured imports, and re-exports. It forms the foundation of the high-fidelity dependency graph that makes tours grounded in real data.",
            watch_out: "WASM loading in VS Code extension bundles requires careful esbuild configuration — the .wasm files must be copied to the dist folder and loaded with the correct path resolution.",
            files: ["src/analyzers/TreeSitterProvider.ts", "src/analyzers/AnalysisProvider.ts"],
            highlights: [{ file: "src/analyzers/TreeSitterProvider.ts", lines: [32, 45] }],
            relationships: [{ from: "src/analyzers/TreeSitterProvider.ts", to: "src/analyzers/AnalysisProvider.ts", type: 'implements' }]
        },
        {
            order: 3,
            title: "Webview UI — WebviewProvider bridge",
            what_it_does: "The WebviewProvider creates and manages the VS Code WebView panel. It renders the architecture graph using React and Sigma.js for force-directed graph layout, receiving structured tour data from the extension host via postMessage.",
            why_it_matters: "This is the boundary between the VS Code extension host and the React UI. All communication flows through a typed postMessage protocol defined in shared/types.ts, keeping the UI completely decoupled from VS Code extension internals.",
            watch_out: "The Content Security Policy in getWebviewContent() only allows scripts with a nonce. The React bundle must be compiled separately from the extension host into dist/webview/.",
            files: ["src/webview/webviewProvider.ts"],
            highlights: [],
            relationships: []
        }
    ],
    graph: {
        nodes: [
            { id: "src/db/RepoDatabase.ts", label: "RepoDatabase.ts", type: "unknown", weight: 5 },
            { id: "src/analyzers/TreeSitterProvider.ts", label: "TreeSitterProvider.ts", type: "unknown", weight: 3 },
            { id: "src/analyzers/AnalysisProvider.ts", label: "AnalysisProvider.ts", type: "unknown", weight: 2 },
            { id: "src/webview/webviewProvider.ts", label: "webviewProvider.ts", type: "unknown", weight: 4 }
        ],
        edges: [
            { source: "src/analyzers/TreeSitterProvider.ts", target: "src/analyzers/AnalysisProvider.ts", label: "implements" }
        ]
    }
};

/** Fast local mock provider used in tests and no-key development flows. */
export class MockProvider implements LLMProvider {
    readonly name = 'Mock Provider (Instant)';

    isConfigured(): boolean {
        return true;
    }

    async generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
        // Simulate a tiny bit of network delay for realism (500ms)
        await new Promise(resolve => setTimeout(resolve, 500));

        return {
            text: JSON.stringify(MOCK_TOUR, null, 2),
            finishReason: 'stop',
            usage: {
                promptTokens: 100,
                completionTokens: 250,
                totalTokens: 350
            }
        };
    }

    async *generateStream(
        systemPrompt: string,
        userPrompt: string
    ): AsyncGenerator<string, void, unknown> {
        // Stream the JSON string in chunks
        const text = JSON.stringify(MOCK_TOUR, null, 2);
        const chunks = text.match(/.{1,10}/g) || [];

        for (const chunk of chunks) {
            await new Promise(resolve => setTimeout(resolve, 50));
            yield chunk;
        }
    }
}
