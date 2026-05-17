const path = require('path');
const cp = require('child_process');
const {
    downloadAndUnzipVSCode,
    resolveCliArgsFromVSCodeExecutablePath,
} = require('@vscode/test-electron');

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    const extensionTestsPath = path.resolve(__dirname, './index.js');
    const vscodeExecutablePath = await downloadAndUnzipVSCode({
        extensionDevelopmentPath,
    });
    const [cliPath, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

    const args = [
        ...cliArgs,
        '--disable-extensions',
        '--disable-updates',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust',
        `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
        `--extensionTestsPath=${extensionTestsPath}`,
    ];

    await new Promise((resolve, reject) => {
        const child = cp.spawn(cliPath, args, {
            stdio: 'inherit',
            env: process.env,
        });

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }

            const suffix = signal ? `signal ${signal}` : `code ${code}`;
            reject(new Error(`Extension smoke test failed with ${suffix}`));
        });
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
