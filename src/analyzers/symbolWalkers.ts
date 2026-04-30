/**
 * Symbol Walkers
 *
 * Language-walker implementations extracted from symbolExtractor.ts.
 * Contains all private walker functions for JS/TS, Python, and future languages.
 * symbolExtractor.ts delegates to these; this file has NO vscode imports.
 *
 * NO vscode imports. Fully testable outside VS Code.
 */

import type * as webTreeSitter from 'web-tree-sitter';
import type { SymbolInfo, SymbolEdge, SymbolKind, ImportEdge } from '../types';

/** Languages supported by the walker dispatch layer. */
export type SupportedLang = 'javascript' | 'typescript' | 'tsx' | 'python' | 'go';

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/** Check if a node is wrapped in an export_statement. */
export function isExported(node: webTreeSitter.Node): boolean {
    return node.parent?.type === 'export_statement';
}

/** Get the text of a named field child. */
export function getNameField(node: webTreeSitter.Node, fieldName: string): string | null {
    const child = node.childForFieldName(fieldName);
    return child?.text ?? null;
}

// ─── JS/TS Walker ────────────────────────────────────────────────────────────

/** Walk JS/TS AST and collect symbols into the provided array. */
export function walkJsTsSymbols(
    node: webTreeSitter.Node,
    filePath: string,
    symbols: SymbolInfo[],
    parentClass: string | undefined
): void {
    switch (node.type) {
        case 'function_declaration': {
            const name = getNameField(node, 'name');
            if (name) {
                symbols.push({
                    name,
                    kind: 'function',
                    filePath,
                    lineStart: node.startPosition.row,
                    lineEnd: node.endPosition.row,
                    isExported: isExported(node),
                    isEntryPoint: false,
                });
            }
            break;
        }

        case 'class_declaration': {
            const name = getNameField(node, 'name');
            if (name) {
                symbols.push({
                    name,
                    kind: 'class',
                    filePath,
                    lineStart: node.startPosition.row,
                    lineEnd: node.endPosition.row,
                    isExported: isExported(node),
                    isEntryPoint: false,
                });
                const body = node.childForFieldName('body');
                if (body) {
                    for (const child of body.namedChildren) {
                        walkJsTsSymbols(child, filePath, symbols, name);
                    }
                }
            }
            return;
        }

        case 'method_definition': {
            const name = getNameField(node, 'name');
            if (name && parentClass) {
                symbols.push({
                    name,
                    kind: 'method',
                    filePath,
                    lineStart: node.startPosition.row,
                    lineEnd: node.endPosition.row,
                    isExported: false,
                    isEntryPoint: false,
                    parentSymbol: parentClass,
                });
            }
            break;
        }

        case 'interface_declaration': {
            const name = getNameField(node, 'name');
            if (name) {
                symbols.push({
                    name,
                    kind: 'interface',
                    filePath,
                    lineStart: node.startPosition.row,
                    lineEnd: node.endPosition.row,
                    isExported: isExported(node),
                    isEntryPoint: false,
                });
            }
            break;
        }

        case 'type_alias_declaration': {
            const name = getNameField(node, 'name');
            if (name) {
                symbols.push({
                    name,
                    kind: 'type_alias',
                    filePath,
                    lineStart: node.startPosition.row,
                    lineEnd: node.endPosition.row,
                    isExported: isExported(node),
                    isEntryPoint: false,
                });
            }
            break;
        }

        case 'enum_declaration': {
            const name = getNameField(node, 'name');
            if (name) {
                symbols.push({
                    name,
                    kind: 'enum',
                    filePath,
                    lineStart: node.startPosition.row,
                    lineEnd: node.endPosition.row,
                    isExported: isExported(node),
                    isEntryPoint: false,
                });
            }
            break;
        }

        case 'lexical_declaration': {
            if (!isExported(node)) break;
            for (const declarator of node.namedChildren) {
                if (declarator.type === 'variable_declarator') {
                    const name = getNameField(declarator, 'name');
                    if (!name) continue;
                    const value = declarator.childForFieldName('value');
                    const isArrow = value?.type === 'arrow_function';
                    const isFunc = value?.type === 'function_expression' || value?.type === 'function';
                    symbols.push({
                        name,
                        kind: isArrow || isFunc ? 'function' : 'constant',
                        filePath,
                        lineStart: node.startPosition.row,
                        lineEnd: node.endPosition.row,
                        isExported: true,
                        isEntryPoint: false,
                    });
                }
            }
            break;
        }

        case 'export_statement': {
            for (const child of node.namedChildren) {
                walkJsTsSymbols(child, filePath, symbols, parentClass);
            }
            return;
        }
    }

    if (node.type !== 'class_declaration' && node.type !== 'export_statement') {
        for (const child of node.namedChildren) {
            walkJsTsSymbols(child, filePath, symbols, parentClass);
        }
    }
}

