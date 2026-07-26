#!/usr/bin/env node
import { createServer, runServer } from './server.js';
import { contactsToolRegistrars, registerTools } from './tools/registrars.js';
import { registerReferenceResource } from './resources/lexware-reference.js';

const server = createServer('lexware-mcp-contacts');
registerReferenceResource(server);
registerTools(server, contactsToolRegistrars);
runServer(server);
