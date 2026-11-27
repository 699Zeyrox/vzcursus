// IA simulée partagée par les tests. Aucun réseau.
export const calls = { groqStt: [], groqChat: 0, groqModels: [] };
export const ctl = { quotaOnKey: null };

const resp = (status, body, headers) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) }));

/* réponses du « faux modèle » selon la consigne reçue */
function answer(sys, user) {
  if (sys.includes('"drop"')) { // nettoyage : retire les phrases de bavardage (le match d'hier)
    const drop = [];
    (user.match(/^\d+\. .*$/gm) || []).forEach((line) => { const m = /^(\d+)\. (.*)$/.exec(line); if (/match hier/i.test(m[2])) drop.push(Number(m[1])); });
    return { json: { drop, fix: [] } };
  }
  if (sys.includes('"start"')) return { json: { sections: [{ heading: 'Définition', start: 1, terms: ['photosynthèse', 'chloroplastes'] }] } };
  if (sys.includes('termines')) return { json: { title: 'La photosynthèse', summary: 'Le professeur définit la photosynthèse.', keyPoints: ['Définition', 'Chloroplastes'], assignments: [{ i: 0, chapter: 'La photosynthèse' }] } };
  if (sys.includes('fiches de révision')) return { text: '## Photosynthèse\n- **Définition** : « La photosynthèse est la transformation de l\'énergie lumineuse en énergie chimique. »' };
  return { json: { ok: true } };
}

export function fakeFetch(url, init) {
  const u = String(url);
  const hdr = init.headers || {};
  if (u.includes('api.groq.com/openai/v1/audio/transcriptions')) {
    const key = String(hdr.authorization || '').replace('Bearer ', '');
    calls.groqStt.push(key);
    if (key === ctl.quotaOnKey) return resp(429, { error: { message: 'Rate limit reached for audio seconds per day' } }, { 'retry-after': '3600' });
    return resp(200, { text: 'x', duration: 120, segments: [
      { text: ' La photosynthèse est la transformation de l\'énergie lumineuse en énergie chimique.', avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.4 },
      { text: ' Sous-titrage ST\' 501', avg_logprob: -0.3, no_speech_prob: 0.1, compression_ratio: 1.0 },
      { text: ' bruit de chaise', avg_logprob: -1.8, no_speech_prob: 0.9, compression_ratio: 1.0 },
      { text: ' Eh t\'as vu le match hier ?', avg_logprob: -0.3, no_speech_prob: 0.02, compression_ratio: 1.0 },
      { text: ' Attention, j\'écris au tableau la formule de la photosynthèse.', avg_logprob: -0.25, no_speech_prob: 0.02, compression_ratio: 1.3 },
      { text: ' Elle a lieu dans les chloroplastes, grâce à la chlorophylle, et produit du glucose et du dioxygène.', avg_logprob: -0.25, no_speech_prob: 0.02, compression_ratio: 1.5 },
    ] });
  }
  if (u.includes('api.groq.com/openai/v1/chat/completions')) {
    const body = JSON.parse(init.body);
    calls.groqChat++; calls.groqModels.push(body.model);
    const a = answer(body.messages[0].content, body.messages[1].content);
    return resp(200, { choices: [{ message: { content: a.json ? JSON.stringify(a.json) : a.text } }] });
  }
  return resp(404, {});
}