// ─── Python Walker ───────────────────────────────────────────────────────────

/** Walk Python AST and collect symbols into the provided array. */
export function walkPythonSymbols(
    node: webTreeSitter.Node,
    filePath: string,
    symbols: SymbolInfo[],
    parentClass: string | undefined
): void {
    if (node.type === 'function_definition') {
        const name = getNameField(node, 'name');
        if (name) {
            symbols.push({
                name,
                kind: parentClass ? 'method' : 'function',
                filePath,
                lineStart: node.startPosition.row,
                lineEnd: node.endPosition.row,
                isExported: !name.startsWith('_') && !parentClass,
                isEntryPoint: false,
                parentSymbol: parentClass,
            });
        }
        return;
    }

    if (node.type === 'class_definition') {
        const name = getNameField(node, 'name');
        if (name) {
            symbols.push({
                name,
                kind: 'class',
                filePath,
                lineStart: node.startPosition.row,
                lineEnd: node.endPosition.row,
                isExported: !name.startsWith('_'),
                isEntryPoint: false,
            });
            const body = node.childForFieldName('body');
            if (body) {
                for (const child of body.namedChildren) {
                    walkPythonSymbols(child, filePath, symbols, name);
                }
            }
        }
        return;
    }

    for (const child of node.namedChildren) {
        walkPythonSymbols(child, filePath, symbols, parentClass);
    }
}

// ─── Symbol Resolver ─────────────────────────────────────────────────────────

/** Resolve a symbol name to a SymbolInfo entry from another file. */
export function resolveSymbol(
    name: string,
    importedFrom: Map<string, string>,
    symbolIndex: Map<string, SymbolInfo[]>,
    currentFile: string
): SymbolInfo | null {
    const candidates = symbolIndex.get(name);
    if (!candidates || candidates.length === 0) return null;

    const importSource = importedFrom.get(name);
    if (importSource) {
        const match = candidates.find(c => c.filePath === importSource);
        if (match) return match;
    }

    const crossFile = candidates.filter(c => c.filePath !== currentFile);
    return crossFile.length > 0 ? crossFile[0] : null;
}

// ─── JS/TS Edge Walker ───────────────────────────────────────────────────────

/** Trace JS/TS edges: call_expression, extends clause, implements clause. */
export function traceJsTsEdges(
    node: webTreeSitter.Node,
    filePath: string,
    symbolIndex: Map<string, SymbolInfo[]>,
    importedFrom: Map<string, string>,
    edges: SymbolEdge[]
): void {
    if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');
        if (funcNode) {
            const callName = funcNode.type === 'member_expression'
                ? funcNode.childForFieldName('property')?.text
                : funcNode.type === 'identifier'
                    ? funcNode.text
                    : null;

            if (callName) {
                const target = resolveSymbol(callName, importedFrom, symbolIndex, filePath);
                if (target) {
                    const sourceName = findEnclosingSymbolName(node) ?? '<module>';
                    edges.push({
                        sourceFile: filePath,
                        sourceName,
                        targetFile: target.filePath,
                        targetName: target.name,
                        edgeType: 'calls',
                        lineNumber: node.startPosition.row,
                    });
                }
            }
        }
    }

    if (node.type === 'class_declaration') {
        const className = node.childForFieldName('name')?.text;
        const heritage = node.namedChildren.find(c => c.type === 'class_heritage');
        if (heritage && className) {
            const extendsClause = heritage.namedChildren.find(c => c.type === 'extends_clause');
            if (extendsClause) {
                const superName = extendsClause.namedChildren[0]?.text;
                if (superName) {
                    const target = resolveSymbol(superName, importedFrom, symbolIndex, filePath);
                    if (target) {
                        edges.push({
                            sourceFile: filePath,
                            sourceName: className,
                            targetFile: target.filePath,
                            targetName: target.name,
                            edgeType: 'extends',
                            lineNumber: node.startPosition.row,
                        });
                    }
                }
            }

            const implementsClause = heritage.namedChildren.find(c => c.type === 'implements_clause');
            if (implementsClause) {
                for (const typeNode of implementsClause.namedChildren) {
                    const ifaceName = typeNode.text;
                    const target = resolveSymbol(ifaceName, importedFrom, symbolIndex, filePath);
                    if (target) {
                        edges.push({
                            sourceFile: filePath,
                            sourceName: className,
                            targetFile: target.filePath,
                            targetName: target.name,
                            edgeType: 'implements',
                            lineNumber: node.startPosition.row,
                        });
                    }
                }
            }
        }
    }

    for (const child of node.namedChildren) {
        traceJsTsEdges(child, filePath, symbolIndex, importedFrom, edges);
    }
}

