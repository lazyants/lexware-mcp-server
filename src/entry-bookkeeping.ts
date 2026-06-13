#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerVoucherTools } from './tools/vouchers.js';
import { registerVoucherlistTools } from './tools/voucherlist.js';
import { registerPaymentTools } from './tools/payments.js';
import { registerReferenceResource } from './resources/lexware-reference.js';

const server = createServer('lexware-mcp-bookkeeping');
registerReferenceResource(server);
registerVoucherTools(server);
registerVoucherlistTools(server);
registerPaymentTools(server);
startServer(server).catch((err) => { console.error('Fatal:', err); process.exit(1); });
