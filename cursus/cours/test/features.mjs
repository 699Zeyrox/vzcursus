/* Tests : cours fidèle, éditeur de chapitres, matières, apparence par compte, suivi des connexions (admin). */
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createApi, splitSentences, boldTerms, parseUa } from '../lib/core.mjs';
import { fileStorage } from '../lib/storage-file.mjs';
import { fakeFetch } from './fake-ai.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-'));
const store = fileStorage(path.join(dir, 'd.json'));
const env = { GROQ_API_KEYS: 'gsk_AAAAAAAAAAAAAAAAAAAAAAAA', ADMIN_PASSWORD: 'MotDePasseDeTest!' };
const handle = createApi(store, { env, fetch: fakeFetch });
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.error('  ECHEC ' + name, e); process.exitCode = 1; } };

function client(ua, ip, geo) {
  const jar = {};
  async function call(method, p, body) {
    const headers = { 'x-requested-with': 'cours', 'user-agent': ua || 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' };
    if (Object.keys(jar).length) headers.cookie = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
    const [pathname, search] = p.split('?');
    const req = { method, path: pathname, search: search ? '?' + search : '', headers, rawBody: '', bytes: null, host: 'x', ip: ip || '81.2.69.142', geo: geo || { city: 'Lyon', region: 'Auvergne-Rhône-Alpes', country: 'France' }, secure: false };
    if (body instanceof Uint8Array) { headers['content-type'] = 'audio/webm'; req.bytes = body; } else if (body !== undefined) { req.rawBody = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const r = await handle(req);
    for (const c of r.cookies) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v; }
    return r;
  }
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b || {}), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p) };
}
const audio = new Uint8Array(5000).fill(7);
async function record(c, subjectId, extra) {
  const l = (await c.post('/api/lessons', Object.assign({ subjectId }, extra || {}))).body.lesson;
  for (let i = 0; i < 2; i++) assert.equal((await c.put('/api/lessons/' + l.id + '/chunks/' + i, audio)).status, 200);
  assert.equal((await c.post('/api/lessons/' + l.id + '/finish', { chunks: 2 })).body.ok, true);
  for (let i = 0; i < 30; i++) { const r = (await c.post('/api/lessons/' + l.id + '/step')).body; if (r.done) break; }
  return (await c.get('/api/lessons/' + l.id)).body.lesson;
}

console.log('Outils de texte');
await t('découpe en phrases, gras des termes, appareil lisible', () => {
  assert.deepEqual(splitSentences('Bonjour à tous. Aujourd\'hui, on voit la cellule ! Pourquoi ? Parce que 3 est impair.'), ['Bonjour à tous.', 'Aujourd\'hui, on voit la cellule !', 'Pourquoi ?', 'Parce que 3 est impair.']);
  assert.equal(boldTerms('La photosynthèse est un processus. La photosynthèse produit du glucose.', ['photosynthèse']), 'La **photosynthèse** est un processus. La photosynthèse produit du glucose.');
  const d = parseUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1');
  assert.equal(d.os, 'iOS'); assert.equal(d.browser, 'Safari'); assert.equal(d.type, 'Téléphone');
  assert.equal(parseUa('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit Chrome/120 Mobile Safari').model, 'SM-S918B');
});

const A = client(), ADM = client();
await A.post('/api/register', { pseudo: 'alice', password: 'motdepasse1' });
await ADM.post('/api/admin/login', { id: 'Frexi699*', password: 'MotDePasseDeTest!' });
const subj = (await A.post('/api/subjects', { name: 'SVT', color: '#12abef' })).body.subject;

console.log('Cours fidèle au prof');
let lesson;
await t('toutes les phrases du prof sont gardées, mot pour mot ; seul le bruit part', async () => {
  lesson = await record(A, subj.id);
  assert.equal(lesson.status, 'ready');
  const course = (await A.get('/api/subjects/' + subj.id + '/course')).body.course;
  const text = course.chapters.map((c) => c.sections.map((s) => s.content).join('\n')).join('\n');
  assert.ok(text.includes('Attention, j\'écris au tableau la formule de la photosynthèse.'), 'phrase banale du prof conservée telle quelle');
  assert.ok(text.includes('Elle a lieu dans les chloroplastes, grâce à la chlorophylle, et produit du glucose et du dioxygène.'));
  assert.ok(!/match hier/.test(text), 'le bavardage est retiré');
  assert.ok(text.includes('**photosynthèse**') || text.includes('**Photosynthèse**'), 'terme clé surligné');
  assert.equal((await A.get('/api/lessons/' + lesson.id + '/transcript')).body.text.includes('chaise'), false);
});

