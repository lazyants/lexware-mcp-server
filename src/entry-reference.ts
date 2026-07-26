#!/usr/bin/env node
import { createServer, runServer } from './server.js';
import { referenceToolRegistrars, registerTools } from './tools/registrars.js';
import { registerReferenceResource } from './resources/lexware-reference.js';

const server = createServer('lexware-mcp-reference');
registerReferenceResource(server);
registerTools(server, referenceToolRegistrars);
runServer(server);
