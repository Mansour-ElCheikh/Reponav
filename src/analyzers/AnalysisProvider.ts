import { ImportEdge } from '../types';

export interface ImportAnalysisResult {
    edges: ImportEdge[];
    externalDependencies: Set<string>;
    circularDependencies: string[][];
}

export interface ImportAnalysisProgress {
    phase: 'initializing' | 'parsing';
    processed: number;
    total: number;
    message: string;
}

export interface ImportAnalysisOptions {
    onProgress?: (progress: ImportAnalysisProgress) => void;
}

export interface AnalysisProvider {
    /**
     * Analyze imports for a given set of files to build a dependency graph.
     * @param workspaceRoot The root of the workspace.
     * @param files A map of file paths to their contents.
     */
    analyzeImports(
        workspaceRoot: string,
        files: Map<string, string>,
        options?: ImportAnalysisOptions
    ): Promise<ImportAnalysisResult>;
}
