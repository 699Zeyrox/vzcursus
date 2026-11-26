/* Tests de l'API avec une IA simulée : node test/run.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi, filterSegments, pickSections } from '../lib/core.mjs';
import { fileStorage } from '../lib/storage-file.mjs';

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('  ECHEC ' + name + '\n', e); process.exitCode = 1; } };

/* ----- IA simulée (Groq + Gemini) ----- */
const calls = { groqStt: [], gemini: [], groqChat: 0 };
let quotaOnKey = null;       // clé Groq qui répond 429
let geminiDown = false;      // Gemini répond 429 « par jour »
function fakeFetch(url, init) {
  const u = String(url);
  const hdr = init.headers || {};
  const resp = (status, body, headers) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) }));
  if (u.includes('api.groq.com/openai/v1/audio/transcriptions')) {
    const key = String(hdr.authorization || '').replace('Bearer ', '');
    calls.groqStt.push(key);
    if (key === quotaOnKey) return resp(429, { error: { message: 'Rate limit reached for audio seconds per day' } }, { 'retry-after': '3600' });
    return resp(200, { text: 'x', duration: 120, segments: [
      { text: ' La photosynthèse est la transformation de l\'énergie lumineuse en énergie chimique.', avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.4 },
      { text: ' Sous-titrage ST\' 501', avg_logprob: -0.3, no_speech_prob: 0.1, compression_ratio: 1.0 },
      { text: ' bruit de chaise', avg_logprob: -1.8, no_speech_prob: 0.9, compression_ratio: 1.0 },
      { text: ' Elle a lieu dans les chloroplastes, grâce à la chlorophylle, et produit du glucose et du dioxygène.', avg_logprob: -0.25, no_speech_prob: 0.02, compression_ratio: 1.5 },
    ] });
  }
  if (u.includes('generativelanguage.googleapis.com')) {
    calls.gemini.push(u);
    if (geminiDown) return resp(429, { error: { message: 'Quota exceeded for metric ... PerDay', details: [] } });
    const body = JSON.parse(init.body);
    if (!body.systemInstruction) return resp(200, { candidates: [{ content: { parts: [{ text: 'Transcription de secours par Gemini : la photosynthèse a lieu dans les chloroplastes.' }] } }] });
    const sys = body.systemInstruction.parts[0].text;
    let out;
    if (sys.includes('prise de notes')) out = { text: 'La photosynthèse est la transformation de l\'énergie lumineuse en énergie chimique. Elle a lieu dans les chloroplastes, grâce à la chlorophylle, et produit du glucose et du dioxygène.' };
    else if (sys.includes('structures')) out = { sections: [{ heading: 'Définition', content: '- **Photosynthèse** : transformation de l\'énergie lumineuse en énergie chimique.\n- Lieu : les chloroplastes.', terms: ['photosynthèse', 'chloroplaste'] }] };
    else if (sys.includes('termines')) out = { title: 'La photosynthèse', summary: 'Le professeur définit la photosynthèse.', keyPoints: ['Définition', 'Chloroplastes'], assignments: [{ i: 0, chapter: 'La photosynthèse' }] };
    else if (sys.includes('fiches de révision')) {
      return resp(200, { candidates: [{ content: { parts: [{ text: '## Photosynthèse\n- **Définition** : « transformation de l\'énergie lumineuse en énergie chimique ».' }] } }] });
    } else out = { ok: true };
    return resp(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
  }
  return resp(404, {});
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cours-'));
const env = { GROQ_API_KEYS: 'gsk_AAAAAAAAAAAAAAAAAAAAAAAA, gsk_BBBBBBBBBBBBBBBBBBBBBBBB', GEMINI_API_KEYS: 'AIzaCCCCCCCCCCCCCCCCCCCCCCCC', ADMIN_PASSWORD: 'MotDePasseDeTest!' };
const store = fileStorage(path.join(dir, 'd.json'));
const handle = createApi(store, { env, fetch: fakeFetch });
let H = handle; // le handler utilisé par les clients (remplaçable dans un test)

function client() {
  const jar = {};
  async function call(method, p, body, extra) {
    const headers = Object.assign({ 'x-requested-with': 'cours' }, extra || {});
    if (Object.keys(jar).length) headers.cookie = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
    const [pathname, search] = p.split('?');
    const req = { method, path: pathname, search: search ? '?' + search : '', headers, rawBody: '', bytes: null, host: 'localhost', ip: '1.2.3.4', secure: false };
    if (body instanceof Uint8Array) { headers['content-type'] = 'audio/webm'; req.bytes = body; }
    else if (body !== undefined) { req.rawBody = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const r = await H(req);
    for (const c of r.cookies) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v; }
    return r;
  }
  return { call, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b || {}), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p) };
}
const audio = new Uint8Array(5000).fill(7);

