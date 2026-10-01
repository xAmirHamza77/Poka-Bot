const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

function createLocalServer(uiRoot, backendPort) {
  const root = path.resolve(uiRoot);
  return http.createServer((req, res) => {
    // Reject DNS rebinding and requests from unrelated sites before serving UI/API.
    const expectedHost = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) {
      res.writeHead(403).end('Untrusted origin'); return;
    }
    const requestPath = new URL(req.url, `http://${expectedHost}`).pathname;
    if (requestPath === '/api/v1' || requestPath.startsWith('/api/v1/')) {
      const headers = { ...req.headers, host: `127.0.0.1:${backendPort}` };
      delete headers.connection;
      const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers }, (response) => {
        res.writeHead(response.statusCode, { ...response.headers, 'cache-control': 'no-store' });
        response.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Local backend unavailable'); });
      res.on('close', () => upstream.destroy());
      req.pipe(upstream); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    let decoded;
    try { decoded = decodeURIComponent(requestPath); } catch { res.writeHead(400).end(); return; }
    let file = path.resolve(root, `.${decoded}`);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
}
module.exports = { createLocalServer };
