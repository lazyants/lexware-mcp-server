// Drives the PUBLISHED 5.5.0 tarball over stdio against a local stand-in for the Lexware API and
// asserts the 5.5.0 contract:
//   1. an invalid LEXWARE_API_BASE stops the server before it serves anything (no fallback);
//   2. a valid LEXWARE_API_BASE is announced on stderr and every request goes there;
//   3. lexware_list_voucherlist stops at Lexware's 10,000-entry search window and reports
//      searchWindowReached instead of a silently complete result.
// Usage: node drive-smoke.mjs <path to node_modules/@lazyants/lexware-mcp-server/dist/index.js>
import { spawn } from 'node:child_process';
import http from 'node:http';

const BIN = process.argv[2];
const TOKEN = 'smoke-not-a-real-token';
const WINDOW = 10_000;
let failed = 0;
const check = (label, ok) => {
  if (!ok) failed++;
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${label}`);
};

// --- Stand-in for the Lexware REST API -------------------------------------------------------
// Behaves like Lexware's documented paging: totalElements is capped at the search window, and a
// page reaching past the window is rejected with 400 "Maximum search window size exceeded".
const seen = { requests: 0, maxPage: -1, rejected: 0, authOk: 0, authBad: 0, paths: new Set() };
const api = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://stand-in');
  seen.requests++;
  seen.paths.add(url.pathname);
  // Compare, never print: if the keyring override failed, this header would carry a real token.
  if (req.headers.authorization === `Bearer ${TOKEN}`) seen.authOk++; else seen.authBad++;
  if (url.pathname !== '/v1/voucherlist') {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 404, message: 'not in stand-in' }));
  }
  const page = Number(url.searchParams.get('page') ?? 0);
  const size = Number(url.searchParams.get('size') ?? 25);
  seen.maxPage = Math.max(seen.maxPage, page);
  if ((page + 1) * size > WINDOW) {
    seen.rejected++;
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 400, message: 'Maximum search window size exceeded' }));
  }
  // 15,000 vouchers "match"; Lexware reports at most the window. Every 1,000th has an open amount.
  const content = Array.from({ length: size }, (_, i) => {
    const n = page * size + i;
    return { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, voucherType: 'invoice',
      contactName: `Customer ${n}`, openAmount: n % 1000 === 0 ? 100 : 0 };
  });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content, totalPages: Math.ceil(WINDOW / size), totalElements: WINDOW,
    first: page === 0, last: (page + 1) * size >= WINDOW, size, number: page }));
});
await new Promise((r) => api.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${api.address().port}/v1`;
console.log(`stand-in Lexware API listening on ${BASE}\n`);

// The real token may sit in the OS keyring, and a keyring token wins over LEXWARE_API_TOKEN, so
// point the keyring lookup at a service that does not exist.
const env = (apiBase) => ({ ...process.env, LEXWARE_API_BASE: apiBase, LEXWARE_API_TOKEN: TOKEN,
  LEXWARE_KEYRING_SERVICE: 'lexware-mcp-smoke-no-such-service' });

// --- 1. Invalid base: the server must refuse to start ----------------------------------------
console.log(`1. LEXWARE_API_BASE="${BASE}?" (empty query: invalid)`);
{
  const child = spawn(process.execPath, [BIN], { env: env(`${BASE}?`), stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d.toString(); });
  const code = await new Promise((r) => {
    const k = setTimeout(() => { child.kill(); r('still running after 15s'); }, 15000);
    child.on('exit', (c) => { clearTimeout(k); r(c); });
  });
  console.log(`  exit code: ${code}`);
  console.log(`  stderr: ${err.trim().split('\n').find((l) => l.includes('LEXWARE_API_BASE')) ?? '(none)'}`);
  check('server exits with a non-zero code', typeof code === 'number' && code !== 0);
  check('stderr names the invalid LEXWARE_API_BASE', err.includes('LEXWARE_API_BASE must be'));
  check('never announced "running on stdio"', !err.includes('running on stdio'));
  check('stand-in received no request', seen.requests === 0);
}

// --- 2 + 3. Valid base -----------------------------------------------------------------------
console.log(`\n2. LEXWARE_API_BASE="${BASE}/" (valid, trailing slash)`);
const child = spawn(process.execPath, [BIN], { env: env(`${BASE}/`), stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
// Anything written before the server attaches its stdin reader is lost, so wait for its own
// readiness banner on stderr rather than guessing a delay.
const ready = new Promise((res, rej) => {
  child.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.includes('running on stdio')) res(); });
  setTimeout(() => rej(new Error('server never announced readiness')), 60000);
});
let buf = '';
const msgs = [];
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) msgs.push(JSON.parse(line));
  }
});
const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
const wait = (id) => new Promise((res, rej) => {
  const t = setInterval(() => {
    const m = msgs.find((x) => x.id === id);
    if (m) { clearInterval(t); clearTimeout(k); res(m); }
  }, 50);
  const k = setTimeout(() => { clearInterval(t); rej(new Error(`timeout waiting for id=${id}`)); }, 120000);
});

await ready;
for (const l of stderr.trim().split('\n')) console.log(`  stderr: ${l}`);
check('stderr announces the override and its target', stderr.includes(`requests go to ${BASE} instead of https://api.lexware.io/v1`));
check('banner reports v5.5.0', stderr.includes('running on stdio (v5.5.0)'));

send({ jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });
const init = await wait(1);
console.log(`  serverInfo: ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
check('serverInfo.version is 5.5.0', init.result.serverInfo.version === '5.5.0');
send({ jsonrpc: '2.0', method: 'notifications/initialized' });

send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
const list = await wait(2);
const vl = list.result.tools.find((t) => t.name === 'lexware_list_voucherlist');
console.log(`  tools advertised: ${list.result.tools.length}`);
check('main entry advertises 66 tools', list.result.tools.length === 66);
check('voucherlist description mentions searchWindowReached',
  JSON.stringify(vl.inputSchema).includes('searchWindowReached'));

console.log('\n3. lexware_list_voucherlist { hasOpenAmount: true } against a 15,000-voucher account');
send({ jsonrpc: '2.0', id: 3, method: 'tools/call',
  params: { name: 'lexware_list_voucherlist', arguments: { hasOpenAmount: true } } });
const call = await wait(3);
const text = call.result?.content?.[0]?.text ?? '';
let out = {};
try { out = JSON.parse(text); } catch { console.log(`  raw result: ${text.slice(0, 300)}`); }
console.log(`  isError=${call.result?.isError ?? false} fetchedPages=${out.fetchedPages} filteredCount=${out.filteredCount} ` +
  `totalElements=${out.totalElements} truncated=${out.truncated} searchWindowReached=${out.searchWindowReached}`);
console.log(`  stand-in saw: ${seen.requests} requests on ${[...seen.paths].join(', ')}, highest page ${seen.maxPage}, ` +
  `${seen.rejected} rejected past the window, smoke token on ${seen.authOk}/${seen.requests}`);
check('tool call succeeded', call.result && !call.result.isError);
check('read 40 pages of 250 (the whole window)', out.fetchedPages === 40);
check('10 entries with an open amount kept', out.filteredCount === 10);
check('searchWindowReached is true', out.searchWindowReached === true);
check('no page past the window was requested', seen.rejected === 0 && seen.maxPage === 39);
check('every request went to the stand-in with the smoke token', seen.authBad === 0 && seen.authOk === 40);

child.kill();
api.close();
console.log(`\nassertions failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