async function recordLesson(c, subjectId, nChunks, title) {
  const l = (await c.post('/api/lessons', { subjectId, title })).body.lesson;
  for (let i = 0; i < nChunks; i++) { const r = await c.put('/api/lessons/' + l.id + '/chunks/' + i, audio); assert.equal(r.status, 200, JSON.stringify(r.body)); }
  const f = await c.post('/api/lessons/' + l.id + '/finish', { chunks: nChunks, durationSec: 240 });
  assert.equal(f.body.ok, true);
  let last;
  for (let i = 0; i < 30; i++) { last = (await c.post('/api/lessons/' + l.id + '/step')).body; if (last.done) break; }
  assert.equal(last.done, true);
  return l.id;
}

console.log('Filtre et recherche');
await t('filterSegments retire bruit et hallucinations', () => {
  const f = filterSegments({ segments: [
    { text: 'Bonjour à tous', avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1 },
    { text: 'Sous-titrage Société Radio-Canada', avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1 },
    { text: 'hmm', avg_logprob: -1.5, no_speech_prob: 0.8, compression_ratio: 1 },
  ] });
  assert.equal(f.text, 'Bonjour à tous'); assert.equal(f.dropped, 2);
});
await t('pickSections retrouve une notion avec accents et pluriels', () => {
  const course = { chapters: [{ title: 'Cellule', sections: [{ heading: 'Mitochondries', content: 'La mitochondrie produit l\'énergie.' }, { heading: 'Noyau', content: 'ADN' }] }] };
  const r = pickSections(course, 'énergie des mitochondries', 10000);
  assert.equal(r.found, true); assert.equal(r.parts[0].heading, 'Mitochondries');
});

console.log('Comptes et admin');
const A = client(), B = client(), ADM = client();
await t('inscription, connexion, mauvais mot de passe', async () => {
  assert.equal((await A.post('/api/register', { pseudo: 'alice', password: 'motdepasse1' })).status, 201);
  assert.equal((await B.post('/api/register', { pseudo: 'bob', password: 'motdepasse2' })).status, 201);
  assert.equal((await client().post('/api/register', { pseudo: 'Alice', password: 'motdepasse1' })).status, 409);
  assert.equal((await client().post('/api/login', { pseudo: 'alice', password: 'mauvais-mdp' })).status, 401);
  assert.equal((await A.get('/api/me')).body.user.pseudo, 'alice');
});
await t('protection CSRF et accès sans compte', async () => {
  const r = await handle({ method: 'POST', path: '/api/subjects', headers: {}, rawBody: '{}', host: 'x', ip: '' });
  assert.equal(r.status, 403);
  assert.equal((await client().get('/api/subjects')).status, 401);
});
await t('admin : même identifiant que VZ Gym, refus si mauvais mot de passe', async () => {
  assert.equal((await ADM.post('/api/admin/login', { id: 'Frexi699*', password: 'faux' })).status, 403);
  assert.equal((await ADM.get('/api/admin/users')).status, 403);
  assert.equal((await ADM.post('/api/admin/login', { id: 'Frexi699*', password: 'MotDePasseDeTest!' })).status, 200);
  const u = (await ADM.get('/api/admin/users')).body.users;
  assert.deepEqual(u.map((x) => x.pseudo).sort(), ['alice', 'bob']);
});

