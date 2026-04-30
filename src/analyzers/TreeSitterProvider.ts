import * as path from 'path';
import * as webTreeSitter from 'web-tree-sitter';
import { ImportEdge, SymbolInfo, SymbolEdge } from '../types';
import { getWasmDirectory } from '../utils/wasmLocator';
import {
    AnalysisProvider,
    ImportAnalysisOptions,
    ImportAnalysisResult,
} from './AnalysisProvider';
import { resolveGoImports } from './goImportResolver';
import { extractSymbols, traceSymbolEdges } from './symbolExtractor';
import { detectCycles, resolveJsImport, resolvePythonImport } from './utils';

export type SupportedLang = 'javascript' | 'typescript' | 'tsx' | 'python' | 'go';

const RESPONSIVENESS_YIELD_INTERVAL = 20;
const IMPORT_PROGRESS_INTERVAL = 25;

const EXT_TO_LANG: Record<string, SupportedLang> = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
};

/** Tree-sitter backed analyzer/provider for imports, symbols, and file facts. */
export class TreeSitterProvider implements AnalysisProvider {
    private parser: webTreeSitter.Parser | null = null;
    private languages: Record<string, webTreeSitter.Language> = {};
    private initPromise: Promise<void> | null = null;

    /**
     * @param languageHint - Optional set of language keys to load (e.g. `new Set(['typescript', 'tsx'])`).
     *   When provided only the listed grammars are loaded into WASM memory, saving up to 3.1 MB
     *   in single-language repos. Defaults to loading all four supported grammars.
     */
    constructor(private languageHint?: Set<SupportedLang>) {}

    /**
     * Override the language hint before the first analysis call.
     * Has no effect once WASM init has started.
     */
    setLanguageHint(langs: Set<SupportedLang>): void {
        if (!this.initPromise) {
            this.languageHint = langs;
        }
    }

    private async init() {
        if (this.parser) return;
        if (this.initPromise) return this.initPromise;
        this.initPromise = this._doInit();
        return this.initPromise;
    }

    private async _doInit() {
        const initStart = performance.now();

        const allLangs: SupportedLang[] = ['javascript', 'typescript', 'tsx', 'python', 'go'];
        const langsToLoad = this.languageHint
            ? allLangs.filter((l) => this.languageHint!.has(l))
            : allLangs;

        const wasmDir = getWasmDirectory([
            'tree-sitter-javascript.wasm',
            'tree-sitter-typescript.wasm',
            'tree-sitter-tsx.wasm',
            'tree-sitter-python.wasm',
            'tree-sitter-go.wasm',
        ]);

        await webTreeSitter.Parser.init({
            locateFile: (scriptName: string) => {
                return path.join(wasmDir, scriptName);
            },
        });

        this.parser = new webTreeSitter.Parser();

        const loadedPairs = await Promise.all(
            langsToLoad.map(async (lang) => {
                const grammar = await webTreeSitter.Language.load(
                    path.join(wasmDir, `tree-sitter-${lang}.wasm`)
                );
                return [lang, grammar] as const;
            })
        );
        for (const [lang, grammar] of loadedPairs) {
            this.languages[lang] = grammar;
        }

        const initMs = performance.now() - initStart;
        console.error(`[RepoNav][perf][TreeSitter] init: ${initMs.toFixed(1)}ms, languages: ${Object.keys(this.languages).join(', ')}`);
    }

