import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.js';
import { registerInvoiceTools } from '../tools/invoices.js';
import { registerArticleTools } from '../tools/articles.js';
import { registerEventSubscriptionTools } from '../tools/event-subscriptions.js';

// Regression guard for the fleet's Zod-4 `optin` bug: schemas built with
// `z.preprocess()` get tagged `optin: "optional"` internally, which silently
// drops otherwise-required fields from the `tools/list` `required[]` array
// (see transkribus-mcp-server's `clearOptinMarker` fix, PR #5). lexware
// doesn't use `z.preprocess` today, but a future schema change or a zod bump
// could reintroduce the class of bug in a way that only shows up on the wire —
// per-tool unit tests here mock the service and never touch zod's schema
// conversion at all. This file drives a REAL in-process MCP client/server
// round-trip (mirrors `resources.test.ts`'s `connectClient` pattern) and
// locks the `required[]` shape and `.describe()` propagation for a
// representative slice of tools: required-only, mixed, default-valued, and
// all-optional input shapes.

type Server = ReturnType<typeof createServer>;

async function connectClient(register: (s: Server) => void): Promise<Client> {
  const server = createServer('test');
  register(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

interface JsonSchemaTool {
  name: string;
  inputSchema: {
    properties?: Record<string, { description?: string }>;
    required?: string[];
  };
}

async function findTool(client: Client, name: string): Promise<JsonSchemaTool> {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === name) as JsonSchemaTool | undefined;
  if (!tool) throw new Error(`${name} not present in tools/list`);
  return tool;
}

describe('tools/list round-trip: required[] and describe() propagation', () => {
  it('lexware_create_invoice requires only body; finalize stays optional', async () => {
    const client = await connectClient(registerInvoiceTools);
    try {
      const tool = await findTool(client, 'lexware_create_invoice');
      expect(tool.inputSchema.required).toEqual(['body']);
      expect(tool.inputSchema.properties?.finalize).toBeDefined();
      expect(tool.inputSchema.properties?.body?.description).toMatch(/Invoice JSON body/);
    } finally {
      await client.close();
    }
  });

  it('lexware_get_invoice requires id, with its own .describe() override intact', async () => {
    const client = await connectClient(registerInvoiceTools);
    try {
      const tool = await findTool(client, 'lexware_get_invoice');
      expect(tool.inputSchema.required).toEqual(['id']);
      // UuidSchema's base description is "Resource UUID"; each call site
      // re-describes it — confirm the override, not the base, survives.
      expect(tool.inputSchema.properties?.id?.description).toBe('Invoice UUID');
    } finally {
      await client.close();
    }
  });

  it('lexware_download_invoice_file requires only id; the defaulted format stays out of required[]', async () => {
    const client = await connectClient(registerInvoiceTools);
    try {
      const tool = await findTool(client, 'lexware_download_invoice_file');
      expect(tool.inputSchema.required).toEqual(['id']);
      expect(tool.inputSchema.properties?.format).toBeDefined();
      expect(tool.inputSchema.properties?.format?.description).toMatch(/XRechnung XML/);
    } finally {
      await client.close();
    }
  });

  it('lexware_list_articles has no required params (all-optional pagination/filter shape)', async () => {
    const client = await connectClient(registerArticleTools);
    try {
      const tool = await findTool(client, 'lexware_list_articles');
      expect(tool.inputSchema.required ?? []).toEqual([]);
      expect(tool.inputSchema.properties?.size?.description).toBe('Results per page (max 250)');
    } finally {
      await client.close();
    }
  });

  it('lexware_verify_webhook_signature requires both payload and signature', async () => {
    const client = await connectClient(registerEventSubscriptionTools);
    try {
      const tool = await findTool(client, 'lexware_verify_webhook_signature');
      expect([...(tool.inputSchema.required ?? [])].sort()).toEqual(['payload', 'signature']);
      expect(tool.inputSchema.properties?.signature?.description).toMatch(/X-Lxo-Signature/);
    } finally {
      await client.close();
    }
  });
});
