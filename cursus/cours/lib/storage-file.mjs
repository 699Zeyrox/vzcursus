/*
  Stockage dans un fichier JSON : pour tester en local, sans rien installer.
  (Sur Netlify, c'est storage-blobs.mjs qui est utilisé.)
*/
import fs from 'node:fs';
import path from 'node:path';

export function fileStorage(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let map = {};
  if (fs.existsSync(file)) {
    try { map = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { throw new Error('Le fichier de données est illisible : ' + file + ' (' + e.message + ')'); }
  }
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const save = () => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(map));
    fs.renameSync(tmp, file);
  };
  return {
    async get(k) { return k in map ? clone(map[k]) : null; },
    async set(k, v) { map[k] = clone(v); save(); },
    async del(k) { if (k in map) { delete map[k]; save(); } },
    async list(prefix) { return Object.keys(map).filter((k) => k.startsWith(prefix)); },
    async setIfNew(k, v) { if (k in map) return false; map[k] = clone(v); save(); return true; },
  };
}
