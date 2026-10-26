import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer } from '../server.js';
import { allToolRegistrars, registerTools } from '../tools/registrars.js';
import { READ_ONLY_TOOL_NAMES, parseReadOnlyMode } from '../read-only.js';
import { REFERENCE_MD, REFERENCE_URI } from '../resources/lexware-reference.js';

// Read-only mode (#149). Calls go through a real in-process MCP client and the
// SDK's own tools/list and tools/call handlers, so a blocked tool is checked the
// way a client would reach it. The service module is mocked: every Lexware
// request a tool makes lands on these spies, and none goes over the network.

const service = vi.hoisted(() => ({
  lexwareRequest: vi.fn(),
  lexwareUpload: vi.fn(),
  lexwareDownload: vi.fn(),
  getWebhookPublicKey: vi.fn(),
}));
vi.mock('../services/lexware.js', () => service);

// Each entry module hands its server to runServer(); capture it instead of
// opening stdio, so the test inspects exactly the server the bin would serve.
const captured = vi.hoisted(() => [] as McpServer[]);
vi.mock('../server.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server.js')>()),
  runServer: (server: McpServer) => {
    captured.push(server);
  },
}));

const UUID = '0b4f2a6e-1f3c-4d5e-8a9b-1c2d3e4f5a6b';
const BLOCKED_DESCRIPTION =
  'Blocked: read-only mode (LEXWARE_READ_ONLY) is on, and this tool would change Lexware data.';
const BLOCKED_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
// Arguments a client might really send to a mutating tool; the stub must ignore them.
const REALISTIC_ARGS = { id: UUID, body: { name: 'x' }, finalize: true, filePath: '/etc/hosts', version: 1 };

function blockedMessage(name: string): string {
  return (
    `Error: ${name} is blocked: read-only mode is on (LEXWARE_READ_ONLY), so this server does not ` +
    'create, change, delete, upload or pursue Lexware data.'
  );
}

const TEST_PUBLIC_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .publicKey.export({ type: 'spki', format: 'pem' })
  .toString();

// The entry points are whatever package.json publishes as bins, so a new entry
// point is covered here without editing this file.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  bin: Record<string, string>;
};
const ENTRY_POINTS = Object.entries(pkg.bin).map(([command, target]) => ({
  command,
  path: fileURLToPath(new URL(`../${target.replace(/^dist\//, '').replace(/\.js$/, '.ts')}`, import.meta.url)),
}));
const FULL_SERVER = ENTRY_POINTS.find((entry) => entry.command === 'lexware-mcp-server')!.path;

type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
}

const clients: Client[] = [];

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'read-only-test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  clients.push(client);
  return client;
}

/** Load an entry module fresh, with LEXWARE_READ_ONLY set to `readOnlyEnv`. */
async function importEntry(path: string, readOnlyEnv: string): Promise<void> {
  vi.stubEnv('LEXWARE_READ_ONLY', readOnlyEnv);
  vi.resetModules();
  captured.length = 0;
  await import(path);
}

/** Load an entry module fresh and connect to the server it built. */
async function startEntry(path: string, readOnlyEnv: string): Promise<Client> {
  await importEntry(path, readOnlyEnv);
  expect(captured).toHaveLength(1);
  return connect(captured[0]);
}

async function listTools(client: Client): Promise<ListedTool[]> {
  return (await client.listTools()).tools;
}

