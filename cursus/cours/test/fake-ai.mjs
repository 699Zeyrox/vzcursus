// IA simulée partagée par les tests
/* ----- IA simulée (Groq + Gemini) ----- */
export const calls = { groqStt: [], gemini: [], groqChat: 0 };
export let quotaOnKey = null;       // clé Groq qui répond 429
export let geminiDown = false;      // Gemini répond 429 « par jour »
export function fakeFetch(url, init) {
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

