const { spawnSync } = require('child_process');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        shell: false,
        ...options,
    });

    if (result.error) {
        throw result.error;
    }

    if (typeof result.status === 'number' && result.status !== 0) {
        process.exit(result.status);
    }
}

function main() {
    run('npm', ['run', 'build'], { cwd: workspaceRoot });
    run('npm', ['run', 'build:webview'], { cwd: workspaceRoot });

    const codeCmd = process.platform === 'win32' ? 'code.cmd' : 'code';
    run(codeCmd, ['--new-window', `--extensionDevelopmentPath=${workspaceRoot}`], {
        cwd: workspaceRoot,
    });
}

main();
