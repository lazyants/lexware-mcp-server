import { describe, it, expect } from 'vitest';
import { createServer } from '../server.js';

describe('createServer', () => {
  it('returns an McpServer instance', () => {
    const server = createServer();
    expect(server).toBeDefined();
    expect(typeof server.registerTool).toBe('function');
  });

  it('accepts custom name', () => {
    const server = createServer('custom-name');
    expect(server).toBeDefined();
  });
});
