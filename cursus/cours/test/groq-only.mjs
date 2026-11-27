/* Test : le site marche avec UNE SEULE clé Groq, et passe au modèle suivant quand un quota est atteint. */
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createApi } from '../lib/core.mjs';
import { fileStorage } from '../lib/storage-file.mjs';
import { fakeFetch, calls } from './fake-ai.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groq-'));
const store = fileStorage(path.join(dir, 'd.json'));
const env = { GROQ_API_KEYS: 'gsk_ONLYGROQKEYAAAAAAAAAAAA' };
let limited = 'openai/gpt-oss-120b'; // ce modèle répond « quota dépassé »
const f = (u, i) => {
  if (String(u).includes('chat/completions') && JSON.parse(i.body).model === limited) return Promise.resolve(new Response('{"error":{"message":"Rate limit reached on tokens per day"}}', { status: 429, headers: { 'retry-after': '1800' } }));
  return fakeFetch(u, i);
};
const handle = createApi(store, { env, fetch: f });
const jar = {};
async function call(method, p, body) {
  const headers = { 'x-requested-with': 'cours' };
  if (Object.keys(jar).length) headers.cookie = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
  const [pathname, search] = p.split('?');
  const req = { method, path: pathname, search: search ? '?' + search : '', headers, rawBody: '', bytes: null, host: 'x', ip: '1.1.1.1', secure: false };
  if (body instanceof Uint8Array) { headers['content-type'] = 'audio/webm'; req.bytes = body; } else if (body !== undefined) { req.rawBody = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const r = await handle(req);
  for (const c of r.cookies) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar[k] = v; }
  return r;
}
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.error('  ECHEC ' + name, e); process.exitCode = 1; } };

await call('POST', '/api/register', { pseudo: 'groqonly', password: 'motdepasse1' });
const subj = (await call('POST', '/api/subjects', { name: 'SVT' })).body.subject;

await t('un cours entier se traite avec Groq seul, en sautant le modèle en quota', async () => {
  const l = (await call('POST', '/api/lessons', { subjectId: subj.id })).body.lesson;
  for (let i = 0; i < 3; i++) assert.equal((await call('PUT', '/api/lessons/' + l.id + '/chunks/' + i, new Uint8Array(4000).fill(5))).status, 200);
  assert.equal((await call('POST', '/api/lessons/' + l.id + '/finish', { chunks: 3 })).body.ok, true);
  let last; for (let i = 0; i < 20; i++) { last = (await call('POST', '/api/lessons/' + l.id + '/step', {})); assert.equal(last.status, 200, JSON.stringify(last.body)); if (last.body.done) break; }
  assert.equal(last.body.done, true);
  assert.equal((await call('GET', '/api/lessons/' + l.id)).body.lesson.status, 'ready');
  assert.ok(calls.groqChat > 0, 'Groq a bien servi pour le texte');
  assert.ok(!calls.groqModels.slice(-3).includes('openai/gpt-oss-120b') || calls.groqModels.includes('openai/gpt-oss-20b'), 'bascule sur un autre modèle');
  assert.ok(calls.groqModels.some((m) => m !== 'openai/gpt-oss-120b'));
});
await t('les morceaux envoyés à l\'IA restent petits (quota de 8 000 jetons par minute)', async () => {
  // gros texte : beaucoup d'extraits -> plusieurs groupes de ~700 mots maximum
  const l = (await call('POST', '/api/lessons', { subjectId: subj.id })).body.lesson;
  for (let i = 0; i < 40; i++) await call('PUT', '/api/lessons/' + l.id + '/chunks/' + i, new Uint8Array(4000).fill(6));
  const r = await call('POST', '/api/lessons/' + l.id + '/finish', { chunks: 40 });
  assert.equal(r.body.ok, true);
  const doc = await store.get('lesson/' + l.id);
  assert.ok(doc.plan.groups.length >= 2, 'le cours est coupé en plusieurs morceaux');
});
await t('une fiche se crée avec Groq seul', async () => {
  const r = await call('POST', '/api/sheets', { subjectId: subj.id, scope: 'notion', query: 'photosynthèse' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  let s; for (let i = 0; i < 10; i++) { s = (await call('POST', '/api/sheets/' + r.body.id + '/step', {})).body; if (s.done) break; }
  assert.equal(s.done, true);
});
await t('si tous les modèles Groq sont en quota : 503 avec l\'heure de reprise', async () => {
  limited = '*';
  const f2 = (u, i) => (String(u).includes('chat/completions') ? Promise.resolve(new Response('{"error":{"message":"limite"}}', { status: 429, headers: { 'retry-after': '120' } })) : fakeFetch(u, i));
  const h2 = createApi(store, { env, fetch: f2 });
  for (const k of await store.list('aicool/')) await store.del(k);
  const sheet = (await call('POST', '/api/sheets', { subjectId: subj.id, scope: 'notion', query: 'photosynthèse' })).body;
  const headers = { 'x-requested-with': 'cours', 'content-type': 'application/json', cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') };
  const r = await h2({ method: 'POST', path: '/api/sheets/' + sheet.id + '/step', search: '', headers, rawBody: '{}', bytes: null, host: 'x', ip: '1.1.1.1', secure: false });
  assert.equal(r.status, 503); assert.ok(r.body.retryAfter >= 5);
});
console.log('\n' + n + ' tests réussis (Groq seul)');
fs.rmSync(dir, { recursive: true, force: true });