console.log('Éditeur de cours');
let chapId, secId;
await t('créer un chapitre, y ranger un cours entier à l\'enregistrement', async () => {
  const ch = await A.post('/api/subjects/' + subj.id + '/chapters', { title: 'Chapitre 1 : la cellule' });
  assert.equal(ch.status, 201); chapId = ch.body.chapter.id;
  assert.equal((await A.post('/api/subjects/' + subj.id + '/chapters', { title: 'chapitre 1 : la cellule' })).status, 409);
  const l2 = await record(A, subj.id, { chapterId: chapId });
  const course = (await A.get('/api/subjects/' + subj.id + '/course')).body.course;
  const mine = course.chapters.find((c) => c.id === chapId);
  assert.ok(mine && mine.sections.length >= 1 && mine.sections.every((s) => s.lessonId === l2.id), 'tout le cours est dans le chapitre choisi');
  assert.ok(l2.sections.every((s) => s.chapter === 'Chapitre 1 : la cellule'));
  secId = mine.sections[0].id;
});
await t('modifier le texte, ajouter du texte, déplacer, réordonner, supprimer', async () => {
  assert.equal((await A.post('/api/subjects/' + subj.id + '/sections/' + secId, { heading: 'Ma définition', content: 'Texte corrigé à la main.' })).status, 200);
  const add = await A.post('/api/subjects/' + subj.id + '/sections', { chapterId: chapId, heading: 'Ajout', content: 'Une note personnelle.' });
  assert.equal(add.status, 201);
  let course = (await A.get('/api/subjects/' + subj.id + '/course')).body.course;
  const mine = course.chapters.find((c) => c.id === chapId);
  assert.equal(mine.sections[0].content, 'Texte corrigé à la main.'); assert.equal(mine.sections[0].edited, true);
  const last = mine.sections[mine.sections.length - 1];
  assert.equal(last.heading, 'Ajout');
  assert.equal((await A.post('/api/subjects/' + subj.id + '/sections/' + last.id + '/move', { dir: -1 })).status, 200);
  course = (await A.get('/api/subjects/' + subj.id + '/course')).body.course;
  assert.equal(course.chapters.find((c) => c.id === chapId).sections.slice(-2)[0].heading, 'Ajout');
  // déplacer une section dans un autre chapitre
  const other = course.chapters.find((c) => c.id !== chapId);
  assert.equal((await A.post('/api/subjects/' + subj.id + '/sections/' + last.id, { chapterId: other.id })).status, 200);
  course = (await A.get('/api/subjects/' + subj.id + '/course')).body.course;
  assert.ok(course.chapters.find((c) => c.id === other.id).sections.some((s) => s.id === last.id));
  // chapitres : renommer, monter, supprimer
  assert.equal((await A.post('/api/subjects/' + subj.id + '/chapters/' + chapId, { title: 'La cellule' })).status, 200);
  assert.equal((await A.post('/api/subjects/' + subj.id + '/chapters/' + chapId + '/move', { dir: -1 })).status, 200);
  course = (await A.get('/api/subjects/' + subj.id + '/course')).body.course;
  assert.equal(course.chapters[0].id, chapId); assert.equal(course.chapters[0].title, 'La cellule');
  assert.equal((await A.del('/api/subjects/' + subj.id + '/sections/' + last.id)).status, 200);
  assert.equal((await A.del('/api/subjects/' + subj.id + '/chapters/' + other.id)).status, 200);
});
await t('un chapitre créé à la main survit à la suppression de ses cours', async () => {
  const ch = (await A.post('/api/subjects/' + subj.id + '/chapters', { title: 'Vide' })).body.chapter;
  const l = await record(A, subj.id, { chapterId: ch.id });
  await A.del('/api/lessons/' + l.id);
  const course = (await A.get('/api/subjects/' + subj.id + '/course')).body.course;
  assert.ok(course.chapters.some((c) => c.id === ch.id), 'chapitre manuel conservé');
});
await t('un autre compte ne peut pas toucher à mon cours', async () => {
  const B = client(); await B.post('/api/register', { pseudo: 'bob', password: 'motdepasse2' });
  assert.equal((await B.post('/api/subjects/' + subj.id + '/chapters', { title: 'X' })).status, 404);
  assert.equal((await B.del('/api/subjects/' + subj.id + '/sections/' + secId)).status, 404);
});