// ─── Python Edge Walker ──────────────────────────────────────────────────────

/** Trace Python edges: call expressions. */
export function tracePythonEdges(
    node: webTreeSitter.Node,
    filePath: string,
    symbolIndex: Map<string, SymbolInfo[]>,
    importedFrom: Map<string, string>,
    edges: SymbolEdge[]
): void {
    if (node.type === 'call') {
        const funcNode = node.childForFieldName('function');
        if (funcNode) {
            const callName = funcNode.type === 'attribute'
                ? funcNode.childForFieldName('attribute')?.text
                : funcNode.type === 'identifier'
                    ? funcNode.text
                    : null;

            if (callName) {
                const target = resolveSymbol(callName, importedFrom, symbolIndex, filePath);
                if (target) {
                    const sourceName = findEnclosingSymbolName(node) ?? '<module>';
                    edges.push({
                        sourceFile: filePath,
                        sourceName,
                        targetFile: target.filePath,
                        targetName: target.name,
                        edgeType: 'calls',
                        lineNumber: node.startPosition.row,
                    });
                }
            }
        }
    }

    for (const child of node.namedChildren) {
        tracePythonEdges(child, filePath, symbolIndex, importedFrom, edges);
    }
}

// ─── AST Traversal Helper ────────────────────────────────────────────────────

/**
 * Walk up the AST to find the nearest enclosing function or method name.
 * Returns null when the call site is at module level.
 */
export function findEnclosingSymbolName(node: webTreeSitter.Node): string | null {
    let current = node.parent;
    while (current) {
        if (
            current.type === 'function_declaration' ||
            current.type === 'method_definition' ||
            current.type === 'function_definition'
        ) {
            return current.childForFieldName('name')?.text ?? null;
        }
        if (current.type === 'variable_declarator') {
            return current.childForFieldName('name')?.text ?? null;
        }
        current = current.parent;
    }
    return null;
}

// ─── Go Walker ───────────────────────────────────────────────────────────────

/** Returns true if a Go identifier starts with an uppercase letter (exported). */
function isGoExported(name: string): boolean {
    return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
}

/**
 * Walk Go AST and collect symbols: functions, methods, structs, interfaces.
 *
 * Go node types (tree-sitter-go):
 *   function_declaration  → top-level function
 *   method_declaration    → method with receiver; field_identifier = name
 *   type_declaration > type_spec → struct_type (class) or interface_type (interface)
 */
