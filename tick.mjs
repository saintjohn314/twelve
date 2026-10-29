import { getStore } from '@netlify/blobs';
import Anthropic from '@anthropic-ai/sdk';
import { tickAll, aiClientFactory } from '../lib/engine.mjs';

export default async () => {
  const store = getStore({ name: 'twelve', consistency: 'strong' });
  const ai = aiClientFactory(Anthropic);
  try {
    const r = await tickAll(store, ai, 21000);
    console.log('tick', JSON.stringify(r));
  } catch (e) {
    console.log('tick failed', e && e.stack || e);
  }
};

export const config = { schedule: '*/5 * * * *' };
