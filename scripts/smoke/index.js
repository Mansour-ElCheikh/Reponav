const assert = require('assert');
const vscode = require('vscode');

async function run() {
    const extension = vscode.extensions.getExtension('reponav.reponav');
    assert.ok(extension, 'Extension reponav.reponav should be available for smoke test');

    if (!extension.isActive) {
        await extension.activate();
    }

    const health = await vscode.commands.executeCommand('reponav.healthCheck');
    assert.ok(health, 'Health check command should return a value');
    assert.strictEqual(health.status, 'ok', 'Health check status must be ok');
    assert.strictEqual(health.readiness.commandsRegistered, true, 'Required commands must be registered');
    assert.strictEqual(health.readiness.webviewAssetsReady, true, 'Webview assets must be available');

    // Verify all user-facing commands are registered
    const allCommands = await vscode.commands.getCommands(true);
    const requiredCommands = [
        'reponav.generateTour',
        'reponav.showDependencyGraph',
        'reponav.healthCheck',
    ];
    for (const cmd of requiredCommands) {
        assert.ok(allCommands.includes(cmd), `Command ${cmd} must be registered`);
    }

    // Verify extension exports the expected API surface
    assert.ok(extension.isActive, 'Extension must be active after activation');
}

module.exports = { run };