export function walkGoSymbols(
    node: webTreeSitter.Node,
    filePath: string,
    symbols: SymbolInfo[]
): void {
    if (node.type === 'function_declaration') {
        const name = node.childForFieldName('name')?.text;
        if (name) {
            symbols.push({
                name,
                kind: 'function',
                filePath,
                lineStart: node.startPosition.row,
                lineEnd: node.endPosition.row,
                isExported: isGoExported(name),
                isEntryPoint: false,
            });
        }
    }

    if (node.type === 'method_declaration') {
        // name is a field_identifier child (not a named field)
        const nameNode = node.namedChildren.find(c => c.type === 'field_identifier');
        const name = nameNode?.text;
        // receiver type: first parameter_list → parameter_declaration → type_identifier
        const receiverList = node.namedChildren.find(c => c.type === 'parameter_list');
        const receiverDecl = receiverList?.namedChildren.find(c => c.type === 'parameter_declaration');
        const receiverType = receiverDecl?.namedChildren.find(
            c => c.type === 'type_identifier' || c.type === 'pointer_type'
        );
        const parentName = receiverType?.type === 'pointer_type'
            ? receiverType.namedChildren.find(c => c.type === 'type_identifier')?.text
            : receiverType?.text;
        if (name) {
            symbols.push({
                name,
                kind: 'method',
                filePath,
                lineStart: node.startPosition.row,
                lineEnd: node.endPosition.row,
                isExported: isGoExported(name),
                isEntryPoint: false,
                parentSymbol: parentName,
            });
        }
    }

    if (node.type === 'type_declaration') {
        for (const typeSpec of node.namedChildren) {
            if (typeSpec.type !== 'type_spec') continue;
            const name = typeSpec.childForFieldName('name')?.text;
            if (!name) continue;
            const body = typeSpec.namedChildren.find(
                c => c.type === 'struct_type' || c.type === 'interface_type'
            );
            if (!body) continue;
            symbols.push({
                name,
                kind: body.type === 'interface_type' ? 'interface' : 'class',
                filePath,
                lineStart: node.startPosition.row,
                lineEnd: node.endPosition.row,
                isExported: isGoExported(name),
                isEntryPoint: false,
            });
        }
    }

    for (const child of node.namedChildren) {
        walkGoSymbols(child, filePath, symbols);
    }
}

// ─── Go Edge Walker ──────────────────────────────────────────────────────────

/**
 * Trace Go edges: call expressions (CALLS) and struct embedding (INHERITS_FROM).
 */
export function traceGoEdges(
    node: webTreeSitter.Node,
    filePath: string,
    symbolIndex: Map<string, SymbolInfo[]>,
    importedFrom: Map<string, string>,
    edges: SymbolEdge[]
): void {
    if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');
        if (funcNode) {
            const callName = funcNode.type === 'selector_expression'
                ? funcNode.childForFieldName('field')?.text
                : funcNode.type === 'identifier'
                    ? funcNode.text
                    : null;
            if (callName) {
                const target = resolveSymbol(callName, importedFrom, symbolIndex, filePath);
                if (target) {
                    const sourceName = findGoEnclosingSymbolName(node) ?? '<module>';
                    edges.push({
                        sourceFile: filePath,
                        sourceName,
                        targetFile: target.filePath,
                        targetName: target.name,
                        edgeType: 'calls',
                        lineNumber: node.startPosition.row,
                    });
                }
            }
        }
    }

    if (node.type === 'field_declaration') {
        // Embedded struct: field_declaration with no name field (bare type = embedded)
        const nameField = node.childForFieldName('name');
        if (!nameField) {
            const typeField = node.childForFieldName('type');
            // Handle both direct type_identifier and pointer embedding (*B)
            const typeNode = typeField?.type === 'pointer_type'
                ? typeField.namedChildren.find((c: webTreeSitter.Node) => c.type === 'type_identifier')
                : typeField?.type === 'type_identifier' ? typeField : null;
            if (typeNode) {
                const embeddedName = typeNode.text;
                const target = resolveSymbol(embeddedName, importedFrom, symbolIndex, filePath);
                if (target) {
                    const structName = findGoEnclosingStructName(node);
                    if (structName) {
                        edges.push({
                            sourceFile: filePath,
                            sourceName: structName,
                            targetFile: target.filePath,
                            targetName: target.name,
                            edgeType: 'extends',
                            lineNumber: node.startPosition.row,
                        });
                    }
                }
            }
        }
    }

    for (const child of node.namedChildren) {
        traceGoEdges(child, filePath, symbolIndex, importedFrom, edges);
    }
}

/** Walk up Go AST to find the nearest enclosing function or method name. */
function findGoEnclosingSymbolName(node: webTreeSitter.Node): string | null {
    let current = node.parent;
    while (current) {
        if (current.type === 'function_declaration') {
            return current.childForFieldName('name')?.text ?? null;
        }
        if (current.type === 'method_declaration') {
            const nameNode = current.namedChildren.find(c => c.type === 'field_identifier');
            return nameNode?.text ?? null;
        }
        current = current.parent;
    }
    return null;
}

/** Walk up Go AST from a field_declaration to find the enclosing struct type name. */
function findGoEnclosingStructName(node: webTreeSitter.Node): string | null {
    let current = node.parent;
    while (current) {
        if (current.type === 'type_spec') {
            return current.childForFieldName('name')?.text ?? null;
        }
        current = current.parent;
    }
    return null;
}
