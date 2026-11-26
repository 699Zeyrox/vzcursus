/*
  Couche IA : uniquement Groq — transcription (Whisper) et texte (gpt-oss, Llama…).
  Chaque service gratuit a des quotas. Pour que ça tienne « à l'infini » :
    - on peut donner PLUSIEURS clés (variables d'environnement ou panneau admin) ;
    - quand une clé dépasse son quota (erreur 429), elle est mise en pause jusqu'à l'heure de
      renouvellement indiquée par le service (minute, heure ou minuit), puis réutilisée toute seule ;
    - pendant ce temps on passe à la clé / au modèle / au service suivant ;
    - si tout est en pause, l'API répond 503 avec « retryAfter » et le site réessaie tout seul.
  Variables : GROQ_API_KEYS (clés séparées par des virgules),
  GROQ_TEXT_MODELS (liste de modèles, dans l'ordre de préférence), GROQ_STT_MODEL.
*/
import crypto from 'node:crypto';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const HOUR = 3600 * 1000;

export const keyId = (k) => sha(String(k)).slice(0, 10);
export const maskKey = (k) => (k.length > 10 ? k.slice(0, 4) + '…' + k.slice(-3) : '…');

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

function quotaErr(waitMs, msg) { return Object.assign(new Error(msg || 'Quota dépassé'), { quota: true, waitMs: Math.max(5000, Math.min(waitMs, 26 * HOUR)) }); }
function badKeyErr(msg) { return Object.assign(new Error(msg || 'Clé refusée'), { badKey: true }); }
function transientErr(msg) { return Object.assign(new Error(msg || 'Service indisponible'), { transient: true }); }

export function parseJsonLoose(txt) {
  if (txt == null) return null;
  let s = String(txt).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (e) { /* on essaie de découper */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* rien */ } }
  return null;
}

