#!/usr/bin/env node
import { createServer, runServer } from './server.js';
import { bookkeepingToolRegistrars, registerTools } from './tools/registrars.js';
import { registerReferenceResource } from './resources/lexware-reference.js';

const server = createServer('lexware-mcp-bookkeeping');
registerReferenceResource(server);
registerTools(server, bookkeepingToolRegistrars);
runServer(server);
