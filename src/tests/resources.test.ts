import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.js';
import {
  registerReferenceResource,
  REFERENCE_URI,
  REFERENCE_NAME,
  REFERENCE_MIME_TYPE,
  REFERENCE_MD,
} from '../resources/lexware-reference.js';
import { registerInvoiceTools } from '../tools/invoices.js';

type Server = ReturnType<typeof createServer>;

async function connectClient(register: (s: Server) => void): Promise<Client> {
  const server = createServer('test');
  register(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('reference resource constant', () => {
  it('is a non-empty markdown string with known reference tokens', () => {
    expect(typeof REFERENCE_MD).toBe('string');
    expect(REFERENCE_MD.length).toBeGreaterThan(0);
    expect(REFERENCE_MD).toContain('# Lexware Office');
    expect(REFERENCE_MD).toContain('lexware_create_invoice');
    expect(REFERENCE_MD).toContain('api.lexware.io');
  });
});

describe('reference resource registration (in-process via SDK client)', () => {
  it('lists reference://lexware/api with correct name and mimeType', async () => {
    const client = await connectClient(registerReferenceResource);
    try {
      const { resources } = await client.listResources();
      const ref = resources.find((r) => r.uri === REFERENCE_URI);
      expect(ref).toBeDefined();
      expect(ref?.name).toBe(REFERENCE_NAME);
      expect(ref?.mimeType).toBe(REFERENCE_MIME_TYPE);
    } finally {
      await client.close();
    }
  });

  it('reads the resource returning the exact uri string and markdown body', async () => {
    const client = await connectClient(registerReferenceResource);
    try {
      const result = await client.readResource({ uri: REFERENCE_URI });
      expect(result.contents).toHaveLength(1);
      const [content] = result.contents;
      // The read callback receives a URL; the wire value must be a plain string.
      expect(typeof content.uri).toBe('string');
      expect(content.uri).toBe(REFERENCE_URI);
      expect(content.mimeType).toBe(REFERENCE_MIME_TYPE);
      // contents[] is a text|blob union; this resource is text.
      expect('text' in content).toBe(true);
      const { text } = content as { text: string };
      expect(typeof text).toBe('string');
      expect(text).toBe(REFERENCE_MD);
      expect(text).toContain('lexware_create_invoice');
    } finally {
      await client.close();
    }
  });

  it('is additive: resource and tools coexist without regressing tool registration', async () => {
    const client = await connectClient((server) => {
      registerReferenceResource(server);
      registerInvoiceTools(server);
    });
    try {
      const { resources } = await client.listResources();
      expect(resources.map((r) => r.uri)).toContain(REFERENCE_URI);
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((t) => t.name)).toContain('lexware_create_invoice');
    } finally {
      await client.close();
    }
  });
});
