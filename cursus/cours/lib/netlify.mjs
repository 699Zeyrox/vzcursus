/* Adaptateur entre une fonction Netlify (API Request / Response) et le noyau de l'API. */
export function asNetlifyHandler(handle) {
  return async (req) => {
    const url = new URL(req.url);
    const ctype = req.headers.get('content-type') || '';
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const audio = hasBody && /^audio\//i.test(ctype);
    const raw = hasBody && !audio ? await req.text() : '';
    const bytes = audio ? new Uint8Array(await req.arrayBuffer()) : null;
    const ip = req.headers.get('x-nf-client-connection-ip')
      || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
    const r = await handle({
      method: req.method,
      path: url.pathname,
      search: url.search,
      headers: Object.fromEntries(req.headers),
      rawBody: raw,
      bytes,
      host: url.host,
      ip,
      secure: url.protocol === 'https:',
    });
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const c of r.cookies || []) headers.append('Set-Cookie', c);
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  };
}
