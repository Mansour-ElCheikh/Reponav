/**
 * RepoNav MCP Server — stdio transport entry point.
 *
 * Starts the MCP server and connects it to stdin/stdout via StdioServerTransport.
 * Designed to be invoked by MCP clients (VS Code Copilot, Claude Desktop, etc.)
 *
 * Usage:
 *   node --experimental-strip-types bin/mcp.ts
 */

// Redirect perf/info logs to stderr so stdout carries only MCP JSON-RPC frames.
// eslint-disable-next-line no-console
console.info = (...args: unknown[]) => { process.stderr.write(args.map(String).join(' ') + '\n'); };

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../src/mcp/mcpServer';

// Start the MCP server with stdio transport
async function start() {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

start().catch((err) => {
    process.stderr.write(`MCP server error: ${err}\n`);
    process.exit(1);
});
