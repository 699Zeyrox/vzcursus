/*
  Serveur local de test : node server.mjs  puis  http://localhost:3000
  Variables : GROQ_API_KEYS (voir README). Données dans data/cours.json.
  Attention : le micro n'est autorisé que sur localhost ou en HTTPS.
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './lib/core.mjs';
import { fileStorage } from './lib/storage-file.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = process.env.COURS_DATA ? path.join(process.env.COURS_DATA, 'cours.json') : path.join(ROOT, 'data', 'cours.json');

const handle = createApi(fileStorage(DATA_FILE));

const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'microphone=(self)' };
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'";
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('trop gros')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  let raw = '', bytes = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const audio = /^audio\//i.test(req.headers['content-type'] || '');
    try {
      const buf = await readBody(req, audio ? 6 * 1024 * 1024 : 1024 * 1024);
      if (audio) bytes = new Uint8Array(buf); else raw = buf.toString('utf8');
    } catch (e) { res.writeHead(413, SEC); return res.end(); }
  }
  const r = await handle({
    method: req.method, path: url.pathname, search: url.search, headers: req.headers, rawBody: raw, bytes,
    host: req.headers.host, ip: req.socket.remoteAddress || '', secure: false,
  });
  const headers = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SEC);
  if (r.cookies.length) headers['Set-Cookie'] = r.cookies;
  res.writeHead(r.status, headers);
  res.end(JSON.stringify(r.body));
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Page introuvable'); }
    const ext = path.extname(file).toLowerCase();
    const headers = Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, SEC);
    if (ext === '.html') headers['Content-Security-Policy'] = CSP;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(500, SEC); res.end(); }
  }
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? 'Le port ' + PORT + ' est déjà utilisé. Essaie : PORT=3001 node server.mjs' : e);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log('Cursus (test local) : http://localhost:' + PORT);
  console.log('Données : ' + DATA_FILE);
});
