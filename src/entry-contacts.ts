#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerContactTools } from './tools/contacts.js';
import { registerArticleTools } from './tools/articles.js';
import { registerReferenceResource } from './resources/lexware-reference.js';

const server = createServer('lexware-mcp-contacts');
registerReferenceResource(server);
registerContactTools(server);
registerArticleTools(server);
startServer(server).catch((err) => { console.error('Fatal:', err); process.exit(1); });
