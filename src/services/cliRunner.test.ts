import { describe, it, expect } from 'vitest';
import { CliRunner } from './cliRunner';

describe('CliRunner', () => {
    it('returns exitCode 0 for help', async () => {
        const runner = new CliRunner();
        const result = await runner.run(['node', 'reponav', '--help']);
        expect(result.exitCode).toBe(0);
    });

    it('returns exitCode 2 when analyze given nonexistent repo', async () => {
        const runner = new CliRunner();
        const result = await runner.run(['node', 'reponav', 'analyze', '--repo', '/nonexistent/path/xyz']);
        expect(result.exitCode).toBe(2);
    });
});
