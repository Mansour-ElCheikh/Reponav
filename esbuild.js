const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Copy wasm/ directory into dist/wasm/ so the extension can find grammars at runtime. */
function copyWasmFiles() {
    const src = path.join(__dirname, 'wasm');
    const dest = path.join(__dirname, 'dist', 'wasm');
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, file), path.join(dest, file));
    }
    console.log('[esbuild] Copied WASM files to dist/wasm/');
}

/** Copy media/ directory into dist/media/ so vsce can find the icon during packaging. */
function copyMediaFiles() {
    const src = path.join(__dirname, 'media');
    const dest = path.join(__dirname, 'dist', 'media');
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, file), path.join(dest, file));
    }
    console.log('[esbuild] Copied media files to dist/media/');
}

/** Mark the bin output files as executable (for npm bin path). */
function chmodBins() {
    const bins = ['dist/bin/reponav.js', 'dist/bin/mcp.js'];
    for (const rel of bins) {
        const full = path.join(__dirname, rel);
        if (fs.existsSync(full)) fs.chmodSync(full, 0o755);
    }
    console.log('[esbuild] Made dist/bin/{reponav,mcp}.js executable');
}

// Externalize all production deps. vsce ships them via node_modules
// in the vsix (default behavior when --no-dependencies is NOT passed).
// Bundling AI SDKs worked but bundling WASM-loading deps (web-tree-sitter,
// sql.js) breaks dynamic resolution. Externalizing all is the simplest
// consistent posture; vsix size grows ~2MB (acceptable, under 4MB total).
const sharedExternal = [
    'vscode',
    '@anthropic-ai/sdk',
    '@google/generative-ai',
    '@modelcontextprotocol/sdk',
    'openai',
    'sql.js',
    'tree-sitter-go',
    'web-tree-sitter',
    'yaml',
    'zod',
];

async function main() {
    // Three entry points → three bundles:
    // 1. dist/extension.js — VS Code extension host (CJS, vscode external)
    // 2. dist/bin/reponav.js — headless CLI for `npx reponav`
    // 3. dist/bin/mcp.js — MCP stdio server for `npx reponav mcp` and standalone use
    const buildConfigs = [
        {
            entryPoints: ['src/extension.ts'],
            outfile: 'dist/extension.js',
            external: sharedExternal,
            banner: undefined,
        },
        {
            entryPoints: ['bin/reponav.ts'],
            outfile: 'dist/bin/reponav.js',
            external: sharedExternal.filter(d => d !== 'vscode'),  // CLI never imports vscode
            banner: { js: '#!/usr/bin/env node' },
        },
        {
            entryPoints: ['bin/mcp.ts'],
            outfile: 'dist/bin/mcp.js',
            external: sharedExternal.filter(d => d !== 'vscode'),
            banner: { js: '#!/usr/bin/env node' },
        },
    ];

    const contexts = await Promise.all(buildConfigs.map(cfg => esbuild.context({
        entryPoints: cfg.entryPoints,
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: cfg.outfile,
        external: cfg.external,
        banner: cfg.banner,
        logLevel: 'info',
        plugins: watch
            ? [
                  {
                      name: 'watch-plugin',
                      setup(build) {
                          build.onEnd((result) => {
                              if (result.errors.length === 0) {
                                  copyWasmFiles();
                                  copyMediaFiles();
                                  chmodBins();
                                  console.log(`[esbuild] ${cfg.outfile} build complete`);
                              }
                          });
                      },
                  },
              ]
            : [],
    })));

    if (watch) {
        await Promise.all(contexts.map(ctx => ctx.watch()));
        console.log('[esbuild] Watching for changes...');
    } else {
        await Promise.all(contexts.map(ctx => ctx.rebuild()));
        await Promise.all(contexts.map(ctx => ctx.dispose()));
        copyWasmFiles();
        copyMediaFiles();
        chmodBins();
        console.log('[esbuild] All builds complete (extension + bin/reponav + bin/mcp)');
    }
}

main().then(() => {
    if (!watch) process.exit(0);
}).catch((e) => {
    console.error(e);
    process.exit(1);
});
