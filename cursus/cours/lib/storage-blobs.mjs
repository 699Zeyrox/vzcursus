/*
  Stockage Netlify Blobs : la base de données intégrée à Netlify (aucun compte en plus).
  Le paquet @netlify/blobs est chargé à la première requête. Il fonctionne :
    - sur Netlify une fois le site déployé,
    - en local avec « npx netlify dev » (Netlify simule les Blobs sur ton PC).
  Pour les tests, on peut injecter un faux getStore : blobsStorage({ getStore }).

  IMPORTANT : la connexion (getStore) est recréée à chaque opération et jamais gardée en mémoire.
  Elle contient un jeton propre à la requête en cours : le réutiliser plus tard donne
  « BlobsInternalError: Failed to decode token: Token expired ».
*/
export function blobsStorage(opts = {}) {
  const name = opts.name || 'cours';
  let getStoreFn = opts.getStore || null;
  async function s() {
    if (!getStoreFn) getStoreFn = (await import('@netlify/blobs')).getStore; // on garde la fonction, pas le store
    return getStoreFn({ name, consistency: 'strong' });
  }
  return {
    async get(k) {
      const v = await (await s()).get(k, { type: 'json' });
      return v === undefined ? null : v;
    },
    async set(k, v) { await (await s()).setJSON(k, v); },
    async del(k) { await (await s()).delete(k); },
    async list(prefix) {
      const r = await (await s()).list({ prefix });
      return r.blobs.map((b) => b.key);
    },
    async setIfNew(k, v) {
      const st = await s();
      if ((await st.get(k, { type: 'json' })) != null) return false;
      const r = await st.setJSON(k, v, { onlyIfNew: true });
      return !(r && r.modified === false);
    },
  };
}