console.log('Matières, enregistrement, traitement');
let subj, lessonId;
await t('créer des matières (doublon refusé)', async () => {
  subj = (await A.post('/api/subjects', { name: 'SVT' })).body.subject;
  assert.ok(subj.id && subj.color);
  assert.equal((await A.post('/api/subjects', { name: 'svt' })).status, 409);
  await A.post('/api/subjects', { name: 'Maths' });
  assert.equal((await A.get('/api/subjects')).body.subjects.length, 2);
});
await t('enregistrer 2 segments, nettoyer, structurer, classer dans le cours global', async () => {
  lessonId = await recordLesson(A, subj.id, 2, '');
  const l = (await A.get('/api/lessons/' + lessonId)).body.lesson;
  assert.equal(l.status, 'ready');
  assert.equal(l.title, 'La photosynthèse'); // titre automatique
  assert.ok(l.recap.summary && l.recap.keyPoints.length);
  const tr = (await A.get('/api/lessons/' + lessonId + '/transcript')).body.text;
  assert.ok(tr.includes('chloroplastes')); assert.ok(!/Sous-titrage|chaise/.test(tr), 'le bruit doit être filtré');
  const course = (await A.get('/api/subjects/' + subj.id + '/course')).body.course;
  assert.equal(course.chapters.length, 1); assert.equal(course.chapters[0].title, 'La photosynthèse');
});
await t('segment renvoyé deux fois : pas de nouvel appel IA', async () => {
  const l = (await A.post('/api/lessons', { subjectId: subj.id, title: 'Test' })).body.lesson;
  await A.put('/api/lessons/' + l.id + '/chunks/0', audio);
  const n = calls.groqStt.length;
  const r = await A.put('/api/lessons/' + l.id + '/chunks/0', audio);
  assert.equal(r.body.duplicate, true); assert.equal(calls.groqStt.length, n);
  const f = await A.post('/api/lessons/' + l.id + '/finish', { chunks: 2 });
  assert.deepEqual(f.body.missing, [1]); // le segment manquant est signalé au site
  await A.del('/api/lessons/' + l.id);
});
await t('un 2e cours s\'ajoute au cours global (rejouer une étape ne duplique pas)', async () => {
  const id2 = await recordLesson(A, subj.id, 1, 'Cours du jeudi');
  await A.post('/api/lessons/' + id2 + '/step'); // déjà prêt : sans effet
  const course = (await A.get('/api/subjects/' + subj.id + '/course')).body.course;
  assert.equal(course.chapters.length, 1);
  assert.equal(course.chapters[0].sections.length, 2);
  assert.deepEqual(new Set(course.chapters[0].sections.map((s) => s.lessonId)).size, 2);
});
await t('un autre utilisateur ne voit pas mes cours', async () => {
  assert.equal((await B.get('/api/lessons/' + lessonId)).status, 404);
  assert.equal((await B.put('/api/lessons/' + lessonId + '/chunks/5', audio)).status, 404);
});

