#!/usr/bin/env node
import { createServer, runServer } from './server.js';
import { allToolRegistrars, registerTools } from './tools/registrars.js';
import { registerReferenceResource } from './resources/lexware-reference.js';

const server = createServer('lexware-mcp-server');

registerReferenceResource(server);
registerTools(server, allToolRegistrars);

runServer(server);
