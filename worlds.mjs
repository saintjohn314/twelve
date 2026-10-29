import { getStore } from '@netlify/blobs';
import { listWorlds } from '../lib/engine.mjs';

export default async () => {
  const store = getStore({ name: 'twelve', consistency: 'strong' });
  const list = await listWorlds(store);
  return new Response(JSON.stringify({ worlds: list, now: Date.now() }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate', 'netlify-cdn-cache-control': 'public, durable, s-maxage=10, stale-while-revalidate=30' } });
};

export const config = { path: '/api/worlds' };
