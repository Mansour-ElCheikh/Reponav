const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourceRoots = ['src', 'shared'];
const outRoot = path.join(repoRoot, 'dist');

function walkDir(dir, acc) {
    if (!fs.existsSync(dir)) {
        return acc;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDir(fullPath, acc);
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        if (!/\.tsx?$/.test(entry.name)) {
            continue;
        }

        if (/\.d\.tsx?$/.test(entry.name)) {
            continue;
        }

        if (/\.test\.tsx?$/.test(entry.name)) {
            continue;
        }

        acc.push(fullPath);
    }

    return acc;
}

function compileFile(filePath) {
    const sourceText = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repoRoot, filePath);

    const output = ts.transpileModule(sourceText, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            sourceMap: true,
            inlineSources: false,
            esModuleInterop: true,
            resolveJsonModule: true,
        },
        fileName: relativePath,
        reportDiagnostics: true,
    });

    if (output.diagnostics && output.diagnostics.length > 0) {
        const messages = ts.formatDiagnosticsWithColorAndContext(output.diagnostics, {
            getCanonicalFileName: (f) => f,
            getCurrentDirectory: () => repoRoot,
            getNewLine: () => '\n',
        });
        console.warn(messages);
    }

    const jsOutPath = path.join(outRoot, relativePath.replace(/\.tsx?$/, '.js'));
    fs.mkdirSync(path.dirname(jsOutPath), { recursive: true });
    fs.writeFileSync(jsOutPath, output.outputText, 'utf8');

    if (output.sourceMapText) {
        fs.writeFileSync(`${jsOutPath}.map`, output.sourceMapText, 'utf8');
    }
}

function main() {
    const files = [];
    for (const root of sourceRoots) {
        walkDir(path.join(repoRoot, root), files);
    }

    for (const file of files) {
        compileFile(file);
    }

    console.log(`[transpile] Compiled ${files.length} TypeScript files`);
}

main();