console.log('Matières et fiches');
await t('ranger les matières, renommer (le nom suit partout), supprimer', async () => {
  const b = (await A.post('/api/subjects', { name: 'Maths' })).body.subject;
  const c = (await A.post('/api/subjects', { name: 'Histoire', color: '#ff00aa' })).body.subject;
  assert.equal((await A.post('/api/subjects/order', { ids: [c.id, b.id, subj.id] })).status, 200);
  assert.deepEqual((await A.get('/api/subjects')).body.subjects.map((s) => s.name), ['Histoire', 'Maths', 'SVT']);
  assert.equal((await A.get('/api/subjects')).body.subjects[0].color, '#ff00aa');
  assert.equal((await A.post('/api/subjects/' + subj.id + '/rename', { name: 'Sciences de la vie', color: '#00ff88' })).status, 200);
  assert.equal((await A.get('/api/lessons/' + lesson.id)).body.lesson.subjectName, 'Sciences de la vie');
  assert.equal((await A.del('/api/subjects/' + b.id)).status, 200);
  assert.equal((await A.get('/api/subjects')).body.subjects.length, 2);
});
let sheetId;
await t('fiche : phrases exactes du prof, puis modifiable', async () => {
  const r = await A.post('/api/sheets', { subjectId: subj.id, scope: 'notion', query: 'photosynthèse' });
  for (let i = 0; i < 5; i++) if ((await A.post('/api/sheets/' + r.body.id + '/step')).body.done) break;
  sheetId = r.body.id;
  const sh = (await A.get('/api/sheets/' + sheetId)).body.sheet;
  assert.ok(sh.content.includes('La photosynthèse est la transformation'));
  assert.equal((await A.post('/api/sheets/' + sheetId + '/edit', { content: '## Ma fiche\n- corrigée' })).status, 200);
  assert.equal((await A.get('/api/sheets/' + sheetId)).body.sheet.content, '## Ma fiche\n- corrigée');
  assert.equal((await A.post('/api/sheets/' + sheetId + '/edit', { content: '  ' })).status, 400);
});

console.log('Apparence par compte');
await t('préférences enregistrées par compte, valeurs invalides ignorées', async () => {
  const B = client(); await B.post('/api/register', { pseudo: 'carla', password: 'motdepasse3' });
  assert.equal((await A.get('/api/me')).body.prefs.mode, 'auto');
  const r = await A.post('/api/prefs', { mode: 'dark', accent: '#ff5500', mark: '#a0ffb0', paper: 'grid', size: 'l', font: 'sans', veil: 200, bgType: 'color', bgColor: '#102030' });
  assert.equal(r.body.prefs.veil, 90);
  const bad = await A.post('/api/prefs', { accent: 'javascript:alert(1)', mode: 'hacker', paper: '<b>' });
  assert.equal(bad.body.prefs.accent, '#ff5500'); assert.equal(bad.body.prefs.mode, 'dark'); assert.equal(bad.body.prefs.paper, 'grid');
  assert.equal((await B.get('/api/me')).body.prefs.mode, 'auto', 'un autre compte garde ses réglages');
  assert.equal((await A.get('/api/me')).body.prefs.accent, '#ff5500');
});
await t('fond d\'écran photo : stocké, relu, retiré ; fichier non image refusé', async () => {
  const img = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD';
  const ok = await A.post('/api/prefs', { image: img });
  assert.equal(ok.body.prefs.bgType, 'image'); assert.equal(ok.body.prefs.bgV, 1);
  assert.equal((await A.get('/api/prefs/bg')).body.data, img);
  assert.equal((await A.post('/api/prefs', { image: 'data:text/html;base64,PGI+' })).status, 400);
  assert.equal((await A.post('/api/prefs', { image: 'data:image/jpeg;base64,' + 'A'.repeat(750000) })).status, 400);
  const off = await A.post('/api/prefs', { image: null });
  assert.equal(off.body.prefs.bgType, 'none'); assert.equal((await A.get('/api/prefs/bg')).body.data, null);
});