console.log('Clés d\'IA : quota dépassé, rotation, renouvellement');
await t('une clé Groq en quota est mise en pause, la suivante prend le relais', async () => {
  quotaOnKey = 'gsk_AAAAAAAAAAAAAAAAAAAAAAAA';
  const l = (await A.post('/api/lessons', { subjectId: subj.id })).body.lesson;
  let n = 0;
  const paused = async () => (await ADM.get('/api/admin/ai')).body.status.groq.filter((k) => k.cooling.length).length;
  while (!(await paused()) && n < 40) { assert.equal((await A.put('/api/lessons/' + l.id + '/chunks/' + n, audio)).status, 200); n++; } // jamais d'échec visible : on bascule sur la clé B
  assert.equal(await paused(), 1, 'la clé en quota doit apparaître en pause');
  const before = calls.groqStt.filter((k) => k === quotaOnKey).length;
  for (let i = 0; i < 6; i++) assert.equal((await A.put('/api/lessons/' + l.id + '/chunks/' + (n + i), audio)).status, 200);
  assert.equal(calls.groqStt.filter((k) => k === quotaOnKey).length, before, 'la clé en pause n\'est plus appelée');
  await A.del('/api/lessons/' + l.id);
});
await t('la pause expire toute seule puis la clé est réutilisée', async () => {
  for (const k of await store.list('aicool/')) { const v = await store.get(k); v.until = Date.now() - 1000; await store.set(k, v); }
  quotaOnKey = null;
  const l = (await A.post('/api/lessons', { subjectId: subj.id })).body.lesson;
  const before = calls.groqStt.length;
  for (let i = 0; i < 12; i++) await A.put('/api/lessons/' + l.id + '/chunks/' + i, audio);
  const used = new Set(calls.groqStt.slice(before));
  assert.equal(used.size, 2, 'les deux clés servent de nouveau');
  await A.del('/api/lessons/' + l.id);
});
await t('toutes les clés Groq en pause : bascule sur Gemini pour l\'audio', async () => {
  for (const k of await store.list('aicool/')) await store.del(k);
  const noGroq = (u, i) => (String(u).includes('groq.com') ? Promise.resolve(new Response('{"error":{"message":"limite"}}', { status: 429, headers: { 'retry-after': '120' } })) : fakeFetch(u, i));
  H = createApi(store, { env, fetch: noGroq });
  const l = (await A.post('/api/lessons', { subjectId: subj.id })).body.lesson;
  const g0 = calls.gemini.length;
  const r = await A.put('/api/lessons/' + l.id + '/chunks/0', audio);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(calls.gemini.length > g0, 'Gemini a pris le relais');
  H = handle;
  for (const k of await store.list('aicool/')) await store.del(k);
  await A.del('/api/lessons/' + l.id);
});
await t('quota partout : 503 + retryAfter, puis tout reprend quand le quota se renouvelle', async () => {
  for (const k of await store.list('aicool/')) await store.del(k);
  geminiDown = true;
  const allDown = (u, i) => (String(u).includes('groq.com') ? Promise.resolve(new Response('{"error":{"message":"limite"}}', { status: 429, headers: { 'retry-after': '90' } })) : fakeFetch(u, i));
  H = createApi(store, { env, fetch: allDown });
  const l = (await A.post('/api/lessons', { subjectId: subj.id })).body.lesson;
  const r = await A.put('/api/lessons/' + l.id + '/chunks/0', audio);
  assert.equal(r.status, 503); assert.ok(r.body.retryAfter >= 5, 'le site sait combien de temps attendre');
  assert.equal((await store.list('lchunk/' + l.id + '/')).length, 0, 'rien n\'est enregistré à moitié');
  // le quota se renouvelle : on fait expirer les pauses
  for (const k of await store.list('aicool/')) { const v = await store.get(k); v.until = Date.now() - 1; await store.set(k, v); }
  geminiDown = false; H = handle;
  assert.equal((await A.put('/api/lessons/' + l.id + '/chunks/0', audio)).status, 200);
  await A.del('/api/lessons/' + l.id);
});

console.log('Fiches de révision');
let sheetId;
await t('fiche sur une notion, un chapitre et tout le cours', async () => {
  const mk = async (b) => {
    const r = await A.post('/api/sheets', Object.assign({ subjectId: subj.id }, b));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    let s;
    for (let i = 0; i < 50; i++) { s = (await A.post('/api/sheets/' + r.body.id + '/step')).body; if (s.done) break; }
    assert.equal(s.done, true);
    return (await A.get('/api/sheets/' + r.body.id)).body.sheet;
  };
  const a = await mk({ scope: 'notion', query: 'chloroplaste' });
  assert.equal(a.status, 'ready'); assert.ok(a.content.includes('Photosynthèse')); sheetId = a.id;
  const course = (await A.get('/api/subjects/' + subj.id + '/course')).body.course;
  const b = await mk({ scope: 'chapter', chapterId: course.chapters[0].id });
  assert.ok(b.content.length > 10);
  const c = await mk({ scope: 'all' });
  assert.ok(c.content.length > 10);
  assert.equal((await A.get('/api/sheets')).body.sheets.length, 3);
});
await t('fiche refusée si la matière n\'a pas de cours', async () => {
  const maths = (await A.get('/api/subjects')).body.subjects.find((s) => s.name === 'Maths');
  assert.equal((await A.post('/api/sheets', { subjectId: maths.id, scope: 'all' })).status, 400);
});

