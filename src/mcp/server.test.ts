import { describe, expect, it } from 'vitest';
import { buildDescriptor } from '../cli/descriptor.js';
import { buildMcpTools, createMcpJsonResponse } from './server.js';

describe('MCP helpers', () => {
  it('暴露 apkpub_describe 工具', () => {
    const tools = buildMcpTools();
    expect(tools.map((tool) => tool.name)).toContain('apkpub_describe');
  });

  it('MCP JSON 响应保留 text JSON 并提供结构化结果', () => {
    const descriptor = buildDescriptor();
    const response = createMcpJsonResponse(descriptor);
    expect(JSON.parse(response.content[0]?.text ?? '{}')).toMatchObject({ name: 'apkpub-cli' });
    expect(response.structuredContent).toBe(descriptor);
  });
});
