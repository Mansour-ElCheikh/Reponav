/**
 * WorkspaceAdapter Interface
 *
 * Thin boundary between VS Code host APIs and business logic.
 * Core files (tourGenerator, analyzers) depend ONLY on this interface,
 * making them unit-testable outside of the VS Code extension host.
 */

/** Progress reporter — matches the shape of vscode.Progress without importing it. */
export interface ProgressReporter {
    report(value: { message?: string; increment?: number }): void;
}

export interface WorkspaceAdapter {
    /** Return the absolute path to the workspace root, or null if none is open. */
    getWorkspaceRoot(): string | null;

    /** Read a VS Code configuration value. */
    getConfig<T>(section: string, key: string, defaultValue: T): T;

    /** Read a file's content as UTF-8. Returns null if the file doesn't exist. */
    readFile(absolutePath: string): Promise<string | null>;

    /**
     * Find files in the workspace matching include/exclude patterns.
     * Returns workspace-relative paths.
     */
    findFiles(
        includePattern: string,
        excludePattern: string,
        maxResults: number
    ): Promise<string[]>;

    /** Show an informational message to the user. */
    showInfo(message: string): void;

    /** Show an error message to the user. */
    showError(message: string): void;
}
