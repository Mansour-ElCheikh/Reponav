/**
 * VS Code Workspace Adapter
 *
 * Concrete implementation of WorkspaceAdapter backed by the real VS Code API.
 * This is the ONLY place in the project that imports `vscode` for workspace
 * configuration and file operations used by business-logic code.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { SymbolEnricher } from './analyzers/symbolEnrichment';
import type { SymbolInfo, SymbolKind } from './types';
import { WorkspaceAdapter } from './WorkspaceAdapter';

/** VS Code-backed workspace adapter used by pure business logic via WorkspaceAdapter. */
export class VSCodeWorkspaceAdapter implements WorkspaceAdapter {
    getWorkspaceRoot(): string | null {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
    }

    getConfig<T>(section: string, key: string, defaultValue: T): T {
        return vscode.workspace.getConfiguration(section).get<T>(key, defaultValue);
    }

    async readFile(absolutePath: string): Promise<string | null> {
        try {
            return await fs.readFile(absolutePath, 'utf8');
        } catch {
            return null;
        }
    }

    async findFiles(
        includePattern: string,
        excludePattern: string,
        maxResults: number
    ): Promise<string[]> {
        const root = this.getWorkspaceRoot();
        if (!root) return [];

        const rootUri = vscode.Uri.file(root);
        const pattern = new vscode.RelativePattern(rootUri, includePattern);
        const uris = await vscode.workspace.findFiles(pattern, excludePattern, maxResults);

        return uris.map((uri) => path.relative(root, uri.fsPath));
    }

    showInfo(message: string): void {
        vscode.window.showInformationMessage(message);
    }

    showError(message: string): void {
        vscode.window.showErrorMessage(message);
    }
}

/** VS Code-backed symbol enricher that overlays document-symbol metadata after deterministic Tier 2. */
export class VSCodeDocumentSymbolEnricher implements SymbolEnricher {
    constructor(private readonly workspace: WorkspaceAdapter) {}

    async enrichDocumentSymbols(relativePath: string, _content: string): Promise<SymbolInfo[]> {
        const root = this.getWorkspaceRoot();
        if (!root) return [];

        const absolutePath = path.join(root, relativePath);
        const uri = vscode.Uri.file(absolutePath);

        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );

            if (!symbols || symbols.length === 0) {
                return [];
            }

            return flattenDocumentSymbols(symbols, relativePath);
        } catch {
            return [];
        }
    }

    private getWorkspaceRoot(): string | null {
        return this.workspace.getWorkspaceRoot();
    }
}

function flattenDocumentSymbols(
    symbols: vscode.DocumentSymbol[],
    filePath: string,
    parentSymbol?: string,
    result: SymbolInfo[] = []
): SymbolInfo[] {
    for (const symbol of symbols) {
        const kind = mapDocumentSymbolKind(symbol.kind);
        const currentParent = parentSymbol;

        if (kind) {
            result.push({
                name: symbol.name,
                kind,
                filePath,
                lineStart: symbol.range.start.line,
                lineEnd: symbol.range.end.line,
                signature: symbol.detail || undefined,
                isExported: false,
                isEntryPoint: false,
                parentSymbol: currentParent,
            });
        }

        if (symbol.children.length > 0) {
            flattenDocumentSymbols(
                symbol.children,
                filePath,
                kind === 'class' || kind === 'interface' ? symbol.name : currentParent,
                result
            );
        }
    }

    return result;
}

function mapDocumentSymbolKind(kind: vscode.SymbolKind): SymbolKind | null {
    switch (kind) {
        case vscode.SymbolKind.Function:
            return 'function';
        case vscode.SymbolKind.Method:
        case vscode.SymbolKind.Constructor:
            return 'method';
        case vscode.SymbolKind.Class:
            return 'class';
        case vscode.SymbolKind.Interface:
            return 'interface';
        case vscode.SymbolKind.Enum:
            return 'enum';
        case vscode.SymbolKind.Constant:
        case vscode.SymbolKind.Variable:
        case vscode.SymbolKind.Property:
            return 'constant';
        default:
            return null;
    }
}
