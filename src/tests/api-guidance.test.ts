import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../server.js';
import { registerArticleTools } from '../tools/articles.js';
import { registerCreditNoteTools } from '../tools/credit-notes.js';
import { registerDeliveryNoteTools } from '../tools/delivery-notes.js';
import { registerDunningTools } from '../tools/dunnings.js';
import { registerEventSubscriptionTools } from '../tools/event-subscriptions.js';
import { registerInvoiceTools } from '../tools/invoices.js';
import { registerOrderConfirmationTools } from '../tools/order-confirmations.js';
import { registerQuotationTools } from '../tools/quotations.js';
import { registerVoucherTools } from '../tools/vouchers.js';
import { REFERENCE_URI, registerReferenceResource } from '../resources/lexware-reference.js';

const { mockLexwareRequest } = vi.hoisted(() => ({ mockLexwareRequest: vi.fn() }));

vi.mock('../services/lexware.js', () => ({
  lexwareRequest: mockLexwareRequest,
  lexwareDownload: vi.fn(),
  lexwareUpload: vi.fn(),
  getWebhookPublicKey: vi.fn(),
}));

const UUID = '745f3319-f473-4d55-9943-fecd942fd76d';
const SALES_TOOLS = [
  ['lexware_create_invoice', '/invoices', false],
  ['lexware_pursue_invoice', '/invoices', true],
  ['lexware_create_credit_note', '/credit-notes', false],
  ['lexware_pursue_credit_note', '/credit-notes', true],
  ['lexware_create_quotation', '/quotations', false],
  ['lexware_create_order_confirmation', '/order-confirmations', false],
  ['lexware_pursue_order_confirmation', '/order-confirmations', true],
  ['lexware_create_delivery_note', '/delivery-notes', false],
  ['lexware_pursue_delivery_note', '/delivery-notes', true],
  ['lexware_pursue_dunning', '/dunnings', true],
] as const;

const connections: { client: Client; server: ReturnType<typeof createServer> }[] = [];

function propertyDescription(tool: Tool | undefined, property: string): string | undefined {
  return (tool?.inputSchema.properties?.[property] as { description?: string } | undefined)?.description;
}

async function connectClient(): Promise<Client> {
  const server = createServer('guidance-test');
  for (const register of [
    registerArticleTools, registerCreditNoteTools, registerDeliveryNoteTools,
    registerDunningTools, registerEventSubscriptionTools, registerInvoiceTools,
    registerOrderConfirmationTools, registerQuotationTools, registerVoucherTools,
    registerReferenceResource,
  ]) register(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'guidance-test-client', version: '0.0.0' });
  connections.push({ client, server });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

beforeEach(() => {
  mockLexwareRequest.mockReset().mockResolvedValue({ id: UUID, version: 1 });
});

afterEach(async () => {
  for (const { client, server } of connections.splice(0)) {
    await client.close();
    await server.close();
  }
});

