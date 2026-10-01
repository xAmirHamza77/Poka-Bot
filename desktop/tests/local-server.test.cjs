const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createLocalServer } = require('../local-server.cjs');

test('desktop static files, same-origin API streaming, and origin restrictions', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poka-server-'));
  fs.mkdirSync(path.join(root, 'app')); fs.writeFileSync(path.join(root, 'app/index.html'), '<h1>Poka</h1>');
  const backend = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/event-stream'); res.write('data: first\n\n'); setTimeout(() => res.end('data: second\n\n'), 10); });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const server = createLocalServer(root, backend.address().port);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); backend.close(); fs.rmSync(root, { recursive: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(`${origin}/app/`)).text(), '<h1>Poka</h1>');
  const stream = await fetch(`${origin}/api/v1/stream`, { headers: { Origin: origin } });
  assert.equal(await stream.text(), 'data: first\n\ndata: second\n\n');
  assert.equal((await fetch(`${origin}/api/v1/test`, { headers: { Origin: 'https://untrusted.test' } })).status, 403);
  const badHostStatus = await new Promise(resolve => { http.get(`${origin}/app/`, { headers: { Host: 'untrusted.test' } }, response => { response.resume(); resolve(response.statusCode); }); });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(`${origin}/%2e%2e%2foutside`)).status, 403);
  assert.equal((await fetch(`${origin}/missing`)).status, 404);
});
