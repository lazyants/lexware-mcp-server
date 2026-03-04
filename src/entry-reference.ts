#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerCountryTools } from './tools/countries.js';
import { registerPaymentConditionTools } from './tools/payment-conditions.js';
import { registerPostingCategoryTools } from './tools/posting-categories.js';
import { registerProfileTools } from './tools/profile.js';
import { registerPrintLayoutTools } from './tools/print-layouts.js';

const server = createServer('lexware-mcp-reference');
registerCountryTools(server);
registerPaymentConditionTools(server);
registerPostingCategoryTools(server);
registerProfileTools(server);
registerPrintLayoutTools(server);
startServer(server).catch((err) => { console.error('Fatal:', err); process.exit(1); });