console.log('Admin : suivi d\'un compte');
await t('connexions : date, nombre, IP, lieu, appareil, en ligne / hors ligne', async () => {
  const U = client('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', '90.10.20.30', { city: 'Paris', region: 'Île-de-France', country: 'France' });
  await U.post('/api/register', { pseudo: 'dina', password: 'motdepasse4' });
  await U.post('/api/logout'); await U.post('/api/login', { pseudo: 'dina', password: 'motdepasse4' });
  await U.get('/api/me');
  const list = (await ADM.get('/api/admin/users')).body.users.find((u) => u.pseudo === 'dina');
  assert.equal(list.online, true); assert.equal(list.logins, 2);
  const d = (await ADM.get('/api/admin/users/' + list.id)).body;
  assert.equal(d.online, true); assert.equal(d.logins, 2); assert.ok(d.lastLogin > 0);
  assert.equal(d.last.ip, '90.10.20.30'); assert.equal(d.last.city, 'Paris'); assert.equal(d.last.device.os, 'iOS'); assert.equal(d.last.device.browser, 'Safari');
  assert.equal(d.events[0].kind, 'login'); assert.equal(d.events.length, 2);
  await U.post('/api/logout');
  assert.equal((await ADM.get('/api/admin/users/' + list.id)).body.online, false, 'déconnecté = hors ligne');
});
await t('hors ligne si plus de signe de vie depuis 3 minutes', async () => {
  const id = (await ADM.get('/api/admin/users')).body.users.find((u) => u.pseudo === 'alice').id;
  await A.get('/api/me');
  const pr = await store.get('presence/' + id); pr.lastSeen = Date.now() - 10 * 60000; pr.offline = false; await store.set('presence/' + id, pr);
  assert.equal((await ADM.get('/api/admin/users/' + id)).body.online, false);
  await A.get('/api/me'); // nouvelle visite après 10 min
  const d = (await ADM.get('/api/admin/users/' + id)).body;
  assert.equal(d.online, true);
});
await t('l\'admin lit les cours, séances et fiches d\'un compte (lecture seule) ; pas les autres utilisateurs', async () => {
  const id = (await ADM.get('/api/admin/users')).body.users.find((u) => u.pseudo === 'alice').id;
  const d = (await ADM.get('/api/admin/users/' + id)).body;
  assert.ok(d.subjects.length >= 1 && d.lessons.length >= 1 && d.sheets.length >= 1);
  assert.ok((await ADM.get('/api/admin/users/' + id + '/subjects/' + subj.id)).body.course.chapters.length >= 1);
  assert.ok((await ADM.get('/api/admin/users/' + id + '/lessons/' + lesson.id)).body.transcript.includes('chloroplastes'));
  assert.ok((await ADM.get('/api/admin/users/' + id + '/sheets/' + sheetId)).body.sheet.content.length > 3);
  assert.equal((await ADM.get('/api/admin/users/' + id + '/lessons/l_deadbeef')).status, 404);
  const B = client(); await B.post('/api/register', { pseudo: 'eve', password: 'motdepasse5' });
  assert.equal((await B.get('/api/admin/users/' + id)).status, 403);
  assert.equal((await B.get('/api/admin/users/' + id + '/lessons/' + lesson.id)).status, 403);
});
await t('supprimer un compte efface aussi réglages, fond et historique de connexion', async () => {
  const id = (await ADM.get('/api/admin/users')).body.users.find((u) => u.pseudo === 'carla').id;
  assert.equal((await ADM.del('/api/admin/users/' + id)).status, 200);
  assert.ok(!(await store.get('conn/' + id)) && !(await store.get('presence/' + id)) && !(await store.get('prefs/' + id)));
});

console.log('\n' + n + ' tests réussis (nouveautés)');
fs.rmSync(dir, { recursive: true, force: true });
