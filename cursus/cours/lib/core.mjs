/*
  Noyau de l'API de « Cursus » : aucune dépendance, indépendant de la plateforme.
  Même architecture que Armure (VZ Gym) : un « stockage » (get / set / del / list / setIfNew),
  donc le même code tourne en local (fichier) et sur Netlify (Netlify Blobs).
  Comptes, sessions et administrateur : repris à l'identique d'Armure (mêmes identifiants admin).
*/
import crypto from 'node:crypto';
import { createAi, keyId, maskKey } from './ai.mjs';

const DAY = 24 * 3600 * 1000;
const MAX_BODY = 200 * 1024;
const MAX_AUDIO = 5 * 1024 * 1024; // une fonction Netlify accepte ~6 Mo par requête

/* ---------- utilitaires ---------- */
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
const todayUtc = () => dkey(new Date());
const parseDay = (k) => { const p = k.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
const addDays = (k, n) => { const d = parseDay(k); d.setUTCDate(d.getUTCDate() + n); return dkey(d); };
const validDate = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && dkey(parseDay(k)) === k;

const scrypt = (pw, salt) => new Promise((res, rej) =>
  crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
async function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return { salt: salt.toString('base64'), hash: key.toString('base64') };
}
async function checkPw(pw, user) {
  const key = await scrypt(pw, user ? Buffer.from(user.salt, 'base64') : Buffer.alloc(16)); // même durée si le pseudo n'existe pas
  if (!user) return false;
  const stored = Buffer.from(user.hash, 'base64');
  return stored.length === key.length && crypto.timingSafeEqual(stored, key);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rid = (n) => crypto.randomBytes(n).toString('hex');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const pad4 = (n) => String(n).padStart(4, '0');
const words = (t) => (String(t || '').match(/\S+/g) || []).length;
/* découpe en phrases (la transcription du prof est ensuite gardée MOT POUR MOT : l'IA ne fait que numéroter/retirer/titrer) */
export function splitSentences(text) {
  const base = String(text || '').replace(/\s+/g, ' ').trim();
  if (!base) return [];
  const out = [];
  base.split(/(?<=[.!?…»])\s+(?=[A-ZÀ-ÖØ-Þ«"'(\d])/).forEach((raw) => {
    let t = raw.trim();
    while (t.length > 500) { // phrase sans ponctuation : on coupe à une virgule
      const cut = t.lastIndexOf(', ', 420);
      const at = cut > 120 ? cut + 1 : 420;
      out.push(t.slice(0, at).trim()); t = t.slice(at).trim();
    }
    if (t) out.push(t);
  });
  return out;
}
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function boldTerms(text, terms) {
  let out = text;
  const seen = new Set();
  (terms || []).forEach((t) => {
    const k = String(t || '').trim();
    if (k.length < 3 || k.length > 60 || seen.has(k.toLowerCase())) return;
    seen.add(k.toLowerCase());
    let done = false;
    out = out.replace(new RegExp(escRe(k), 'iu'), (m, off, whole) => {
      if (done || whole.slice(Math.max(0, off - 2), off) === '**') return m;
      done = true; return '**' + m + '**';
    });
  });
  return out;
}
/* appareil lisible à partir du User-Agent */
export function parseUa(ua) {
  ua = String(ua || '');
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Inconnu';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Inconnu';
  const type = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'Tablette' : /Mobi|iPhone|Android/.test(ua) ? 'Téléphone' : 'Ordinateur';
  let model = (/Android [\d.]+;\s*([^;)]+)/.exec(ua) || [])[1] || (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : '');
  if (model.length < 2) model = '';
  return { os, browser, type, model, label: type + (model ? ' ' + model : '') + ' · ' + os + ' · ' + browser };
}
const HEX = /^#[0-9a-f]{6}$/i;

const COLORS = ['#e4572e', '#f2a541', '#3a9d5d', '#2e86ab', '#6a4c93', '#d1478c', '#4f6d7a', '#8a5a44'];
const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'ar'];
const LANG_NAMES = { fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien', pt: 'portugais', nl: 'néerlandais', ar: 'arabe' };

/* ---------- compte administrateur : IDENTIQUE à Armure (même identifiant, même mot de passe) ---------- */
/*
  Identifiant : Frexi699*. Le mot de passe n'est pas écrit en clair dans le code, seulement son empreinte scrypt.
  Pour les changer sans toucher au code (recommandé en ligne) : variables d'environnement ADMIN_ID et ADMIN_PASSWORD.
*/
const ADMIN_SALT = Buffer.from('ls58cYiMZLchn7fvb7FSmg==', 'base64');
const ADMIN_HASH = 'XHNTbSlqNHkOSGMftzjs1T+2T6qVz1TBzqBVUCg1O7D5bFjtFj+Z2w0dS4OHvXj5dyD5iHQ7a152sd5qpOIDqA==';
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
async function adminOk(id, pw, env) {
  const key = await scrypt(String(pw == null ? '' : pw).slice(0, 200), ADMIN_SALT);
  const ref = env.ADMIN_PASSWORD ? await scrypt(env.ADMIN_PASSWORD, ADMIN_SALT) : Buffer.from(ADMIN_HASH, 'base64');
  const h = (v) => crypto.createHash('sha256').update(String(v == null ? '' : v)).digest();
  return safeEq(key, ref) & safeEq(h(id), h(env.ADMIN_ID || 'Frexi699*')) ? true : false;
}

/* ---------- filtre du bruit sur la transcription (Whisper renvoie des indices de qualité par segment) ---------- */
const HALLU = /sous-?titr|amara\.org|merci d['’]avoir (regard|suivi)|abonnez-vous|n['’]oubliez pas de vous abonner|thanks for watching|subscribe to|www\.\S+\.\S+/i;
export function filterSegments(tr) {
  if (!tr) return { text: '', kept: 0, dropped: 0 };
  if (!tr.segments) {
    const t = String(tr.text || '').trim();
    return { text: HALLU.test(t) && words(t) < 12 ? '' : t, kept: t ? 1 : 0, dropped: 0 };
  }
  const keep = [];
  let dropped = 0;
  for (const s of tr.segments) {
    const t = String(s.text || '').trim();
    if (!t) continue;
    const bad = (s.no_speech_prob > 0.6 && s.avg_logprob < -0.5) || s.avg_logprob < -1.2 || s.compression_ratio > 2.4 || HALLU.test(t);
    if (bad) { dropped++; continue; }
    keep.push(t);
  }
  return { text: keep.join(' ').replace(/\s+/g, ' ').trim(), kept: keep.length, dropped };
}

/* ---------- recherche d'une notion dans le cours ---------- */
const STOP = new Set('les des une que qui quoi dans pour par sur avec sans est sont comme plus mais donc alors cette ces son ses leur leurs aux the and for that with from this what quel quelle quels quelles notion chapitre cours fiche'.split(' '));
const stem = (w) => w.slice(0, 5);
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem);
export function pickSections(course, query, maxChars) {
  const q = Array.from(new Set(tokens(query)));
  const all = [];
  course.chapters.forEach((ch) => ch.sections.forEach((s) => all.push({ ch, s })));
  const scored = all.map((x, i) => {
    const head = tokens(x.s.heading + ' ' + x.ch.title), body = tokens(x.s.content);
    let sc = 0;
    q.forEach((w) => { sc += 3 * head.filter((t) => t === w).length + body.filter((t) => t === w).length; });
    return { x, i, sc };
  });
  let pool = scored.filter((e) => e.sc > 0).sort((a, b) => b.sc - a.sc);
  const found = pool.length > 0;
  if (!found) pool = scored; // rien de précis : on laisse l'IA chercher dans le début du cours
  const out = [];
  let size = 0;
  for (const e of pool) {
    const len = e.x.s.content.length + e.x.s.heading.length + 40;
    if (size + len > maxChars && out.length) continue;
    out.push(e); size += len;
  }
  out.sort((a, b) => a.i - b.i);
  return { found, parts: out.map((e) => ({ chapter: e.x.ch.title, heading: e.x.s.heading, content: e.x.s.content, date: e.x.s.date })) };
}
const extractsText = (parts) => parts.map((p) => '### ' + (p.chapter ? p.chapter + ' — ' : '') + p.heading + (p.date ? ' (' + p.date + ')' : '') + '\n' + p.content).join('\n\n');

/* ---------- API ---------- */
/*
  store : { get(key), set(key, value), del(key), list(prefix) -> [keys], setIfNew(key, value) -> bool }
  req   : { method, path, headers (clés en minuscules), rawBody (texte), bytes (audio), host, ip, secure }
  rend  : { status, body, cookies: [chaînes Set-Cookie] }
*/
export function createApi(store, opts = {}) {
  const env = opts.env || (typeof process !== 'undefined' && process.env) || {};
  const ai = opts.ai || createAi(store, { env, fetch: opts.fetch });
  const json = (status, body, cookies) => ({ status, body, cookies: cookies || [] });
  const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});
  const pub = (u) => ({ id: u.id, pseudo: u.pseudo, lang: u.lang || 'fr' });

  const cookie = (req, value, maxAge) => {
    let c = 'cours_sid=' + value + '; HttpOnly; SameSite=Strict; Path=/';
    if (req.secure) c += '; Secure';
    if (maxAge === 0) c += '; Max-Age=0';
    else if (maxAge) c += '; Max-Age=' + maxAge;
    return c;
  };
  const tokenOf = (req) => { const m = /(?:^|;\s*)cours_sid=([a-f0-9]{64})/.exec(req.headers.cookie || ''); return m ? m[1] : null; };

  async function startSession(req, user, remember) {
    const token = rid(32);
    const ttl = remember ? 30 * DAY : DAY;
    await store.set('sess/' + sha(token), { uid: user.id, tv: user.tv || 0, exp: Date.now() + ttl });
    return cookie(req, token, remember ? Math.floor(ttl / 1000) : null);
  }
  async function authUser(req) {
    const t = tokenOf(req);
    if (!t) return null;
    const s = await store.get('sess/' + sha(t));
    if (!s) return null;
    if (s.exp < Date.now()) { await store.del('sess/' + sha(t)); return null; }
    const u = await store.get('user/' + s.uid);
    return u && (u.tv || 0) === s.tv ? u : null;
  }

  const admCookie = (req, value, maxAge) => 'cours_adm=' + value + '; HttpOnly; SameSite=Strict; Path=/' + (req.secure ? '; Secure' : '') + (maxAge === 0 ? '; Max-Age=0' : maxAge ? '; Max-Age=' + maxAge : '');
  async function isAdmin(req) {
    const m = /(?:^|;\s*)cours_adm=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (!m) return false;
    const s = await store.get('asess/' + sha(m[1]));
    if (!s) return false;
    if (s.exp < Date.now()) { await store.del('asess/' + sha(m[1])); return false; }
    return true;
  }
  async function throttleWait(key) {
    const a = await store.get('rl/' + key);
    return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 1000) : 0;
  }
  async function noteFailure(key) {
    const a = (await store.get('rl/' + key)) || { n: 0, until: 0 };
    a.n++;
    if (a.n >= 5) a.until = Date.now() + Math.min(15 * 60, 30 * Math.pow(2, a.n - 5)) * 1000;
    await store.set('rl/' + key, a);
  }
  function parseBody(req, max) {
    const raw = req.rawBody || '';
    if (raw.length > (max || MAX_BODY)) throw fail(413, 'Requête trop volumineuse.');
    if (!raw) return {};
    let b;
    try { b = JSON.parse(raw); } catch (e) { throw fail(400, 'Données invalides.'); }
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw fail(400, 'Données invalides.');
    return b;
  }
  const ctoday = (req, body) => {
    const c = (body && body.today) || req.headers['x-today'];
    return validDate(c) && c >= addDays(todayUtc(), -1) && c <= addDays(todayUtc(), 1) ? c : todayUtc();
  };

  /* ---------- données d'un utilisateur ---------- */
  const getSubjects = async (uid) => (await store.get('subj/' + uid)) || { items: [] };
  const getIndex = async (uid) => (await store.get('ulessons/' + uid)) || { items: [] };
  const getCourse = async (uid, sid) => (await store.get('course/' + uid + '/' + sid)) || { chapters: [] };
  const getSheetsIdx = async (uid) => (await store.get('usheets/' + uid)) || { items: [] };
  const getInbox = async (uid) => (await store.get('inbox/' + uid)) || { items: [] };
  const getOutbox = async (uid) => (await store.get('outbox/' + uid)) || { items: [] };

  const PREF_DEFAULT = { mode: 'auto', accent: '', mark: '', bgType: 'none', bgColor: '', veil: 55, paper: 'seyes', size: 'm', font: 'serif', bgV: 0 };
  const getPrefs = async (uid) => Object.assign({}, PREF_DEFAULT, (await store.get('prefs/' + uid)) || {});

  /* suivi des connexions : visible par l'administrateur (les utilisateurs en sont informés dans l'appli) */
  const geoOf = (req) => { const g = req.geo || {}; return { city: str(g.city, 60), region: str(g.region, 60), country: str(g.country, 60) }; };
  async function recordConn(user, req, kind) {
    const now = Date.now();
    const ev = Object.assign({ at: now, kind, ip: str(req.ip, 64), ua: str(req.headers['user-agent'], 300) }, geoOf(req));
    const c = (await store.get('conn/' + user.id)) || { logins: 0, visits: 0, items: [] };
    if (kind === 'visit') c.visits++; else c.logins++;
    c.items.unshift(ev); c.items = c.items.slice(0, 30);
    await store.set('conn/' + user.id, c);
    await store.set('presence/' + user.id, { lastSeen: now, ip: ev.ip, ua: ev.ua, city: ev.city, region: ev.region, country: ev.country, offline: false });
  }
  async function touchPresence(user, req) { // appelé par le ping de la page (toutes les ~90 s quand elle est visible)
    const now = Date.now();
    const pr = await store.get('presence/' + user.id);
    if (pr && !pr.offline && now - pr.lastSeen < 60000) return;
    if (!pr || pr.offline || now - pr.lastSeen > 30 * 60000) { await recordConn(user, req, 'visit'); return; } // nouvelle visite
    await store.set('presence/' + user.id, Object.assign({}, pr, { lastSeen: now }));
  }
  async function adminDetail(u) {
    const now = Date.now();
    const conn = (await store.get('conn/' + u.id)) || { logins: 0, visits: 0, items: [] };
    const pr = await store.get('presence/' + u.id);
    const idx = (await getIndex(u.id)).items;
    const withDev = (e) => Object.assign({}, e, { device: parseUa(e.ua) });
    const lastLogin = conn.items.find((e) => e.kind !== 'visit');
    return {
      user: { id: u.id, pseudo: u.pseudo, joined: u.joined, lang: u.lang || 'fr' },
      online: !!(pr && !pr.offline && now - pr.lastSeen < 3 * 60000), lastSeen: pr ? pr.lastSeen : 0, lastLogin: lastLogin ? lastLogin.at : 0,
      logins: conn.logins, visits: conn.visits, last: pr ? withDev(pr) : null, events: conn.items.map(withDev),
      subjects: (await getSubjects(u.id)).items.map((x) => ({ id: x.id, name: x.name, color: x.color, lessons: idx.filter((l) => l.subjectId === x.id).length })),
      lessons: idx, sheets: (await getSheetsIdx(u.id)).items,
    };
  }

  async function ownLesson(user, id) {
    const l = /^l_[a-f0-9]+$/.test(id) ? await store.get('lesson/' + id) : null;
    if (!l || l.uid !== user.id) throw fail(404, 'Cours introuvable.');
    return l;
  }
  async function ownSheet(user, id) {
    const s = /^f_[a-f0-9]+$/.test(id) ? await store.get('sheet/' + id) : null;
    if (!s || s.uid !== user.id) throw fail(404, 'Fiche introuvable.');
    return s;
  }
  async function saveLesson(l) {
    await store.set('lesson/' + l.id, l);
    const idx = await getIndex(l.uid);
    const meta = { id: l.id, subjectId: l.subjectId, title: l.title, date: l.date, status: l.status, durationSec: l.durationSec || 0, createdAt: l.createdAt };
    const i = idx.items.findIndex((x) => x.id === l.id);
    if (i >= 0) idx.items[i] = meta; else idx.items.unshift(meta);
    await store.set('ulessons/' + l.uid, idx);
  }
  async function dropSectionsOf(uid, sid, lessonId) {
    const c = await getCourse(uid, sid);
    c.chapters.forEach((ch) => { ch.sections = ch.sections.filter((s) => s.lessonId !== lessonId); });
    c.chapters = c.chapters.filter((ch) => ch.sections.length || !ch.auto); // un chapitre créé à la main reste, même vide
    await store.set('course/' + uid + '/' + sid, c);
  }
  async function deleteLesson(l) {
    for (const k of await store.list('lchunk/' + l.id + '/')) await store.del(k);
    for (const k of await store.list('lnote/' + l.id + '/')) await store.del(k);
    for (const k of await store.list('lsec/' + l.id + '/')) await store.del(k);
    await store.del('lesson/' + l.id);
    const idx = await getIndex(l.uid);
    idx.items = idx.items.filter((x) => x.id !== l.id);
    await store.set('ulessons/' + l.uid, idx);
    await dropSectionsOf(l.uid, l.subjectId, l.id);
  }
  async function deleteSheet(s) {
    await store.del('sheet/' + s.id);
    const idx = await getSheetsIdx(s.uid);
    idx.items = idx.items.filter((x) => x.id !== s.id);
    await store.set('usheets/' + s.uid, idx);
  }
  async function deleteUserData(u) {
    for (const x of (await getIndex(u.id)).items) { const l = await store.get('lesson/' + x.id); if (l) await deleteLesson(l); }
    for (const x of (await getSheetsIdx(u.id)).items) { const s = await store.get('sheet/' + x.id); if (s) await deleteSheet(s); }
    for (const s of (await getSubjects(u.id)).items) await store.del('course/' + u.id + '/' + s.id);
    for (const k of ['user/', 'subj/', 'ulessons/', 'usheets/', 'inbox/', 'outbox/', 'prefs/', 'prefbg/', 'conn/', 'presence/']) await store.del(k + u.id);
    const idx = await store.get('pseudo/' + u.pseudoLower);
    if (idx && idx.id === u.id) await store.del('pseudo/' + u.pseudoLower);
  }

  /* ---------- ajout de sections au cours global d'une matière ---------- */
  function addToCourse(course, chapterTitle, section, chapterId) {
    let ch = chapterId ? course.chapters.find((c) => c.id === chapterId) : null;
    if (!ch) { const key = norm(chapterTitle); ch = course.chapters.find((c) => norm(c.title) === key); }
    if (!ch) { ch = { id: 'c_' + rid(4), title: chapterTitle, auto: true, sections: [] }; course.chapters.push(ch); }
    ch.sections.push(Object.assign({ id: 's_' + rid(4) }, section)); // l'ordre d'arrivée est l'ordre du cours
    return ch;
  }

  /* ---------- traitement d'une séance, étape par étape (chaque appel reste court) ---------- */
  const langName = (u) => LANG_NAMES[u.lang || 'fr'] || 'français';

  /*
    Fidélité : l'IA ne réécrit jamais le cours. Elle reçoit les phrases du prof NUMÉROTÉES et ne répond que par
    des numéros (phrases à retirer = bruit ; coupures en sections) et de rares corrections de mots mal entendus.
    Le texte final est donc fait des phrases exactes du prof, toutes, dans l'ordre.
  */
  async function stepClean(user, l, n) {
    const ch = await store.get('lchunk/' + l.id + '/' + pad4(n));
    const sents = splitSentences(ch ? ch.text : '');
    if (!sents.length) { await store.set('lnote/' + l.id + '/' + pad4(n), { n, text: '' }); return; }
    const prev = n > 0 ? await store.get('lnote/' + l.id + '/' + pad4(n - 1)) : null;
    const tail = prev && prev.text ? prev.text.slice(-300) : '(début du cours)';
    let numbered = '', used = 0;
    for (let i = 0; i < sents.length; i++) { const line = (i + 1) + '. ' + sents[i] + '\n'; if (numbered.length + line.length > 14000) break; numbered += line; used = i + 1; }
    const r = await ai.text({
      json: true, maxTokens: 1500,
      system: 'Tu aides un élève à garder le cours de « ' + l.subjectName + ' » (' + langName(user) + '). On te donne les phrases NUMÉROTÉES de la transcription automatique d\'un extrait enregistré en classe.\n' +
        'NE RÉÉCRIS PAS le texte. Réponds seulement avec :\n' +
        '- "drop" : les numéros des phrases à RETIRER, uniquement si ce n\'est clairement pas le cours : bruit, bavardages d\'élèves, apartés, discipline ou organisation sans lien avec la matière, mots isolés sans sens, transcription incompréhensible.\n' +
        '- "fix" : pour les rares phrases où un mot a été manifestement mal reconnu, {"n": numéro, "text": la phrase complète corrigée, mots identiques sinon}.\n' +
        'Toute phrase de l\'enseignant qui parle du cours, même banale ou répétée, doit être GARDÉE. Dans le doute, garde.\n' +
        'Réponds uniquement en JSON : {"drop":[],"fix":[]}',
      user: 'Fin de l\'extrait précédent (contexte seulement) :\n' + tail + '\n\nPhrases :\n' + numbered,
    });
    const j = r.json || {};
    const drop = new Set((Array.isArray(j.drop) ? j.drop : []).map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= used));
    const ignoreDrop = used >= 4 && drop.size > 0.7 * used; // une IA qui retire presque tout se trompe : on garde
    const fixes = {};
    (Array.isArray(j.fix) ? j.fix : []).forEach((f) => {
      const k = Number(f && f.n), t = str(f && f.text, 1200);
      if (!(Number.isInteger(k) && k >= 1 && k <= used && t)) return;
      const a = words(sents[k - 1]), b = words(t);
      if (b >= a * 0.7 && b <= a * 1.3 + 2) fixes[k] = t;
    });
    const keep = [];
    sents.forEach((s0, i) => { const k = i + 1; if (!ignoreDrop && drop.has(k)) return; keep.push(fixes[k] || s0); });
    await store.set('lnote/' + l.id + '/' + pad4(n), { n, text: keep.join(' '), total: sents.length, dropped: ignoreDrop ? 0 : drop.size });
  }

  async function stepSections(user, l, gi) {
    const group = l.plan.groups[gi];
    const parts = [];
    for (const n of group) { const d = await store.get('lnote/' + l.id + '/' + pad4(n)); if (d && d.text) parts.push(d.text); }
    const sents = splitSentences(parts.join(' '));
    if (words(sents.join(' ')) < 15) { await store.set('lsec/' + l.id + '/' + pad4(gi), { gi, sections: [] }); return; }
    const r = await ai.text({
      json: true, maxTokens: 2500,
      system: 'Tu découpes en sections un cours de « ' + l.subjectName + ' » (' + langName(user) + '). Les phrases de l\'enseignant sont numérotées, dans l\'ordre.\n' +
        'NE RÉÉCRIS RIEN et ne résume rien : indique seulement où commence chaque section. Commence une nouvelle section à chaque changement de notion ou de sujet. ' +
        'Pour chaque section : "heading" (titre court), "start" (numéro de sa première phrase), "terms" (0 à 8 termes clés, notions, définitions ou noms propres, écrits exactement comme dans les phrases).\n' +
        'La première section commence à 1. Réponds uniquement en JSON : {"sections":[{"heading":"","start":1,"terms":[""]}]}',
      user: sents.map((x, i) => (i + 1) + '. ' + x).join('\n').slice(0, 40000),
    });
    const plan = r.json && Array.isArray(r.json.sections) ? r.json.sections : [];
    const starts = new Map();
    plan.forEach((x) => { const st = Math.round(Number(x && x.start)); if (Number.isInteger(st) && st >= 1 && st <= sents.length && !starts.has(st)) starts.set(st, x); });
    if (!starts.has(1)) starts.set(1, { heading: plan[0] && plan[0].heading });
    if (starts.size === 1 && sents.length > 12) { starts.clear(); for (let i = 1; i <= sents.length; i += 8) starts.set(i, { heading: 'Suite du cours' }); } // plan inutilisable : coupes régulières
    const order = Array.from(starts.keys()).sort((a, b) => a - b);
    const secs = order.map((st, idx) => {
      const en = (order[idx + 1] || sents.length + 1) - 1;
      const meta = starts.get(st) || {};
      const slice = sents.slice(st - 1, en);
      const paras = [];
      for (let i = 0; i < slice.length; i += 4) paras.push(slice.slice(i, i + 4).join(' '));
      const terms = (Array.isArray(meta.terms) ? meta.terms : []).map((t) => str(t, 60)).filter((t) => t.length >= 3).slice(0, 10);
      return { heading: str(meta.heading, 120) || 'Suite du cours', content: boldTerms(paras.join('\n\n'), terms), terms };
    });
    await store.set('lsec/' + l.id + '/' + pad4(gi), { gi, sections: secs });
  }

  async function stepFinalize(user, l) {
    const compact = true;
    const secs = [];
    for (let gi = 0; gi < l.plan.groups.length; gi++) {
      const d = await store.get('lsec/' + l.id + '/' + pad4(gi));
      if (d) secs.push(...d.sections);
    }
    if (!secs.length) {
      l.status = 'error'; l.error = 'Aucun contenu de cours exploitable n\'a été détecté dans cet enregistrement.';
      await saveLesson(l); return;
    }
    const course = await getCourse(user.id, l.subjectId);
    const forced = l.chapterId ? course.chapters.find((c) => c.id === l.chapterId) : null; // chapitre choisi avant d'enregistrer
    const titles = forced ? [] : course.chapters.filter((c) => c.sections.some((s) => s.lessonId !== l.id)).map((c) => c.title).slice(0, compact ? 50 : 200);
    const r = await ai.text({
      json: true, maxTokens: 4096,
      system: 'Tu termines la fiche d\'un cours de « ' + l.subjectName + ' » (' + langName(user) + '). On te donne les sections numérotées du cours du jour et la liste des chapitres déjà présents dans le cours global de la matière.\n' +
        'Produis : "title" (titre court du cours du jour, 70 caractères max) ; "summary" (récapitulatif en 4 à 8 phrases) ; "keyPoints" (4 à 10 points à retenir) ; ' +
        '"assignments" : pour CHAQUE section i, le "chapter" du cours global où la ranger. Réutilise EXACTEMENT le titre d\'un chapitre existant quand la section en relève ; sinon crée un nouveau titre de chapitre court (60 caractères max). Plusieurs sections peuvent aller dans le même chapitre.\n' +
        'Réponds uniquement en JSON : {"title":"","summary":"","keyPoints":[""],"assignments":[{"i":0,"chapter":""}]}',
      user: 'Chapitres existants :\n' + (titles.length ? titles.map((t) => '- ' + t).join('\n') : '(aucun pour le moment)') + '\n\nSections du cours du jour :\n' +
        secs.map((s, i) => i + '. ' + s.heading + ' : ' + s.content.slice(0, compact ? 100 : 260).replace(/\s+/g, ' ')).join('\n').slice(0, compact ? 8000 : 20000),
    });
    const j = r.json || {};
    const byI = {};
    (Array.isArray(j.assignments) ? j.assignments : []).forEach((a) => { if (a && Number.isInteger(a.i)) byI[a.i] = str(a.chapter, 60); });
    const fallback = str(j.title, 60) || l.title || 'Cours';
    await dropSectionsOf(user.id, l.subjectId, l.id); // si l'étape est rejouée, pas de doublon
    const c2 = await getCourse(user.id, l.subjectId);
    const target = l.chapterId ? c2.chapters.find((c) => c.id === l.chapterId) : null;
    const used = [];
    const placed = [];
    secs.forEach((s, i) => {
      let chap = target ? target.title : (byI[i] || fallback);
      const ex = target || c2.chapters.find((c) => norm(c.title) === norm(chap));
      if (ex) chap = ex.title;
      if (!used.includes(chap)) used.push(chap);
      placed.push(chap);
      addToCourse(c2, chap, { heading: s.heading, content: s.content, terms: s.terms, lessonId: l.id, lessonTitle: l.title, date: l.date }, target ? target.id : undefined);
    });
    await store.set('course/' + user.id + '/' + l.subjectId, c2);
    if (l.autoTitle && str(j.title, 80)) l.title = str(j.title, 80);
    l.recap = { summary: str(j.summary, 3000), keyPoints: (Array.isArray(j.keyPoints) ? j.keyPoints : []).map((k) => str(k, 300)).filter(Boolean).slice(0, 12) };
    l.sections = secs.map((s, i) => ({ heading: s.heading, content: s.content, terms: s.terms, chapter: placed[i] }));
    l.status = 'ready'; l.error = null;
    await saveLesson(l);
  }

  async function lessonStep(user, l) {
    if (l.status === 'ready') return { done: true, progress: { done: 1, total: 1 } };
    if (l.status !== 'processing') throw fail(400, l.status === 'error' ? (l.error || 'Ce cours est en erreur.') : 'Ce cours n\'est pas terminé.');
    const plan = l.plan, done = l.done || { clean: [], groups: [] };
    const total = plan.clean.length + plan.groups.length + 1;
    const n = plan.clean.find((x) => !done.clean.includes(x));
    if (n !== undefined) { await stepClean(user, l, n); done.clean.push(n); }
    else {
      const gi = plan.groups.findIndex((_, i) => !done.groups.includes(i));
      if (gi >= 0) { await stepSections(user, l, gi); done.groups.push(gi); }
      else { await stepFinalize(user, l); }
    }
    l.done = done;
    if (l.status === 'processing') await store.set('lesson/' + l.id, l);
    const doneCount = done.clean.length + done.groups.length + (l.status === 'processing' ? 0 : 1);
    return { done: l.status !== 'processing', status: l.status, error: l.error || null, progress: { done: doneCount, total } };
  }

  /* ---------- fiches de révision ---------- */
  const SHEET_SYS = (subject, lang) => 'Tu rédiges des fiches de révision pour un élève, à partir EXCLUSIVEMENT des extraits de cours fournis (cours de « ' + subject + ' », ' + lang + ').\n' +
    'Règles : la fiche est un récapitulatif classé par NOTIONS. Pour chaque notion : un titre, puis les phrases EXACTES de l\'enseignant qui la définissent ou l\'expliquent, recopiées mot pour mot (ne les reformule pas, ne les remplace pas par ta version). ' +
    'Tu peux regrouper et ordonner, mais jamais changer les mots du professeur. N\'ajoute aucune information extérieure. Si une notion demandée n\'apparaît pas dans les extraits, dis-le clairement au lieu de l\'inventer.\n' +
    'Format Markdown : ## pour une notion, listes à puces pour les points, **gras** pour les termes et définitions à connaître. Termine par « À retenir » : 3 à 6 puces faites de phrases exactes du cours. Pas de préambule ni de conclusion.';

  async function buildSheetTodo(user, subject, body) {
    const course = await getCourse(user.id, subject.id);
    if (!course.chapters.length) throw fail(400, 'Cette matière n\'a pas encore de cours enregistré.');
    const scope = ['notion', 'chapter', 'all'].includes(body.scope) ? body.scope : 'notion';
    const MAX = 8000;
    if (scope === 'notion') {
      const query = str(body.query, 200);
      if (query.length < 2) throw fail(400, 'Indique la notion à réviser.');
      const pk = pickSections(course, query, MAX);
      return { title: 'Fiche : ' + query, query, todo: [{ title: query, src: extractsText(pk.parts), ask: 'Fiche de révision sur la notion : « ' + query + ' ».' }] };
    }
    if (scope === 'chapter') {
      const ch = course.chapters.find((c) => c.id === body.chapterId);
      if (!ch) throw fail(404, 'Chapitre introuvable.');
      const parts = ch.sections.map((s) => ({ chapter: ch.title, heading: s.heading, content: s.content, date: s.date }));
      return { title: 'Fiche : ' + ch.title, query: ch.title, todo: splitParts(parts, MAX).map((p, i, a) => ({ title: ch.title + (a.length > 1 ? ' (' + (i + 1) + '/' + a.length + ')' : ''), src: extractsText(p), ask: 'Fiche de révision sur le chapitre « ' + ch.title + ' »' + (a.length > 1 ? ' (partie ' + (i + 1) + ' sur ' + a.length + ')' : '') + '.' })) };
    }
    const todo = [];
    course.chapters.forEach((ch) => {
      const parts = ch.sections.map((s) => ({ chapter: ch.title, heading: s.heading, content: s.content, date: s.date }));
      splitParts(parts, MAX).forEach((p, i, a) => todo.push({ title: ch.title + (a.length > 1 ? ' (' + (i + 1) + '/' + a.length + ')' : ''), src: extractsText(p), ask: 'Fiche de révision sur le chapitre « ' + ch.title + ' ».' }));
    });
    if (todo.length > (MAX > 10000 ? 40 : 100)) throw fail(400, 'Ce cours est trop volumineux pour une seule fiche : demande plutôt une fiche par chapitre.');
    return { title: 'Fiche : cours complet de ' + subject.name, query: '', todo };
  }
  function splitParts(parts, max) {
    const groups = [];
    let cur = [], size = 0;
    parts.forEach((p) => {
      const len = p.content.length + p.heading.length + 40;
      if (cur.length && size + len > max) { groups.push(cur); cur = []; size = 0; }
      cur.push(p); size += len;
    });
    if (cur.length) groups.push(cur);
    return groups;
  }
  async function sheetStep(user, sh) {
    if (sh.status === 'ready') return { done: true, progress: { done: sh.todo.length, total: sh.todo.length } };
    const i = sh.todo.findIndex((t) => !t.done);
    if (i >= 0) {
      const t = sh.todo[i];
      const r = await ai.text({ maxTokens: 6000, system: SHEET_SYS(sh.subjectName, langName(user)), user: t.ask + '\n\nExtraits du cours :\n\n' + t.src });
      t.md = String(r.text || '').trim(); t.done = true; t.src = '';
    }
    if (sh.todo.every((t) => t.done)) {
      sh.content = sh.todo.map((t) => (sh.todo.length > 1 ? '## ' + t.title + '\n\n' : '') + t.md).join('\n\n');
      sh.status = 'ready';
      await store.set('sheet/' + sh.id, sh);
      const idx = await getSheetsIdx(sh.uid);
      const meta = { id: sh.id, subjectId: sh.subjectId, subjectName: sh.subjectName, title: sh.title, scope: sh.scope, at: sh.createdAt, from: sh.from || null };
      if (!idx.items.some((x) => x.id === sh.id)) idx.items.unshift(meta);
      await store.set('usheets/' + sh.uid, idx);
    } else await store.set('sheet/' + sh.id, sh);
    return { done: sh.status === 'ready', progress: { done: sh.todo.filter((t) => t.done).length, total: sh.todo.length } };
  }

  /* ---------- partage entre utilisateurs ---------- */
  async function sendShare(user, body) {
    const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
    const idx = /^[a-z0-9_-]{3,16}$/.test(to) ? await store.get('pseudo/' + to) : null;
    const target = idx ? await store.get('user/' + idx.id) : null;
    if (!target) throw fail(404, 'Aucun utilisateur avec ce pseudo.');
    if (target.id === user.id) throw fail(400, 'Tu ne peux pas t\'envoyer un élément à toi-même.');
    let kind = body.kind, payload, title;
    if (kind === 'sheet') {
      const sh = await ownSheet(user, str(body.refId, 40));
      if (sh.status !== 'ready') throw fail(400, 'Cette fiche n\'est pas terminée.');
      payload = { title: sh.title, subjectName: sh.subjectName, content: sh.content };
      title = sh.title;
    } else if (kind === 'course') {
      const sub = (await getSubjects(user.id)).items.find((s) => s.id === body.refId);
      if (!sub) throw fail(404, 'Matière introuvable.');
      const course = await getCourse(user.id, sub.id);
      if (!course.chapters.length) throw fail(400, 'Cette matière n\'a pas encore de cours.');
      payload = { subjectName: sub.name, color: sub.color, chapters: course.chapters.map((c) => ({ title: c.title, sections: c.sections.map((s) => ({ heading: s.heading, content: s.content, terms: s.terms, lessonTitle: s.lessonTitle, date: s.date })) })) };
      title = 'Cours de ' + sub.name;
    } else if (kind === 'lesson') {
      const l = await ownLesson(user, str(body.refId, 40));
      if (l.status !== 'ready') throw fail(400, 'Ce cours n\'est pas encore prêt.');
      payload = { title: l.title, date: l.date, subjectName: l.subjectName, recap: l.recap, sections: l.sections };
      title = l.title + ' (' + l.subjectName + ')';
    } else throw fail(400, 'Type d\'élément inconnu.');
    const raw = JSON.stringify(payload);
    if (raw.length > 4 * 1024 * 1024) throw fail(413, 'Élément trop volumineux pour être envoyé.');
    const inbox = await getInbox(target.id);
    if (inbox.items.length >= 100) throw fail(429, 'La boîte de réception de ce joueur est pleine.');
    const id = 'x_' + rid(8);
    await store.set('sharep/' + id, payload);
    inbox.items.unshift({ id, from: user.id, fromPseudo: user.pseudo, kind, title, at: Date.now(), status: 'pending' });
    await store.set('inbox/' + target.id, inbox);
    const out = await getOutbox(user.id);
    out.items.unshift({ id, to: target.id, toPseudo: target.pseudo, kind, title, at: Date.now(), status: 'pending' });
    out.items = out.items.slice(0, 60);
    await store.set('outbox/' + user.id, out);
    return { id };
  }
  async function setShareStatus(shareId, status) {
    // met à jour l'état chez l'expéditeur
    for (const k of await store.list('outbox/')) {
      const o = await store.get(k);
      const it = o && o.items.find((x) => x.id === shareId);
      if (it) { it.status = status; await store.set(k, o); return; }
    }
  }
  function mergeChapters(course, chapters, by, fallbackDate) {
    chapters.forEach((ch) => (ch.sections || []).forEach((s) => addToCourse(course, str(ch.title, 60) || 'Divers', {
      heading: str(s.heading, 120) || 'Notes', content: str(s.content, 12000), terms: (Array.isArray(s.terms) ? s.terms : []).slice(0, 8).map((t) => str(t, 60)),
      lessonId: null, lessonTitle: str(s.lessonTitle, 80) || null, date: validDate(s.date) ? s.date : fallbackDate, by,
    })));
  }

  /* =====================================================================================
     ROUTES
     ===================================================================================== */
  async function route(req) {
    const m = req.method;
    const p = (req.path || '').replace(/\/+$/, '') || '/';
    if (!p.startsWith('/api/')) return json(404, { error: 'Introuvable.' });

    if (m !== 'GET') {
      if (req.headers['x-requested-with'] !== 'cours') return json(403, { error: 'Requête refusée.' });
      const o = req.headers.origin;
      if (o) {
        let ok = false;
        try { ok = new URL(o).host === req.host; } catch (e) { /* refusé */ }
        if (!ok) return json(403, { error: 'Requête refusée.' });
      }
    }
    const isAudio = m === 'PUT' && /^\/api\/lessons\/l_[a-f0-9]+\/chunks\/\d+$/.test(p);
    const body = m === 'POST' ? parseBody(req, p === '/api/prefs' ? 900 * 1024 : MAX_BODY) : {};
    const user = await authUser(req);

    if (m === 'GET' && p === '/api/me') {
      let pending = 0, prefs = null;
      if (user) { pending = (await getInbox(user.id)).items.filter((x) => x.status === 'pending').length; prefs = await getPrefs(user.id); await touchPresence(user, req); }
      return json(200, { user: user ? pub(user) : null, pending, prefs, langs: LANGS });
    }

    if (m === 'POST' && p === '/api/register') {
      const pseudo = typeof body.pseudo === 'string' ? body.pseudo.trim() : '';
      if (!/^[A-Za-z0-9_-]{3,16}$/.test(pseudo)) return json(400, { error: 'Le pseudo doit faire 3 à 16 caractères : lettres, chiffres, _ ou -.' });
      if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 64) return json(400, { error: 'Le mot de passe doit faire entre 8 et 64 caractères.' });
      const low = pseudo.toLowerCase();
      const h = await hashPw(body.password);
      const id = 'u_' + rid(8);
      const claimed = await store.setIfNew('pseudo/' + low, { id });
      if (!claimed) {
        const old = await store.get('pseudo/' + low);
        if (old && (await store.get('user/' + old.id))) return json(409, { error: 'Ce pseudo est déjà pris.' });
        await store.set('pseudo/' + low, { id }); // réservation orpheline : on la reprend
      }
      const u = { id, pseudo, pseudoLower: low, salt: h.salt, hash: h.hash, joined: todayUtc(), tv: 0, lang: 'fr' };
      await store.set('user/' + id, u);
      await recordConn(u, req, 'register');
      return json(201, { user: pub(u) }, [await startSession(req, u, !!body.remember)]);
    }

    if (m === 'POST' && p === '/api/login') {
      const low = typeof body.pseudo === 'string' ? body.pseudo.trim().toLowerCase() : '';
      const key = sha((req.ip || '') + '|' + low);
      const wait = await throttleWait(key);
      if (wait) return json(429, { error: 'Trop d’essais. Réessaie dans ' + wait + ' s.' });
      const idx = /^[a-z0-9_-]{3,16}$/.test(low) ? await store.get('pseudo/' + low) : null;
      const u = idx ? await store.get('user/' + idx.id) : null;
      const ok = typeof body.password === 'string' && (await checkPw(body.password.slice(0, 200), u));
      if (!ok) { await noteFailure(key); return json(401, { error: 'Pseudo ou mot de passe incorrect.' }); }
      await store.del('rl/' + key);
      await recordConn(u, req, 'login');
      return json(200, { user: pub(u) }, [await startSession(req, u, !!body.remember)]);
    }

    if (m === 'POST' && p === '/api/logout') {
      const t = tokenOf(req);
      if (t) await store.del('sess/' + sha(t));
      if (user) { const pr = await store.get('presence/' + user.id); if (pr) await store.set('presence/' + user.id, Object.assign({}, pr, { offline: true })); }
      return json(200, { ok: true }, [cookie(req, '', 0)]);
    }

    /* ----- administration (cookie séparé, indépendant du compte utilisateur) ----- */
    if (p.startsWith('/api/admin/')) {
      if (m === 'POST' && p === '/api/admin/login') {
        const key = sha((req.ip || '') + '|admin');
        const wait = await throttleWait(key);
        if (wait) return json(429, { error: 'Trop d’essais. Réessaie dans ' + wait + ' s.' });
        if (!(await adminOk(body.id, body.password, env))) { await noteFailure(key); return json(403, { error: 'Identifiants administrateur incorrects.' }); }
        await store.del('rl/' + key);
        const token = rid(32), ttl = 2 * 3600 * 1000;
        await store.set('asess/' + sha(token), { exp: Date.now() + ttl });
        return json(200, { ok: true }, [admCookie(req, token, Math.floor(ttl / 1000))]);
      }
      if (!(await isAdmin(req))) return json(403, { error: 'Accès administrateur requis.' });
      if (m === 'GET' && p === '/api/admin/session') return json(200, { ok: true });
      if (m === 'POST' && p === '/api/admin/logout') {
        const t = /cours_adm=([a-f0-9]{64})/.exec(req.headers.cookie || '');
        if (t) await store.del('asess/' + sha(t[1]));
        return json(200, { ok: true }, [admCookie(req, '', 0)]);
      }
      if (m === 'GET' && p === '/api/admin/users') {
        const all = (await Promise.all((await store.list('user/')).map((k) => store.get(k)))).filter(Boolean);
        const out = [];
        for (const u of all) {
          const pr = await store.get('presence/' + u.id), cn = (await store.get('conn/' + u.id)) || { logins: 0, visits: 0 };
          out.push({ id: u.id, pseudo: u.pseudo, pseudoLower: u.pseudoLower, joined: u.joined, lessons: (await getIndex(u.id)).items.length, subjects: (await getSubjects(u.id)).items.length,
            online: !!(pr && !pr.offline && Date.now() - pr.lastSeen < 3 * 60000), lastSeen: pr ? pr.lastSeen : 0, logins: cn.logins, visits: cn.visits });
        }
        out.sort((a, b) => String(a.pseudoLower).localeCompare(String(b.pseudoLower)));
        return json(200, { users: out });
      }
      const ac = /^\/api\/admin\/users\/(u_[a-f0-9]+)\/(subjects|lessons|sheets)\/([mlf]_[a-f0-9]+)$/.exec(p);
      if (ac && m === 'GET') { // lecture seule des cours et fiches d'un compte
        const tu = await store.get('user/' + ac[1]);
        if (!tu) return json(404, { error: 'Utilisateur introuvable.' });
        if (ac[2] === 'subjects') {
          const sj = (await getSubjects(tu.id)).items.find((x) => x.id === ac[3]);
          return sj ? json(200, { subject: sj, course: await getCourse(tu.id, sj.id) }) : json(404, { error: 'Matière introuvable.' });
        }
        if (ac[2] === 'lessons') {
          const l = await store.get('lesson/' + ac[3]);
          if (!l || l.uid !== tu.id) return json(404, { error: 'Cours introuvable.' });
          const keys = (await store.list('lchunk/' + l.id + '/')).sort();
          const text = (await Promise.all(keys.map((k) => store.get(k)))).filter(Boolean).map((c) => c.text).filter(Boolean).join('\n\n');
          return json(200, { lesson: l, transcript: text });
        }
        const sh = await store.get('sheet/' + ac[3]);
        return sh && sh.uid === tu.id ? json(200, { sheet: sh }) : json(404, { error: 'Fiche introuvable.' });
      }
      const am = /^\/api\/admin\/users\/(u_[a-f0-9]+)(?:\/(rename|password))?$/.exec(p);
      if (am) {
        const u = await store.get('user/' + am[1]);
        if (!u) return json(404, { error: 'Utilisateur introuvable.' });
        if (m === 'GET' && !am[2]) return json(200, await adminDetail(u));
        if (m === 'DELETE' && !am[2]) { await deleteUserData(u); return json(200, { ok: true }); }
        if (m === 'POST' && am[2] === 'rename') {
          const pseudo = typeof body.pseudo === 'string' ? body.pseudo.trim() : '';
          if (!/^[A-Za-z0-9_-]{3,16}$/.test(pseudo)) return json(400, { error: 'Le pseudo doit faire 3 à 16 caractères : lettres, chiffres, _ ou -.' });
          const low = pseudo.toLowerCase();
          if (low !== u.pseudoLower) {
            if (!(await store.setIfNew('pseudo/' + low, { id: u.id }))) {
              const old = await store.get('pseudo/' + low);
              if (old && old.id !== u.id && (await store.get('user/' + old.id))) return json(409, { error: 'Ce pseudo est déjà pris.' });
              await store.set('pseudo/' + low, { id: u.id });
            }
            await store.del('pseudo/' + u.pseudoLower);
          }
          u.pseudo = pseudo; u.pseudoLower = low;
          await store.set('user/' + u.id, u);
          return json(200, { ok: true, pseudo });
        }
        if (m === 'POST' && am[2] === 'password') {
          if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 64) return json(400, { error: 'Le mot de passe doit faire entre 8 et 64 caractères.' });
          const h = await hashPw(body.password);
          u.salt = h.salt; u.hash = h.hash; u.tv = (u.tv || 0) + 1; // déconnecte ses appareils
          await store.set('user/' + u.id, u);
          return json(200, { ok: true });
        }
      }
      /* clés d'IA : ajoutées / retirées sans redéployer */
      if (m === 'GET' && p === '/api/admin/ai') {
        const doc = (await store.get('aikeys')) || { items: [] };
        const status = await ai.status();
        const inEnv = (prov) => (((prov === 'groq' ? env.GROQ_API_KEYS || env.GROQ_API_KEY : '') || '').split(/[\s,;]+/).filter(Boolean).length);
        return json(200, {
          stored: doc.items.map((k) => ({ id: k.id, provider: k.provider, mask: k.mask, disabled: !!k.disabled, addedAt: k.addedAt })),
          envCount: { groq: inEnv('groq') }, status, now: Date.now(),
        });
      }
      if (m === 'POST' && p === '/api/admin/ai/keys') {
        const provider = !body.provider || body.provider === 'groq' ? 'groq' : '';
        const key = str(body.key, 300);
        if (!provider || key.length < 20 || /\s/.test(key)) return json(400, { error: 'Colle une clé Groq valide (elle commence par gsk_).' });
        const doc = (await store.get('aikeys')) || { items: [] };
        const id = keyId(key);
        if (doc.items.some((k) => k.id === id)) return json(409, { error: 'Cette clé est déjà enregistrée.' });
        doc.items.push({ id, provider, key, mask: maskKey(key), addedAt: Date.now() });
        await store.set('aikeys', doc);
        return json(201, { ok: true });
      }
      const ak = /^\/api\/admin\/ai\/keys\/([a-f0-9]{10})$/.exec(p);
      if (ak && m === 'DELETE') {
        const doc = (await store.get('aikeys')) || { items: [] };
        doc.items = doc.items.filter((k) => k.id !== ak[1]);
        await store.set('aikeys', doc);
        return json(200, { ok: true });
      }
      if (m === 'POST' && p === '/api/admin/ai/test') {
        try {
          const r = await ai.text({ json: true, maxTokens: 50, system: 'Réponds uniquement en JSON.', user: 'Renvoie {"ok":true}.' });
          return json(200, { ok: true, provider: r.provider, model: r.model });
        } catch (e) { return json(200, { ok: false, error: e.message, retryAfter: e.retryAfter || 0 }); }
      }
      return json(404, { error: 'Introuvable.' });
    }

    if (!user) return json(401, { error: 'Connecte-toi pour continuer.' });

    /* ----- compte ----- */
    if (m === 'POST' && p === '/api/password') {
      if (typeof body.next !== 'string' || body.next.length < 8 || body.next.length > 64) return json(400, { error: 'Le nouveau mot de passe doit faire entre 8 et 64 caractères.' });
      if (!(typeof body.current === 'string' && (await checkPw(body.current.slice(0, 200), user)))) return json(403, { error: 'Mot de passe actuel incorrect.' });
      const h = await hashPw(body.next);
      user.salt = h.salt; user.hash = h.hash; user.tv = (user.tv || 0) + 1;
      await store.set('user/' + user.id, user);
      await store.del('sess/' + sha(tokenOf(req)));
      return json(200, { ok: true }, [await startSession(req, user, true)]);
    }
    if (m === 'POST' && p === '/api/settings') {
      if (body.lang !== undefined) { if (!LANGS.includes(body.lang)) return json(400, { error: 'Langue inconnue.' }); user.lang = body.lang; }
      await store.set('user/' + user.id, user);
      return json(200, { user: pub(user) });
    }

    /* ----- apparence propre à chaque compte ----- */
    if (m === 'GET' && p === '/api/prefs/bg') return json(200, (await store.get('prefbg/' + user.id)) || { data: null, v: 0 });
    if (m === 'POST' && p === '/api/prefs') {
      const cur = await getPrefs(user.id);
      const next = Object.assign({}, cur);
      if (['auto', 'light', 'dark'].includes(body.mode)) next.mode = body.mode;
      for (const k of ['accent', 'mark', 'bgColor']) if (body[k] !== undefined) next[k] = (body[k] === '' || HEX.test(String(body[k]))) ? body[k] : cur[k];
      if (['none', 'color', 'image'].includes(body.bgType)) next.bgType = body.bgType;
      if (body.veil !== undefined) next.veil = Math.max(0, Math.min(90, Math.round(Number(body.veil) || 0)));
      if (['seyes', 'lines', 'grid', 'plain'].includes(body.paper)) next.paper = body.paper;
      if (['s', 'm', 'l'].includes(body.size)) next.size = body.size;
      if (['serif', 'sans'].includes(body.font)) next.font = body.font;
      if (body.image === null) { await store.del('prefbg/' + user.id); next.bgV = cur.bgV + 1; if (next.bgType === 'image') next.bgType = 'none'; }
      else if (typeof body.image === 'string') {
        if (body.image.length > 700000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image)) return json(400, { error: 'Image invalide ou trop lourde.' });
        next.bgV = cur.bgV + 1; next.bgType = 'image';
        await store.set('prefbg/' + user.id, { data: body.image, v: next.bgV });
      }
      if (next.bgType === 'image' && !(await store.get('prefbg/' + user.id))) next.bgType = 'none';
      await store.set('prefs/' + user.id, next);
      return json(200, { prefs: next });
    }

    /* ----- matières ----- */
    if (m === 'GET' && p === '/api/subjects') {
      const subj = await getSubjects(user.id);
      const idx = await getIndex(user.id);
      return json(200, { subjects: subj.items.map((s) => {
        const ls = idx.items.filter((l) => l.subjectId === s.id);
        return Object.assign({}, s, { lessons: ls.length, ready: ls.filter((l) => l.status === 'ready').length, last: ls.map((l) => l.date).sort().pop() || null });
      }) });
    }
    if (m === 'POST' && p === '/api/subjects') {
      const name = str(body.name, 40);
      if (!name) return json(400, { error: 'Donne un nom à la matière.' });
      const subj = await getSubjects(user.id);
      if (subj.items.length >= 60) return json(400, { error: 'Maximum 60 matières.' });
      if (subj.items.some((s) => norm(s.name) === norm(name))) return json(409, { error: 'Cette matière existe déjà.' });
      const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : COLORS[subj.items.length % COLORS.length];
      const s = { id: 'm_' + rid(5), name, color, createdAt: Date.now() };
      subj.items.push(s);
      await store.set('subj/' + user.id, subj);
      return json(201, { subject: s });
    }
    if (m === 'POST' && p === '/api/subjects/order') { // ranger les matières
      const subj = await getSubjects(user.id);
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const byId = new Map(subj.items.map((x) => [x.id, x]));
      const next = ids.filter((id, i) => byId.has(id) && ids.indexOf(id) === i).map((id) => byId.get(id));
      subj.items.forEach((x) => { if (!next.includes(x)) next.push(x); });
      subj.items = next;
      await store.set('subj/' + user.id, subj);
      return json(200, { ok: true });
    }

    /* ----- édition du cours global : chapitres et sections (texte modifiable, déplaçable) ----- */
    let mm = /^\/api\/subjects\/(m_[a-f0-9]+)\/(chapters|sections)(?:\/([cs]_[a-f0-9]+))?(?:\/(move))?$/.exec(p);
    if (mm) {
      const sj = (await getSubjects(user.id)).items.find((x) => x.id === mm[1]);
      if (!sj) return json(404, { error: 'Matière introuvable.' });
      const [, , what, id, move] = mm;
      if (!id && move) return json(404, { error: 'Introuvable.' });
      const course = await getCourse(user.id, sj.id);
      const save = () => store.set('course/' + user.id + '/' + sj.id, course);
      const dir = Number(body.dir) < 0 ? -1 : 1;
      const swap = (arr, i) => { const j = i + dir; if (j < 0 || j >= arr.length) return false; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; return true; };
      if (what === 'chapters') {
        if (m === 'POST' && !id) {
          const title = str(body.title, 60);
          if (!title) return json(400, { error: 'Donne un nom au chapitre.' });
          if (course.chapters.length >= 200) return json(400, { error: 'Maximum 200 chapitres.' });
          if (course.chapters.some((c) => norm(c.title) === norm(title))) return json(409, { error: 'Ce chapitre existe déjà.' });
          const ch = { id: 'c_' + rid(4), title, sections: [] };
          course.chapters.push(ch); await save();
          return json(201, { chapter: ch });
        }
        const i = course.chapters.findIndex((c) => c.id === id);
        if (i < 0) return json(404, { error: 'Chapitre introuvable.' });
        const ch = course.chapters[i];
        if (m === 'POST' && move) { swap(course.chapters, i); await save(); return json(200, { ok: true }); }
        if (m === 'POST') {
          const title = str(body.title, 60);
          if (!title) return json(400, { error: 'Donne un nom au chapitre.' });
          if (course.chapters.some((c) => c.id !== id && norm(c.title) === norm(title))) return json(409, { error: 'Ce chapitre existe déjà.' });
          ch.title = title; delete ch.auto; await save();
          return json(200, { chapter: ch });
        }
        if (m === 'DELETE') { course.chapters.splice(i, 1); await save(); return json(200, { ok: true }); }
      } else {
        if (m === 'POST' && !id) {
          const ch = course.chapters.find((c) => c.id === body.chapterId);
          if (!ch) return json(404, { error: 'Choisis un chapitre.' });
          const content = str(body.content, 60000);
          if (!content) return json(400, { error: 'Le texte est vide.' });
          if (ch.sections.length >= 500) return json(400, { error: 'Maximum 500 sections par chapitre.' });
          const sec = { id: 's_' + rid(4), heading: str(body.heading, 120) || 'Notes', content, terms: [], lessonId: null, lessonTitle: null, date: ctoday(req, body), manual: true };
          ch.sections.push(sec); delete ch.auto; await save();
          return json(201, { section: sec });
        }
        let ci = -1, si = -1;
        course.chapters.forEach((c, x) => { const y = c.sections.findIndex((q) => q.id === id); if (y >= 0) { ci = x; si = y; } });
        if (ci < 0) return json(404, { error: 'Section introuvable.' });
        const from = course.chapters[ci], sec = from.sections[si];
        if (m === 'POST' && move) { swap(from.sections, si); await save(); return json(200, { ok: true }); }
        if (m === 'POST') {
          if (body.heading !== undefined) sec.heading = str(body.heading, 120) || 'Notes';
          if (body.content !== undefined) { const c = str(body.content, 60000); if (!c) return json(400, { error: 'Le texte est vide.' }); sec.content = c; }
          sec.edited = true;
          if (body.chapterId && body.chapterId !== from.id) {
            const to = course.chapters.find((c) => c.id === body.chapterId);
            if (!to) return json(404, { error: 'Chapitre introuvable.' });
            from.sections.splice(si, 1); to.sections.push(sec); delete to.auto;
          }
          await save();
          return json(200, { section: sec });
        }
        if (m === 'DELETE') { from.sections.splice(si, 1); await save(); return json(200, { ok: true }); }
      }
    }

    mm = /^\/api\/subjects\/(m_[a-f0-9]+)(?:\/(course|rename))?$/.exec(p);
    if (mm) {
      const subj = await getSubjects(user.id);
      const s = subj.items.find((x) => x.id === mm[1]);
      if (!s) return json(404, { error: 'Matière introuvable.' });
      if (m === 'GET' && mm[2] === 'course') return json(200, { subject: s, course: await getCourse(user.id, s.id) });
      if (m === 'POST' && mm[2] === 'rename') {
        const name = str(body.name, 40);
        if (!name) return json(400, { error: 'Donne un nom à la matière.' });
        if (subj.items.some((x) => x.id !== s.id && norm(x.name) === norm(name))) return json(409, { error: 'Cette matière existe déjà.' });
        s.name = name;
        if (/^#[0-9a-f]{6}$/i.test(body.color || '')) s.color = body.color;
        await store.set('subj/' + user.id, subj);
        for (const x of (await getIndex(user.id)).items.filter((l) => l.subjectId === s.id)) { const l = await store.get('lesson/' + x.id); if (l && l.subjectName !== name) { l.subjectName = name; await store.set('lesson/' + l.id, l); } }
        const sidx = await getSheetsIdx(user.id);
        for (const x of sidx.items.filter((f) => f.subjectId === s.id)) { x.subjectName = name; const f = await store.get('sheet/' + x.id); if (f) { f.subjectName = name; await store.set('sheet/' + f.id, f); } }
        await store.set('usheets/' + user.id, sidx);
        return json(200, { subject: s });
      }
      if (m === 'DELETE' && !mm[2]) {
        for (const x of (await getIndex(user.id)).items.filter((l) => l.subjectId === s.id)) { const l = await store.get('lesson/' + x.id); if (l) await deleteLesson(l); }
        await store.del('course/' + user.id + '/' + s.id);
        subj.items = subj.items.filter((x) => x.id !== s.id);
        await store.set('subj/' + user.id, subj);
        return json(200, { ok: true });
      }
    }

    /* ----- séances (enregistrements) ----- */
    if (m === 'GET' && p === '/api/lessons') {
      return json(200, { lessons: (await getIndex(user.id)).items });
    }
    if (m === 'POST' && p === '/api/lessons') {
      const s = (await getSubjects(user.id)).items.find((x) => x.id === body.subjectId);
      if (!s) return json(404, { error: 'Choisis une matière.' });
      const title = str(body.title, 80);
      const date = ctoday(req, body);
      const l = {
        id: 'l_' + rid(8), uid: user.id, subjectId: s.id, subjectName: s.name, title: title || s.name + ' — ' + date.split('-').reverse().join('/'),
        autoTitle: !title, chapterId: /^c_[a-f0-9]+$/.test(body.chapterId || '') ? body.chapterId : null, date, status: 'recording', durationSec: 0, createdAt: Date.now(), recap: null, sections: [],
      };
      await saveLesson(l);
      return json(201, { lesson: l });
    }
    mm = /^\/api\/lessons\/(l_[a-f0-9]+)(?:\/(finish|step|transcript|rename|retry|chunks\/(\d+)))?$/.exec(p);
    if (mm) {
      const l = await ownLesson(user, mm[1]);
      const act = mm[2] && mm[2].startsWith('chunks') ? 'chunks' : mm[2];
      if (m === 'GET' && !act) return json(200, { lesson: l });
      if (m === 'DELETE' && !act) { await deleteLesson(l); return json(200, { ok: true }); }
      if (m === 'POST' && act === 'rename') {
        const t = str(body.title, 80);
        if (!t) return json(400, { error: 'Le titre ne peut pas être vide.' });
        l.title = t; l.autoTitle = false;
        await saveLesson(l);
        return json(200, { lesson: l });
      }
      if (m === 'GET' && act === 'transcript') {
        const keys = (await store.list('lchunk/' + l.id + '/')).sort();
        const parts = (await Promise.all(keys.map((k) => store.get(k)))).filter(Boolean);
        return json(200, { text: parts.map((c) => c.text).filter(Boolean).join('\n\n') });
      }
      if (isAudio && m === 'PUT') {
        if (l.status !== 'recording' && l.status !== 'processing') throw fail(400, 'Ce cours est déjà terminé.');
        const n = Number(mm[3]);
        if (!(n >= 0 && n < 1000)) throw fail(400, 'Numéro de segment invalide.');
        const key = 'lchunk/' + l.id + '/' + pad4(n);
        const have = await store.get(key);
        if (have) return json(200, { ok: true, words: words(have.text), duplicate: true });
        const bytes = req.bytes;
        if (!bytes || bytes.length < 200) throw fail(400, 'Segment audio vide.');
        if (bytes.length > MAX_AUDIO) throw fail(413, 'Segment audio trop volumineux.');
        const mime = String(req.headers['content-type'] || 'audio/webm').split(';')[0];
        const prevDoc = n > 0 ? await store.get('lchunk/' + l.id + '/' + pad4(n - 1)) : null;
        const prompt = 'Cours de ' + l.subjectName + '.' + (prevDoc && prevDoc.text ? ' ' + prevDoc.text.slice(-300) : '');
        const tr = await ai.transcribe({ bytes, mime, language: user.lang || 'fr', prompt });
        const f = filterSegments(tr);
        await store.set(key, { n, text: f.text, kept: f.kept, dropped: f.dropped, dur: Math.round(Number(req.headers['x-duration']) || tr.duration || 0) });
        return json(200, { ok: true, words: words(f.text) });
      }
      if (m === 'POST' && act === 'finish') {
        if (l.status === 'ready' || (l.status === 'processing' && l.plan)) return json(200, { ok: true, lesson: l }); // déjà pris en compte : on ne repart pas de zéro
        const total = Math.round(Number(body.chunks));
        if (!(total >= 0 && total <= 1000)) return json(400, { error: 'Nombre de segments invalide.' });
        const have = (await store.list('lchunk/' + l.id + '/')).map((k) => Number(k.split('/').pop()));
        const skip = Array.isArray(body.skip) ? body.skip.map(Number) : []; // segments perdus côté téléphone : on avance sans eux
        const missing = [];
        for (let i = 0; i < total; i++) if (!have.includes(i) && !skip.includes(i)) missing.push(i);
        if (missing.length) return json(200, { ok: false, missing });
        const docs = [];
        for (let i = 0; i < total; i++) docs.push(skip.includes(i) ? null : await store.get('lchunk/' + l.id + '/' + pad4(i)));
        const withText = docs.filter((d) => d && words(d.text) >= 8);
        l.durationSec = Math.max(0, Math.min(86400, Math.round(Number(body.durationSec) || docs.reduce((a, d) => a + (d ? d.dur || 0 : 0), 0))));
        if (!withText.length) {
          l.status = 'error'; l.error = 'Aucune parole exploitable n\'a été détectée dans cet enregistrement.';
          await saveLesson(l);
          return json(200, { ok: true, lesson: l });
        }
        const groups = [];
        const maxWords = 1100; // petits morceaux pour tenir dans les quotas de Groq
        let cur = [], w = 0;
        withText.forEach((d) => {
          const dw = words(d.text);
          if (cur.length && w + dw > maxWords) { groups.push(cur); cur = []; w = 0; }
          cur.push(d.n); w += dw;
        });
        if (cur.length) groups.push(cur);
        l.plan = { clean: withText.map((d) => d.n), groups };
        l.done = { clean: [], groups: [] };
        l.status = 'processing'; l.error = null;
        await saveLesson(l);
        return json(200, { ok: true, lesson: l, total: l.plan.clean.length + l.plan.groups.length + 1 });
      }
      if (m === 'POST' && act === 'retry') {
        if (l.status !== 'error' || !l.plan) return json(400, { error: 'Rien à relancer.' });
        l.status = 'processing'; l.error = null;
        await saveLesson(l);
        return json(200, { lesson: l });
      }
      if (m === 'POST' && act === 'step') {
        return json(200, await lessonStep(user, l));
      }
    }

    /* ----- fiches de révision ----- */
    if (m === 'GET' && p === '/api/sheets') return json(200, { sheets: (await getSheetsIdx(user.id)).items });
    if (m === 'POST' && p === '/api/sheets') {
      const s = (await getSubjects(user.id)).items.find((x) => x.id === body.subjectId);
      if (!s) return json(404, { error: 'Choisis une matière.' });
      const b = await buildSheetTodo(user, s, body);
      const sh = { id: 'f_' + rid(8), uid: user.id, subjectId: s.id, subjectName: s.name, title: b.title.slice(0, 120), scope: body.scope, query: b.query, status: 'processing', todo: b.todo, content: '', createdAt: Date.now() };
      await store.set('sheet/' + sh.id, sh);
      return json(201, { id: sh.id, total: sh.todo.length });
    }
    mm = /^\/api\/sheets\/(f_[a-f0-9]+)(?:\/(step|rename|edit))?$/.exec(p);
    if (mm) {
      const sh = await ownSheet(user, mm[1]);
      if (m === 'GET' && !mm[2]) { const { todo, ...rest } = sh; return json(200, { sheet: Object.assign(rest, { progress: { done: todo.filter((t) => t.done).length, total: todo.length } }) }); }
      if (m === 'DELETE' && !mm[2]) { await deleteSheet(sh); return json(200, { ok: true }); }
      if (m === 'POST' && mm[2] === 'step') return json(200, await sheetStep(user, sh));
      if (m === 'POST' && mm[2] === 'edit') {
        if (sh.status !== 'ready') return json(400, { error: 'La fiche n\'est pas terminée.' });
        const c = str(body.content, 200000);
        if (!c) return json(400, { error: 'Le texte est vide.' });
        sh.content = c; sh.edited = true;
        await store.set('sheet/' + sh.id, sh);
        return json(200, { ok: true });
      }
      if (m === 'POST' && mm[2] === 'rename') {
        const t = str(body.title, 120);
        if (!t) return json(400, { error: 'Le titre ne peut pas être vide.' });
        sh.title = t; await store.set('sheet/' + sh.id, sh);
        const idx = await getSheetsIdx(user.id);
        const it = idx.items.find((x) => x.id === sh.id); if (it) it.title = t;
        await store.set('usheets/' + user.id, idx);
        return json(200, { ok: true });
      }
    }

    /* ----- partage ----- */
    if (m === 'GET' && p === '/api/users') {
      const q = str(req.query && req.query.q, 16).toLowerCase();
      if (q.length < 2) return json(200, { users: [] });
      const keys = (await store.list('pseudo/' + q)).slice(0, 8);
      const out = [];
      for (const k of keys) { const idx = await store.get(k); const u = idx ? await store.get('user/' + idx.id) : null; if (u && u.id !== user.id) out.push(u.pseudo); }
      return json(200, { users: out });
    }
    if (m === 'POST' && p === '/api/share') return json(201, await sendShare(user, body));
    if (m === 'GET' && p === '/api/inbox') return json(200, { received: (await getInbox(user.id)).items, sent: (await getOutbox(user.id)).items });
    mm = /^\/api\/share\/(x_[a-f0-9]+)(?:\/(accept|decline))?$/.exec(p);
    if (mm) {
      const inbox = await getInbox(user.id);
      const it = inbox.items.find((x) => x.id === mm[1]);
      const out = await getOutbox(user.id);
      const mine = out.items.find((x) => x.id === mm[1]);
      if (m === 'GET' && !mm[2]) {
        if (!it && !mine) return json(404, { error: 'Envoi introuvable.' });
        return json(200, { item: it || mine, payload: await store.get('sharep/' + mm[1]) });
      }
      if (m === 'DELETE' && !mm[2]) { // l'expéditeur retire un envoi non accepté, ou le destinataire supprime la ligne
        if (it) { inbox.items = inbox.items.filter((x) => x.id !== mm[1]); await store.set('inbox/' + user.id, inbox); if (it.status !== 'accepted') { /* la copie reste chez l'expéditeur */ } return json(200, { ok: true }); }
        if (mine) {
          out.items = out.items.filter((x) => x.id !== mm[1]); await store.set('outbox/' + user.id, out);
          const ri = await getInbox(mine.to);
          const rit = ri.items.find((x) => x.id === mm[1]);
          if (rit && rit.status === 'pending') { ri.items = ri.items.filter((x) => x.id !== mm[1]); await store.set('inbox/' + mine.to, ri); await store.del('sharep/' + mm[1]); }
          return json(200, { ok: true });
        }
        return json(404, { error: 'Envoi introuvable.' });
      }
      if (!it) return json(404, { error: 'Envoi introuvable.' });
      if (m === 'POST' && mm[2] === 'decline') {
        it.status = 'declined'; await store.set('inbox/' + user.id, inbox); await setShareStatus(it.id, 'declined');
        return json(200, { ok: true });
      }
      if (m === 'POST' && mm[2] === 'accept') {
        if (it.status === 'accepted') return json(200, { ok: true, already: true });
        const payload = await store.get('sharep/' + it.id);
        if (!payload) return json(410, { error: 'Cet envoi n\'est plus disponible.' });
        const subj = await getSubjects(user.id);
        let target = null;
        if (it.kind !== 'sheet' || body.subjectId) {
          target = subj.items.find((s) => s.id === body.subjectId) || null;
          if (!target && it.kind !== 'sheet') {
            const nm = str(payload.subjectName, 40) || 'Matière reçue';
            target = subj.items.find((s) => norm(s.name) === norm(nm));
            if (!target) {
              if (subj.items.length >= 60) return json(400, { error: 'Maximum 60 matières.' });
              target = { id: 'm_' + rid(5), name: nm, color: /^#[0-9a-f]{6}$/i.test(payload.color || '') ? payload.color : COLORS[subj.items.length % COLORS.length], createdAt: Date.now() };
              subj.items.push(target);
              await store.set('subj/' + user.id, subj);
            }
          }
        }
        const today = todayUtc();
        if (it.kind === 'sheet') {
          const sh = { id: 'f_' + rid(8), uid: user.id, subjectId: target ? target.id : null, subjectName: target ? target.name : (str(payload.subjectName, 40) || 'Reçue'), title: str(payload.title, 120) || 'Fiche reçue', scope: 'shared', query: '', status: 'ready', todo: [], content: str(payload.content, 200000), createdAt: Date.now(), from: it.fromPseudo };
          await store.set('sheet/' + sh.id, sh);
          const idx = await getSheetsIdx(user.id);
          idx.items.unshift({ id: sh.id, subjectId: sh.subjectId, subjectName: sh.subjectName, title: sh.title, scope: 'shared', at: sh.createdAt, from: it.fromPseudo });
          await store.set('usheets/' + user.id, idx);
        } else if (it.kind === 'course') {
          const course = await getCourse(user.id, target.id);
          mergeChapters(course, Array.isArray(payload.chapters) ? payload.chapters : [], it.fromPseudo, today);
          await store.set('course/' + user.id + '/' + target.id, course);
        } else if (it.kind === 'lesson') {
          const l = { id: 'l_' + rid(8), uid: user.id, subjectId: target.id, subjectName: target.name, title: str(payload.title, 80) || 'Cours reçu', autoTitle: false, date: validDate(payload.date) ? payload.date : today, status: 'ready', durationSec: 0, createdAt: Date.now(), recap: payload.recap || null, sections: Array.isArray(payload.sections) ? payload.sections : [], from: it.fromPseudo };
          await saveLesson(l);
          const course = await getCourse(user.id, target.id);
          (l.sections || []).forEach((s) => addToCourse(course, str(s.chapter, 60) || l.title, { heading: str(s.heading, 120) || 'Notes', content: str(s.content, 12000), terms: (Array.isArray(s.terms) ? s.terms : []).slice(0, 8), lessonId: l.id, lessonTitle: l.title, date: l.date, by: it.fromPseudo }));
          await store.set('course/' + user.id + '/' + target.id, course);
        }
        it.status = 'accepted'; await store.set('inbox/' + user.id, inbox); await setShareStatus(it.id, 'accepted');
        return json(200, { ok: true, subjectId: target ? target.id : null });
      }
    }

    return json(404, { error: 'Introuvable.' });
  }

  return async function handle(req) {
    try {
      const url = new URL('http://x' + (req.path || '/') + (req.search || ''));
      req.query = Object.fromEntries(url.searchParams);
      req.path = url.pathname;
      return await route(req);
    } catch (e) {
      if (e && e.status) {
        const body = { error: e.message };
        if (e.retryAfter) body.retryAfter = e.retryAfter;
        return json(e.status, body);
      }
      console.error(e);
      return json(500, { error: 'Erreur du serveur.' });
    }
  };
}
