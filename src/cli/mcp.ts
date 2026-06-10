import { Command } from 'commander';
import { startMcpServer } from '../mcp/server.js';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('以 MCP server 模式运行，暴露 publish/status/info/doctor 工具')
    .action(async () => {
      await startMcpServer();
    });
}
