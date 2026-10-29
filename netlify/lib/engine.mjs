// Server engine for Twelve: several island worlds run side by side. Each tick loads every world,
// runs it up to real time, lets Claude (when a key is set) think for the spotlight cast,
// writes confessionals and episode recaps, and saves.
import * as S from '../../public/sim.mjs';

const env = k => (globalThis.Netlify && Netlify.env && Netlify.env.get(k)) || process.env[k];
const MODEL = () => env('TWELVE_MODEL') || 'claude-haiku-5-5';
const PER_DAY = () => Math.max(0, +(env('TWELVE_AI_PER_DAY') || 400));
const EP_EVERY = 6 * 24;        // game hours between episodes (2 real hours)
const CONF_EVERY = 30;          // game hours between confessionals (25 real minutes)
const MAX_CALLS = 8;            // Claude calls per world per tick
export const MAX_WORLDS = 6;
const WORLD_NAMES = ['Saltwater', 'Ember Reef', 'Low Tide', 'Kestrel', 'Black Coral', 'Moonfall', 'Tern Rock', 'Driftwood', 'Halcyon', 'Stormbreak', 'Wrecker’s Rest', 'Coral Sea'];

export function aiClientFactory(Anthropic) {
  if (!env('ANTHROPIC_API_KEY')) return null;
  return new Anthropic({ timeout: 9000, maxRetries: 0 });
}
export const adminKey = () => env('TWELVE_ADMIN_KEY') || '';
const wkey = id => 'world:' + id;

/* ---------- the index of worlds ---------- */
export async function getIndex(store, create = true) {
  const r = await store.getWithMetadata('index', { type: 'json' });
  if (r && r.data && Array.isArray(r.data.worlds)) return { idx: r.data, etag: r.etag };
  if (!create) return { idx: { worlds: [] }, etag: null };
  const idx = { worlds: [], n: 0 };
  for (let i = 0; i < 3; i++) addWorldEntry(idx);
  await store.setJSON('index', idx, { onlyIfNew: true });
  const again = await store.getWithMetadata('index', { type: 'json' });
  return { idx: again.data, etag: again.etag };
}
function addWorldEntry(idx, name) {
  idx.n = (idx.n || 0) + 1;
  const used = new Set(idx.worlds.map(w => w.name));
  const nm = name || WORLD_NAMES.find(n => !used.has(n)) || 'Island ' + idx.n;
  const id = Math.random().toString(36).slice(2, 7) + idx.n.toString(36);
  const w = { id, name: nm, created: Date.now(), seed: ((Date.now() + idx.n * 7919) % 2147483646) + 1 };
  idx.worlds.push(w);
  return w;
}
async function saveIndex(store, idx, etag) {
  const res = await store.setJSON('index', idx, etag ? { onlyIfMatch: etag } : {});
  return res.modified;
}

/* ---------- storage ---------- */
async function loadWorld(store, entry) {
  const r = await store.getWithMetadata(wkey(entry.id), { type: 'text' });
  if (r && r.data) {
    try { S.load(r.data); return { etag: r.etag, fresh: false }; }
    catch (e) { console.log(entry.name, 'incompatible, starting a new season:', e.message); }
  }
  S.newSeason(entry.seed || ((Date.now() % 2147483646) + 1), Date.now());
  return { etag: r ? r.etag : null, fresh: true };
}
async function saveWorld(store, entry, etag, now) {
  const W = S.W;
  W.ver = (W.ver || 0) + 1;
  W.savedAt = now;
  W.wid = entry.id; W.wname = entry.name;
  const metadata = { savedAt: now, ver: W.ver, t: W.t, season: W.season, pop: W.people.length, camps: W.groups.filter(g => !g.dead).length, gen: W.stats.maxGen, ai: !!W.ai.on };
  const res = await store.set(wkey(entry.id), S.save(), etag ? { metadata, onlyIfMatch: etag } : { metadata, onlyIfNew: true });
  if (!res.modified) console.log(entry.name, 'save skipped: another writer got there first');
  return res;
}
async function archiveSeason(store, entry, old) {
  try {
    const doc = { season: old.season, seed: old.seed, years: Math.floor(old.t / S.HPY), stats: old.stats, history: old.history, daily: old.daily, episodes: old.episodes, milestones: old.milestones, confs: old.confs.slice(-30), endedAt: Date.now() };
    await store.setJSON(`season:${entry.id}:${old.season}`, doc);
  } catch (e) { console.log('archive failed', e.message); }
}

