import { describe, it, expect } from 'vitest';
import { createServer } from '../server.js';
import {
  allToolRegistrars,
  salesToolRegistrars,
  contactsToolRegistrars,
  referenceToolRegistrars,
  bookkeepingToolRegistrars,
  systemToolRegistrars,
  registerTools,
  type ToolRegistrar,
} from '../tools/registrars.js';

function registerAndCount(registrars: ToolRegistrar[]): number {
  const server = createServer('test');
  let count = 0;
  // GOTCHA: McpServer.registerTool has overloaded signatures — TypeScript rejects
  // spreading Parameters<> for overloads. Use `any` + `.apply()` to bypass.
  const orig = server.registerTool;
  server.registerTool = ((...args: any[]) => {
    count++;
    return (orig as any).apply(server, args);
  }) as typeof server.registerTool;

  registerTools(server, registrars);

  return count;
}

describe('smoke tests', () => {
  // Every count below derives from `../tools/registrars.js` — the SAME arrays
  // `index.ts` / `entry-*.ts` register from — so a tool silently dropped from
  // (or duplicated into) an entry's array fails here too, instead of this test
  // verifying its own hand-copied, independently-drifting list.
  it('registers exactly 65 tools in full server', () => {
    expect(registerAndCount(allToolRegistrars)).toBe(65);
  });

  it('entry-sales registers 32 tools', () => {
    expect(registerAndCount(salesToolRegistrars)).toBe(32);
  });

  it('entry-contacts registers 10 tools', () => {
    expect(registerAndCount(contactsToolRegistrars)).toBe(10);
  });

  it('entry-bookkeeping registers 8 tools', () => {
    expect(registerAndCount(bookkeepingToolRegistrars)).toBe(8);
  });

  it('entry-reference registers 5 tools', () => {
    expect(registerAndCount(referenceToolRegistrars)).toBe(5);
  });

  it('entry-system registers 11 tools', () => {
    expect(registerAndCount(systemToolRegistrars)).toBe(11);
  });
});
