// Drives the PUBLISHED tarball over stdio and asserts the 5.0.0 contract.
import { spawn } from 'node:child_process';

// Runs the bin from a real `npm i @lazyants/lexware-mcp-server@5.0.0` install
// (path passed in argv[2]) rather than via npx, whose cache races produced
// intermittent `command not found` exits.
const BIN = process.argv[2];
const child = spawn(process.execPath, [BIN], {
  env: { ...process.env, LEXWARE_API_TOKEN: 'smoke-not-a-real-token' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

// Anything written before the server attaches its stdin reader is lost, so wait
// for its own readiness banner on stderr rather than guessing a delay.
const ready = new Promise((res, rej) => {
  let e = '';
  child.stderr.on('data', (d) => { e += d.toString(); if (e.includes('running on stdio')) res(); });
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
const wait = (id) =>
  new Promise((res, rej) => {
    const t = setInterval(() => {
      const m = msgs.find((x) => x.id === id);
      if (m) { clearInterval(t); clearTimeout(k); res(m); }
    }, 50);
    const k = setTimeout(() => { clearInterval(t); rej(new Error(`timeout waiting for id=${id}`)); }, 60000);
  });

await ready;

send({ jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });
const init = await wait(1);
console.log(`serverInfo: ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);

send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
const list = await wait(2);
console.log(`tools advertised: ${list.result.tools.length}`);

let bad = 0;
for (const name of ['lexware_upload_file', 'lexware_upload_voucher_file']) {
  const t = list.result.tools.find((x) => x.name === name);
  const ct = t.inputSchema.properties.contentType;
  const re = new RegExp(ct.pattern);
  const req = (t.inputSchema.required || []).includes('contentType');
  const chk = (v, want) => { const got = re.test(v); if (got !== want) bad++; return got === want ? 'ok' : 'REGRESSION'; };
  console.log(`\n${name}`);
  console.log(`  pattern: ${ct.pattern}`);
  console.log(`  ""                              -> ${re.test('') ? 'ACCEPT' : 'REJECT'}  [${chk('', false)}]   <- the 5.0.0 break`);
  console.log(`  "application/pdf"               -> ${re.test('application/pdf') ? 'ACCEPT' : 'REJECT'}  [${chk('application/pdf', true)}]`);
  console.log(`  "application/pdf; charset=utf-8" -> ${re.test('application/pdf; charset=utf-8') ? 'ACCEPT' : 'REJECT'}  [${chk('application/pdf; charset=utf-8', true)}]`);
  console.log(`  "application/pdf\\r\\nX-Injected: e" -> ${re.test('application/pdf\r\nX-Injected: e') ? 'ACCEPT' : 'REJECT'}  [${chk('application/pdf\r\nX-Injected: e', false)}]`);
  console.log(`  in required[]: ${req}  [${req === false ? 'ok' : 'REGRESSION'}]  (false = omitting it still defaults to application/pdf)`);
  if (req !== false) bad++;
}
child.kill();
console.log(`\nassertions failed: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