console.log('Partage entre utilisateurs');
await t('recherche de pseudo, envoi d\'une fiche, acceptation', async () => {
  assert.deepEqual((await A.get('/api/users?q=bo')).body.users, ['bob']);
  assert.equal((await A.post('/api/share', { kind: 'sheet', refId: sheetId, to: 'inconnu' })).status, 404);
  assert.equal((await A.post('/api/share', { kind: 'sheet', refId: sheetId, to: 'alice' })).status, 400);
  const s = await A.post('/api/share', { kind: 'sheet', refId: sheetId, to: 'bob' });
  assert.equal(s.status, 201);
  assert.equal((await B.get('/api/me')).body.pending, 1);
  const inbox = (await B.get('/api/inbox')).body.received;
  assert.equal(inbox[0].fromPseudo, 'alice');
  assert.equal((await B.post('/api/share/' + inbox[0].id + '/accept')).status, 200);
  const sheets = (await B.get('/api/sheets')).body.sheets;
  assert.equal(sheets.length, 1); assert.equal(sheets[0].from, 'alice');
  assert.equal((await A.get('/api/inbox')).body.sent[0].status, 'accepted');
});
await t('envoi d\'un cours global : fusion par chapitre chez le destinataire', async () => {
  assert.equal((await A.post('/api/share', { kind: 'course', refId: subj.id, to: 'bob' })).status, 201);
  const it = (await B.get('/api/inbox')).body.received.find((x) => x.kind === 'course');
  assert.equal((await B.post('/api/share/' + it.id + '/accept')).status, 200);
  const bs = (await B.get('/api/subjects')).body.subjects;
  assert.equal(bs.length, 1); assert.equal(bs[0].name, 'SVT');
  const course = (await B.get('/api/subjects/' + bs[0].id + '/course')).body.course;
  assert.equal(course.chapters[0].sections.length, 2);
  assert.equal(course.chapters[0].sections[0].by, 'alice');
});
await t('envoi d\'un cours (séance) et refus', async () => {
  assert.equal((await A.post('/api/share', { kind: 'lesson', refId: lessonId, to: 'bob' })).status, 201);
  const it = (await B.get('/api/inbox')).body.received.find((x) => x.kind === 'lesson' && x.status === 'pending');
  assert.equal((await B.post('/api/share/' + it.id + '/decline')).status, 200);
  assert.equal((await B.get('/api/me')).body.pending, 0);
});

console.log('Suppression');
await t('supprimer une séance retire ses sections du cours', async () => {
  const before = (await A.get('/api/subjects/' + subj.id + '/course')).body.course.chapters[0].sections.length;
  assert.equal((await A.del('/api/lessons/' + lessonId)).status, 200);
  const course = (await A.get('/api/subjects/' + subj.id + '/course')).body.course;
  assert.equal(course.chapters[0].sections.length, before - 1);
});
await t('l\'admin supprime un utilisateur et ses données', async () => {
  const bob = (await ADM.get('/api/admin/users')).body.users.find((u) => u.pseudo === 'bob');
  assert.equal((await ADM.del('/api/admin/users/' + bob.id)).status, 200);
  assert.equal((await B.get('/api/me')).body.user, null);
  assert.equal((await client().post('/api/register', { pseudo: 'bob', password: 'nouveaumdp1' })).status, 201);
});
await t('l\'admin gère les clés d\'IA sans redéployer', async () => {
  const ok = await ADM.post('/api/admin/ai/keys', { provider: 'gemini', key: 'AIzaDDDDDDDDDDDDDDDDDDDDDDDDDD' });
  assert.equal(ok.status, 201);
  assert.equal((await ADM.post('/api/admin/ai/keys', { provider: 'gemini', key: 'AIzaDDDDDDDDDDDDDDDDDDDDDDDDDD' })).status, 409);
  const st = (await ADM.get('/api/admin/ai')).body;
  assert.equal(st.stored.length, 1); assert.ok(!JSON.stringify(st).includes('DDDDDDDDDD'), 'la clé complète ne sort jamais');
  assert.equal((await ADM.del('/api/admin/ai/keys/' + st.stored[0].id)).status, 200);
  const test = (await ADM.post('/api/admin/ai/test')).body;
  assert.equal(test.ok, true);
});

console.log('\n' + passed + ' tests réussis');
fs.rmSync(dir, { recursive: true, force: true });
