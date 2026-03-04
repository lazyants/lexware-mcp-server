#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerEventSubscriptionTools } from './tools/event-subscriptions.js';
import { registerFileTools } from './tools/files.js';
import { registerRecurringTemplateTools } from './tools/recurring-templates.js';

const server = createServer('lexware-mcp-system');
registerEventSubscriptionTools(server);
registerFileTools(server);
registerRecurringTemplateTools(server);
startServer(server).catch((err) => { console.error('Fatal:', err); process.exit(1); });