describe('published API guidance', () => {
  it('exposes formatting fields and Lexware syntax in every sales tool and body description', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    for (const [name] of SALES_TOOLS) {
      const tool = tools.find((tool) => tool.name === name);
      expect(tool, name).toBeDefined();
      for (const text of [tool?.description, propertyDescription(tool, 'body')]) {
        expect(text, name).toContain('introduction');
        expect(text, name).toContain('lineItems[].description');
        expect(text, name).toContain('remark');
        expect(text, name).toContain('**bold**');
        expect(text, name).toContain('__italic__');
        expect(text, name).toMatch(/dash-prefixed list items separated by newlines/);
      }
    }
  });

  it('exposes article description formatting and the unsupported title in create/update discovery', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    for (const name of ['lexware_create_article', 'lexware_update_article']) {
      const tool = tools.find((tool) => tool.name === name);
      expect(tool, name).toBeDefined();
      for (const text of [tool?.description, propertyDescription(tool, 'body')]) {
        expect(text).toContain('Only description supports Lexware formatting');
        expect(text).toContain('**bold**');
        expect(text).toContain('__italic__');
        expect(text).toMatch(/dash-prefixed list items separated by newlines/);
        expect(text).toContain('article title does not support formatting');
      }
      expect(propertyDescription(tool, 'body')).toContain('price');
      expect(propertyDescription(tool, 'body')).not.toContain('unitPrice');
      if (name === 'lexware_update_article') expect(tool?.description).toContain('version');
    }
  });

  it('exposes the existing-unchecked transition constraint and the version requirement', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const tool = tools.find((tool) => tool.name === 'lexware_update_voucher');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(['id', 'body']);
    for (const text of [tool?.description, propertyDescription(tool, 'body')]) {
      expect(text).toMatch(/current version.*optimistic locking/);
      expect(text).toContain('If the existing voucher is unchecked');
      expect(text).toContain('transition voucherStatus to open');
    }
    expect(propertyDescription(tool, 'body')).toContain('does not apply to vouchers already in other statuses');
  });

  it('exposes external webhook acknowledgement, queueing, and rate-limit guidance', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const tool = tools.find((tool) => tool.name === 'lexware_create_event_subscription');
    expect(tool?.description).toContain('does not host a receiver');
    expect(tool?.description).toContain('manages subscriptions and verifies signatures');
    for (const text of [tool?.description, propertyDescription(tool, 'callbackUrl')]) {
      expect(text).toContain('HTTP 200/204');
      expect(text).toMatch(/5 seconds|5000 ms/);
      expect(text).toContain('enqueue the payload for asynchronous processing');
      expect(text).toContain('throttle outgoing API calls to respect rate limits');
    }
    expect(propertyDescription(tool, 'callbackUrl')).toContain('hosted by your application');
  });

  it('keeps updated tool descriptions within two sentences without cross-references', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const updatedNames = new Set([
      ...SALES_TOOLS.map(([name]) => name), 'lexware_create_article',
      'lexware_update_article', 'lexware_update_voucher', 'lexware_create_event_subscription',
    ]);
    for (const tool of tools.filter((tool) => updatedNames.has(tool.name))) {
      expect(tool.description?.split(/(?<=[.!?])\s+(?=[A-Z])/).length, tool.name).toBeLessThanOrEqual(2);
      expect(tool.description, tool.name).not.toMatch(/lexware_[a-z_]+/);
    }
  });

  it('discovers and reads the bundled guidance, examples, and upstream references', async () => {
    const client = await connectClient();
    const { resources } = await client.listResources();
    expect(resources.find((resource) => resource.uri === REFERENCE_URI)?.description).toContain('text formatting');
    const { contents } = await client.readResource({ uri: REFERENCE_URI });
    const content = contents[0];
    expect(content).toHaveProperty('text');
    if (!('text' in content)) throw new Error('Expected a text reference');
    const text = content.text;
    expect(text).toContain('Article `title` does not support formatting');
    expect(text).toContain('Other Markdown features and HTML are not documented as supported');
    const example = text.match(/```json\n([\s\S]*?)\n```/);
    expect(example).not.toBeNull();
    expect(JSON.parse(example![1])).toEqual({
      introduction: 'Thank you for your **order**',
      lineItems: [{ description: 'Includes __installation__' }],
      remark: '- First step\n- Second step',
    });
    expect(text).toContain('"title": "Installation", "description": "**Setup** with __support__"');
    expect(text).toContain('Updates require the current `version`');
    expect(text).toContain('`unchecked`, the update must transition `voucherStatus` to `open`');
    expect(text).toContain('apply to vouchers already in other statuses');
    expect(text).toContain('does not host a receiver');
    expect(text).toContain('5 seconds (5000 ms)');
    expect(text).toContain('process it asynchronously');
    expect(text).toContain('controlled processing retries/backoff independently');
    expect(text).toContain('of Lexware delivery retries');
    expect(text).toContain('Throttle outgoing API calls');
    for (const anchor of ['faq-text-formatting', 'change-log', 'event-subscriptions-endpoint-purpose-best-practices']) {
      expect(text).toContain(`https://developers.lexware.io/docs/#${anchor}`);
    }
  });
});

describe('guidance preserves JSON passthrough over MCP', () => {
  it.each(SALES_TOOLS)('%s preserves caller text and forwards one request', async (name, path, chained) => {
    const client = await connectClient();
    const body = {
      introduction: 'Thank you for your **order** — Ä',
      lineItems: [{ description: 'Includes __installation__\n- Setup\n- Support' }],
      remark: 'Caller text with <tags> and `literal markers` stays unchanged',
    };
    const result = await client.callTool({
      name,
      arguments: { body, ...(chained ? { precedingSalesVoucherId: UUID } : {}) },
    });
    expect(result.isError).not.toBe(true);
    expect(mockLexwareRequest).toHaveBeenCalledTimes(1);
    const [method, url, forwardedBody, query] = mockLexwareRequest.mock.calls[0];
    expect([method, url, forwardedBody]).toEqual(['POST', path, body]);
    expect(query).toEqual(chained ? { precedingSalesVoucherId: UUID } : undefined);
  });

  it.each(['lexware_create_article', 'lexware_update_article'])('%s preserves article text', async (name) => {
    const client = await connectClient();
    const updating = name === 'lexware_update_article';
    const body = {
      title: 'Caller **title** stays unchanged',
      description: '**Setup** and __support__\n- First\n- Second',
      type: 'SERVICE', unitName: 'hour', price: { netPrice: 10, taxRate: 19, leadingPrice: 'NET' },
      ...(updating ? { version: 1 } : {}),
    };
    const result = await client.callTool({ name, arguments: { body, ...(updating ? { id: UUID } : {}) } });
    expect(result.isError).not.toBe(true);
    expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
      updating ? 'PUT' : 'POST', updating ? `/articles/${UUID}` : '/articles', body,
    );
  });

  it.each(['open', undefined])('forwards voucherStatus=%s updates without a preflight request', async (voucherStatus) => {
    const client = await connectClient();
    const body = {
      version: 1, type: 'salesinvoice', voucherItems: [],
      ...(voucherStatus ? { voucherStatus } : {}),
    };
    const result = await client.callTool({ name: 'lexware_update_voucher', arguments: { id: UUID, body } });
    expect(result.isError).not.toBe(true);
    expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith('PUT', `/vouchers/${UUID}`, body);
  });
});
