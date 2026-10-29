import { getStore } from '@netlify/blobs';
import { readState, readSeason } from '../lib/engine.mjs';

const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' };

export default async (req) => {
  const store = getStore({ name: 'twelve', consistency: 'strong' });
  const url = new URL(req.url);
  const w = url.searchParams.get('w') || '';
  const season = url.searchParams.get('season');
  if (season) {
    const doc = await readSeason(store, w, season);
    if (!doc) return new Response('{"error":"not found"}', { status: 404, headers: H });
    return new Response(doc, { headers: { ...H, 'netlify-cdn-cache-control': 'public, durable, s-maxage=86400' } });
  }
  const body = await readState(store, w);
  if (!body) return new Response('{"error":"no world"}', { status: 404, headers: H });
  return new Response(body, { headers: { ...H, 'netlify-cdn-cache-control': 'public, durable, s-maxage=15, stale-while-revalidate=45' } });
};

export const config = { path: '/api/state' };
