#!/usr/bin/env node
import { createServer, runServer } from './server.js';
import { systemToolRegistrars, registerTools } from './tools/registrars.js';
import { registerReferenceResource } from './resources/lexware-reference.js';

const server = createServer('lexware-mcp-system');
registerReferenceResource(server);
registerTools(server, systemToolRegistrars);
runServer(server);