    async analyzeImports(
        workspaceRoot: string,
        files: Map<string, string>,
        options?: ImportAnalysisOptions
    ): Promise<ImportAnalysisResult> {
        const totalFiles = files.size;
        options?.onProgress?.({
            phase: 'initializing',
            processed: 0,
            total: totalFiles,
            message: 'Initializing Tree-sitter...',
        });
        await this.init();
        if (!this.parser) throw new Error('TreeSitter parser failed to initialize');
        options?.onProgress?.({
            phase: 'initializing',
            processed: 0,
            total: totalFiles,
            message: 'Tree-sitter ready',
        });

        const allFilePaths = new Set(files.keys());
        const edges: ImportEdge[] = [];
        const externalDeps = new Set<string>();
        let processed = 0;

        for (const [filePath, content] of files) {
            // Yield periodically so the extension host stays responsive and timers can fire.
            if (processed > 0 && processed % RESPONSIVENESS_YIELD_INTERVAL === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
            processed += 1;
            if (processed === 1 || processed === totalFiles || processed % IMPORT_PROGRESS_INTERVAL === 0) {
                options?.onProgress?.({
                    phase: 'parsing',
                    processed,
                    total: totalFiles,
                    message: `Analyzing dependencies (${processed}/${totalFiles} files)...`,
                });
            }

            const ext = path.extname(filePath);
            const langKey = EXT_TO_LANG[ext];

            if (!langKey || !this.languages[langKey]) continue;

            this.parser.setLanguage(this.languages[langKey]);
            const tree = this.parser.parse(content);

            if (!tree) continue;

            try {
                if (langKey === 'python') {
                    this.findPythonImports(tree.rootNode, filePath, allFilePaths, workspaceRoot, edges, externalDeps);
                } else if (langKey === 'go') {
                    this.findGoImports(tree.rootNode, filePath, workspaceRoot, edges, externalDeps);
                } else {
                    this.findJsImports(tree.rootNode, filePath, allFilePaths, workspaceRoot, edges, externalDeps);
                }
            } finally {
                tree.delete();
            }
        }

        return {
            edges,
            externalDependencies: externalDeps,
            circularDependencies: detectCycles(edges),
        };
    }

    private findJsImports(
        node: webTreeSitter.Node,
        filePath: string,
        allFiles: Set<string>,
        workspaceRoot: string,
        edges: ImportEdge[],
        externalDeps: Set<string>
    ) {
        if (node.type === 'import_statement') {
            const sourceNode = node.namedChildren.find((n: webTreeSitter.Node) => n.type === 'string');
            if (sourceNode) {
                const moduleSpecifier = sourceNode.text.replace(/['"]/g, '');
                this.addJsEdge(filePath, moduleSpecifier, node.text, false, allFiles, workspaceRoot, edges, externalDeps);
            }
        } else if (node.type === 'export_statement') {
            const sourceNode = node.namedChildren.find((n: webTreeSitter.Node) => n.type === 'string');
            if (sourceNode) {
                const moduleSpecifier = sourceNode.text.replace(/['"]/g, '');
                this.addJsEdge(filePath, moduleSpecifier, node.text, false, allFiles, workspaceRoot, edges, externalDeps);
            }
        } else if (node.type === 'call_expression') {
            const funcNode = node.childForFieldName('function');
            const argsNode = node.childForFieldName('arguments');

            if (funcNode && argsNode && argsNode.namedChildren.length > 0) {
                if (funcNode.type === 'import' || (funcNode.type === 'identifier' && funcNode.text === 'require')) {
                    const arg = argsNode.namedChildren[0];
                    if (arg && arg.type === 'string') {
                        const moduleSpecifier = arg.text.replace(/['"]/g, '');
                        this.addJsEdge(filePath, moduleSpecifier, node.text, funcNode.type === 'import', allFiles, workspaceRoot, edges, externalDeps);
                    }
                }
            }
        }

        for (const child of node.children) {
            this.findJsImports(child, filePath, allFiles, workspaceRoot, edges, externalDeps);
        }
    }

    /**
     * Extract Python imports from AST.
     *
     * Python tree-sitter node types:
     * - import_statement: `import os`, `import os, sys`
     * - import_from_statement: `from fastapi import FastAPI`
     */
    private findPythonImports(
        node: webTreeSitter.Node,
        filePath: string,
        allFiles: Set<string>,
        workspaceRoot: string,
        edges: ImportEdge[],
        externalDeps: Set<string>
    ) {
        if (node.type === 'import_statement') {
            // `import X` or `import X, Y`
            for (const child of node.namedChildren) {
                if (child.type === 'dotted_name' || child.type === 'aliased_import') {
                    const modName = child.type === 'aliased_import'
                        ? child.namedChildren.find((n: webTreeSitter.Node) => n.type === 'dotted_name')?.text
                        : child.text;
                    if (modName) {
                        this.addPythonEdge(filePath, modName, node.text, [], allFiles, workspaceRoot, edges, externalDeps);
                    }
                }
            }
        } else if (node.type === 'import_from_statement') {
            // `from X import Y, Z`
            const moduleNode = node.childForFieldName('module_name')
                ?? node.namedChildren.find((n: webTreeSitter.Node) => n.type === 'dotted_name' || n.type === 'relative_import');
            if (moduleNode) {
                const modName = moduleNode.text;
                const specifiers: string[] = [];
                for (const child of node.namedChildren) {
                    if (child.type === 'dotted_name' && child !== moduleNode) {
                        specifiers.push(child.text);
                    } else if (child.type === 'aliased_import') {
                        const name = child.namedChildren.find((n: webTreeSitter.Node) => n.type === 'dotted_name');
                        if (name) specifiers.push(name.text);
                    }
                }
                this.addPythonEdge(filePath, modName, node.text, specifiers, allFiles, workspaceRoot, edges, externalDeps);
            }
        }

        for (const child of node.children) {
            this.findPythonImports(child, filePath, allFiles, workspaceRoot, edges, externalDeps);
        }
    }

    private addJsEdge(
        sourcePath: string,
        moduleSpecifier: string,
        rawStatement: string,
        isDynamic: boolean,
        allFiles: Set<string>,
        workspaceRoot: string,
        edges: ImportEdge[],
        externalDeps: Set<string>
    ) {
        const resolved = resolveJsImport(moduleSpecifier, sourcePath, allFiles, workspaceRoot);

        if (resolved) {
            edges.push({
                source: sourcePath,
                target: resolved,
                specifiers: [],
                isDynamic,
                rawStatement,
            });
        } else if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
            const pkgName = moduleSpecifier.startsWith('@')
                ? moduleSpecifier.split('/').slice(0, 2).join('/')
                : moduleSpecifier.split('/')[0];
            externalDeps.add(pkgName);
            // Emit edge with bare package name as target so boundary role classifier
            // can annotate source files with their external API boundary categories.
            edges.push({
                source: sourcePath,
                target: pkgName,
                specifiers: [],
                isDynamic,
                rawStatement,
            });
        }
    }

    private addPythonEdge(
        sourcePath: string,
        moduleSpecifier: string,
        rawStatement: string,
        specifiers: string[],
        allFiles: Set<string>,
        workspaceRoot: string,
        edges: ImportEdge[],
        externalDeps: Set<string>
    ) {
        const resolved = resolvePythonImport(moduleSpecifier, sourcePath, allFiles, workspaceRoot);

        if (resolved) {
            edges.push({
                source: sourcePath,
                target: resolved,
                specifiers,
                isDynamic: false,
                rawStatement,
            });
        } else {
            // Top-level module name as external dep
            const topLevel = moduleSpecifier.split('.')[0];
            if (topLevel) externalDeps.add(topLevel);
        }
    }

    /**
     * Extract Go imports from AST.
     *
     * Go tree-sitter node types:
     * - import_declaration → import_spec_list → import_spec (path: interpreted_string_literal)
     * - single import: import_declaration → import_spec (path: interpreted_string_literal)
     */
    private findGoImports(
        node: webTreeSitter.Node,
        filePath: string,
        workspaceRoot: string,
        edges: ImportEdge[],
        externalDeps: Set<string>
    ) {
        // Collect all import path strings from this file
        const importPaths: string[] = [];
        this._collectGoImportPaths(node, importPaths);
        if (importPaths.length === 0) return;

        const resolved = resolveGoImports(filePath, workspaceRoot, importPaths, null);
        for (const edge of resolved) {
            if (edge.target.startsWith('external:')) {
                externalDeps.add(edge.target.slice('external:'.length).split('/')[0]);
            } else if (!edge.target.startsWith('stdlib:')) {
                edges.push(edge);
            }
        }
    }

    /** Recursively collect string values of all import_spec path nodes. */
    private _collectGoImportPaths(node: webTreeSitter.Node, acc: string[]) {
        if (node.type === 'import_spec') {
            const pathNode = node.namedChildren.find(
                (n: webTreeSitter.Node) => n.type === 'interpreted_string_literal'
            );
            if (pathNode) {
                acc.push(pathNode.text.replace(/"/g, ''));
            }
        }
        for (const child of node.children) {
            this._collectGoImportPaths(child, acc);
        }
    }

    // ─── Symbol Analysis (v1.3) ──────────────────────────────────────────

    /**
     * Extract symbols and trace cross-file edges from all workspace files.
     * Reuses the same parser/languages from init().
     */
    async analyzeSymbols(
        workspaceRoot: string,
        files: Map<string, string>,
        importEdges: ImportEdge[],
        options?: ImportAnalysisOptions
    ): Promise<{ symbols: SymbolInfo[]; edges: SymbolEdge[] }> {
        await this.init();
        if (!this.parser) throw new Error('TreeSitter parser failed to initialize');

        const allSymbols: SymbolInfo[] = [];
        let processed = 0;
        const totalFiles = files.size;

        // Pass 1: extract symbols from all files
        for (const [filePath, content] of files) {
            if (processed > 0 && processed % RESPONSIVENESS_YIELD_INTERVAL === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
            processed++;

            const ext = path.extname(filePath);
            const langKey = EXT_TO_LANG[ext];
            if (!langKey || !this.languages[langKey]) continue;

            this.parser.setLanguage(this.languages[langKey]);
            const tree = this.parser.parse(content);
            if (!tree) continue;

            try {
                allSymbols.push(...extractSymbols(tree, filePath, langKey));
            } finally {
                tree.delete();
            }
        }

        // Build symbol index for edge tracing
        const symbolIndex = new Map<string, SymbolInfo[]>();
        for (const sym of allSymbols) {
            const existing = symbolIndex.get(sym.name) ?? [];
            existing.push(sym);
            symbolIndex.set(sym.name, existing);
        }

        // Pass 2: trace cross-file edges
        const allEdges: SymbolEdge[] = [];
        for (const [filePath, content] of files) {
            const ext = path.extname(filePath);
            const langKey = EXT_TO_LANG[ext];
            if (!langKey || !this.languages[langKey]) continue;

            this.parser.setLanguage(this.languages[langKey]);
            const tree = this.parser.parse(content);
            if (!tree) continue;

            try {
                allEdges.push(...traceSymbolEdges(tree, filePath, langKey, symbolIndex, importEdges));
            } finally {
                tree.delete();
            }
        }

        return { symbols: allSymbols, edges: allEdges };
    }
}