export function createAi(store, opts = {}) {
  const env = opts.env || (typeof process !== 'undefined' ? process.env : {});
  const doFetch = opts.fetch || ((...a) => fetch(...a));

  // Modèles texte de Groq, du préféré au dernier recours. « tpm » = jetons par minute du palier gratuit,
  // « out » = sortie maximale. Une requête trop grosse pour un modèle passe directement au suivant.
  const MODEL_INFO = {
    'openai/gpt-oss-120b': { tpm: 8000, out: 32000 },
    'meta-llama/llama-4-scout-17b-16e-instruct': { tpm: 30000, out: 8192 },
    'llama-3.3-70b-versatile': { tpm: 12000, out: 32000 },
    'openai/gpt-oss-20b': { tpm: 8000, out: 32000 },
    'llama-3.1-8b-instant': { tpm: 6000, out: 8192 },
  };
  const DEFAULT_TEXT_MODELS = 'openai/gpt-oss-120b,meta-llama/llama-4-scout-17b-16e-instruct,llama-3.3-70b-versatile,openai/gpt-oss-20b,llama-3.1-8b-instant';
  const groqTextModels = () => (env.GROQ_TEXT_MODELS || env.GROQ_TEXT_MODEL || DEFAULT_TEXT_MODELS).split(/[\s,;]+/).filter(Boolean);
  const groqSttModel = () => env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';

  async function keys(provider) {
    const raw = provider === 'groq' ? (env.GROQ_API_KEYS || env.GROQ_API_KEY || '') : '';
    const fromEnv = raw.split(/[\s,;]+/).filter(Boolean);
    const doc = (await store.get('aikeys')) || { items: [] };
    const fromStore = doc.items.filter((k) => k.provider === provider && !k.disabled).map((k) => k.key);
    return Array.from(new Set(fromEnv.concat(fromStore)));
  }

  /* ----- appels HTTP bruts, chacun traduit les erreurs en quota / clé refusée / transitoire ----- */
  async function readErr(r) {
    let body = null, text = '';
    try { text = await r.text(); body = JSON.parse(text); } catch (e) { /* texte brut */ }
    return { body, text };
  }
  function classify(r, info, provider) {
    const msg = (info.body && info.body.error && (info.body.error.message || info.body.error)) || info.text || ('HTTP ' + r.status);
    if (r.status === 429) {
      let wait = 0;
      const ra = Number(r.headers.get('retry-after'));
      if (ra > 0) wait = ra * 1000;
      const det = info.body && info.body.error && info.body.error.details;
      if (Array.isArray(det)) {
        const ri = det.find((d) => d && d.retryDelay);
        if (ri) wait = Math.max(wait, parseFloat(ri.retryDelay) * 1000 || 0);
      }
      if (!wait) wait = 60 * 1000;
      return quotaErr(wait, String(msg).slice(0, 200));
    }
    if (r.status === 401 || r.status === 403 || (r.status === 400 && /API key/i.test(String(msg)))) return badKeyErr(String(msg).slice(0, 200));
    if (r.status >= 500 || r.status === 408) return transientErr(String(msg).slice(0, 200));
    return Object.assign(new Error(String(msg).slice(0, 300)), { status: r.status, fatal: true });
  }

  async function groqText(key, model, { system, user, json, maxTokens }) {
    const body = { model, temperature: 0.2, max_tokens: maxTokens || 4096, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    if (json) body.response_format = { type: 'json_object' };
    if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
    let r;
    try {
      r = await doFetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body),
      });
    } catch (e) { throw transientErr('Réseau : ' + e.message); }
    if (!r.ok) throw classify(r, await readErr(r), 'groq');
    const j = await r.json();
    const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!text) throw transientErr('Réponse vide');
    return text;
  }

  const extFor = (mime) => (/mp4|m4a|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : /mpeg|mp3/.test(mime) ? 'mp3' : 'webm');

  async function groqStt(key, model, { bytes, mime, language, prompt }) {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: mime || 'audio/webm' }), 'chunk.' + extFor(mime || ''));
    fd.append('model', model);
    fd.append('response_format', 'verbose_json');
    fd.append('temperature', '0');
    if (language) fd.append('language', language);
    if (prompt) fd.append('prompt', String(prompt).slice(0, 600));
    let r;
    try { r = await doFetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: fd }); }
    catch (e) { throw transientErr('Réseau : ' + e.message); }
    if (!r.ok) throw classify(r, await readErr(r), 'groq');
    const j = await r.json();
    return { text: j.text || '', segments: Array.isArray(j.segments) ? j.segments : null, duration: j.duration || 0 };
  }

  /* ----- rotation : essaie chaque (service, modèle, clé) non mis en pause ----- */
  const coolKey = (provider, key, model) => 'aicool/' + sha(provider + '|' + key + '|' + model).slice(0, 20);

  async function rotate(cands, run) {
    let soonest = Infinity, transient = 0, fatal = null;
    for (const c of shuffle(cands)) {
      const ck = coolKey(c.provider, c.key, c.model);
      const cool = await store.get(ck);
      if (cool && cool.until > Date.now()) { soonest = Math.min(soonest, cool.until); continue; }
      try {
        const out = await run(c);
        if (cool) await store.del(ck); // la pause est finie et ça remarche : on l'oublie
        return Object.assign({ provider: c.provider, model: c.model, keyId: keyId(c.key) }, { value: out });
      } catch (e) {
        if (e.quota) { const until = Date.now() + e.waitMs; await store.set(ck, { until, at: Date.now(), why: 'quota', msg: e.message }); soonest = Math.min(soonest, until); continue; }
        if (e.badKey) { const until = Date.now() + 6 * HOUR; await store.set(ck, { until, at: Date.now(), why: 'clé refusée', msg: e.message }); continue; }
        if (e.transient) { transient++; continue; }
        fatal = e; // erreur propre à la requête (ex. 400) : un autre fournisseur peut faire mieux
      }
    }
    if (fatal && !transient && soonest === Infinity) throw Object.assign(new Error('Erreur IA : ' + fatal.message), { status: 502 });
    const retryAfter = soonest !== Infinity ? Math.max(5, Math.ceil((soonest - Date.now()) / 1000)) : 10;
    const none = !cands.length;
    throw Object.assign(new Error(none ? 'Aucune clé IA n\'est configurée. L\'administrateur doit en ajouter une.' : 'Le service d\'IA est saturé pour le moment. Nouvelle tentative automatique.'), { status: none ? 501 : 503, retryAfter, ai: true });
  }

  // Jetons d'entrée estimés (≈ 3 caractères par jeton en français, on reste prudent)
  const estTokens = (chars) => Math.ceil(chars / 3) + 50;

  return {
    /* texte : rend { text, json, provider, model } */
    async text({ system, user, json, maxTokens }) {
      const kk = await keys('groq');
      const inTok = estTokens(system.length + user.length);
      let last = null;
      for (const model of groqTextModels()) {
        const info = MODEL_INFO[model] || { tpm: 8000, out: 8192 };
        // Groq compte entrée + sortie demandée dans la limite par minute : on ajuste la sortie au budget du modèle
        const room = Math.min(info.out, info.tpm - inTok - 100);
        if (room < Math.min(1024, maxTokens || 4096)) continue; // trop gros pour ce modèle
        const mt = Math.min(maxTokens || 4096, room);
        const cands = kk.map((key) => ({ provider: 'groq', model, key }));
        try {
          const r = await rotate(cands, (c) => groqText(c.key, c.model, { system, user, json, maxTokens: mt }));
          const parsed = json ? parseJsonLoose(r.value) : null;
          if (json && !parsed) { last = Object.assign(new Error('Réponse de l\'IA illisible, nouvelle tentative…'), { status: 502, retryAfter: 3 }); continue; }
          return { text: r.value, json: parsed, provider: r.provider, model: r.model };
        } catch (e) {
          if (e.status === 501) throw e; // aucune clé
          if (!last || !last.ai || (e.ai && (e.retryAfter || 0) < (last.retryAfter || Infinity))) last = e;
        }
      }
      if (last) throw last;
      throw Object.assign(new Error(kk.length ? 'Texte trop long pour les modèles disponibles.' : 'Aucune clé IA n\'est configurée. L\'administrateur doit en ajouter une.'), { status: kk.length ? 413 : 501 });
    },
    /* audio -> texte : rend { text, segments|null, duration } */
    async transcribe({ bytes, mime, language, prompt }) {
      const kk = await keys('groq');
      const models = [groqSttModel()].concat(groqSttModel() === 'whisper-large-v3' ? [] : ['whisper-large-v3']);
      const run = (c) => groqStt(c.key, c.model, { bytes, mime, language, prompt });
      // Whisper turbo d'abord ; si toutes les clés sont en pause, Whisper large v3 (quota séparé) prend le relais
      for (let i = 0; i < models.length; i++) {
        try { return (await rotate(kk.map((key) => ({ provider: 'groq', model: models[i], key })), run)).value; }
        catch (e) { if (!e.ai || e.status === 501 || i === models.length - 1) throw e; }
      }
    },
    /* état des clés pour le panneau admin */
    async status() {
      const now = Date.now();
      const out = { groq: [] };
      for (const provider of ['groq']) {
        for (const key of await keys(provider)) {
          const models = [groqSttModel(), ...groqTextModels()];
          const cooling = [];
          for (const model of models) {
            const c = await store.get(coolKey(provider, key, model));
            if (c && c.until > now) cooling.push({ model, until: c.until, why: c.why });
          }
          out[provider].push({ id: keyId(key), mask: maskKey(key), cooling });
        }
      }
      return out;
    },
  };
}
