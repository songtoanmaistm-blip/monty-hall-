// Local test server: serves the site and runs apps-script/Code.gs against an in-memory Sheet.
//   node tests/dev-server.js        → http://localhost:8787/  (results: /results.html?key=testkey)
//   /__offline?on=1  / ?on=0        → simulate a network outage for the API
// The real config.js is not changed; this server serves a config.js that points to /api.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadCodeGs } = require('./gas-mock.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8787;
const gas = loadCodeGs({ adminKey: 'testkey' });
let offline = false;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.md': 'text/plain' };

http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__offline') {
    offline = url.searchParams.get('on') === '1';
    res.end('offline=' + offline);
    return;
  }
  if (url.pathname === '/api') {
    if (offline) { req.socket.destroy(); return; }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', function (c) { body += c; });
      req.on('end', function () {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(gas.post(body)));
      });
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(gas.get(Object.fromEntries(url.searchParams))));
    }
    return;
  }
  if (url.pathname === '/config.js') {
    const src = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8').replace(/API_URL:\s*"[^"]*"/, 'API_URL: "/api"');
    res.setHeader('Content-Type', 'text/javascript');
    res.end(src);
    return;
  }
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, function () { console.log('Dev server on http://localhost:' + PORT); });