/* ---------- Claude ---------- */
const SYS_DECIDE = `You are the private inner voice of one castaway in a long-running social experiment: twelve strangers, six men and six women, washed up on an island after a shipwreck, and their descendants. You decide what this one person does next. Stay true to their personality, history, relationships, goals and how they feel right now. People here are not heroes or villains by default; they are tired, hungry, proud, scared, loyal, petty, loving. Reply with JSON only, no other text: {"choice":"<one option key>","thought":"<one or two sentences in first person: what goes through their head as they decide. Plain spoken words. Use real names. No emojis.>"}`;
const SYS_PLAN = `You are the private inner voice of one castaway in a long-running island social experiment (strangers shipwrecked on islands, now living in rival camps, with children and grandchildren). Decide what this person is trying to do for the next day or two, given everything they know and feel. Pick one goal from the options. Then write what they would say to two or three specific people today, in their own voice: short, natural, one sentence each, consistent with the goal and their relationships. Reply with JSON only: {"goal":"<option key>","thought":"<one or two sentences, first person, why>","lines":{"<Name>":"<what they say to that person>"}}. No emojis.`;
const SYS_CONF = `You write the private video confessional of one castaway in a long-running island social experiment (strangers shipwrecked on islands, now living in rival camps). The person sits alone and talks to the camera. Write 2 to 4 sentences, first person, raw and specific: name real people, grudges, alliances, fears, secrets, plans. Match their personality and current goal. No emojis, no stage directions, no quotation marks, no hashtags.`;
const SYS_EP = `You are the narrator of a documentary series that follows a long-running social experiment: strangers shipwrecked on an island, and the generations that come after them. Write the recap for one episode from the event log you are given. Use only facts in the log. Tone: dry, observant, quietly ominous, like a nature documentary narrator. Past tense. Reply with JSON only: {"title":"<2 to 5 words>","text":"<one paragraph, 90 to 140 words>"}`;

