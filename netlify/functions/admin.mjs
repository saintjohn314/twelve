import { getStore } from '@netlify/blobs';
import { adminAction, adminKey } from '../lib/engine.mjs';

const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'POST') return J({ ok: false, error: 'POST only' }, 405);
  let body = {};
  try { body = await req.json(); } catch (e) { return J({ ok: false, error: 'Bad request' }, 400); }
  const key = adminKey();
  if (!key) return J({ ok: false, error: 'Owner controls are not set up on the server.' }, 503);
  if (!body.key || body.key !== key) return J({ ok: false, error: 'That owner key is not right.' }, 403);
  if (body.action === 'check') return J({ ok: true });
  const store = getStore({ name: 'twelve', consistency: 'strong' });
  try { return J(await adminAction(store, body)); }
  catch (e) { return J({ ok: false, error: String(e && e.message || e).slice(0, 200) }, 500); }
};

export const config = { path: '/api/admin' };
