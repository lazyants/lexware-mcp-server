#!/usr/bin/env node
import { createServer, runServer } from './server.js';
import { salesToolRegistrars, registerTools } from './tools/registrars.js';
import { registerReferenceResource } from './resources/lexware-reference.js';

const server = createServer('lexware-mcp-sales');
registerReferenceResource(server);
registerTools(server, salesToolRegistrars);
runServer(server);
