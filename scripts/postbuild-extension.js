const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const wasmSrcDir = path.join(repoRoot, 'wasm');
const wasmDestDir = path.join(distDir, 'wasm');
const extensionShimPath = path.join(distDir, 'extension.js');

function copyWasmFiles() {
    if (!fs.existsSync(wasmSrcDir)) {
        return;
    }

    fs.rmSync(wasmDestDir, { recursive: true, force: true });
    fs.cpSync(wasmSrcDir, wasmDestDir, { recursive: true });
    console.log('[postbuild] Copied WASM files to dist/wasm/');
}

function writeExtensionShim() {
    fs.mkdirSync(distDir, { recursive: true });

    const shimContents = [
        "'use strict';",
        '',
        "module.exports = require('./src/extension.js');",
        '',
    ].join('\n');

    fs.writeFileSync(extensionShimPath, shimContents, 'utf8');
    console.log('[postbuild] Wrote dist/extension.js shim');
}

function main() {
    writeExtensionShim();
    copyWasmFiles();
}

main();
