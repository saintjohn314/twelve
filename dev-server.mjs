// Local dev server: serves public/ and the API backed by an in-memory store (rules only, no Claude).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { readState, tickAll, listWorlds, adminAction, readSeason } from './netlify/lib/engine.mjs';
const PORT = +process.argv[2] || 8787;
process.env.TWELVE_ADMIN_KEY = process.env.TWELVE_ADMIN_KEY || 'dev';
const blobs = new Map(); let et = 0;
export const store = {
  async getWithMetadata(k, o = {}) { const b = blobs.get(k); if (!b) return null; return { data: o.type === 'json' ? JSON.parse(b.data) : b.data, etag: b.etag, metadata: b.meta }; },
  async getMetadata(k) { const b = blobs.get(k); return b ? { etag: b.etag, metadata: b.meta || {} } : null; },
  async get(k, o = {}) { const b = blobs.get(k); if (!b) return null; return o.type === 'json' ? JSON.parse(b.data) : b.data; },
  async set(k, data, o = {}) { const b = blobs.get(k); if (o.onlyIfNew && b) return { modified: false }; if (o.onlyIfMatch && (!b || b.etag !== o.onlyIfMatch)) return { modified: false }; const etag = 'e' + (++et); blobs.set(k, { data, etag, meta: o.metadata }); return { modified: true, etag }; },
  async setJSON(k, d, o) { return this.set(k, JSON.stringify(d), o); },
  async delete(k) { blobs.delete(k); },
};
if (process.env.WARM) {   // pre-age the worlds: pretend they started WARM hours ago
  const real = Date.now; const end = real(); let fake = end - (+process.env.WARM) * 3600e3;
  Date.now = () => fake;
  await tickAll(store, null);
  while (fake < end) { fake = Math.min(end, fake + 30 * 60e3); await tickAll(store, null, 600000); }
  Date.now = real;
  console.log('warmed', [...blobs.keys()].join(' '));
}
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.wasm': 'application/wasm' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
  try {
    if (u.pathname === '/api/state') {
      if (u.searchParams.get('season')) { const d = await readSeason(store, u.searchParams.get('w'), u.searchParams.get('season')); return d ? json(d) : json({ error: 'nf' }, 404); }
      return json(await readState(store, u.searchParams.get('w') || ''));
    }
    if (u.pathname === '/api/worlds') return json({ worlds: await listWorlds(store), now: Date.now() });
    if (u.pathname === '/api/admin') {
      let b = ''; for await (const c of req) b += c;
      const body = JSON.parse(b || '{}');
      if (body.key !== process.env.TWELVE_ADMIN_KEY) return json({ ok: false, error: 'That owner key is not right.' }, 403);
      if (body.action === 'check') return json({ ok: true });
      return json(await adminAction(store, body));
    }
    if (u.pathname === '/api/tick') return json(await tickAll(store, null));
  } catch (e) { console.log(e); return json({ error: String(e) }, 500); }
  const f = path.join('public', u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  fs.readFile(f, (err, d) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(PORT, () => console.log('dev server on', PORT));
