/* Cursus — le site complet (JavaScript sans dépendance). Il parle à /api/*. */
(() => {
'use strict';

/* =========================== utilitaires =========================== */
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const localDay = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const fmtDate = (k) => { try { return new Date(k + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' }); } catch (e) { return k; } };
const fmtDur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? h + ' h ' + pad(m) : m + ' min'; };
const clock = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600); return (h ? h + ':' : '') + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60); };
const store = {
  get(k) { try { return localStorage.getItem('cursus.' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('cursus.' + k, v); } catch (e) { /* stockage indisponible */ } },
};
const COLORS = ['#e4572e', '#f2a541', '#3a9d5d', '#2e86ab', '#6a4c93', '#d1478c', '#4f6d7a', '#8a5a44'];
const LANGS = { fr: 'Français', en: 'Anglais', es: 'Espagnol', de: 'Allemand', it: 'Italien', pt: 'Portugais', nl: 'Néerlandais', ar: 'Arabe' };

const IC = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7"/></svg>',
  sheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
};

/* rendu Markdown minimal et sûr : on échappe tout, puis on remet quelques balises */
function inline(s) {
  return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}
function md(src) {
  const lines = esc(src).split('\n');
  let html = '', list = null, para = [];
  const flush = () => { if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
  const close = () => { if (list) { html += '</' + list + '>'; list = null; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if (!l.trim()) { flush(); close(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { flush(); close(); html += '<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'; continue; }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { flush(); if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += '<li>' + inline(m[1]) + '</li>'; continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { flush(); if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += '<li>' + inline(m[1]) + '</li>'; continue; }
    if ((m = /^&gt;\s?(.*)$/.exec(l))) { flush(); close(); html += '<blockquote>' + inline(m[1]) + '</blockquote>'; continue; }
    close(); para.push(l.trim());
  }
  flush(); close();
  return html;
}

/* =========================== API =========================== */
async function api(method, path, body, opts) {
  const headers = { 'X-Requested-With': 'cours', 'X-Today': localDay() };
  let payload;
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    headers['Content-Type'] = body.type || 'audio/webm';
    if (opts && opts.duration) headers['X-Duration'] = String(Math.round(opts.duration));
    payload = body;
  } else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let r;
  try { r = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' }); }
  catch (e) { throw { network: true, message: 'Pas de connexion à internet.' }; }
  let data = null;
  try { data = await r.json(); } catch (e) { /* corps vide */ }
  if (!r.ok) {
    const err = { status: r.status, message: (data && data.error) || 'Erreur ' + r.status, retryAfter: (data && data.retryAfter) || 0 };
    if (r.status === 401 && !(opts && opts.quiet) && state.user) { state.user = null; render(); }
    throw err;
  }
  return data;
}

/* =========================== état =========================== */
const state = {
  ready: false, user: null, pending: 0, tab: store.get('tab') || 'rec', stack: [],
  subjects: [], lessons: [], sheets: [], inbox: null, subjectId: store.get('subject') || null,
  jobs: {}, rec: { active: false, t: 0, wake: false, lvl: 0, sent: 0, queued: 0, msg: '', mic: true },
  admin: null, loadingMsg: '',
};
const page = () => state.stack[state.stack.length - 1] || null;
const subjectById = (id) => state.subjects.find((s) => s.id === id);

function toast(msg, ms) {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg; el.setAttribute('role', 'status');
  box.appendChild(el);
  setTimeout(() => el.remove(), ms || 3200);
}
function openModal(html, onMount) {
  closeModal();
  const o = document.createElement('div');
  o.className = 'overlay'; o.id = 'modal';
  o.innerHTML = '<div class="sheetbox" role="dialog" aria-modal="true">' + html + '</div>';
  o.addEventListener('click', (e) => { if (e.target === o) closeModal(); });
  document.body.appendChild(o);
  if (onMount) onMount(o);
  const f = o.querySelector('input,select,textarea'); if (f) f.focus();
  return o;
}
function closeModal() { const m = $('#modal'); if (m) m.remove(); }
const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

/* =========================== navigation =========================== */
function go(p) { state.stack.push(p); try { history.pushState({ d: state.stack.length }, ''); } catch (e) { /* rien */ } render(); window.scrollTo(0, 0); }
function back() { if (state.stack.length) { try { history.back(); } catch (e) { state.stack.pop(); render(); } } }
window.addEventListener('popstate', () => { if (state.stack.length) { state.stack.pop(); render(); } });
function setTab(t) { state.tab = t; state.stack = []; store.set('tab', t); render(); window.scrollTo(0, 0); if (t === 'share') loadInbox(); if (t === 'sheets') loadSheets(); if (t === 'courses') loadAll(); }

/* =========================== données =========================== */
async function loadAll() {
  try {
    const [s, l] = await Promise.all([api('GET', '/api/subjects'), api('GET', '/api/lessons')]);
    state.subjects = s.subjects; state.lessons = l.lessons;
    if (state.subjectId && !subjectById(state.subjectId)) state.subjectId = null;
    render();
  } catch (e) { if (!e.status) toast(e.message); }
}
async function loadSheets() { try { state.sheets = (await api('GET', '/api/sheets')).sheets; render(); } catch (e) { toast(e.message); } }
async function loadInbox() {
  try { state.inbox = await api('GET', '/api/inbox'); state.pending = state.inbox.received.filter((x) => x.status === 'pending').length; render(); } catch (e) { toast(e.message); }
}

/* =========================== IndexedDB : les segments audio sont gardés ici jusqu'à leur envoi =========================== */
const mem = { chunks: new Map(), meta: new Map() };
let dbp = null;
function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const r = indexedDB.open('cursus', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('chunks', { keyPath: 'key' }); r.result.createObjectStore('meta', { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return dbp;
}
async function dbDo(storeName, mode, fn, fallback) {
  const db = await openDb();
  if (!db) return fallback();
  return new Promise((res) => {
    try {
      const tx = db.transaction(storeName, mode);
      const rq = fn(tx.objectStore(storeName));
      tx.oncomplete = () => res(rq ? rq.result : undefined);
      tx.onerror = () => res(fallback());
      tx.onabort = () => res(fallback());
    } catch (e) { res(fallback()); }
  });
}
const dbPut = (s, v) => dbDo(s, 'readwrite', (os) => os.put(v), () => { mem[s].set(v.key || v.id, v); });
const dbGet = (s, k) => dbDo(s, 'readonly', (os) => os.get(k), () => mem[s].get(k));
const dbDel = (s, k) => dbDo(s, 'readwrite', (os) => os.delete(k), () => { mem[s].delete(k); });
const dbAll = (s) => dbDo(s, 'readonly', (os) => os.getAll(), () => Array.from(mem[s].values()));

/* =========================== envoi des segments =========================== */
let pumping = false;
async function countQueued() { state.rec.queued = (await dbAll('chunks')).length; updateRecUI(); }
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const all = (await dbAll('chunks')).sort((a, b) => (a.lessonId === b.lessonId ? a.n - b.n : a.lessonId < b.lessonId ? -1 : 1));
      state.rec.queued = all.length; updateRecUI();
      if (!all.length) break;
      const c = all[0];
      try {
        await api('PUT', '/api/lessons/' + c.lessonId + '/chunks/' + c.n, c.blob, { duration: c.dur, quiet: true });
        await dbDel('chunks', c.key);
        state.rec.sent++; state.rec.msg = '';
      } catch (e) {
        if (e.status === 404 || e.status === 400 || e.status === 413) { await dbDel('chunks', c.key); continue; } // segment inutilisable : on ne bloque pas la file
        if (e.status === 401) { state.rec.msg = 'Session expirée : reconnecte-toi, l\'audio est gardé sur ton téléphone.'; updateRecUI(); await sleep(8000); continue; }
        let wait = 5000;
        if (e.status === 503) { wait = Math.min(Math.max(e.retryAfter, 5), 90) * 1000; state.rec.msg = 'L\'IA est très sollicitée : nouvel essai automatique dans ' + Math.round(wait / 1000) + ' s.'; }
        else if (e.status === 501) { wait = 30000; state.rec.msg = 'L\'IA n\'est pas encore configurée par l\'administrateur. L\'audio est gardé en attendant.'; }
        else if (e.network) state.rec.msg = 'Hors connexion : l\'audio est gardé et partira dès le retour du réseau.';
        else state.rec.msg = e.message;
        updateRecUI();
        await sleep(wait);
      }
    }
  } finally { pumping = false; }
}

/* =========================== enregistrement =========================== */
const SEG_MS = window.__SEG_MS || 120000;
const Rec = { stream: null, mr: null, mime: '', segTimer: null, tick: null, raf: 0, ctx: null, analyser: null, wake: null, fallbackVideo: null, lessonId: null, subjectId: null, n: 0, saved: [], saves: [], startedAt: 0, accMs: 0, segStart: 0 };

function pickMime() {
  const c = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined') return null;
  return c.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
}
async function lockScreen() {
  try {
    if ('wakeLock' in navigator) {
      Rec.wake = await navigator.wakeLock.request('screen');
      state.rec.wake = true;
      Rec.wake.addEventListener('release', () => { state.rec.wake = false; updateRecUI(); });
      return;
    }
  } catch (e) { /* refusé : on tente le secours */ }
  // secours pour les navigateurs sans Wake Lock : une vidéo muette en lecture empêche la veille
  try {
    if (!Rec.fallbackVideo) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 2;
      const g = cv.getContext('2d');
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0';
      v.srcObject = cv.captureStream(2);
      document.body.appendChild(v);
      Rec.fallbackVideo = { v, g, t: setInterval(() => { g.fillStyle = Math.random() > .5 ? '#000' : '#010101'; g.fillRect(0, 0, 2, 2); }, 500) };
    }
    await Rec.fallbackVideo.v.play();
    state.rec.wake = true;
  } catch (e) { state.rec.wake = false; }
}
function unlockScreen() {
  try { if (Rec.wake) Rec.wake.release(); } catch (e) { /* déjà libéré */ }
  Rec.wake = null;
  if (Rec.fallbackVideo) { clearInterval(Rec.fallbackVideo.t); Rec.fallbackVideo.v.pause(); Rec.fallbackVideo.v.remove(); Rec.fallbackVideo = null; }
  state.rec.wake = false;
}

function saveSegment(lessonId, n, blob, mime, dur) {
  if (!blob || blob.size < 1500) return Promise.resolve(); // trop court : rien à transcrire
  const p = (async () => {
    await dbPut('chunks', { key: lessonId + ':' + String(n).padStart(4, '0'), lessonId, n, blob, mime, dur });
    Rec.saved.push(n);
    await dbPut('meta', { id: lessonId, subjectId: Rec.subjectId, nextN: Rec.n, saved: Rec.saved.slice(), stopped: false, startedAt: Rec.startedAt });
    pump();
  })();
  Rec.saves.push(p);
  return p;
}
function newRecorder() {
  const n = Rec.n++;
  const data = [];
  const started = Date.now();
  const lessonId = Rec.lessonId;
  const mr = new MediaRecorder(Rec.stream, Rec.mime ? { mimeType: Rec.mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
  mr.ondataavailable = (e) => { if (e.data && e.data.size) data.push(e.data); };
  mr.onstop = () => { saveSegment(lessonId, n, new Blob(data, { type: mr.mimeType || Rec.mime || 'audio/webm' }), mr.mimeType || Rec.mime, (Date.now() - started) / 1000); };
  mr.onerror = () => { state.rec.mic = false; updateRecUI(); };
  mr.start(1000);
  return mr;
}
function rotateSegment() {
  if (!state.rec.active) return;
  const old = Rec.mr;
  try { Rec.mr = newRecorder(); } catch (e) { return; } // le nouveau démarre avant que l'ancien s'arrête : aucune coupure
  try { if (old && old.state !== 'inactive') old.stop(); } catch (e) { /* déjà arrêté */ }
  Rec.segTimer = setTimeout(rotateSegment, SEG_MS);
}
function watchLevel() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    Rec.ctx = new AC();
    const src = Rec.ctx.createMediaStreamSource(Rec.stream);
    Rec.analyser = Rec.ctx.createAnalyser(); Rec.analyser.fftSize = 512;
    src.connect(Rec.analyser);
    const buf = new Uint8Array(Rec.analyser.fftSize);
    const loop = () => {
      if (!state.rec.active) return;
      Rec.analyser.getByteTimeDomainData(buf);
      let peak = 0; for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      state.rec.lvl = Math.min(1, peak / 60);
      const b = $('#recBtn'); if (b) b.style.setProperty('--lvl', state.rec.lvl.toFixed(2));
      Rec.raf = requestAnimationFrame(loop);
    };
    loop();
  } catch (e) { /* pas de vumètre, l'enregistrement continue */ }
}
async function getMic() {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
}
async function startRec() {
  if (state.rec.active) return;
  const subj = subjectById(state.subjectId);
  if (!subj) { toast('Choisis d\'abord une matière.'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') { toast('Ce navigateur ne peut pas enregistrer. Utilise Chrome ou Safari à jour, en HTTPS.', 6000); return; }
  Rec.mime = pickMime();
  try { Rec.stream = await getMic(); } catch (e) { toast('Micro refusé : autorise-le dans les réglages du navigateur.', 6000); return; }
  let lesson;
  try { lesson = (await api('POST', '/api/lessons', { subjectId: subj.id, title: val('lessonTitle'), today: localDay() })).lesson; }
  catch (e) { Rec.stream.getTracks().forEach((t) => t.stop()); toast(e.message); return; }
  Object.assign(Rec, { lessonId: lesson.id, subjectId: subj.id, n: 0, saved: [], saves: [], startedAt: Date.now(), accMs: 0 });
  Object.assign(state.rec, { active: true, t: 0, sent: 0, msg: '', mic: true });
  await dbPut('meta', { id: lesson.id, subjectId: subj.id, nextN: 0, saved: [], stopped: false, startedAt: Rec.startedAt });
  Rec.stream.getAudioTracks().forEach((tr) => { tr.onended = () => { if (state.rec.active) { state.rec.mic = false; updateRecUI(); ensureMic(); } }; });
  Rec.mr = newRecorder();
  Rec.segTimer = setTimeout(rotateSegment, SEG_MS);
  Rec.segStart = Date.now();
  Rec.tick = setInterval(() => { state.rec.t = (Date.now() - Rec.startedAt) / 1000; const el = $('#timer'); if (el) el.textContent = clock(state.rec.t); }, 500);
  watchLevel();
  await lockScreen();
  try { if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: 'Cours en cours d\'enregistrement', artist: subj.name }); } catch (e) { /* facultatif */ }
  render();
}
async function ensureMic() {
  if (!state.rec.active) return;
  const dead = !Rec.stream || Rec.stream.getAudioTracks().every((t) => t.readyState === 'ended') || !Rec.mr || Rec.mr.state === 'inactive';
  if (!dead) { state.rec.mic = true; updateRecUI(); return; }
  try {
    clearTimeout(Rec.segTimer);
    Rec.stream = await getMic();
    Rec.stream.getAudioTracks().forEach((tr) => { tr.onended = () => { if (state.rec.active) { state.rec.mic = false; updateRecUI(); } }; });
    Rec.mr = newRecorder();
    Rec.segTimer = setTimeout(rotateSegment, SEG_MS);
    state.rec.mic = true; state.rec.msg = 'Le micro avait été coupé par le téléphone : l\'enregistrement a repris.';
    watchLevel();
  } catch (e) { state.rec.mic = false; state.rec.msg = 'Le micro est coupé. Ouvre cette page et touche le bouton pour reprendre.'; }
  updateRecUI();
}
async function stopRec() {
  if (!state.rec.active) return;
  state.rec.active = false;
  clearTimeout(Rec.segTimer); clearInterval(Rec.tick); cancelAnimationFrame(Rec.raf);
  const id = Rec.lessonId;
  const dur = (Date.now() - Rec.startedAt) / 1000;
  await new Promise((res) => { // on attend que le dernier extrait soit bien enregistré
    const mr = Rec.mr;
    if (!mr || mr.state === 'inactive') return res();
    const prev = mr.onstop;
    const timer = setTimeout(res, 4000);
    mr.onstop = (ev) => { try { prev && prev(ev); } catch (e) { /* rien */ } clearTimeout(timer); res(); };
    try { mr.stop(); } catch (e) { clearTimeout(timer); res(); }
  });
  try { Rec.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* rien */ }
  try { if (Rec.ctx) Rec.ctx.close(); } catch (e) { /* rien */ }
  unlockScreen();
  await Promise.all(Rec.saves);
  const meta = (await dbGet('meta', id)) || { id, saved: Rec.saved.slice(), nextN: Rec.n };
  meta.stopped = true; meta.durationSec = Math.round(dur);
  await dbPut('meta', meta);
  render();
  finishLesson(id);
}

/* =========================== fin d'une séance puis analyse (par petites étapes, reprenable) =========================== */
function job(id, patch) { state.jobs[id] = Object.assign(state.jobs[id] || { title: 'Cours', phase: 'upload', done: 0, total: 0, msg: '' }, patch); updateJobsUI(); }
async function waitUploads(id) {
  for (;;) {
    const left = (await dbAll('chunks')).filter((c) => c.lessonId === id);
    if (!left.length) return;
    pump();
    await sleep(1200);
  }
}
async function finishLesson(id) {
  if (state.jobs[id] && state.jobs[id].running) return;
  const subj = subjectById((await dbGet('meta', id) || {}).subjectId);
  job(id, { running: true, phase: 'upload', title: (subj ? subj.name : 'Cours') + ' — envoi', msg: 'Envoi de l\'enregistrement…' });
  try {
    await waitUploads(id);
    const meta = (await dbGet('meta', id)) || {};
    const saved = meta.saved || [];
    const total = saved.length ? Math.max(...saved) + 1 : 0;
    const skip = []; for (let i = 0; i < total; i++) if (!saved.includes(i)) skip.push(i);
    for (let tries = 0; ; tries++) {
      let r;
      try { r = await api('POST', '/api/lessons/' + id + '/finish', { chunks: total, durationSec: meta.durationSec || 0, skip }); }
      catch (e) { if (e.status === 404) { await dbDel('meta', id); delete state.jobs[id]; updateJobsUI(); return; } if (e.status && e.status < 500) throw e; await sleep(4000); continue; }
      if (r.ok) break;
      if (tries > 3) { skip.push(...r.missing); }
      await sleep(1000);
    }
    await dbDel('meta', id);
    await runSteps(id);
  } catch (e) {
    job(id, { running: false, phase: 'error', msg: e.message || 'Erreur' });
  }
}
async function runSteps(id) {
  const l0 = state.lessons.find((x) => x.id === id);
  job(id, { running: true, phase: 'analyse', title: l0 ? l0.title : 'Analyse du cours', msg: 'Analyse du cours…' });
  for (;;) {
    try {
      const r = await api('POST', '/api/lessons/' + id + '/step', {});
      job(id, { done: r.progress.done, total: r.progress.total, msg: 'Analyse du cours…' });
      if (r.done) {
        await loadAll();
        const l = state.lessons.find((x) => x.id === id);
        if (r.status === 'error' || (l && l.status === 'error')) { job(id, { running: false, phase: 'error', msg: r.error || 'Aucun contenu exploitable.' }); }
        else { delete state.jobs[id]; toast('Cours prêt : ' + (l ? l.title : '')); }
        updateJobsUI(); render();
        return;
      }
    } catch (e) {
      if (e.status === 503 || e.status === 502) { const w = Math.min(Math.max(e.retryAfter || 10, 5), 90); job(id, { msg: 'IA très sollicitée : reprise automatique dans ' + w + ' s.' }); await sleep(w * 1000); continue; }
      if (e.status === 501) { job(id, { msg: 'L\'IA n\'est pas configurée. Prévenir l\'administrateur.' }); await sleep(30000); continue; }
      if (e.network || e.status >= 500) { job(id, { msg: 'Connexion perdue, nouvel essai…' }); await sleep(5000); continue; }
      job(id, { running: false, phase: 'error', msg: e.message });
      return;
    }
  }
}
/* reprise au démarrage : cours en analyse, ou enregistrements interrompus (téléphone éteint, onglet fermé) */
let orphans = [];
async function resumeWork() {
  const metas = await dbAll('meta');
  orphans = [];
  for (const m of metas) {
    const l = state.lessons.find((x) => x.id === m.id);
    if (!l) { await dbDel('meta', m.id); continue; }
    if (state.rec.active && Rec.lessonId === m.id) continue;
    if (m.stopped) finishLesson(m.id); else orphans.push(m);
  }
  state.lessons.filter((l) => l.status === 'processing' && !(state.jobs[l.id] && state.jobs[l.id].running)).forEach((l) => runSteps(l.id));
  if ((await dbAll('chunks')).length) pump();
}
async function finishOrphan(id) {
  const m = await dbGet('meta', id);
  if (!m) return;
  m.stopped = true; m.durationSec = m.durationSec || Math.round((Date.now() - (m.startedAt || Date.now())) / 1000);
  await dbPut('meta', m);
  orphans = orphans.filter((o) => o.id !== id);
  render(); finishLesson(id);
}

/* =========================== vues =========================== */
const app = () => $('#app');

function chrome(title, inner, opts) {
  const o = opts || {};
  const nav = ['rec', 'courses', 'sheets', 'share', 'account'];
  const labels = { rec: 'Enregistrer', courses: 'Cours', sheets: 'Fiches', share: 'Partage', account: 'Compte' };
  const icons = { rec: IC.mic, courses: IC.book, sheets: IC.sheet, share: IC.send, account: IC.user };
  const cur = state.stack.length ? null : state.tab;
  const activeTab = state.tab;
  return '<header class="top">' +
    (state.stack.length ? '<button class="icon-btn" data-act="back" aria-label="Retour">' + IC.back + '</button>' : '') +
    '<h1>' + esc(title) + '</h1>' + (o.right || '') + '</header>' +
    '<main class="page">' + inner + '</main>' +
    '<nav class="nav" aria-label="Navigation"><div class="nav-in">' +
    nav.map((t) => '<button data-act="tab" data-v="' + t + '"' + (activeTab === t ? ' aria-current="page"' : '') + '>' + icons[t] + '<span>' + labels[t] + '</span>' +
      (t === 'share' && state.pending ? '<i class="pip">' + state.pending + '</i>' : '') + '</button>').join('') +
    '</div></nav>';
}

function render() {
  const el = app();
  if (!el) return;
  if (!state.ready) { el.innerHTML = '<p class="page muted">Chargement…</p>'; return; }
  if (state.admin) { el.innerHTML = adminView(); return; }
  if (!state.user) { el.innerHTML = authView(); return; }
  const p = page();
  let html;
  if (p) {
    if (p.type === 'subject') html = subjectView(p);
    else if (p.type === 'lesson') html = lessonView(p);
    else if (p.type === 'sheet') html = sheetView(p);
    else if (p.type === 'newsheet') html = newSheetView(p);
  }
  if (!html) html = state.tab === 'courses' ? coursesView() : state.tab === 'sheets' ? sheetsView() : state.tab === 'share' ? shareView() : state.tab === 'account' ? accountView() : recView();
  el.innerHTML = html;
  const b = $('#recBtn'); if (b) b.style.setProperty('--lvl', state.rec.lvl.toFixed(2));
}

/* ---------- connexion ---------- */
let authMode = 'login';
function authView() {
  return '<div class="auth"><div><h1>Cursus</h1><p class="muted" style="margin-top:6px">Enregistre tes cours. Retrouve-les triés, résumés, prêts à réviser.</p></div>' +
    '<div class="seg" role="group" aria-label="Mode"><button data-act="authmode" data-v="login" aria-pressed="' + (authMode === 'login') + '">Connexion</button><button data-act="authmode" data-v="register" aria-pressed="' + (authMode === 'register') + '">Créer un compte</button></div>' +
    '<form data-form="auth" class="list" autocomplete="on">' +
    '<label class="field"><span>Pseudo</span><input id="a_pseudo" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="16" required></label>' +
    '<label class="field"><span>Mot de passe' + (authMode === 'register' ? ' (8 caractères minimum)' : '') + '</span><input id="a_pw" type="password" autocomplete="' + (authMode === 'register' ? 'new-password' : 'current-password') + '" maxlength="64" required></label>' +
    '<label class="row small muted"><input type="checkbox" id="a_rem" checked> Rester connecté sur cet appareil</label>' +
    '<p class="err" id="a_err" role="alert"></p>' +
    '<button class="btn" type="submit">' + (authMode === 'register' ? 'Créer mon compte' : 'Se connecter') + '</button></form>' +
    '<button class="btn ghost sm" data-act="admin">Administration</button></div>';
}

/* ---------- enregistrer ---------- */
function recView() {
  const r = state.rec;
  const subj = subjectById(state.subjectId);
  const chips = state.subjects.map((s) => '<button class="itab" style="--c:' + esc(s.color) + '" data-act="pick" data-v="' + s.id + '" aria-pressed="' + (s.id === state.subjectId) + '"' + (r.active ? ' disabled' : '') + '>' + esc(s.name) + '</button>').join('') +
    (r.active ? '' : '<button class="itab add" data-act="addsubject">' + IC.plus + ' Matière</button>');
  const jobs = Object.entries(state.jobs).map(([id, j]) => jobCard(id, j)).join('');
  const orph = orphans.map((m) => '<div class="card list"><b>Un enregistrement n\'a pas été terminé</b><p class="muted small">Il a été interrompu (page fermée ou téléphone éteint). L\'audio déjà capté est conservé.</p><button class="btn" data-act="finishorphan" data-v="' + m.id + '">Terminer et analyser</button></div>').join('');
  const hint = r.active ? 'Touche pour arrêter. Garde cette page ouverte.' : subj ? 'Touche pour enregistrer « ' + esc(subj.name) + ' »' : state.subjects.length ? 'Choisis une matière pour commencer' : 'Ajoute ta première matière pour commencer';
  return chrome('Enregistrer',
    '<div><div class="tabs-subj" role="group" aria-label="Matière">' + chips + '</div>' +
    '<div class="tabs-body"><label class="field"><span>Titre du cours (facultatif)</span><input id="lessonTitle" type="text" maxlength="80" placeholder="Rempli automatiquement après l\'analyse"' + (r.active ? ' disabled' : '') + '></label>' +
    '<div class="stage"><div class="rec-wrap"><button id="recBtn" class="rec-btn' + (r.active ? ' on' : '') + '" data-act="rec" aria-label="' + (r.active ? 'Arrêter l\'enregistrement' : 'Démarrer l\'enregistrement') + '"' + (!r.active && !subj ? ' data-nosubj="1"' : '') + '>' + (r.active ? IC.stop : IC.mic) + '</button></div>' +
    '<div class="timer" id="timer" aria-live="off">' + clock(r.t) + '</div><p class="muted" id="hint" style="text-align:center">' + hint + '</p></div>' +
    '<ul class="status" id="status">' + statusItems() + '</ul></div></div>' + orph + jobs +
    (state.subjects.length === 0 ? '<div class="empty"><p>Tu n\'as encore aucune matière.</p><button class="btn" data-act="addsubject">Ajouter une matière</button></div>' : ''));
}
function statusItems() {
  const r = state.rec;
  if (!r.active && !r.queued && !r.msg) return '<li><span class="dot"></span>Prêt. L\'écran restera allumé pendant l\'enregistrement.</li>';
  let h = '';
  if (r.active) {
    h += '<li><span class="dot ' + (r.wake ? 'ok' : 'warn') + '"></span>' + (r.wake ? 'Écran maintenu allumé' : 'Écran non verrouillé par le navigateur : désactive la mise en veille') + '</li>';
    h += '<li><span class="dot ' + (r.mic ? 'ok' : 'bad') + '"></span>' + (r.mic ? 'Micro actif, bruits atténués' : 'Micro coupé') + '</li>';
  }
  h += '<li><span class="dot ' + (r.queued ? 'warn' : 'ok') + '"></span>' + r.sent + ' extrait' + (r.sent > 1 ? 's' : '') + ' envoyé' + (r.sent > 1 ? 's' : '') + (r.queued ? ', ' + r.queued + ' en attente' : '') + '</li>';
  if (r.msg) h += '<li><span class="dot warn"></span>' + esc(r.msg) + '</li>';
  return h;
}
function jobCard(id, j) {
  const pct = j.total ? Math.round(100 * j.done / j.total) : (j.phase === 'upload' ? 8 : 4);
  const failed = j.phase === 'error';
  return '<div class="card list" data-job="' + id + '"><div class="spread"><b>' + esc(j.title) + '</b><span class="badge ' + (failed ? 'bad' : 'warn') + '">' + (failed ? 'Erreur' : j.phase === 'upload' ? 'Envoi' : 'Analyse') + '</span></div>' +
    (failed ? '<p class="err">' + esc(j.msg) + '</p><div class="row"><button class="btn sm" data-act="retryjob" data-v="' + id + '">Réessayer</button><button class="btn sm danger" data-act="dellesson" data-v="' + id + '">Supprimer</button></div>'
      : '<div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div><p class="muted small">' + esc(j.msg) + ' Tu peux quitter cet écran, ça continue.</p>') + '</div>';
}
function updateRecUI() {
  const t = $('#status'); if (t) t.innerHTML = statusItems();
}
function updateJobsUI() { if (state.tab === 'rec' && !state.stack.length && state.user) render(); }

/* ---------- cours ---------- */
function coursesView() {
  const cards = state.subjects.map((s) => '<button class="subject-card" style="--c:' + esc(s.color) + '" data-act="opensubject" data-v="' + s.id + '"><span></span><span><b>' + esc(s.name) + '</b><br><span class="muted small">' + s.lessons + ' séance' + (s.lessons > 1 ? 's' : '') + (s.last ? ' · dernière le ' + esc(fmtDate(s.last)) : '') + '</span></span><span class="muted">›</span></button>').join('');
  return chrome('Mes cours', '<div class="list">' + (cards || '<div class="empty"><p>Aucune matière pour le moment.</p></div>') + '</div><button class="btn soft" data-act="addsubject">' + IC.plus + ' Ajouter une matière</button>');
}
function lessonRow(l) {
  const st = l.status === 'ready' ? '<span class="badge ok">Prêt</span>' : l.status === 'error' ? '<span class="badge bad">Erreur</span>' : l.status === 'processing' ? '<span class="badge warn">Analyse</span>' : '<span class="badge warn">En cours</span>';
  return '<button class="item" data-act="openlesson" data-v="' + l.id + '"><div class="spread"><b>' + esc(l.title) + '</b>' + st + '</div><span class="muted small">' + esc(fmtDate(l.date)) + (l.durationSec ? ' · ' + fmtDur(l.durationSec) : '') + '</span></button>';
}
function subjectView(p) {
  const s = subjectById(p.id);
  if (!s) return '';
  const tab = p.tab || 'course';
  const ls = state.lessons.filter((l) => l.subjectId === s.id).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  let body = '';
  if (tab === 'course') {
    const c = p.course;
    if (!c) { body = '<p class="muted">Chargement du cours…</p>'; loadCourse(s.id); }
    else if (!c.chapters.length) body = '<div class="empty"><p>Le cours global se remplira dès ton premier enregistrement terminé.</p><button class="btn" data-act="tab" data-v="rec">Enregistrer un cours</button></div>';
    else body = '<div class="list">' + c.chapters.map((ch, i) => '<details class="chap"' + (i === 0 ? ' open' : '') + '><summary><span>' + esc(ch.title) + '</span><span class="badge">' + ch.sections.length + '</span></summary><div class="paper">' +
      ch.sections.map((x) => '<h3>' + esc(x.heading) + '</h3>' + md(x.content) + '<p class="src">' + esc(fmtDate(x.date)) + (x.by ? ' · reçu de ' + esc(x.by) : '') + '</p>').join('') + '</div></details>').join('') + '</div>';
  } else if (tab === 'lessons') {
    body = ls.length ? '<div class="list">' + ls.map(lessonRow).join('') + '</div>' : '<div class="empty"><p>Aucune séance enregistrée.</p></div>';
  } else {
    const fs = state.sheets.filter((f) => f.subjectId === s.id);
    body = '<button class="btn" data-act="newsheet" data-v="' + s.id + '">' + IC.plus + ' Nouvelle fiche</button><div class="list" style="margin-top:12px">' + (fs.length ? fs.map(sheetRow).join('') : '<p class="muted">Aucune fiche pour cette matière.</p>') + '</div>';
  }
  return chrome(s.name,
    '<div class="seg" role="group" aria-label="Section"><button data-act="subtab" data-v="course" aria-pressed="' + (tab === 'course') + '">Cours global</button><button data-act="subtab" data-v="lessons" aria-pressed="' + (tab === 'lessons') + '">Séances</button><button data-act="subtab" data-v="sheets" aria-pressed="' + (tab === 'sheets') + '">Fiches</button></div>' +
    body + '<div class="row noprint"><button class="btn sm soft" data-act="newsheet" data-v="' + s.id + '">Fiche de révision</button><button class="btn sm soft" data-act="share" data-kind="course" data-v="' + s.id + '">Envoyer le cours</button><button class="btn sm ghost" data-act="editsubject" data-v="' + s.id + '">Modifier</button></div>');
}
async function loadCourse(id) {
  try { const r = await api('GET', '/api/subjects/' + id + '/course'); const p = page(); if (p && p.type === 'subject' && p.id === id) { p.course = r.course; render(); } } catch (e) { toast(e.message); }
}
function lessonView(p) {
  const l = p.lesson;
  if (!l) { loadLesson(p.id); return chrome('Cours', '<p class="muted">Chargement…</p>'); }
  const rc = l.recap;
  let body = '<p class="muted">' + esc(l.subjectName) + ' · ' + esc(fmtDate(l.date)) + (l.durationSec ? ' · ' + fmtDur(l.durationSec) : '') + (l.from ? ' · reçu de ' + esc(l.from) : '') + '</p>';
  if (l.status === 'error') body += '<div class="card"><p class="err">' + esc(l.error || 'Erreur') + '</p><div class="row" style="margin-top:10px">' + (l.plan ? '<button class="btn sm" data-act="retryjob" data-v="' + l.id + '">Relancer l\'analyse</button>' : '') + '</div></div>';
  else if (l.status !== 'ready') body += '<div class="card"><p>' + (l.status === 'processing' ? 'Analyse en cours…' : 'Enregistrement non terminé.') + '</p></div>';
  if (rc) {
    body += '<div class="paper"><h2>Récap</h2><p>' + esc(rc.summary) + '</p>' + (rc.keyPoints && rc.keyPoints.length ? '<h3>À retenir</h3><ul>' + rc.keyPoints.map((k) => '<li>' + inline(esc(k)) + '</li>').join('') + '</ul>' : '') + '</div>';
    body += '<div class="paper"><h2>Le cours</h2>' + (l.sections || []).map((x) => '<h3>' + esc(x.heading) + '</h3>' + md(x.content) + (x.chapter ? '<p class="src">Rangé dans « ' + esc(x.chapter) + ' »</p>' : '')).join('') + '</div>';
  }
  if (l.status !== 'recording') body += '<details class="card"><summary data-act="transcript" data-v="' + l.id + '" style="cursor:pointer;font-weight:650">Voir la transcription filtrée</summary><div id="tr" class="small muted" style="margin-top:10px;white-space:pre-wrap">Chargement…</div></details>';
  body += '<div class="row noprint"><button class="btn sm soft" data-act="rename" data-kind="lesson" data-v="' + l.id + '">Renommer</button>' + (l.status === 'ready' ? '<button class="btn sm soft" data-act="share" data-kind="lesson" data-v="' + l.id + '">Envoyer</button>' : '') + '<button class="btn sm danger" data-act="dellesson" data-v="' + l.id + '">Supprimer</button></div>';
  return chrome(l.title, body);
}
async function loadLesson(id) {
  try { const r = await api('GET', '/api/lessons/' + id); const p = page(); if (p && p.type === 'lesson' && p.id === id) { p.lesson = r.lesson; render(); } } catch (e) { toast(e.message); back(); }
}

/* ---------- fiches ---------- */
function sheetRow(f) {
  return '<button class="item" data-act="opensheet" data-v="' + f.id + '"><b>' + esc(f.title) + '</b><span class="muted small">' + esc(f.subjectName || '') + ' · ' + esc(new Date(f.at).toLocaleDateString('fr-FR')) + (f.from ? ' · reçue de ' + esc(f.from) : '') + '</span></button>';
}
function sheetsView() {
  return chrome('Fiches de révision', '<button class="btn" data-act="newsheet">' + IC.plus + ' Nouvelle fiche</button><div class="list">' +
    (state.sheets.length ? state.sheets.map(sheetRow).join('') : '<div class="empty"><p>Tes fiches apparaîtront ici. Une fiche reprend les mots exacts de ton professeur.</p></div>') + '</div>');
}
function sheetView(p) {
  const f = p.sheet;
  if (!f) { loadSheet(p.id); return chrome('Fiche', '<p class="muted">Chargement…</p>'); }
  return chrome(f.title, '<p class="muted">' + esc(f.subjectName || '') + (f.from ? ' · reçue de ' + esc(f.from) : '') + '</p><article class="paper">' + md(f.content) + '</article>' +
    '<div class="row noprint"><button class="btn sm soft" data-act="copysheet">Copier</button><button class="btn sm soft" data-act="print">Imprimer / PDF</button><button class="btn sm soft" data-act="share" data-kind="sheet" data-v="' + f.id + '">Envoyer</button><button class="btn sm soft" data-act="rename" data-kind="sheet" data-v="' + f.id + '">Renommer</button><button class="btn sm danger" data-act="delsheet" data-v="' + f.id + '">Supprimer</button></div>');
}
async function loadSheet(id) {
  try { const r = await api('GET', '/api/sheets/' + id); const p = page(); if (p && p.type === 'sheet' && p.id === id) { p.sheet = r.sheet; render(); } } catch (e) { toast(e.message); back(); }
}
function newSheetView(p) {
  const subs = state.subjects.filter((s) => s.ready > 0);
  if (!subs.length) return chrome('Nouvelle fiche', '<div class="empty"><p>Il faut au moins un cours terminé pour créer une fiche.</p><button class="btn" data-act="tab" data-v="rec">Enregistrer un cours</button></div>');
  const sid = p.subjectId && subs.some((s) => s.id === p.subjectId) ? p.subjectId : subs[0].id;
  const scope = p.scope || 'notion';
  const course = p.courses && p.courses[sid];
  if (!course && !p.loading) { p.loading = true; api('GET', '/api/subjects/' + sid + '/course').then((r) => { p.courses = p.courses || {}; p.courses[sid] = r.course; p.loading = false; if (page() === p) render(); }).catch(() => { p.loading = false; }); }
  return chrome('Nouvelle fiche',
    '<form data-form="newsheet" class="list"><label class="field"><span>Matière</span><select id="ns_subject" data-change="nssubject">' + subs.map((s) => '<option value="' + s.id + '"' + (s.id === sid ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label>' +
    '<div class="field"><span>Que veux-tu réviser ?</span><div class="seg" role="group"><button type="button" data-act="scope" data-v="notion" aria-pressed="' + (scope === 'notion') + '">Une notion</button><button type="button" data-act="scope" data-v="chapter" aria-pressed="' + (scope === 'chapter') + '">Un chapitre</button><button type="button" data-act="scope" data-v="all" aria-pressed="' + (scope === 'all') + '">Tout le cours</button></div></div>' +
    (scope === 'notion' ? '<label class="field"><span>Quelle notion ?</span><input id="ns_query" type="text" maxlength="200" placeholder="Par exemple : la photosynthèse" required></label>' : '') +
    (scope === 'chapter' ? '<label class="field"><span>Quel chapitre ?</span><select id="ns_chapter">' + (course ? course.chapters.map((c) => '<option value="' + c.id + '">' + esc(c.title) + '</option>').join('') : '<option>Chargement…</option>') + '</select></label>' : '') +
    (scope === 'all' ? '<p class="muted small">Une fiche par chapitre, assemblées. Compte quelques secondes par chapitre.</p>' : '') +
    '<p class="muted small">La fiche reprend les mots et définitions de ton professeur, sans rien ajouter d\'extérieur.</p>' +
    '<p class="err" id="ns_err" role="alert"></p><button class="btn" type="submit" id="ns_go">Créer la fiche</button></form>');
}

/* ---------- partage ---------- */
function kindLabel(k) { return k === 'sheet' ? 'Fiche' : k === 'course' ? 'Cours global' : 'Séance'; }
function shareView() {
  const ib = state.inbox;
  if (!ib) return chrome('Partage', '<p class="muted">Chargement…</p>');
  const rec = ib.received.map((x) => '<div class="card list"><div class="spread"><b>' + esc(x.title) + '</b><span class="badge ' + (x.status === 'pending' ? 'warn' : x.status === 'accepted' ? 'ok' : '') + '">' + (x.status === 'pending' ? 'Nouveau' : x.status === 'accepted' ? 'Ajouté' : 'Refusé') + '</span></div><p class="muted small">' + kindLabel(x.kind) + ' de ' + esc(x.fromPseudo) + ' · ' + esc(new Date(x.at).toLocaleDateString('fr-FR')) + '</p>' +
    (x.status === 'pending' ? '<div class="row"><button class="btn sm" data-act="acceptshare" data-v="' + x.id + '">Ajouter à mes cours</button><button class="btn sm soft" data-act="previewshare" data-v="' + x.id + '">Aperçu</button><button class="btn sm ghost" data-act="declineshare" data-v="' + x.id + '">Refuser</button></div>' : '<div class="row"><button class="btn sm ghost" data-act="rmshare" data-v="' + x.id + '">Retirer de la liste</button></div>') + '</div>').join('');
  const sent = ib.sent.map((x) => '<div class="item"><div class="spread"><b>' + esc(x.title) + '</b><span class="badge ' + (x.status === 'accepted' ? 'ok' : x.status === 'declined' ? 'bad' : 'warn') + '">' + (x.status === 'accepted' ? 'Accepté' : x.status === 'declined' ? 'Refusé' : 'En attente') + '</span></div><span class="muted small">' + kindLabel(x.kind) + ' envoyé à ' + esc(x.toPseudo) + '</span></div>').join('');
  return chrome('Partage', '<p class="muted">Envoie un cours, une séance ou une fiche à un autre utilisateur depuis sa page : bouton « Envoyer ».</p><h2>Reçus</h2><div class="list">' + (rec || '<p class="muted">Rien reçu pour le moment.</p>') + '</div><h2>Envoyés</h2><div class="list">' + (sent || '<p class="muted">Rien envoyé.</p>') + '</div>');
}

/* ---------- compte ---------- */
function accountView() {
  return chrome('Compte', '<div class="card list"><div><b style="font-family:var(--serif);font-size:1.3rem">' + esc(state.user.pseudo) + '</b></div>' +
    '<label class="field"><span>Langue parlée en cours</span><select id="lang" data-change="lang">' + Object.entries(LANGS).map(([k, v]) => '<option value="' + k + '"' + (state.user.lang === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label></div>' +
    '<form data-form="pw" class="card list"><b>Changer de mot de passe</b><label class="field"><span>Mot de passe actuel</span><input id="pw_cur" type="password" autocomplete="current-password" required></label><label class="field"><span>Nouveau mot de passe (8 caractères minimum)</span><input id="pw_new" type="password" autocomplete="new-password" minlength="8" maxlength="64" required></label><p class="err" id="pw_err" role="alert"></p><button class="btn" type="submit">Changer</button></form>' +
    '<div class="card list"><b>Installer sur le téléphone</b><p class="muted small">Dans le menu du navigateur : « Ajouter à l\'écran d\'accueil ». Cursus s\'ouvre alors comme une appli, plus simple pour enregistrer.</p></div>' +
    '<button class="btn ghost" data-act="logout">Se déconnecter</button>');
}

/* ---------- administration ---------- */
function adminView() {
  const a = state.admin;
  if (!a.ok) return '<div class="auth"><h1>Administration</h1><form data-form="adminlogin" class="list"><label class="field"><span>Identifiant</span><input id="ad_id" type="text" autocomplete="username" autocapitalize="none" required></label><label class="field"><span>Mot de passe</span><input id="ad_pw" type="password" autocomplete="current-password" required></label><p class="err" id="ad_err" role="alert"></p><button class="btn" type="submit">Entrer</button></form><button class="btn ghost sm" data-act="adminexit">Retour au site</button></div>';
  const tab = a.tab || 'users';
  let body = '';
  if (tab === 'users') {
    body = '<div class="list">' + (a.users || []).map((u) => '<div class="card list"><div class="spread"><b>' + esc(u.pseudo) + '</b><span class="muted small">' + u.subjects + ' matière(s) · ' + u.lessons + ' cours</span></div><div class="row"><button class="btn sm soft" data-act="adminrename" data-v="' + u.id + '" data-n="' + esc(u.pseudo) + '">Renommer</button><button class="btn sm soft" data-act="adminpw" data-v="' + u.id + '" data-n="' + esc(u.pseudo) + '">Mot de passe</button><button class="btn sm danger" data-act="admindel" data-v="' + u.id + '" data-n="' + esc(u.pseudo) + '">Supprimer</button></div></div>').join('') + '</div>';
  } else {
    const ai = a.ai;
    const now = ai ? ai.now : Date.now();
    const keyRows = (prov) => ai ? ai.status[prov].map((k) => '<div class="item"><div class="spread"><code>' + esc(k.mask) + '</code>' + (k.cooling.length ? '<span class="badge warn">Quota dépassé</span>' : '<span class="badge ok">Disponible</span>') + '</div>' +
      (k.cooling.length ? '<span class="muted small">Reprise automatique ' + esc(new Date(Math.min(...k.cooling.map((c) => c.until))).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })) + '</span>' : '') +
      (ai.stored.find((s) => s.id === k.id) ? '<div class="row"><button class="btn sm danger" data-act="adminkeydel" data-v="' + k.id + '">Retirer</button></div>' : '<span class="muted small">Définie dans Netlify (variable d\'environnement)</span>') + '</div>').join('') : '';
    body = !ai ? '<p class="muted">Chargement…</p>' :
      '<p class="muted small">Quand une clé dépasse son quota gratuit, elle est mise en pause jusqu\'à son renouvellement puis réutilisée toute seule. Plus tu ajoutes de clés (de comptes différents), plus la limite recule.</p>' +
      '<h2>Groq (transcription)</h2><div class="list">' + (keyRows('groq') || '<p class="muted">Aucune clé.</p>') + '</div>' +
      '<h2>Gemini (cours, récaps, fiches)</h2><div class="list">' + (keyRows('gemini') || '<p class="muted">Aucune clé.</p>') + '</div>' +
      '<form data-form="addkey" class="card list"><b>Ajouter une clé</b><label class="field"><span>Service</span><select id="k_prov"><option value="groq">Groq (console.groq.com/keys)</option><option value="gemini">Gemini (aistudio.google.com/apikey)</option></select></label><label class="field"><span>Clé</span><input id="k_key" type="password" autocomplete="off" required></label><p class="err" id="k_err" role="alert"></p><button class="btn" type="submit">Ajouter</button></form>' +
      '<button class="btn soft" data-act="admintest">Tester l\'IA</button><p id="k_test" class="muted small" role="status"></p>';
  }
  return '<header class="top"><h1>Administration</h1><button class="btn sm ghost" data-act="adminlogout">Quitter</button></header><main class="page"><div class="seg"><button data-act="admintab" data-v="users" aria-pressed="' + (tab === 'users') + '">Utilisateurs</button><button data-act="admintab" data-v="ai" aria-pressed="' + (tab === 'ai') + '">Clés d\'IA</button></div>' + body + '</main>';
}
async function adminLoad() {
  const a = state.admin;
  try {
    await api('GET', '/api/admin/session', undefined, { quiet: true });
    a.ok = true;
    a.users = (await api('GET', '/api/admin/users')).users;
    a.ai = await api('GET', '/api/admin/ai');
  } catch (e) { a.ok = false; }
  render();
}

/* =========================== actions =========================== */
function promptModal(title, label, initial, okText, onOk, type) {
  openModal('<h2>' + esc(title) + '</h2><form class="list" data-form="prompt"><label class="field"><span>' + esc(label) + '</span><input id="pm_val" type="' + (type || 'text') + '" value="' + esc(initial || '') + '" maxlength="80" required></label><p class="err" id="pm_err" role="alert"></p><div class="row end"><button type="button" class="btn ghost" data-act="closemodal">Annuler</button><button class="btn" type="submit">' + esc(okText) + '</button></div></form>');
  const f = $('#modal form');
  f.addEventListener('submit', async (e) => { e.preventDefault(); try { await onOk(val('pm_val').trim()); closeModal(); } catch (er) { $('#pm_err').textContent = er.message || 'Erreur'; } });
}
function confirmModal(text, okText, onOk) {
  openModal('<h2>Confirmer</h2><p>' + esc(text) + '</p><div class="row end"><button class="btn ghost" data-act="closemodal">Annuler</button><button class="btn danger" id="cm_ok">' + esc(okText) + '</button></div>');
  $('#cm_ok').addEventListener('click', async () => { try { await onOk(); } catch (e) { toast(e.message); } closeModal(); });
}
let pickedColor = COLORS[0];
function subjectModal(sub) {
  pickedColor = sub ? sub.color : COLORS[state.subjects.length % COLORS.length];
  openModal('<h2>' + (sub ? 'Modifier la matière' : 'Nouvelle matière') + '</h2><form class="list" data-form="subject" data-id="' + (sub ? sub.id : '') + '"><label class="field"><span>Nom</span><input id="sj_name" type="text" maxlength="40" value="' + esc(sub ? sub.name : '') + '" placeholder="Mathématiques, SVT, Histoire…" required></label>' +
    '<div class="field"><span>Couleur de l\'intercalaire</span><div class="swatches">' + COLORS.map((c) => '<button type="button" style="--c:' + c + '" data-act="color" data-v="' + c + '" aria-label="Couleur ' + c + '" aria-pressed="' + (c === pickedColor) + '"></button>').join('') + '</div></div><p class="err" id="sj_err" role="alert"></p>' +
    '<div class="row end">' + (sub ? '<button type="button" class="btn danger" data-act="delsubject" data-v="' + sub.id + '">Supprimer</button>' : '') + '<button type="button" class="btn ghost" data-act="closemodal">Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>');
}
function shareModal(kind, refId) {
  openModal('<h2>Envoyer à un utilisateur</h2><form class="list" data-form="share" data-kind="' + kind + '" data-ref="' + refId + '"><label class="field"><span>Pseudo du destinataire</span><input id="sh_to" type="search" list="sh_list" autocomplete="off" autocapitalize="none" maxlength="16" required><datalist id="sh_list"></datalist></label><p class="err" id="sh_err" role="alert"></p><div class="row end"><button type="button" class="btn ghost" data-act="closemodal">Annuler</button><button class="btn" type="submit">Envoyer</button></div></form>');
  let t = null;
  $('#sh_to').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = val('sh_to').trim();
      if (q.length < 2) return;
      try { const r = await api('GET', '/api/users?q=' + encodeURIComponent(q)); const dl = $('#sh_list'); if (dl) dl.innerHTML = r.users.map((u) => '<option value="' + esc(u) + '">').join(''); } catch (e) { /* suggestions facultatives */ }
    }, 250);
  });
}
async function acceptShare(id) {
  const it = state.inbox.received.find((x) => x.id === id);
  if (!it) return;
  if (it.kind === 'sheet') { try { await api('POST', '/api/share/' + id + '/accept', {}); toast('Fiche ajoutée.'); loadInbox(); loadSheets(); } catch (e) { toast(e.message); } return; }
  const opts = '<option value="">Créer / utiliser la matière du même nom</option>' + state.subjects.map((s) => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('');
  openModal('<h2>Ajouter « ' + esc(it.title) + ' »</h2><form class="list" data-form="accept" data-id="' + id + '"><label class="field"><span>Ranger dans</span><select id="ac_sub">' + opts + '</select></label><p class="muted small">Les chapitres du même nom sont fusionnés avec les tiens.</p><p class="err" id="ac_err" role="alert"></p><div class="row end"><button type="button" class="btn ghost" data-act="closemodal">Annuler</button><button class="btn" type="submit">Ajouter</button></div></form>');
}

const A = {
  back, closemodal: closeModal,
  tab: (el) => setTab(el.dataset.v),
  authmode: (el) => { authMode = el.dataset.v; render(); },
  admin: () => { state.admin = { ok: false }; adminLoad(); },
  adminexit: () => { state.admin = null; render(); },
  admintab: (el) => { state.admin.tab = el.dataset.v; render(); },
  adminlogout: async () => { try { await api('POST', '/api/admin/logout', {}); } catch (e) { /* déjà sorti */ } state.admin = null; render(); },
  pick: (el) => { state.subjectId = el.dataset.v; store.set('subject', state.subjectId); render(); },
  addsubject: () => subjectModal(null),
  color: (el) => { pickedColor = el.dataset.v; document.querySelectorAll('.swatches button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === pickedColor))); },
  editsubject: (el) => subjectModal(subjectById(el.dataset.v)),
  delsubject: (el) => confirmModal('Supprimer cette matière avec tous ses cours et son cours global ? C\'est définitif.', 'Supprimer', async () => { await api('DELETE', '/api/subjects/' + el.dataset.v); state.stack = []; await loadAll(); await loadSheets(); }),
  rec: () => { const b = $('#recBtn'); if (state.rec.active) stopRec(); else if (b && b.dataset.nosubj) { if (state.subjects.length) toast('Choisis d\'abord une matière.'); else subjectModal(null); } else startRec(); },
  finishorphan: (el) => finishOrphan(el.dataset.v),
  opensubject: (el) => go({ type: 'subject', id: el.dataset.v, tab: 'course' }),
  subtab: (el) => { const p = page(); p.tab = el.dataset.v; if (p.tab === 'sheets') loadSheets(); render(); },
  openlesson: (el) => go({ type: 'lesson', id: el.dataset.v }),
  opensheet: (el) => go({ type: 'sheet', id: el.dataset.v }),
  newsheet: (el) => go({ type: 'newsheet', subjectId: el.dataset.v || state.subjectId, scope: 'notion' }),
  scope: (el) => { const p = page(); p.scope = el.dataset.v; render(); },
  transcript: async (el) => { const d = el.parentElement; if (d.open) return; try { const r = await api('GET', '/api/lessons/' + el.dataset.v + '/transcript'); const t = $('#tr'); if (t) t.textContent = r.text || '(vide)'; } catch (e) { toast(e.message); } },
  retryjob: async (el) => { const id = el.dataset.v; try { await api('POST', '/api/lessons/' + id + '/retry', {}); } catch (e) { /* peut déjà être en analyse */ } delete state.jobs[id]; if (page() && page().type === 'lesson') { page().lesson = null; } runSteps(id); render(); },
  dellesson: (el) => confirmModal('Supprimer ce cours ? Il sera aussi retiré du cours global.', 'Supprimer', async () => { const id = el.dataset.v; await api('DELETE', '/api/lessons/' + id); delete state.jobs[id]; await dbDel('meta', id); const cs = await dbAll('chunks'); for (const c of cs) if (c.lessonId === id) await dbDel('chunks', c.key); if (page() && page().type === 'lesson') state.stack.pop(); await loadAll(); }),
  delsheet: (el) => confirmModal('Supprimer cette fiche ?', 'Supprimer', async () => { await api('DELETE', '/api/sheets/' + el.dataset.v); state.stack.pop(); await loadSheets(); }),
  rename: (el) => {
    const kind = el.dataset.kind, p = page();
    const cur = kind === 'lesson' ? p.lesson.title : p.sheet.title;
    promptModal('Renommer', 'Nouveau titre', cur, 'Renommer', async (v) => {
      if (kind === 'lesson') { const r = await api('POST', '/api/lessons/' + p.id + '/rename', { title: v }); p.lesson = r.lesson; await loadAll(); }
      else { await api('POST', '/api/sheets/' + p.id + '/rename', { title: v }); p.sheet.title = v; await loadSheets(); }
      render();
    });
  },
  copysheet: async () => { const p = page(); try { await navigator.clipboard.writeText(p.sheet.content); toast('Fiche copiée.'); } catch (e) { toast('Copie impossible sur ce navigateur.'); } },
  print: () => window.print(),
  share: (el) => shareModal(el.dataset.kind, el.dataset.v),
  acceptshare: (el) => acceptShare(el.dataset.v),
  declineshare: async (el) => { try { await api('POST', '/api/share/' + el.dataset.v + '/decline', {}); loadInbox(); } catch (e) { toast(e.message); } },
  rmshare: async (el) => { try { await api('DELETE', '/api/share/' + el.dataset.v); loadInbox(); } catch (e) { toast(e.message); } },
  previewshare: async (el) => {
    try {
      const r = await api('GET', '/api/share/' + el.dataset.v);
      const p = r.payload || {};
      let html = '';
      if (r.item.kind === 'sheet') html = md(p.content || '');
      else if (r.item.kind === 'course') html = (p.chapters || []).map((c) => '<h2>' + esc(c.title) + '</h2>' + c.sections.map((s) => '<h3>' + esc(s.heading) + '</h3>' + md(s.content)).join('')).join('');
      else html = '<h2>Récap</h2><p>' + esc(p.recap && p.recap.summary) + '</p>' + (p.sections || []).map((s) => '<h3>' + esc(s.heading) + '</h3>' + md(s.content)).join('');
      openModal('<h2>' + esc(r.item.title) + '</h2><div class="paper">' + html + '</div><div class="row end"><button class="btn" data-act="closemodal">Fermer</button></div>');
    } catch (e) { toast(e.message); }
  },
  logout: async () => { try { await api('POST', '/api/logout', {}); } catch (e) { /* rien */ } if (state.rec.active) await stopRec(); state.user = null; state.subjects = []; state.lessons = []; state.sheets = []; state.inbox = null; state.stack = []; render(); },
  adminrename: (el) => promptModal('Renommer ' + el.dataset.n, 'Nouveau pseudo', el.dataset.n, 'Renommer', async (v) => { await api('POST', '/api/admin/users/' + el.dataset.v + '/rename', { pseudo: v }); await adminLoad(); }),
  adminpw: (el) => promptModal('Mot de passe de ' + el.dataset.n, 'Nouveau mot de passe (8 caractères minimum)', '', 'Changer', async (v) => { await api('POST', '/api/admin/users/' + el.dataset.v + '/password', { password: v }); toast('Mot de passe changé.'); }, 'password'),
  admindel: (el) => confirmModal('Supprimer le compte « ' + el.dataset.n + ' » et toutes ses données ?', 'Supprimer', async () => { await api('DELETE', '/api/admin/users/' + el.dataset.v); await adminLoad(); }),
  adminkeydel: (el) => confirmModal('Retirer cette clé ?', 'Retirer', async () => { await api('DELETE', '/api/admin/ai/keys/' + el.dataset.v); await adminLoad(); }),
  admintest: async () => { const t = $('#k_test'); t.textContent = 'Test en cours…'; try { const r = await api('POST', '/api/admin/ai/test', {}); t.textContent = r.ok ? 'L\'IA répond (' + r.provider + ', ' + r.model + ').' : r.error + (r.retryAfter ? ' Nouvel essai possible dans ' + r.retryAfter + ' s.' : ''); } catch (e) { t.textContent = e.message; } },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.act];
  if (fn) { if (el.tagName === 'SUMMARY' && el.dataset.act === 'transcript') { fn(el); return; } fn(el); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.change === 'lang') { try { const r = await api('POST', '/api/settings', { lang: t.value }); state.user = r.user; toast('Langue enregistrée.'); } catch (er) { toast(er.message); } }
  if (t.dataset.change === 'nssubject') { const p = page(); p.subjectId = t.value; render(); }
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const kind = f.dataset.form;
  const err = (id, m) => { const el = document.getElementById(id); if (el) el.textContent = m; };
  try {
    if (kind === 'auth') {
      const r = await api('POST', authMode === 'register' ? '/api/register' : '/api/login', { pseudo: val('a_pseudo'), password: val('a_pw'), remember: $('#a_rem').checked });
      state.user = r.user; await boot(true);
    } else if (kind === 'adminlogin') {
      await api('POST', '/api/admin/login', { id: val('ad_id'), password: val('ad_pw') }); state.admin = { ok: true, tab: 'users' }; await adminLoad();
    } else if (kind === 'subject') {
      const id = f.dataset.id;
      if (id) await api('POST', '/api/subjects/' + id + '/rename', { name: val('sj_name'), color: pickedColor });
      else { const r = await api('POST', '/api/subjects', { name: val('sj_name'), color: pickedColor }); state.subjectId = r.subject.id; store.set('subject', state.subjectId); }
      closeModal(); await loadAll();
    } else if (kind === 'newsheet') {
      const p = page(); const sid = val('ns_subject');
      const body = { subjectId: sid, scope: p.scope || 'notion', query: val('ns_query'), chapterId: val('ns_chapter') };
      const btn = $('#ns_go'); btn.disabled = true; btn.textContent = 'Création de la fiche…';
      const r = await api('POST', '/api/sheets', body);
      for (;;) {
        try { const s = await api('POST', '/api/sheets/' + r.id + '/step', {}); btn.textContent = 'Création… ' + s.progress.done + '/' + s.progress.total; if (s.done) break; }
        catch (er) { if (er.status === 503 || er.network) { const w = Math.min(Math.max(er.retryAfter || 8, 5), 90); btn.textContent = 'IA sollicitée, reprise dans ' + w + ' s…'; await sleep(w * 1000); continue; } throw er; }
      }
      await loadSheets(); state.stack.pop(); go({ type: 'sheet', id: r.id });
    } else if (kind === 'pw') {
      await api('POST', '/api/password', { current: val('pw_cur'), next: val('pw_new') }); toast('Mot de passe changé.'); render();
    } else if (kind === 'share') {
      await api('POST', '/api/share', { kind: f.dataset.kind, refId: f.dataset.ref, to: val('sh_to').trim() }); closeModal(); toast('Envoyé à ' + val('sh_to') + '.');
    } else if (kind === 'accept') {
      const r = await api('POST', '/api/share/' + f.dataset.id + '/accept', { subjectId: val('ac_sub') || undefined }); closeModal(); toast('Ajouté à tes cours.'); await loadAll(); loadInbox();
    } else if (kind === 'addkey') {
      await api('POST', '/api/admin/ai/keys', { provider: val('k_prov'), key: val('k_key') }); await adminLoad(); toast('Clé ajoutée.');
    }
  } catch (er) {
    const map = { auth: 'a_err', adminlogin: 'ad_err', subject: 'sj_err', newsheet: 'ns_err', pw: 'pw_err', share: 'sh_err', accept: 'ac_err', addkey: 'k_err' };
    err(map[kind], er.message || 'Erreur');
    const b = $('#ns_go'); if (b) { b.disabled = false; b.textContent = 'Créer la fiche'; }
  }
});

/* l'écran doit rester allumé et le micro actif : on revérifie dès que l'onglet revient au premier plan */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.rec.active) { lockScreen(); ensureMic(); }
  if (document.visibilityState === 'visible') pump();
});
window.addEventListener('online', () => { pump(); });
window.addEventListener('beforeunload', (e) => { if (state.rec.active) { e.preventDefault(); e.returnValue = ''; } });

/* =========================== démarrage =========================== */
async function boot(after) {
  try {
    const me = await api('GET', '/api/me', undefined, { quiet: true });
    state.user = me.user; state.pending = me.pending || 0;
    if (state.user) { await loadAll(); loadSheets(); resumeWork(); if (!after && state.tab === 'share') loadInbox(); }
  } catch (e) { state.user = null; }
  state.ready = true;
  render();
}
if (location.hash === '#admin') { state.admin = { ok: false }; state.ready = true; adminLoad(); }
else boot();
})();