async function callTool(client: Client, name: string, args?: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function resultText(result: ToolResult): string {
  return result.content.map((part) => part.text ?? '').join('\n');
}

interface JsonSchema {
  type?: string;
  format?: string;
  enum?: unknown[];
  minimum?: number;
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

function sampleValue(schema: JsonSchema): unknown {
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) return sampleValue(schema.anyOf[0]);
  switch (schema.type) {
    case 'string':
      return schema.format === 'uuid' ? UUID : 'x';
    case 'number':
    case 'integer':
      return schema.minimum ?? 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return 'x';
  }
}

/** The smallest arguments a tool's listed schema accepts: one sample value per required field. */
function sampleArguments(schema: JsonSchema): Record<string, unknown> {
  return Object.fromEntries(
    (schema.required ?? []).map((key) => [key, sampleValue(schema.properties?.[key] ?? {})]),
  );
}

beforeEach(() => {
  service.lexwareRequest.mockResolvedValue({ content: [], last: true, totalPages: 1 });
  service.lexwareUpload.mockResolvedValue({ id: UUID });
  service.lexwareDownload.mockResolvedValue({ data: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' });
  service.getWebhookPublicKey.mockResolvedValue(TEST_PUBLIC_KEY);
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('parseReadOnlyMode', () => {
  it.each([undefined, '', '  ', 'false', '0', 'FALSE', ' False '])('treats %j as off', (value) => {
    expect(parseReadOnlyMode(value)).toBe(false);
  });

  it.each(['true', '1', 'TRUE', ' True '])('treats %j as on', (value) => {
    expect(parseReadOnlyMode(value)).toBe(true);
  });

  it.each(['yes', 'on', '2', 'enabled'])('refuses %j instead of guessing', (value) => {
    expect(() => parseReadOnlyMode(value)).toThrow(
      'LEXWARE_READ_ONLY must be "true", "1", "false" or "0" (unset or empty means off).',
    );
  });

  it('does not echo the rejected value', () => {
    expect(() => parseReadOnlyMode('sk_live_not_a_flag')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('sk_live_not_a_flag') }),
    );
  });
});

describe('read-only allowlist', () => {
  it('allows exactly the tools annotated readOnlyHint: true', async () => {
    // Two independent declarations must agree: a new tool, a stale allowlist
    // entry, or a mis-annotated tool all fail here.
    const server = createServer('test');
    registerTools(server, allToolRegistrars, false);
    const tools = await listTools(await connect(server));
    const annotatedReadOnly = tools.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name);
    expect(annotatedReadOnly.sort()).toEqual([...READ_ONLY_TOOL_NAMES].sort());
  });

  it.each([
    'lexware_create_invoice',
    'lexware_update_contact',
    'lexware_delete_article',
    'lexware_upload_file',
    'lexware_pursue_dunning',
  ])('blocks %s', (name) => {
    expect(READ_ONLY_TOOL_NAMES.has(name)).toBe(false);
  });
});

describe.each(ENTRY_POINTS)('entry point $command in read-only mode', ({ path }) => {
  it('lists the same tools, with every tool that changes data replaced by the blocked stub', async () => {
    const normal = await listTools(await startEntry(path, ''));
    const readOnly = await listTools(await startEntry(path, 'true'));
    expect(readOnly.map((tool) => tool.name)).toEqual(normal.map((tool) => tool.name));

    const normalByName = new Map(normal.map((tool) => [tool.name, tool]));
    for (const tool of readOnly) {
      if (READ_ONLY_TOOL_NAMES.has(tool.name)) {
        expect(tool).toEqual(normalByName.get(tool.name));
      } else {
        expect(tool).toMatchObject({
          title: normalByName.get(tool.name)!.title,
          description: BLOCKED_DESCRIPTION,
          annotations: BLOCKED_ANNOTATIONS,
        });
        expect(tool.inputSchema).toEqual({ type: 'object', properties: {} });
      }
    }
    // Every tool the normal listing annotates as changing data is a stub here.
    const stubs = readOnly.filter((tool) => tool.description === BLOCKED_DESCRIPTION);
    expect(stubs.length).toBe(normal.filter((tool) => tool.annotations?.readOnlyHint !== true).length);
  });

  it('still lists the reference resource', async () => {
    const client = await startEntry(path, 'true');
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toContain(REFERENCE_URI);
  });
});

describe('blocked tools', () => {
  it('reject every call on every entry point without contacting Lexware', async () => {
    let blockedTools = 0;
    for (const { path } of ENTRY_POINTS) {
      const client = await startEntry(path, 'true');
      const blocked = (await listTools(client)).filter((tool) => !READ_ONLY_TOOL_NAMES.has(tool.name));
      blockedTools += blocked.length;
      for (const tool of blocked) {
        for (const args of [REALISTIC_ARGS, undefined]) {
          const result = await callTool(client, tool.name, args);
          expect(result.isError, tool.name).toBe(true);
          expect(resultText(result)).toBe(blockedMessage(tool.name));
        }
      }
    }
    // A loop that ran zero times would pass the assertions above.
    expect(blockedTools).toBeGreaterThan(0);
    expect(service.lexwareRequest).not.toHaveBeenCalled();
    expect(service.lexwareUpload).not.toHaveBeenCalled();
    expect(service.lexwareDownload).not.toHaveBeenCalled();
    expect(service.getWebhookPublicKey).not.toHaveBeenCalled();
  });
});

describe('allowed tools in read-only mode', () => {
  it('run to a successful result and only read from Lexware', async () => {
    // Requiring success matters: a mutating tool wrongly put on the allowlist could
    // otherwise fail on sample input before its write, and look harmless.
    const client = await startEntry(FULL_SERVER, 'true');
    const allowed = (await listTools(client)).filter((tool) => READ_ONLY_TOOL_NAMES.has(tool.name));
    expect(allowed).toHaveLength(READ_ONLY_TOOL_NAMES.size);

    for (const tool of allowed) {
      const result = await callTool(client, tool.name, sampleArguments(tool.inputSchema as JsonSchema));
      expect(result.isError, `${tool.name}: ${resultText(result)}`).not.toBe(true);
    }

    const methods = service.lexwareRequest.mock.calls.map((call) => call[0]);
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(['GET']));
    expect(service.lexwareDownload).toHaveBeenCalled();
    expect(service.lexwareUpload).not.toHaveBeenCalled();
  });

  it('return the invoice a get request reads', async () => {
    const client = await startEntry(FULL_SERVER, 'true');
    service.lexwareRequest.mockResolvedValueOnce({ id: UUID, voucherNumber: 'RE-1' });

    const result = await callTool(client, 'lexware_get_invoice', { id: UUID });

    expect(service.lexwareRequest).toHaveBeenCalledExactlyOnceWith('GET', `/invoices/${UUID}`);
    expect(result.structuredContent).toEqual({ id: UUID, voucherNumber: 'RE-1' });
  });

  it('include the reference resource text', async () => {
    const client = await startEntry(FULL_SERVER, 'true');
    const { contents } = await client.readResource({ uri: REFERENCE_URI });
    expect(contents).toEqual([expect.objectContaining({ uri: REFERENCE_URI, text: REFERENCE_MD })]);
  });
});

describe('default mode', () => {
  it('registers every tool exactly as the tool modules declare it', async () => {
    vi.stubEnv('LEXWARE_READ_ONLY', '');
    const viaRegisterTools = createServer('test');
    registerTools(viaRegisterTools, allToolRegistrars);
    const direct = createServer('test');
    for (const register of allToolRegistrars) register(direct);

    expect(await listTools(await connect(viaRegisterTools))).toEqual(await listTools(await connect(direct)));
  });

  it('still sends a create request to Lexware', async () => {
    const client = await startEntry(FULL_SERVER, '');
    const body = { voucherDate: '2026-10-26' };

    const result = await callTool(client, 'lexware_create_invoice', { body });

    expect(result.isError).not.toBe(true);
    expect(service.lexwareRequest).toHaveBeenCalledExactlyOnceWith('POST', '/invoices', body, undefined);
  });
});

describe('LEXWARE_READ_ONLY wiring', () => {
  it('is read by registerTools when no mode is passed', async () => {
    vi.stubEnv('LEXWARE_READ_ONLY', 'true');
    const server = createServer('test');
    registerTools(server, allToolRegistrars);

    const tools = await listTools(await connect(server));
    expect(tools.find((tool) => tool.name === 'lexware_create_invoice')?.description).toBe(BLOCKED_DESCRIPTION);
  });

  it('stops an entry point from starting when the value is not recognized', async () => {
    await expect(importEntry(FULL_SERVER, 'maybe')).rejects.toThrow('LEXWARE_READ_ONLY must be');
    expect(captured).toHaveLength(0);
  });
});
