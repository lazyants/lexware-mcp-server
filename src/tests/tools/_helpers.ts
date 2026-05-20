/**
 * Shared helpers for per-tool tests.
 *
 * Tools are tested by mocking the `services/lexware.js` module — that's the
 * single chokepoint every tool funnels through, so we don't mock axios here.
 * (The axios surface is exercised in `lexware-client.test.ts`.)
 *
 * IMPORTANT: `vi.mock(...)` is statically hoisted by Vitest's transformer, so
 * it CANNOT be wrapped inside a helper function — each test file declares its
 * own `vi.mock('../../services/lexware.js', ...)` at module top, using
 * `vi.hoisted()` to share spy references with the factory.
 *
 * What lives here:
 *  - `registerAndCapture(registerFn)` — fake server that records every
 *    `registerTool(name, def, handler)` call into a Map.
 *  - `getTool(map, name)` — typed accessor that throws on missing tools.
 *  - `expectRequest(spy, ...)` — DSL for the most common assertion: a single
 *    call to `lexwareRequest` with exact (method, url, body, params).
 */
import { expect } from 'vitest';
import type { Mock } from 'vitest';

export type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

export interface CapturedTool {
  name: string;
  schemaShape: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * Build a fake `McpServer` whose `registerTool` records every call into a
 * Map, then invoke the supplied register fn. Returns the populated Map.
 *
 * Tests use this to grab the handler closure and call it directly — bypassing
 * the actual MCP transport — to assert that the right `lexwareRequest` call
 * was made for the right inputs.
 */
export function registerAndCapture(
  registerFn: (server: unknown) => void,
): Map<string, CapturedTool> {
  const captured = new Map<string, CapturedTool>();
  const fakeServer = {
    registerTool(
      name: string,
      def: { inputSchema?: { shape?: Record<string, unknown> } },
      handler: ToolHandler,
    ) {
      captured.set(name, {
        name,
        schemaShape: def.inputSchema?.shape ?? {},
        handler,
      });
    },
  };
  registerFn(fakeServer);
  return captured;
}

export function getTool(tools: Map<string, CapturedTool>, name: string): CapturedTool {
  const tool = tools.get(name);
  if (!tool) throw new Error(`${name} not registered`);
  return tool;
}

export interface ExpectedRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  body?: unknown;
  params?: Record<string, unknown>;
}

/**
 * Assert that a `lexwareRequest` spy was called exactly once with the given
 * (method, url, body?, params?) tuple. Missing body/params assert undefined.
 */
export function expectRequest(spy: Mock, expected: ExpectedRequest): void {
  expect(spy).toHaveBeenCalledExactlyOnceWith(
    expected.method,
    expected.url,
    expected.body,
    expected.params,
  );
}
