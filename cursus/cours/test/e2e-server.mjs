// Serveur de test navigateur : vrai site + vraie API + IA simulée (aucun réseau, aucune clé).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApi } from '../lib/core.mjs'; import { fileStorage } from '../lib/storage-file.mjs'; import { fakeFetch } from './fake-ai.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const env = { GROQ_API_KEYS: 'gsk_AAAAAAAAAAAAAAAAAAAAAAAA', GEMINI_API_KEYS: 'AIzaCCCCCCCCCCCCCCCCCCCCCCCC', ADMIN_PASSWORD: 'MotDePasseDeTest!' };
const handle = createApi(fileStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')), 'd.json')), { env, fetch: fakeFetch });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks); const audio = /^audio\//.test(req.headers['content-type'] || '');
    const r = await handle({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, rawBody: audio ? '' : buf.toString(), bytes: audio ? new Uint8Array(buf) : null, host: req.headers.host, ip: '1.1.1.1', secure: false });
    res.writeHead(r.status, { 'content-type': 'application/json', ...(r.cookies.length ? { 'set-cookie': r.cookies } : {}) }); return res.end(JSON.stringify(r.body));
  }
  const f = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); });
}).listen(3111, () => console.log('e2e http://localhost:3111'));
