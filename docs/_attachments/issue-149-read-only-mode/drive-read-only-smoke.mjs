#!/usr/bin/env node
// Smoke test for issue #149: drives a built entry point over stdio, with no Lexware
// credentials, and checks the read-only mode contract end to end:
//   1. LEXWARE_READ_ONLY=true: tools/list marks mutating tools as blocked, a
//      tools/call to one returns the blocked error, and read tools keep their
//      normal listing.
//   2. LEXWARE_READ_ONLY unset: the same tools keep their normal descriptions.
//   3. LEXWARE_READ_ONLY=yes: the server refuses to start.
// Usage: node drive-read-only-smoke.mjs <path to dist/index.js>
import { spawn } from 'node:child_process';

const bin = process.argv[2];
if (!bin) {
  console.error('usage: node drive-read-only-smoke.mjs <path to dist/index.js>');
  process.exit(2);
}

function startServer(env) {
  const child = spawn(process.execPath, [bin], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    let newline;
    while ((newline = stdout.indexOf('\n')) >= 0) {
      const line = stdout.slice(0, newline);
      stdout = stdout.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  // Writing before the server attaches its stdin reader loses the line, so wait
  // for its own readiness banner rather than sleeping.
  const ready = new Promise((resolve, reject) => {
    child.stderr.on('data', () => { if (stderr.includes('running on stdio')) resolve(); });
    child.on('exit', (code) => reject(new Error(`server exited with ${code} before it was ready:\n${stderr}`)));
  });
  let nextId = 1;
  const request = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve({ code, stderr })));
  return { child, ready, request, exited };
}

async function session(env) {
  const server = startServer(env);
  await server.ready;
  await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'read-only-smoke', version: '0.0.0' },
  });
  server.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return server;
}

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const BLOCKED_PREFIX = 'Blocked:';

console.log('\n== 1. LEXWARE_READ_ONLY=true ==');
{
  const server = await session({ LEXWARE_READ_ONLY: 'true' });
  const { result } = await server.request('tools/list', {});
  const blocked = result.tools.filter((t) => t.description.startsWith(BLOCKED_PREFIX));
  const open = result.tools.filter((t) => !t.description.startsWith(BLOCKED_PREFIX));
  console.log(`tools listed: ${result.tools.length}, blocked: ${blocked.length}, available: ${open.length}`);
  check('mutating tools are listed as blocked', blocked.length > 0);
  check('lexware_create_invoice is blocked', blocked.some((t) => t.name === 'lexware_create_invoice'));
  check('lexware_get_invoice is available', open.some((t) => t.name === 'lexware_get_invoice'));
  const call = await server.request('tools/call', {
    name: 'lexware_create_invoice',
    arguments: { body: { voucherDate: '2026-10-26' }, finalize: true },
  });
  const text = call.result?.content?.[0]?.text ?? '';
  console.log(`tools/call lexware_create_invoice -> isError=${call.result?.isError} text=${JSON.stringify(text)}`);
  check('the call is rejected with the read-only message', call.result?.isError === true && text.includes('LEXWARE_READ_ONLY'));
  const resources = await server.request('resources/list', {});
  check('reference resource is still listed', resources.result.resources.some((r) => r.uri === 'reference://lexware/api'));
  server.child.kill();
}

console.log('\n== 2. LEXWARE_READ_ONLY unset ==');
{
  const server = await session({});
  const { result } = await server.request('tools/list', {});
  const create = result.tools.find((t) => t.name === 'lexware_create_invoice');
  console.log(`tools listed: ${result.tools.length}; lexware_create_invoice: ${JSON.stringify(create.description.slice(0, 70))}...`);
  check('no tool is marked blocked', result.tools.every((t) => !t.description.startsWith(BLOCKED_PREFIX)));
  server.child.kill();
}

console.log('\n== 3. LEXWARE_READ_ONLY=yes ==');
{
  const server = startServer({ LEXWARE_READ_ONLY: 'yes' });
  server.ready.catch(() => {});
  const { code, stderr } = await server.exited;
  const errorLine = stderr.split('\n').find((line) => line.includes('LEXWARE_READ_ONLY')) ?? '';
  console.log(`exit code: ${code}; ${errorLine.trim()}`);
  check('the server refuses to start', code !== 0 && errorLine !== '');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