function textOf(msg) { return (msg && msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim(); }
function jsonOf(s) { const m = s && s.match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } }
const clean = s => String(s || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
async function ask(ai, system, user, max) {
  const msg = await ai.messages.create({ model: MODEL(), max_tokens: max, system, messages: [{ role: 'user', content: user }] });
  return textOf(msg);
}
async function decide(ai, d) {
  const info = S.pendingInfo(d);
  if (!info) return null;
  const user = `${S.describe(info.p)}\n\nRight now: ${info.text}\n\nOptions:\n${info.opts.map(o => `- "${o[0]}": ${o[1]}`).join('\n')}`;
  const j = jsonOf(await ask(ai, SYS_DECIDE, user, 220));
  if (!j) return null;
  return { key: String(j.choice || '').trim(), thought: clean(j.thought).slice(0, 400) };
}
async function plan(ai, p, opts) {
  const keyed = opts.map((o, i) => ({ key: 'g' + (i + 1), o }));
  const user = `${S.describe(p)}\n\nGoal options:\n${keyed.map(x => `- "${x.key}": ${S.goalLabel(x.o)}`).join('\n')}`;
  const j = jsonOf(await ask(ai, SYS_PLAN, user, 320));
  if (!j) return null;
  const pick = keyed.find(x => x.key === String(j.goal || '').trim()) || keyed[0];
  const lines = {};
  if (j.lines && typeof j.lines === 'object') for (const n in j.lines) lines[clean(n)] = clean(j.lines[n]).slice(0, 110);
  return { opt: pick.o, thought: clean(j.thought).slice(0, 300), lines };
}
async function confess(ai, p) {
  const s = clean(await ask(ai, SYS_CONF, `${S.describe(p)}\n\nWrite ${p.name}'s confessional for today.`, 260));
  return s.length > 20 ? s.replace(/^["']|["']$/g, '').slice(0, 600) : null;
}
async function narrate(ai, evs) {
  const W = S.W;
  const groups = W.groups.filter(g => !g.dead).map(g => `${g.name} (${S.members(g).length}${g.leader ? ', led by ' + S.nameOf(g.leader) : ''})`).join('; ');
  const top = evs.filter(e => e.w >= 2).slice(-40);
  const log = (top.length >= 4 ? top : evs.slice(-40)).map(e => `${S.stamp(e.t)}: ${e.s}`).join('\n');
  const user = `Season ${W.season}, episode ${W.epN + 1}. ${S.timeLabel().year > 1 ? 'Year ' + S.timeLabel().year + '. ' : ''}${W.people.length} people alive. Camps: ${groups || 'none'}.\n\nEvent log:\n${log || 'Nothing of note.'}`;
  const j = jsonOf(await ask(ai, SYS_EP, user, 420));
  if (!j || !j.text) return null;
  return { title: clean(j.title).slice(0, 60) || 'Untitled', text: clean(j.text).slice(0, 1200) };
}
function withFrozenRand(fn) { const rs = S.W.rs; try { return fn(); } finally { S.W.rs = rs; } }
function noteErr(e) { const m = String(e && (e.status ? e.status + ' ' : '') + (e && e.message || e)).slice(0, 200); S.W.ai.err = m; S.W.ai.errAt = Date.now(); console.log('claude error:', m); }

/* ---------- one world, one tick ---------- */
export async function tickWorld(store, entry, ai, opt = {}) {
  const now = Date.now();
  const deadline = opt.deadline || now + 15000;
  const { etag } = await loadWorld(store, entry);
  let W = S.W;
  const before = W;
  const day = new Date(now).toISOString().slice(0, 10);
  if (W.ai.day !== day) { W.ai.day = day; W.ai.used = 0; W.ai.calls = 0; }
  if (!opt.catchUp) { W.ai.on = !!ai; W.ai.model = ai ? MODEL() : ''; }
  const frac = (now % 86400000) / 86400000;
  const share = Math.max(1, opt.worlds || 1);
  W.ai.allow = Math.floor(PER_DAY() / share * Math.min(1, 0.1 + frac));
  const target = S.targetT(now);
  W.ai.live = target - W.t < 12;
  W.ai.pending = W.pend.length;
  let calls = 0;
  const budgetLeft = () => (W.ai.calls || 0) < W.ai.allow;
  const canCall = () => ai && calls < MAX_CALLS && budgetLeft() && Date.now() < deadline - 2500;
  for (let guard = 0; guard < 400; guard++) {
    const r = S.advanceTo(target, { stopOnPending: true, deadline });
    W = S.W;
    const open = W.pend.filter(d => !d.asked);
    if (r.why !== 'pending' || !open.length) break;
    const batch = canCall() ? open.slice(0, Math.min(3, MAX_CALLS - calls)) : [];
    for (const d of open) if (batch.indexOf(d) < 0) S.resolvePending(d.id, null, null, false);
    if (!batch.length) continue;
    for (const d of batch) d.asked = true;
    calls += batch.length;
    const res = await Promise.allSettled(batch.map(d => decide(ai, d)));
    res.forEach((x, i) => {
      const d = batch[i];
      if (x.status === 'fulfilled' && x.value) S.resolvePending(d.id, x.value.key, x.value.thought, true);
      else { if (x.status === 'rejected') noteErr(x.reason); S.resolvePending(d.id, null, null, false); }
    });
    W.ai.calls = (W.ai.calls || 0) + batch.length;
  }
  W = S.W;
  if (W !== before && before.season !== W.season) await archiveSeason(store, entry, before);

  // goals: Claude decides what the spotlight cast is working toward
  if (canCall() && W.ai.live) {
    const due = W.spot.map(id => S.PERSON(id)).filter(p => p && (!p.goal || !p.goal.ai || W.t > p.goal.until - 4)).slice(0, Math.min(2, MAX_CALLS - calls));
    if (due.length) {
      calls += due.length; W.ai.calls = (W.ai.calls || 0) + due.length;
      const res = await Promise.allSettled(due.map(p => plan(ai, p, S.goalOptionsFor(p))));
      res.forEach((x, i) => {
        const p = due[i];
        if (x.status !== 'fulfilled' || !x.value) { if (x.status === 'rejected') noteErr(x.reason); return; }
        const v = x.value;
        S.setGoal(p, v.opt, v.thought, v.lines, true);
        if (v.thought) { W.confs.push({ t: W.t, id: p.id, name: p.name, text: v.thought, kind: 'plan', choice: S.goalLabel(p.goal), ai: true }); if (W.confs.length > 80) W.confs.shift(); }
      });
    }
  }

  // confessional: one spotlight castaway talks to the camera
  if (W.t - (W.lastConfT || 0) >= CONF_EVERY && W.spot.length) {
    W.lastConfT = W.t;
    const lastConf = id => { for (let i = W.confs.length - 1; i >= 0; i--) if (W.confs[i].id === id && W.confs[i].kind === 'conf') return W.confs[i].t; return -1e9; };
    const pid = W.spot.slice().sort((a, b) => lastConf(a) - lastConf(b))[0];
    const p = S.PERSON(pid);
    if (p) {
      let text = null;
      if (canCall() && W.ai.live) { calls++; W.ai.calls = (W.ai.calls || 0) + 1; try { text = await confess(ai, p); } catch (e) { noteErr(e); } }
      const isAI = !!text;
      if (!text) text = withFrozenRand(() => S.templateConfessional(p));
      W.confs.push({ t: W.t, id: p.id, name: p.name, text, kind: 'conf', ai: isAI });
      if (W.confs.length > 80) W.confs.shift();
    }
  }

  // episode recap
  if (W.t >= W.nextEp) {
    const from = W.epLastN || 0, to = W.evN;
    const evs = S.episodeEvents(from, to);
    let ep = null;
    if (canCall() && W.ai.live && evs.length) { calls++; W.ai.calls = (W.ai.calls || 0) + 1; try { ep = await narrate(ai, evs); } catch (e) { noteErr(e); } }
    const isAI = !!ep;
    if (!ep) ep = S.templateEpisode(evs);
    const ids = {};
    for (const e of evs) if (e.w >= 2) for (const id of e.ids) ids[id] = (ids[id] || 0) + e.w;
    const cast = Object.entries(ids).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => +x[0]);
    W.epN++;
    W.episodes.push({ n: W.epN, t: W.t, t0: W.epFromT || 0, title: ep.title, text: ep.text, ai: isAI, cast });
    if (W.episodes.length > 60) W.episodes.shift();
    W.epLastN = to; W.epFromT = W.t;
    W.nextEp = W.t + EP_EVERY;
  }

  const res = await saveWorld(store, entry, etag, now);
  return { w: entry.name, t: +W.t.toFixed(2), behind: +(S.targetT(now) - W.t).toFixed(2), calls, saved: res.modified, season: W.season, pop: W.people.length };
}

/* ---------- the scheduled tick: every world ---------- */
export async function tickAll(store, ai, budgetMs = 21000) {
  const start = Date.now();
  const { idx } = await getIndex(store);
  const out = [];
  const n = idx.worlds.length;
  for (let i = 0; i < n; i++) {
    const left = budgetMs - (Date.now() - start);
    if (left < 1500) break;
    const deadline = Date.now() + Math.max(1500, left / (n - i));
    try { out.push(await tickWorld(store, idx.worlds[i], ai, { deadline, worlds: n })); }
    catch (e) { console.log('tick failed for', idx.worlds[i].name, e && e.stack || e); }
  }
  return out;
}

/* ---------- read paths ---------- */
export async function readState(store, wid) {
  const { idx } = await getIndex(store);
  const entry = idx.worlds.find(w => w.id === wid) || idx.worlds[0];
  if (!entry) return null;
  const now = Date.now();
  const meta = await store.getMetadata(wkey(entry.id));
  const stale = !meta || !meta.metadata || now - (+meta.metadata.savedAt || 0) > 7 * 60 * 1000;
  if (stale) {
    try { await tickWorld(store, entry, null, { deadline: now + 7000, catchUp: true, worlds: idx.worlds.length }); } catch (e) { console.log('catch-up failed', e.message); }
  }
  return await store.get(wkey(entry.id), { type: 'text' });
}
export async function listWorlds(store) {
  const { idx } = await getIndex(store);
  const out = [];
  for (const w of idx.worlds) {
    const m = await store.getMetadata(wkey(w.id));
    out.push(Object.assign({ id: w.id, name: w.name, created: w.created }, m && m.metadata ? m.metadata : {}));
  }
  return out;
}
export async function readSeason(store, wid, n) {
  return await store.get(`season:${wid}:${n | 0}`, { type: 'text' });
}

/* ---------- owner actions ---------- */
export async function adminAction(store, body) {
  const { idx, etag } = await getIndex(store);
  const act = body.action;
  if (act === 'create') {
    if (idx.worlds.length >= MAX_WORLDS) return { ok: false, error: `You can run up to ${MAX_WORLDS} worlds at once. Delete one first.` };
    const entry = addWorldEntry(idx, body.name ? String(body.name).slice(0, 28) : '');
    if (!(await saveIndex(store, idx, etag))) return { ok: false, error: 'Busy, try again.' };
    S.newSeason(entry.seed, Date.now());
    await saveWorld(store, entry, null, Date.now());
    return { ok: true, world: entry };
  }
  const entry = idx.worlds.find(w => w.id === body.w);
  if (!entry) return { ok: false, error: 'No such world.' };
  if (act === 'restart') {
    const r = await store.getWithMetadata(wkey(entry.id), { type: 'text' });
    let prev = null;
    if (r && r.data) { try { prev = S.load(r.data); } catch (e) { prev = null; } }
    if (prev) await archiveSeason(store, entry, prev);
    entry.seed = ((Date.now() * 31) % 2147483646) + 1;
    const pv = prev ? prev.ver || 0 : 0;
    S.newSeason(entry.seed, Date.now(), prev);
    S.W.ver = pv;
    await saveIndex(store, idx, etag);
    const res = await saveWorld(store, entry, null, Date.now()).catch(() => null);
    if (!res || !res.modified) await store.set(wkey(entry.id), S.save(), { metadata: { savedAt: Date.now(), ver: S.W.ver, t: S.W.t, season: S.W.season, pop: 12, camps: 0, gen: 1 } });
    return { ok: true, world: entry };
  }
  if (act === 'rename') {
    entry.name = String(body.name || '').slice(0, 28) || entry.name;
    await saveIndex(store, idx, etag);
    return { ok: true, world: entry };
  }
  if (act === 'delete') {
    if (idx.worlds.length <= 1) return { ok: false, error: 'Keep at least one world.' };
    idx.worlds = idx.worlds.filter(w => w !== entry);
    if (!(await saveIndex(store, idx, etag))) return { ok: false, error: 'Busy, try again.' };
    await store.delete(wkey(entry.id));
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
}
