/* Interface: heads-up display, story cards, panels, labels, world switcher, owner tools, sandbox, family trees, minimap, recap and settings. */
import { S, st, R, T, $, $$, esc, clamp, setText, saveOpts, NO_CAMP, campHex, personHex } from './state.mjs';
import { RL, renderList, project, pickPerson } from './actors.mjs';
import { setDirector, flyTo, focusPerson, frameWide, frameIsland, onDirectorChange } from './camera.mjs';
import { setSound, setVolume, narrate, speaking, stopNarration, voices, canSpeak } from './sound.mjs';

let H = {};                    // handlers from main: switchWorld, openSandbox, newSandbox, setSpeed, reload
const ISLE_SHORT = ['', 'home island', 'far island', 'high island'];
const isleOf = isl => ISLE_SHORT[isl] || 'islet';

/* ---------- new events, confessionals and episodes become ticker lines and cards ---------- */
const seenEv = new Set();
const evKey = e => e.k + '|' + e.t.toFixed(2) + '|' + e.s;
const confKey = c => c.t.toFixed(2) + '|' + c.id + '|' + c.kind;
let seenEp = 0;
const seenConf = new Set();
export function ingest(reset, firstVisit) {
  const W = S.W, now = performance.now() / 1000;
  if (reset) {
    seenEv.clear();
    for (const e of W.events) seenEv.add(evKey(e));
    seenConf.clear();
    for (const c of W.confs) seenConf.add(confKey(c));
    const last = W.episodes[W.episodes.length - 1];
    seenEp = last ? last.n : 0;
    st.cardQ.length = 0;
    st.tick.length = 0;
    st.boost.clear();
    if (firstVisit) {
      let fresh = true;
      try { fresh = !localStorage.getItem('twelve-welcome-v'); localStorage.setItem('twelve-welcome-v', '1'); } catch (e) { /* storage blocked */ }
      if (fresh) st.cardQ.push({ type: 'welcome', dur: 26 });
      if (last && st.mode === 'live') st.cardQ.push({ type: 'ep', ep: last, prev: true, dur: cardDur(last.text, 10) });
      const lc = W.confs.filter(c => c.kind === 'conf').slice(-1)[0];
      if (lc && W.t - lc.t < 30) st.cardQ.push(confCard(lc));
    } else st.cardQ.push({ type: st.mode === 'sandbox' && W.season === 1 ? 'sandbox' : 'season', dur: 14 });
    return;
  }
  for (const e of W.events) {
    const k = evKey(e);
    if (seenEv.has(k)) continue;
    seenEv.add(k);
    onEvent(e, now);
  }
  if (seenEv.size > 3000) { seenEv.clear(); for (const e of W.events) seenEv.add(evKey(e)); }
  for (const c of W.confs) {
    const k = confKey(c);
    if (seenConf.has(k)) continue;
    seenConf.add(k);
    if (W.t - c.t < 40 && st.cardQ.length < 6) st.cardQ.push(confCard(c));
  }
  for (const ep of W.episodes) {
    if (ep.n <= seenEp) continue;
    seenEp = ep.n;
    st.cardQ.push({ type: 'ep', ep, dur: cardDur(ep.text, 10) });
  }
}
function cardDur(text, base) { return Math.min(24, base + String(text || '').length * 0.042); }
function confCard(c) { return { type: c.kind === 'conf' ? 'conf' : 'thought', c, pid: S.getP(c.id) ? c.id : 0, dur: cardDur(c.text, 7) }; }
function onEvent(e, now) {
  if (e.w < 2 || e.k === 'culture') return;
  st.tick.push(e);
  if (st.tick.length > 4) st.tick.shift();
  for (const id of e.ids || []) {
    if (!S.getP(id)) continue;
    const b = st.boost.get(id) || { v: 0, until: 0 };
    b.v = Math.min(70, (b.until > now ? b.v : 0) + 16 * e.w);
    b.until = now + 45;
    st.boost.set(id, b);
  }
}
// in the sandbox nobody on a server writes the show, so the browser does it with the built-in templates
export function localShow() {
  const W = S.W;
  if (W.t - (W.lastConfT || 0) >= 30 && W.spot.length) {
    W.lastConfT = W.t;
    const p = S.getP(W.spot[Math.floor(W.t) % W.spot.length]);
    if (p) { W.confs.push({ t: W.t, id: p.id, name: p.name, text: S.templateConfessional(p), kind: 'conf', ai: false }); if (W.confs.length > 80) W.confs.shift(); }
  }
  if (W.t >= W.nextEp) {
    const evs = S.episodeEvents(W.epLastN || 0, W.evN), ep = S.templateEpisode(evs);
    W.epN++;
    W.episodes.push({ n: W.epN, t: W.t, t0: W.epFromT || 0, title: ep.title, text: ep.text, ai: false, cast: [] });
    if (W.episodes.length > 60) W.episodes.shift();
    W.epLastN = W.evN; W.epFromT = W.t; W.nextEp = W.t + 144;
  }
}

/* ---------- cards ---------- */
export function showCard(now) {
  if (st.card && (now < st.card.until || (st.card.spoken && speaking() && now < st.card.until + 40))) return;
  if (st.card) hideCard();
  if (!$('#recap').hidden) return;
  const c = st.cardQ.shift();
  if (!c) return;
  if ((c.type === 'conf' || c.type === 'thought') && c.pid && !S.getP(c.pid)) c.pid = 0;
  st.card = c;
  c.until = now + c.dur;
  const W = S.W;
  let kicker = '', title = '', text = '', meta = '', dot = '';
  if (c.type === 'welcome') {
    kicker = 'Welcome';
    title = 'Twelve strangers. No script.';
    text = 'Six men and six women washed ashore after a shipwreck. Nobody controls them. They find food, fall in love, steal, fight, form camps and cast each other out on their own, live, around the clock. Claude speaks for a few of them at a time: their confessionals and their hardest choices.';
    meta = 'One day on the island is twenty minutes of real time. The director picks the shots. Drag to look around, scroll to zoom where you point, use W A S D to move, and double-click anyone to follow them.';
  } else if (c.type === 'sandbox') {
    kicker = 'Sandbox';
    title = 'Your own island';
    text = 'A private run of the experiment that lives only in this tab: a fresh wreck, twelve new strangers, the same rules as the live worlds. Use the speed buttons at the top left to fast-forward years in minutes. Nothing here touches the live worlds.';
  } else if (c.type === 'season') {
    kicker = 'Season ' + W.season;
    title = 'A new wreck';
    text = 'Everyone from the last season is gone. A new ship broke apart on the reef, and twelve new strangers are washing up on the beach.';
  } else if (c.type === 'ep') {
    const ep = c.ep;
    kicker = c.prev ? 'Previously on Twelve' : 'Episode ' + ep.n;
    title = ep.title;
    text = ep.text;
    meta = `Episode ${ep.n} · ${S.stamp(ep.t0 || 0)} to ${S.stamp(ep.t)}${ep.ai ? ' · Narrated by Claude' : ''}`;
  } else {
    const cf = c.c, p = S.getP(cf.id) || S.W.arch[cf.id];
    const g = p && p.grp ? S.groupById(p.grp) : null;
    dot = p && S.getP(cf.id) ? personHex(p) : NO_CAMP;
    kicker = c.type === 'conf' ? 'Confessional' : 'Decision';
    title = cf.name;
    text = cf.text;
    meta = (c.type === 'thought' ? `Chose: ${cf.choice}. ` : '') + `${S.stamp(cf.t)}${g && !g.dead ? ' · ' + g.name : ''}${cf.ai ? ' · Voiced by Claude' : ''}`;
  }
  $('#cardKicker').innerHTML = (dot ? `<span class="cdot" style="background:${dot}"></span>` : '') + esc(kicker);
  $('#cardTitle').textContent = title;
  $('#cardText').textContent = text;
  $('#cardMeta').textContent = meta;
  $('#card').style.setProperty('--card-c', dot || 'var(--text-3)');
  $('#card').classList.remove('hide');
  $('#letterbox').classList.toggle('on', !!c.pid && st.director);
  if (c.pid && st.director) st.shot = null;
  if (st.opts.narrator && st.opts.sound && c.type !== 'welcome') { narrate(c); c.spoken = true; }
}
function hideCard() {
  if (st.card && st.card.spoken) stopNarration();
  st.card = null;
  $('#card').classList.add('hide');
  $('#letterbox').classList.remove('on');
  if (st.director) st.shot = null;
}

/* ---------- heads-up display ---------- */
export function hudTick(now) {
  const W = S.W, tl = S.timeLabel(W.t + st.alpha * S.DT);
  setText('#hWhen', `Season ${W.season} · Day ${tl.day}${tl.year > 1 ? ' · Year ' + tl.year : ''}`);
  setText('#hClock', tl.clock);
  const camps = W.groups.filter(g => !g.dead).length, sick = W.people.filter(p => p.ill > 0).length;
  const extra = (W.wx.storm > 0 ? ' · storm' : '') + (W.wx.drought > 0 ? ' · drought' : '') + (sick >= 3 ? ` · ${sick} sick` : '');
  setText('#hSub', `${W.people.length} alive · ${camps} ${camps === 1 ? 'camp' : 'camps'} · ${tl.season}${extra}`);
  const live = st.mode === 'live' && Date.now() - st.lastOk < 4 * 60 * 1000;
  $('#live').classList.toggle('off', st.mode === 'live' && !live);
  $('#live').classList.toggle('sand', st.mode === 'sandbox');
  setText('#liveTxt', st.mode === 'sandbox' ? (st.speed ? `SANDBOX ${st.speed}x` : 'SANDBOX PAUSED') : live ? 'LIVE' : 'RECONNECTING');
  setText('#worldName', st.mode === 'sandbox' ? 'Sandbox' : st.wname || 'Twelve');
  $('#speedBar').hidden = st.mode !== 'sandbox';
  $$('#speedBar [data-speed]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.speed === st.speed ? 'true' : 'false'));
  // lower third
  let name = '', role = '', act = '', hex = NO_CAMP, pid = 0;
  const sh = st.director ? st.shot : null;
  const subj = sh && (sh.kind === 'person' || sh.kind === 'pair') ? sh.id : (!st.director && st.sel ? st.sel : 0);
  const p = subj && S.getP(subj);
  if (p) { name = p.name; role = S.roleLabel(p); act = S.actLabel(p); hex = personHex(p); pid = p.id; }
  else if (sh && sh.kind === 'camp') {
    const g = W.groups.find(g => g.id === sh.gid);
    if (g) { const m = S.members(g).length; name = g.name; role = `${m} ${m === 1 ? 'person' : 'people'} · the ${isleOf(g.isl)}`; act = (g.leader ? 'Led by ' + S.nameOf(g.leader) : 'No leader') + (g.fire.lit ? ' · fire burning' : ' · no fire'); hex = campHex(g); }
  } else if (sh && sh.kind === 'boat') {
    const b = W.boats.find(b => b.id === sh.bid);
    if (b && b.sail) { name = 'At sea'; role = b.rig ? 'Under sail' : 'Paddling across open water'; act = (b.sail.pax || []).map(S.nameOf).join(', '); }
  } else if (sh && sh.kind === 'wreck') { name = 'The wreck'; role = 'Where it started'; act = `${Math.floor(W.t / 24)} days ago, twelve strangers crawled out of the surf here.`; }
  else if (sh && sh.kind === 'isle') { name = 'The ' + isleOf(sh.isl); role = `${S.popOf(sh.isl)} people`; act = W.groups.filter(g => !g.dead && g.isl === sh.isl).map(g => g.name).join(', '); }
  else if (sh && sh.kind === 'wide') { name = 'The islands'; role = `${W.people.length} alive · ${camps} camps`; act = `${S.popOf(1)} on the home island, ${S.popOf(2)} on the far island, ${S.popOf(3)} on the high island.`; }
  const lower = $('#lower');
  lower.classList.toggle('hide', !name || !!st.card);
  lower.dataset.pid = pid || '';
  setText('#ltName', name); setText('#ltRole', role); setText('#ltAct', act);
  $('#ltBar').style.background = hex;
  // ticker
  if (now > st.tickT && st.tick.length) {
    const e = st.tick.shift();
    const m = $('#tkMsg');
    m.classList.add('fade');
    setTimeout(() => { setText('#tkDay', S.stamp(e.t)); m.textContent = e.s; m.classList.remove('fade'); }, 250);
    st.tickT = now + 7.5;
  }
  $('#btnSound').setAttribute('aria-pressed', st.opts.sound ? 'true' : 'false');
  setText('#btnSoundTxt', st.opts.sound ? 'Sound on' : 'Sound off');
}

/* ---------- panel: cast ---------- */
let castSig = '';
const ageOf = p => Math.floor(S.ageY(p));
function personRow(p, g) {
  const lead = g && g.leader === p.id, ai = st.aiInfo.on && S.W.spot.indexOf(p.id) >= 0;
  return `<button class="prow" data-pid="${p.id}"><span class="chip" style="background:${personHex(p)};border-radius:50%"></span><span class="nm">${esc(p.name)}</span><span class="ag">${ageOf(p)}</span>${lead ? '<span class="badge lead">Leads</span>' : ''}${p.exiled && !g ? '<span class="badge out">Outcast</span>' : ''}${p.ill > 0 ? '<span class="badge sick">Fever</span>' : ''}${ai ? '<span class="badge ai" title="Claude speaks for this person right now">Claude</span>' : ''}<span class="ac">${esc(S.actLabel(p))}</span></button>`;
}
function renderCast() {
  const W = S.W;
  const groups = W.groups.filter(g => !g.dead).map(g => ({ g, m: S.members(g) })).sort((a, b) => b.m.length - a.m.length);
  const order = (g, list) => list.slice().sort((a, b) => (b.id === g.leader) - (a.id === g.leader) || S.ageY(b) - S.ageY(a));
  let h = '';
  if (!groups.length) h += '<p class="note">No camps yet. The castaways are still finding their feet.</p>';
  for (const { g, m } of groups) {
    const fed = g.store >= m.length * 2;
    const tk = [g.tk && g.tk.pot ? 'pots' : '', g.tk && g.tk.smoke ? 'smoking racks' : ''].filter(Boolean).join(', ');
    h += `<div class="camp"><div class="camp-h"><span class="chip" style="background:${campHex(g)}"></span><div><div class="camp-n">${esc(g.name)}</div><div class="camp-m">${m.length} ${m.length === 1 ? 'person' : 'people'} · ${isleOf(g.isl)}${tk ? ' · ' + tk : ''}</div></div><div class="camp-r">${g.leader ? 'Led by ' + esc(S.nameOf(g.leader)) : 'No leader'}<br>${g.fire.lit ? 'Fire lit' : 'No fire'} · ${fed ? 'food ok' : 'food low'}</div></div>${order(g, m).map(p => personRow(p, g)).join('')}</div>`;
  }
  const loners = W.people.filter(p => !p.grp);
  if (loners.length) h += `<div class="camp"><div class="camp-h"><span class="chip" style="background:${NO_CAMP}"></span><div><div class="camp-n">No camp</div><div class="camp-m">${loners.length} on their own</div></div></div>${loners.sort((a, b) => S.ageY(b) - S.ageY(a)).map(p => personRow(p, null)).join('')}</div>`;
  if (h !== castSig) { castSig = h; $('#pane-cast').innerHTML = h; }
}

/* ---------- panel: relationship web ---------- */
const webPos = new Map();
let webSig = '';
function webEdges(nodes) {
  const E = [], ids = new Set(nodes.map(p => p.id));
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const ra = a.rel[b.id], rb = b.rel[a.id];
    if (!ra && !rb) continue;
    const aff = ((ra ? ra[0] : 0) + (rb ? rb[0] : 0)) / ((ra ? 1 : 0) + (rb ? 1 : 0));
    if (a.partner === b.id) E.push({ a, b, k: 'love' });
    else if (aff > 32) E.push({ a, b, k: 'friend' });
    else if (Math.min(ra ? ra[0] : 0, rb ? rb[0] : 0) < -40) E.push({ a, b, k: 'foe' });
  }
  return E.filter(e => ids.has(e.a.id) && ids.has(e.b.id));
}
function layoutWeb(nodes, edges, iters, Wd, Ht, temp0) {
  const cx = Wd / 2, cy = Ht / 2;
  for (const p of nodes) {
    if (webPos.has(p.id)) continue;
    const par = webPos.get(p.partner) || webPos.get(p.mom) || webPos.get(p.dad);
    webPos.set(p.id, par ? { x: par.x + (Math.random() - 0.5) * 24, y: par.y + (Math.random() - 0.5) * 24 } : { x: cx + (Math.random() - 0.5) * Wd * 0.5, y: cy + (Math.random() - 0.5) * Ht * 0.5 });
  }
  const k = Math.sqrt((Wd - 40) * (Ht - 40) / Math.max(1, nodes.length)) * 0.55;
  const Rd = Math.min(Wd, Ht) * 0.4, grav = clamp(nodes.length * k * k / (2 * Rd * Rd), 0.03, 3);
  const P = nodes.map(p => webPos.get(p.id));
  const idx = new Map(nodes.map((p, i) => [p.id, i]));
  for (let it = 0; it < iters; it++) {
    const temp = temp0 * (1 - it / iters) + 0.5;
    const dx = new Float32Array(nodes.length), dy = new Float32Array(nodes.length);
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const ex = P[i].x - P[j].x, ey = P[i].y - P[j].y;
      const d = Math.sqrt(ex * ex + ey * ey) || 0.1;
      const f = (k * k) / d / d;
      dx[i] += ex * f; dy[i] += ey * f; dx[j] -= ex * f; dy[j] -= ey * f;
    }
    for (const e of edges) {
      const i = idx.get(e.a.id), j = idx.get(e.b.id);
      const ex = P[i].x - P[j].x, ey = P[i].y - P[j].y, d = Math.sqrt(ex * ex + ey * ey) || 0.1;
      const f = e.k === 'love' ? d / k * 3 : e.k === 'friend' ? d / k : -(k * k) / d / d * 0.6;
      dx[i] -= ex * f; dy[i] -= ey * f; dx[j] += ex * f; dy[j] += ey * f;
    }
    const camps = new Map();
    nodes.forEach((p, i) => { if (!p.grp) return; const c = camps.get(p.grp) || { x: 0, y: 0, n: 0 }; c.x += P[i].x; c.y += P[i].y; c.n++; camps.set(p.grp, c); });
    nodes.forEach((p, i) => {
      const c = p.grp && camps.get(p.grp);
      if (c && c.n > 1) { dx[i] += (c.x / c.n - P[i].x) * 0.35; dy[i] += (c.y / c.n - P[i].y) * 0.35; }
      dx[i] += (cx - P[i].x) * grav; dy[i] += (cy - P[i].y) * grav;
      const m = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1, s = Math.min(m, temp) / m;
      P[i].x = clamp(P[i].x + dx[i] * s, 16, Wd - 16); P[i].y = clamp(P[i].y + dy[i] * s, 16, Ht - 16);
    });
  }
}
function renderWeb() {
  const svg = $('#web');
  const Wd = svg.clientWidth || 356, Ht = svg.clientHeight || 440;
  const W = S.W;
  let nodes = W.people.filter(p => S.ageY(p) >= 14);
  if (nodes.length > 110) nodes = nodes.sort((a, b) => S.ageY(b) - S.ageY(a)).slice(0, 110);
  const edges = webEdges(nodes);
  const sig = nodes.map(p => p.id).join(',') + '|' + edges.map(e => e.a.id + e.k + e.b.id).join(',');
  layoutWeb(nodes, edges, sig === webSig ? 10 : 160, Wd, Ht, sig === webSig ? 3 : Wd / 8);
  webSig = sig;
  const leaders = new Set(W.groups.filter(g => !g.dead).map(g => g.leader));
  const showAll = nodes.length <= 36;
  let h = '';
  for (const e of edges) {
    const a = webPos.get(e.a.id), b = webPos.get(e.b.id);
    const s2 = e.k === 'love' ? 'stroke="var(--love)" stroke-width="2.4"' : e.k === 'friend' ? 'stroke="rgba(239,230,214,.32)" stroke-width="1.2"' : 'stroke="var(--foe)" stroke-width="1.4" stroke-dasharray="4 3" opacity=".85"';
    h += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" ${s2}/>`;
  }
  for (const p of nodes) {
    const o = webPos.get(p.id), lead = leaders.has(p.id), sel = p.id === st.sel;
    const r = lead ? 7 : 5;
    h += `<circle data-pid="${p.id}" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${r}" fill="${personHex(p)}" stroke="${sel ? '#fff' : 'var(--panel-solid)'}" stroke-width="${sel ? 2.5 : 1.5}"><title>${esc(p.name)}${lead ? ', leader' : ''}</title></circle>`;
    if (showAll || lead || sel || W.spot.indexOf(p.id) >= 0) { const right = o.x > Wd * 0.62; h += `<text class="lbl" x="${(o.x + (right ? -r - 3 : r + 3)).toFixed(1)}" y="${(o.y + 3.5).toFixed(1)}"${right ? ' text-anchor="end"' : ''}>${esc(p.name)}</text>`; }
  }
  svg.setAttribute('viewBox', `0 0 ${Wd} ${Ht}`);
  svg.innerHTML = h;
  $('#webLegend').innerHTML = '<span><i class="ln" style="border-color:var(--love)"></i>Partners</span><span><i class="ln" style="border-color:rgba(239,230,214,.45)"></i>Close friends</span><span><i class="ln" style="border-color:var(--foe);border-top-style:dashed"></i>Enemies</span>' +
    W.groups.filter(g => !g.dead).map(g => `<span><span class="chip" style="background:${campHex(g)}"></span>${esc(g.name)}</span>`).join('');
}

/* ---------- panel: family trees ---------- */
let famRoot = 0, famFocus = 0, famSig = '';
function famAll() { const W = S.W, m = new Map(); for (const id in W.arch) m.set(+id, W.arch[id]); for (const p of W.people) m.set(p.id, p); return m; }
function founderOf(all, p) {
  let cur = p;
  for (let g = 0; g < 60 && cur; g++) {
    const up = [all.get(cur.mom), all.get(cur.dad)].filter(Boolean).sort((a, b) => a.gen - b.gen)[0];
    if (!up) return cur;
    cur = up;
  }
  return cur;
}
function descendants(all, p) {
  const seen = new Set([p.id]), q = [p];
  let alive = 0, gens = p.gen;
  while (q.length) { const c = q.pop(); for (const k of c.kids || []) { if (seen.has(k)) continue; seen.add(k); const o = all.get(k); if (!o) continue; if (S.getP(k)) alive++; gens = Math.max(gens, o.gen); q.push(o); } }
  return { n: seen.size - 1, alive, gens: gens - p.gen + 1 };
}
export function showFamilyOf(id) {
  const all = famAll(), p = all.get(id);
  if (!p) return;
  famRoot = founderOf(all, p).id; famFocus = id;
  closeInspector();
  showTab('family');
}
function renderFamily() {
  const all = famAll(), W = S.W;
  const founders = [...all.values()].filter(p => p.gen === 1).sort((a, b) => a.id - b.id);
  const stats = new Map(founders.map(f => [f.id, descendants(all, f)]));
  if (!famRoot || !all.get(famRoot)) famRoot = founders.slice().sort((a, b) => stats.get(b.id).alive - stats.get(a.id).alive || stats.get(b.id).n - stats.get(a.id).n)[0]?.id || 0;
  const root = all.get(famRoot);
  let h = '<div class="famh"><label class="small muted" for="famSel">Family line of</label><select id="famSel">' + founders.map(f => { const d = stats.get(f.id); return `<option value="${f.id}"${f.id === famRoot ? ' selected' : ''}>${esc(f.name)}${S.getP(f.id) ? '' : ' (dead)'} · ${d.alive} living</option>`; }).join('') + '</select></div>';
  if (!root) { h += '<p class="note">No family lines yet.</p>'; if (h !== famSig) { famSig = h; $('#pane-family').innerHTML = h; } return; }
  // a tidy tree of descendants: leaves side by side, parents centered over their children
  const nodes = [];
  const seen = new Set([root.id]);
  const build = (p, depth) => {
    const n = { p, depth, kids: [] };
    nodes.push(n);
    if (nodes.length < 320) for (const k of p.kids || []) { const c = all.get(k); if (!c || seen.has(k)) continue; seen.add(k); n.kids.push(build(c, depth + 1)); }
    return n;
  };
  const tree = build(root, 0);
  let leaf = 0, maxD = 0;
  const place = n => { maxD = Math.max(maxD, n.depth); if (!n.kids.length) n.x = leaf++; else { n.kids.forEach(place); n.x = (n.kids[0].x + n.kids[n.kids.length - 1].x) / 2; } };
  place(tree);
  const DX = 74, DY = 78, PAD = 40;
  const Wd = Math.max(340, leaf * DX + PAD), Ht = (maxD + 1) * DY + 30;
  const X = n => PAD / 2 + n.x * DX + DX / 2 - (leaf * DX + PAD < 340 ? -(340 - leaf * DX - PAD) / 2 : 0), Y = n => 26 + n.depth * DY;
  let svg = '';
  for (const n of nodes) for (const c of n.kids) { const x1 = X(n), y1 = Y(n), x2 = X(c), y2 = Y(c), ym = (y1 + y2) / 2; svg += `<path d="M${x1} ${y1 + 9}V${ym}H${x2}V${y2 - 9}" fill="none" stroke="var(--line-2)" stroke-width="1.4"/>`; }
  for (const n of nodes) {
    const p = n.p, alive = !!S.getP(p.id), x = X(n), y = Y(n), foc = p.id === famFocus || p.id === st.sel;
    const col = alive ? personHex(p) : '#55524c';
    const partner = p.partner && all.get(p.partner);
    const sub = alive ? `${Math.floor(S.ageY(p))}` : `died day ${Math.floor((p.died || W.t) / 24) + 1}`;
    svg += `<g class="fnode${alive ? '' : ' dead'}" data-pid="${p.id}"><circle cx="${x}" cy="${y}" r="${foc ? 9 : 7}" fill="${col}" stroke="${foc ? '#fff' : 'var(--panel-solid)'}" stroke-width="${foc ? 2.5 : 1.5}"/>` +
      `<text class="fn" x="${x}" y="${y + 22}" text-anchor="middle">${esc(p.name)}</text><text class="fs" x="${x}" y="${y + 34}" text-anchor="middle">${esc(sub)}</text>` +
      (partner ? `<text class="fs" x="${x}" y="${y + 45}" text-anchor="middle">with ${esc(partner.name)}</text>` : '') + `<title>${esc(p.name)}${alive ? '' : ' (dead: ' + esc(p.cause || 'unknown') + ')'}</title></g>`;
  }
  const d = stats.get(root.id) || descendants(all, root);
  h += `<p class="note small" style="margin:6px 0 8px">${esc(root.name)}${root.prof ? ', once a ' + esc(S.PROFS[root.prof].n) : ''}: ${d.n} ${d.n === 1 ? 'descendant' : 'descendants'} over ${d.gens} ${d.gens === 1 ? 'generation' : 'generations'}, ${d.alive} alive. Tap anyone to open them.</p>`;
  h += `<div class="famwrap"><svg id="famSvg" width="${Wd}" height="${Ht}" viewBox="0 0 ${Wd} ${Ht}">${svg}</svg></div>`;
  if (h !== famSig) {
    const wrap = $('#pane-family .famwrap'), sx = wrap ? wrap.scrollLeft : null;
    famSig = h; $('#pane-family').innerHTML = h;
    const nw = $('#pane-family .famwrap');
    if (sx != null) nw.scrollLeft = sx;
    else { const f = nodes.find(n => n.p.id === famFocus) || tree; nw.scrollLeft = Math.max(0, X(f) - nw.clientWidth / 2); }
  }
}

/* ---------- panel: story ---------- */
let storySig = '';
function quoteHTML(c) {
  const p = S.getP(c.id);
  const hex = p ? personHex(p) : NO_CAMP;
  return `<div class="quote"><span class="bar" style="background:${hex}"></span><div><div class="who">${p ? `<button data-pid="${c.id}">${esc(c.name)}</button>` : esc(c.name) + ' <span class="muted">(dead)</span>'} <span class="muted small qmeta">· ${c.kind === 'conf' ? 'confessional' : c.kind === 'plan' ? 'plan' : 'decision'} · ${S.stamp(c.t)}${c.ai ? ' · Claude' : ''}</span></div><div class="txt">${esc(c.text)}</div>${c.choice ? `<div class="ch">Chose: ${esc(c.choice)}</div>` : ''}</div></div>`;
}
function renderStory() {
  const W = S.W;
  const eps = W.episodes.slice().reverse();
  let h = '<h3>Episodes</h3>';
  if (!eps.length) h += `<p class="note">The first episode recap airs on day ${Math.floor(W.nextEp / 24) + 1}.</p>`;
  eps.forEach((ep, i) => {
    if (i === 0) h += `<div class="ep latest"><div class="ep-k">Episode ${ep.n} · ${S.stamp(ep.t0 || 0)} to ${S.stamp(ep.t)}${ep.ai ? ' · Narrated by Claude' : ''}</div><div class="ep-t">${esc(ep.title)}</div><p>${esc(ep.text)}</p></div>`;
    else if (i < 12) h += `<details class="ep"><summary><div class="ep-k">Episode ${ep.n} · ${S.stamp(ep.t)}</div><div class="ep-t">${esc(ep.title)}</div></summary><p>${esc(ep.text)}</p></details>`;
  });
  const qs = W.confs.slice(-16).reverse();
  h += '<h3>Confessionals and decisions</h3>';
  h += qs.length ? qs.map(quoteHTML).join('') : '<p class="note">Nobody has talked to the camera yet.</p>';
  const evs = W.events.filter(e => e.w >= 2 && e.k !== 'culture').slice(-50).reverse();
  h += '<h3>What happened</h3><div class="log">' + evs.map(e => `<span class="d">${S.stamp(e.t)}</span><span class="s${e.w >= 3 ? ' big' : ''}">${esc(e.s)}</span>`).join('') + '</div>';
  if (W.seasons && W.seasons.length) {
    h += '<h3>Past seasons</h3><div class="seasons">' + W.seasons.slice().reverse().map(s => `<div class="season"><b>Season ${s.season}</b> · ${s.years} years · ${s.gens} generations · ${s.born} born · ${s.murders} murders${s.notes && s.notes.length ? '<br>' + esc(s.notes.slice(-2).join(' ')) : ''}${st.mode === 'live' ? `<br><button class="lk" data-season="${s.season}" style="margin-top:6px">Read its episodes</button><div id="past-${s.season}"></div>` : ''}</div>`).join('') + '</div>';
  }
  if (h !== storySig) { storySig = h; const el = $('#pane-story'), y = el.scrollTop; el.innerHTML = h; el.scrollTop = y; }
}
async function loadSeason(n) {
  const box = $('#past-' + n);
  if (!box) return;
  box.innerHTML = '<p class="note">Loading...</p>';
  try {
    const d = await (await fetch(`/api/state?w=${encodeURIComponent(st.wid)}&season=${n}`)).json();
    box.innerHTML = (d.episodes || []).slice().reverse().map(ep => `<details class="ep" style="margin-top:8px"><summary><div class="ep-k">Episode ${ep.n}</div><div class="ep-t">${esc(ep.title)}</div></summary><p>${esc(ep.text)}</p></details>`).join('') || '<p class="note">No episodes were saved for this season.</p>';
  } catch (e) { box.innerHTML = '<p class="note">That season could not be loaded.</p>'; }
}

/* ---------- panel: stats ---------- */
let statsSig = '';
const SERIES = ['#3987e5', '#d95926', '#199e70'];
function niceMax(v) { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); const f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; }
function lineChart(series, o) {
  const Wd = 352, Ht = o.h || 132, Lm = 30, Rr = 70, Tm = 8, Bt = 18;
  const xs = series[0].pts.map(p => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(x0 + 1, ...xs);
  let y0 = o.min != null ? o.min : 0, y1 = o.max != null ? o.max : niceMax(Math.max(...series.flatMap(s => s.pts.map(p => p[1]))) * 1.05);
  if (o.min == null && Math.min(...series.flatMap(s => s.pts.map(p => p[1]))) < 0) { const m = niceMax(Math.max(...series.flatMap(s => s.pts.map(p => Math.abs(p[1]))))); y0 = -m; y1 = m; }
  const X = x => Lm + (x - x0) / (x1 - x0) * (Wd - Lm - Rr), Y = y => Tm + (1 - (y - y0) / (y1 - y0 || 1)) * (Ht - Tm - Bt);
  let h = `<svg viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${esc(o.label)}">`;
  for (let i = 0; i <= 2; i++) { const v = y0 + (y1 - y0) * i / 2; h += `<line class="grid" x1="${Lm}" x2="${Wd - Rr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${Lm - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${o.fmt ? o.fmt(v) : Math.round(v)}</text>`; }
  h += `<text class="ax" x="${Lm}" y="${Ht - 4}">Day ${x0 + 1}</text><text class="ax" x="${Wd - Rr}" y="${Ht - 4}" text-anchor="end">Day ${x1 + 1}</text>`;
  const lastY = [];
  series.forEach(s => {
    const d = s.pts.map((p, j) => (j ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
    h += `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = s.pts[s.pts.length - 1];
    let ly = Y(last[1]) + 4;
    while (lastY.some(v => Math.abs(v - ly) < 12)) ly += 12;
    lastY.push(ly);
    h += `<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3" fill="${s.c}"/><text class="dl" x="${(X(last[0]) + 7).toFixed(1)}" y="${ly.toFixed(1)}" fill="${s.c}">${esc(s.name)} ${o.fmt ? o.fmt(last[1]) : last[1]}</text>`;
  });
  return h + '</svg>';
}
function renderStats() {
  const W = S.W, s = W.stats;
  const gen = W.people.reduce((m, p) => Math.max(m, p.gen), 1);
  const tiles = [['Alive', W.people.length], ['Generations', gen], ['Camps', W.groups.filter(g => !g.dead).length], ['Born', s.births], ['Died', s.deaths], ['Murders', s.murders], ['Fights', s.fights], ['Thefts', s.thefts], ['Exiles', s.exiles], ['Splits', s.splits], ['Crossings', s.voyages], ['Affairs', s.affairs]];
  let h = '<div class="tiles">' + tiles.map(t => `<div class="tile"><div class="v">${t[1]}</div><div class="k">${t[0]}</div></div>`).join('') + '</div>';
  const D = (W.daily || []).slice();
  if (D.length >= 2) {
    h += '<h3>Population</h3><div class="chart">' + lineChart([{ name: 'All', c: SERIES[0], pts: D.map(d => [d.d, d.pop]) }, { name: 'Far isl.', c: SERIES[1], pts: D.map(d => [d.d, d.far]) }, { name: 'High isl.', c: SERIES[2], pts: D.map(d => [d.d, d.third || 0]) }], { label: 'Population by day' }) + '</div>';
    h += '<h3>Trust</h3><div class="chart">' + lineChart([{ name: 'Avg', c: SERIES[0], pts: D.map(d => [d.d, d.trust]) }], { label: 'Average trust between adults', h: 110, fmt: v => (v > 0 ? '+' : '') + Math.round(v) }) + '</div><div class="chart-cap">How much the adults trust each other on average, from -100 to +100.</div>';
    h += '<h3>Inequality</h3><div class="chart">' + lineChart([{ name: 'Gini', c: SERIES[0], pts: D.map(d => [d.d, d.gini]) }], { label: 'Inequality of food and belongings', h: 110, min: 0, max: 1, fmt: v => v.toFixed(2) }) + '</div><div class="chart-cap">0 means everyone has the same food and belongings; 1 means one person has everything.</div>';
    if (D.some(d => d.sick)) h += '<h3>Sickness</h3><div class="chart">' + lineChart([{ name: 'Sick', c: SERIES[1], pts: D.map(d => [d.d, d.sick || 0]) }], { label: 'People with fever', h: 100 }) + '</div>';
  } else h += '<p class="note" style="margin-top:14px">Charts fill in as the days go by.</p>';
  const camps = W.groups.filter(g => !g.dead).map(g => ({ g, n: S.members(g).length })).sort((a, b) => b.n - a.n);
  if (camps.length) {
    const mx = Math.max(...camps.map(c => c.n));
    h += '<h3>Camp sizes</h3><div class="bars">' + camps.map(c => `<div class="brow"><span class="bn">${esc(c.g.name)}</span><span class="bt" style="width:${Math.max(3, c.n / mx * 100)}%;background:${campHex(c.g)}"></span><span class="bv">${c.n}</span></div>`).join('') + '</div>';
  }
  const tech = Object.entries(W.techs || {});
  if (tech.length) h += '<h3>What they know</h3><div class="ms">' + tech.sort((a, b) => a[1].t - b[1].t).map(([k, v]) => `<span class="d">${S.stamp(v.t)}</span><span>${esc(S.TECH[k] ? S.TECH[k].n : k)}${v.lost ? ' <span class="badge out">Lost</span>' : ''} <span class="muted">· ${esc(S.nameOf(v.by))}</span></span>`).join('') + '</div>';
  const ms = Object.values(W.milestones).sort((a, b) => a.t - b.t);
  if (ms.length) h += '<h3>Firsts</h3><div class="ms">' + ms.map(m => `<span class="d">${S.stamp(m.t)}</span><span>${esc(m.s)}</span>`).join('') + '</div>';
  h += `<p class="note" style="margin-top:16px">One day on the island is twenty minutes of real time; a year is sixteen days. ${st.mode === 'sandbox' ? 'This is your sandbox: it runs only in this tab and built-in rules make every choice.' : st.aiInfo.on ? 'Claude is voicing the spotlight cast right now.' : 'Claude is not connected right now, so built-in rules make every choice and write the recaps.'}</p>`;
  if (h !== statsSig) { statsSig = h; $('#pane-stats').innerHTML = h; }
}

/* ---------- inspector ---------- */
let inspSig = '';
function meter(k, v) { const f = clamp(v, 0, 100); return `<div class="meter${f < 25 ? ' low' : ''}"><div class="k"><span>${k}</span><span>${Math.round(f)}</span></div><div class="t"><div class="f" style="width:${f}%"></div></div></div>`; }
function linkBtn(id, label) { const p = S.getP(id); const a = !p && S.W.arch[id]; if (!p && !a) return ''; return `<button class="lk${p ? '' : ' dead'}" data-pid="${id}">${esc(label || (p || a).name)}</button>`; }
function famLinks(p) {
  const fam = [];
  if (p.partner) fam.push(['Partner', [p.partner]]);
  if (p.mom || p.dad) fam.push(['Parents', [p.mom, p.dad].filter(Boolean)]);
  if (p.kids && p.kids.length) fam.push(['Children', p.kids]);
  if (!fam.length) return '';
  return '<h3>Family</h3>' + fam.map(([k, ids]) => `<div class="famrow"><span class="muted small">${k}</span><div class="links">${ids.map(id => linkBtn(id)).join('')}</div></div>`).join('') + `<button class="lk" data-act="tree" style="margin-top:4px">Show the family tree</button>`;
}
function renderInspector() {
  const box = $('#inspector');
  const p = st.sel && S.getP(st.sel);
  if (!p) {
    const a = st.sel && S.W.arch[st.sel];
    if (a) {
      const age = Math.floor((a.died - a.born) / S.HPY);
      const h = `<div class="insp-h"><button class="back" data-act="close" aria-label="Back">&larr;</button><div><div class="insp-name">${esc(a.name)}</div><div class="insp-sub">${a.sex === 'M' ? 'Man' : 'Woman'}, died at ${age} on ${S.stamp(a.died)}</div><div class="insp-sub">Cause: ${esc(a.cause || 'unknown')}${a.killer ? ', killed by ' + esc(S.nameOf(a.killer)) : ''}</div></div></div><div class="pane">${a.prof ? `<p class="note">Before the wreck: ${esc(S.PROFS[a.prof].n)}</p>` : `<p class="note">Born on the island, generation ${a.gen}</p>`}${famLinks(a)}</div>`;
      if (h !== inspSig) { inspSig = h; box.innerHTML = h; }
    } else closeInspector();
    return;
  }
  const W = S.W, a = S.ageY(p);
  const origin = p.prof ? `Before the wreck: ${S.PROFS[p.prof].n}` : `Born on the island, generation ${p.gen}`;
  const ai = st.aiInfo.on && W.spot.indexOf(p.id) >= 0;
  let h = `<div class="insp-h"><button class="back" data-act="close" aria-label="Back">&larr;</button><div style="min-width:0"><div class="insp-name">${esc(p.name)}</div><div class="insp-sub"><span class="chip" style="display:inline-block;background:${personHex(p)};border-radius:50%;width:8px;height:8px;margin-right:5px"></span>${p.sex === 'M' ? 'Man' : 'Woman'}, ${Math.floor(a)} · ${esc(S.roleLabel(p))}</div><div class="insp-sub">${esc(origin)}${ai ? ' <span class="badge ai">Claude</span>' : ''}${p.ill > 0 ? ' <span class="badge sick">Fever</span>' : ''}</div><div class="insp-act">${esc(S.actLabel(p))}</div></div><div class="insp-btns"><button class="follow" data-act="follow" aria-pressed="${st.follow ? 'true' : 'false'}">Follow</button><button class="follow" data-act="goto">Go to</button></div></div><div class="pane">`;
  h += `<div class="meters">${meter('Fed', p.hun)}${meter('Rested', p.en)}${meter('Company', p.soc)}${meter('Health', p.hp)}</div>`;
  if (p.goal && S.goalLabel) h += `<h3>Trying to</h3><p class="note" style="margin:0;color:var(--text)">${esc(S.goalLabel(p.goal))}</p>`;
  h += '<h3>Personality</h3><div class="traits">' + S.TRAITS.map(([k, n]) => `<div class="trait"><span>${n}</span><span class="t"><i style="left:${(p.p[k] * 100).toFixed(0)}%"></i></span></div>`).join('') + `</div><p class="note small" style="margin:6px 0 0">${esc(S.traitWords(p.p))}</p>`;
  h += famLinks(p);
  const rels = S.topRelations(p, 9);
  if (rels.length) h += '<h3>People</h3><div class="rels">' + rels.map(x => { const v = x.r[0]; const w = Math.abs(v) / 2; return `<button class="rel" data-pid="${x.o.id}"><span class="chip" style="background:${personHex(x.o)};border-radius:50%"></span><span class="rn">${esc(x.o.name)}</span><span class="sw"><i style="left:${v < 0 ? 50 - w : 50}%;width:${w}%;background:${v < 0 ? 'var(--foe)' : 'var(--love)'}"></i></span><span class="rw">${esc(S.relWords(x.r))}</span></button>`; }).join('') + '</div>';
  if (p.secrets.length) h += '<h3>Secrets</h3>' + p.secrets.slice(-4).map(s => `<div class="secret">${esc(s.s)}</div>`).join('');
  const items = S.itemsOf(p);
  if (items.length) h += `<h3>Owns</h3><p class="note" style="margin:0">${items.map(i => esc(S.ITEMS[i.k].n)).join(', ')}</p>`;
  if (p.know.length) h += `<h3>Knows</h3><p class="note" style="margin:0">${p.know.map(k => esc(S.TECH[k] ? S.TECH[k].n : k)).join(', ')}</p>`;
  const cf = W.confs.filter(c => c.id === p.id).slice(-3).reverse();
  if (cf.length) h += '<h3>In their words</h3>' + cf.map(quoteHTML).join('');
  if (p.mem.length) h += '<h3>Lately</h3>' + p.mem.slice(-8).reverse().map(m => `<div class="mem">${esc(m.s)}</div>`).join('');
  if (p.life.length) h += '<h3>Life so far</h3>' + p.life.slice(-10).map(m => `<div class="mem">${esc(m.s)}</div>`).join('');
  h += '</div>';
  if (h !== inspSig) { const pane = box.querySelector('.pane'), y = pane ? pane.scrollTop : 0; inspSig = h; box.innerHTML = h; const np = box.querySelector('.pane'); if (np && box.dataset.pid === String(p.id)) np.scrollTop = y; box.dataset.pid = p.id; }
}
export function select(id, fly) {
  st.sel = id;
  inspSig = '';
  $('#inspector').hidden = !id;
  if (!id) return;
  setDirector(false);
  st.follow = !!S.getP(id);
  renderInspector();
  const r = RL.get(id);
  if (fly !== false && r) flyTo(r.x, r.z, 9, r.gy);
  if (window.innerWidth < 760 && st.sheetMin) toggleSheet(false);
}
export function closeInspector() { st.sel = 0; st.follow = false; $('#inspector').hidden = true; inspSig = ''; }

/* ---------- in-world labels: speech bubbles and name tags ---------- */
const bubPool = [], tagPool = [];
export function updateLabels() {
  const host = $('#labels'), W = S.W, cam = T.camera.position;
  let used = 0;
  const near = [];
  for (const r of renderList) { const d = Math.hypot(r.x - cam.x, r.y - cam.y, r.z - cam.z); if (d < 110) near.push([d, r]); }
  near.sort((a, b) => a[0] - b[0]);
  const talking = new Set();
  if (st.opts.bubbles) for (const [, r] of near) {
    if (used >= 8) break;
    const p = r.p;
    const think = p.act && p.act.k === 'ponder';
    if (!think && (!p.say || p.say.until < W.t)) continue;
    const s = project(r.x, r.y + 0.1 * r.size, r.z);
    if (!s) continue;
    let b = bubPool[used];
    if (!b) { b = document.createElement('div'); b.className = 'bub'; b.innerHTML = '<b></b><i></i>'; host.appendChild(b); bubPool.push(b); }
    const w = think ? 'Thinking it over...' : p.say.w, g = think ? '' : (p.say.g || '');
    if (b._w !== w) { b._w = w; b.firstChild.textContent = w; b.lastChild.textContent = g; b.classList.toggle('think', think); }
    b.style.transform = `translate(${s.x | 0}px, ${(s.y - 6) | 0}px) translate(-50%, -100%)`;
    b.hidden = false;
    talking.add(p.id);
    used++;
  }
  for (let i = used; i < bubPool.length; i++) bubPool[i].hidden = true;
  const ids = [];
  const sh = st.director && st.shot;
  if (st.sel) ids.push(st.sel);
  if (st.hover && st.hover !== st.sel) ids.push(st.hover);
  if (sh && sh.id && ids.indexOf(sh.id) < 0) ids.push(sh.id);
  if (sh && sh.id2 && ids.indexOf(sh.id2) < 0) ids.push(sh.id2);
  if (st.opts.names) for (const [d, r] of near) { if (ids.length >= 10 || d > 36) break; if (ids.indexOf(r.p.id) < 0) ids.push(r.p.id); }
  let nt = 0;
  const placed = [];
  for (const id of ids) {
    const r = RL.get(id);
    if (!r || r.hidden) continue;
    const s = project(r.x, r.y + 0.08 * r.size, r.z);
    if (!s) continue;
    const ty = s.y - (talking.has(id) ? 44 : 4);
    if (placed.some(q => Math.abs(q[0] - s.x) < 58 && Math.abs(q[1] - ty) < 15)) continue;
    placed.push([s.x, ty]);
    let t = tagPool[nt];
    if (!t) { t = document.createElement('div'); t.className = 'tag'; t.innerHTML = '<span class="cdot"></span><span></span>'; host.appendChild(t); tagPool.push(t); }
    const hex = personHex(r.p);
    if (t._n !== r.p.name || t._c !== hex) { t._n = r.p.name; t._c = hex; t.lastChild.textContent = r.p.name; t.firstChild.style.background = hex; }
    t.classList.toggle('sel', id === st.sel);
    t.style.transform = `translate(${s.x | 0}px, ${ty | 0}px) translate(-50%, -100%)`;
    t.hidden = false;
    nt++;
  }
  for (let i = nt; i < tagPool.length; i++) tagPool[i].hidden = true;
}

/* ---------- minimap ---------- */
let mmBase = null, mmSize = 0;
export function buildMinimap() {
  const cv = $('#mmCanvas');
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), size = Math.round(190 * dpr);
  cv.width = cv.height = size; mmSize = size;
  const Hh = S.heights(), GV = S.GV, B = S.B;
  const off = document.createElement('canvas'); off.width = off.height = size;
  const x = off.getContext('2d'), img = x.createImageData(size, size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const wx = -B + (i + 0.5) / size * 2 * B, wz = -B + (j + 0.5) / size * 2 * B;
    const gi = clamp(Math.round((wx + B) / S.CELL), 0, GV - 1), gj = clamp(Math.round((wz + B) / S.CELL), 0, GV - 1);
    const h = Hh[gj * GV + gi];
    let r, g, b;
    if (h < -5) { r = 16; g = 44; b = 56; } else if (h < -0.6) { const k = (h + 5) / 4.4; r = 16 + 18 * k; g = 44 + 50 * k; b = 56 + 40 * k; }
    else if (h < 0.1) { r = 46; g = 128; b = 128; }
    else if (h < 0.9) { const v = S.islandAt(wx, wz) === 3; r = v ? 84 : 196; g = v ? 78 : 178; b = v ? 70 : 130; }
    else if (h < 8) { const f = S.forestAt(wx, wz); const k = clamp((f - 0.42) * 4, 0, 1); r = 104 - 44 * k; g = 128 - 34 * k; b = 64 - 24 * k; }
    else { const k = clamp((h - 8) / 6, 0, 1); r = 110 + 40 * k; g = 106 + 36 * k; b = 92 + 36 * k; }
    const o = (j * size + i) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  mmBase = off;
}
const toMM = v => (v + S.B) / (2 * S.B) * mmSize;
export function minimapTick() {
  const box = $('#minimap');
  const show = st.opts.minimap && window.innerWidth >= 760;
  box.hidden = !show;
  if (!show || !mmBase) return;
  const cv = $('#mmCanvas'), x = cv.getContext('2d'), W = S.W, k = mmSize / 190;
  x.drawImage(mmBase, 0, 0);
  for (const g of W.groups) {
    if (g.dead) continue;
    x.strokeStyle = campHex(g); x.lineWidth = 2 * k;
    x.beginPath(); x.arc(toMM(g.x), toMM(g.z), 5 * k, 0, Math.PI * 2); x.stroke();
  }
  for (const r of renderList) {
    x.fillStyle = personHex(r.p);
    x.fillRect(toMM(r.x) - 1.2 * k, toMM(r.z) - 1.2 * k, 2.4 * k, 2.4 * k);
  }
  x.fillStyle = '#efe6d6';
  for (const b of W.boats) if (b.sail) { x.beginPath(); x.arc(toMM(b.x), toMM(b.z), 2.6 * k, 0, Math.PI * 2); x.fill(); }
  const sr = st.sel && RL.get(st.sel);
  if (sr) { x.strokeStyle = '#fff'; x.lineWidth = 1.6 * k; x.beginPath(); x.arc(toMM(sr.x), toMM(sr.z), 4.5 * k, 0, Math.PI * 2); x.stroke(); }
  // where the camera is and which way it looks
  const c = T.camera.position, tg = T.controls.target;
  const ang = Math.atan2(tg.z - c.z, tg.x - c.x), half = Math.atan(Math.tan(T.camera.fov * Math.PI / 360) * T.camera.aspect);
  const len = clamp(c.distanceTo(tg) * 1.6, 12, 160) / (2 * S.B) * mmSize;
  x.fillStyle = 'rgba(239,230,214,0.16)'; x.strokeStyle = 'rgba(239,230,214,0.7)'; x.lineWidth = 1 * k;
  x.beginPath(); x.moveTo(toMM(c.x), toMM(c.z));
  x.lineTo(toMM(c.x) + Math.cos(ang - half) * len, toMM(c.z) + Math.sin(ang - half) * len);
  x.lineTo(toMM(c.x) + Math.cos(ang + half) * len, toMM(c.z) + Math.sin(ang + half) * len);
  x.closePath(); x.fill(); x.stroke();
}

/* ---------- go to ---------- */
function renderGoto() {
  const W = S.W;
  let h = '<div class="mh">Islands</div>';
  for (const isl of [1, 2, 3]) h += `<button class="mi" data-isle="${isl}"><span class="mi-n">The ${isleOf(isl)}</span><span class="mi-m">${S.popOf(isl)} people</span></button>`;
  h += '<button class="mi" data-go="wreck"><span class="mi-n">The wreck</span><span class="mi-m">where it started</span></button><button class="mi" data-go="wide"><span class="mi-n">Wide view</span><span class="mi-m">the whole archipelago</span></button>';
  const camps = W.groups.filter(g => !g.dead);
  if (camps.length) h += '<div class="mh">Camps</div>' + camps.map(g => `<button class="mi" data-camp="${g.id}"><span class="chip" style="background:${campHex(g)}"></span><span class="mi-n">${esc(g.name)}</span><span class="mi-m">${S.members(g).length}</span></button>`).join('');
  const lead = new Set(W.groups.filter(g => !g.dead && g.leader).map(g => g.leader));
  const people = W.people.filter(p => W.spot.indexOf(p.id) >= 0 || lead.has(p.id) || W.people.length <= 30).sort((a, b) => a.name.localeCompare(b.name));
  if (people.length) h += '<div class="mh">People</div>' + people.map(p => `<button class="mi" data-pid="${p.id}"><span class="chip" style="background:${personHex(p)};border-radius:50%"></span><span class="mi-n">${esc(p.name)}</span><span class="mi-m">${esc(S.actLabel(p))}</span></button>`).join('');
  h += '<div class="mh">Find someone</div><input id="gotoFind" type="search" placeholder="Type a name" autocomplete="off"><div id="gotoHits"></div>';
  $('#gotoMenu').innerHTML = h;
}
function gotoFind(q) {
  q = q.trim().toLowerCase();
  const hits = q ? S.W.people.filter(p => p.name.toLowerCase().startsWith(q)).slice(0, 8) : [];
  $('#gotoHits').innerHTML = hits.map(p => `<button class="mi" data-pid="${p.id}"><span class="chip" style="background:${personHex(p)};border-radius:50%"></span><span class="mi-n">${esc(p.name)}</span><span class="mi-m">${Math.floor(S.ageY(p))}</span></button>`).join('');
}

/* ---------- worlds, sandbox and owner tools ---------- */
async function fetchWorlds() {
  try { const r = await fetch('/api/worlds', { cache: 'no-store' }); if (!r.ok) throw new Error(); const o = await r.json(); st.worlds = o.worlds || []; }
  catch (e) { /* keep the last list */ }
  return st.worlds;
}
export { fetchWorlds };
async function admin(body) {
  const r = await fetch('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ key: st.owner }, body)) });
  let o = {};
  try { o = await r.json(); } catch (e) { o = { ok: false, error: 'No answer from the server.' }; }
  return o;
}
export async function checkOwner() {
  let key = '';
  const hp = new URLSearchParams(location.hash.slice(1)), m = hp.get('owner');
  if (m) {
    key = m;
    try { localStorage.setItem('twelve-owner', key); } catch (e) { /* storage blocked */ }
    hp.delete('owner');
    const rest = hp.toString();
    history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''));
  } else { try { key = localStorage.getItem('twelve-owner') || ''; } catch (e) { key = ''; } }
  st.owner = key; st.ownerOk = false;
  if (!key) return false;
  const o = await admin({ action: 'check' }).catch(() => ({ ok: false }));
  st.ownerOk = !!o.ok;
  if (!o.ok) { st.ownerErr = o.error || 'That owner key was not accepted.'; if (m) toast(st.ownerErr); }
  else if (m) toast('Owner tools are unlocked on this device.');
  return st.ownerOk;
}
let armed = '', armT = 0;
function worldLine(w) {
  const yr = Math.floor((w.t || 0) / S.HPY) + 1, day = Math.floor((w.t || 0) / 24) + 1;
  return `Season ${w.season || 1} · ${yr > 1 ? 'Year ' + yr : 'Day ' + day} · ${w.pop != null ? w.pop : '?'} alive · ${w.camps || 0} ${w.camps === 1 ? 'camp' : 'camps'}${w.ai ? ' · Claude' : ''}`;
}
function renderWorlds() {
  let h = '<div class="mh">Worlds</div>';
  if (!st.worlds.length) h += '<p class="note" style="padding:4px 12px">No live worlds reachable right now.</p>';
  for (const w of st.worlds) {
    const cur = st.mode === 'live' && w.id === st.wid;
    h += `<div class="wrow${cur ? ' cur' : ''}"><button class="mi" data-world="${esc(w.id)}"><span class="mi-n">${esc(w.name)}${cur ? ' <span class="badge">Watching</span>' : ''}</span><span class="mi-m">${esc(worldLine(w))}</span></button>`;
    if (st.ownerOk) h += `<div class="otools"><button class="lk" data-own="rename" data-w="${esc(w.id)}">Rename</button><button class="lk${armed === 'restart' + w.id ? ' warn' : ''}" data-own="restart" data-w="${esc(w.id)}">${armed === 'restart' + w.id ? 'Confirm restart' : 'Restart'}</button><button class="lk${armed === 'delete' + w.id ? ' warn' : ''}" data-own="delete" data-w="${esc(w.id)}">${armed === 'delete' + w.id ? 'Confirm delete' : 'Delete'}</button></div>`;
    h += '</div>';
  }
  h += `<div class="mh">Sandbox</div><button class="mi" data-sandbox="open"><span class="mi-n">${st.mode === 'sandbox' ? 'Sandbox <span class="badge">Watching</span>' : 'Open a sandbox'}</span><span class="mi-m">A private island that runs only in this tab. Speed it up or start over; nothing you do here touches the live worlds.</span></button>`;
  if (st.mode === 'sandbox') h += '<button class="mi" data-sandbox="new"><span class="mi-n">New sandbox island</span><span class="mi-m">Another wreck on a freshly drawn archipelago</span></button>';
  if (st.ownerOk) h += `<div class="mh">Owner</div><div class="owner"><input id="newWorldName" maxlength="28" placeholder="Name for a new world (optional)"><button class="cbtn sm" data-own="create">Create world</button><button class="lk" data-own="signout">Sign out of owner tools</button></div>`;
  else if (st.owner && st.ownerErr) h += `<p class="note" style="padding:6px 12px">${esc(st.ownerErr)} <button class="lk" data-own="signout">Forget key</button></p>`;
  // replace the list only when it changed, so a refresh never swallows a click that is under way
  const el = $('#worldMenu');
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
}
async function ownerAction(btn) {
  const act = btn.dataset.own, w = btn.dataset.w;
  if (act === 'signout') { try { localStorage.removeItem('twelve-owner'); } catch (e) { /* ignore */ } st.owner = ''; st.ownerOk = false; st.ownerErr = ''; renderWorlds(); toast('Owner tools are locked on this device.'); return; }
  if ((act === 'restart' || act === 'delete') && armed !== act + w) { armed = act + w; armT = performance.now(); renderWorlds(); return; }
  armed = '';
  let body = { action: act, w };
  if (act === 'rename') { const cur = st.worlds.find(x => x.id === w); const name = prompt('New name for this world', cur ? cur.name : ''); if (!name) return; body.name = name; }
  if (act === 'create') body = { action: 'create', name: ($('#newWorldName') || {}).value || '' };
  btn.disabled = true;
  const o = await admin(body).catch(() => ({ ok: false, error: 'No answer from the server.' }));
  btn.disabled = false;
  if (!o.ok) { toast(o.error || 'That did not work.'); return; }
  toast(act === 'create' ? `Created ${o.world.name}.` : act === 'restart' ? 'A new season has begun there.' : act === 'delete' ? 'World deleted.' : 'Renamed.');
  await fetchWorlds();
  if (act === 'create' || (act === 'delete' && w === st.wid)) closeMenus();
  if (act === 'create' && o.world) H.switchWorld(o.world.id);
  else if (act === 'restart' && w === st.wid && st.mode === 'live') H.switchWorld(w, true);
  else if (act === 'delete' && w === st.wid && st.mode === 'live' && st.worlds[0]) H.switchWorld(st.worlds[0].id);
  else if (act === 'rename' && w === st.wid) st.wname = (st.worlds.find(x => x.id === w) || {}).name || st.wname;
  renderWorlds();
}
let toastT = 0;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 4200);
}

/* ---------- while you were gone ---------- */
const seenKey = () => 'twelve-seen:' + st.wid;
export function saveSeen() {
  if (st.mode !== 'live' || !st.wid || !S.W) return;
  const W = S.W;
  try { localStorage.setItem(seenKey(), JSON.stringify({ t: W.t, evN: W.evN, epN: W.epN, season: W.season, pop: W.people.length, camps: W.groups.filter(g => !g.dead).length, stats: W.stats, real: Date.now() })); } catch (e) { /* storage blocked */ }
}
function ago(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}
export function maybeRecap() {
  if (st.mode !== 'live') return false;
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(seenKey()) || 'null'); } catch (e) { prev = null; }
  if (!prev) return false;
  const W = S.W;
  const away = Date.now() - (prev.real || Date.now());
  if (prev.season === W.season && W.t - prev.t < 3) return false;
  let h = '', speech = '';
  if (prev.season !== W.season) {
    h += `<p>The season you were watching has ended. Season ${W.season} began with a new wreck and twelve new strangers.</p>`;
    speech = `While you were gone, the season ended. Season ${W.season} has begun.`;
  } else {
    const days = (W.t - prev.t) / 24, s0 = prev.stats || {}, s1 = W.stats;
    const d = k => Math.max(0, (s1[k] || 0) - (s0[k] || 0));
    const facts = [[d('births'), 'born', 'born'], [d('deaths'), 'died', 'died'], [d('murders'), 'murder', 'murders'], [d('fights'), 'fight', 'fights'], [d('thefts'), 'theft', 'thefts'], [d('exiles'), 'exile', 'exiles'], [d('voyages'), 'crossing', 'crossings'], [d('splits'), 'camp split', 'camp splits']].filter(f => f[0] > 0);
    h += `<p class="rc-lead">You were away ${ago(away)}. On the island, ${days < 1.5 ? Math.round(days * 24) + ' hours' : Math.round(days) + ' days'} went by.</p>`;
    h += `<div class="tiles">${[['Alive now', W.people.length, W.people.length - (prev.pop || 0)], ['Camps', W.groups.filter(g => !g.dead).length, W.groups.filter(g => !g.dead).length - (prev.camps || 0)]].map(t => `<div class="tile"><div class="v">${t[1]}</div><div class="k">${t[0]}${t[2] ? ` (${t[2] > 0 ? '+' : ''}${t[2]})` : ''}</div></div>`).join('')}${facts.slice(0, 4).map(f => `<div class="tile"><div class="v">${f[0]}</div><div class="k">${f[0] === 1 ? f[1] : f[2]}</div></div>`).join('')}</div>`;
    const evs = W.events.filter(e => e.n > (prev.evN || 0) && e.w >= 3 && e.k !== 'culture');
    const top = (evs.length ? evs : W.events.filter(e => e.n > (prev.evN || 0) && e.w >= 2 && e.k !== 'culture')).slice(-7);
    if (top.length) h += '<h3>The big moments</h3><div class="log">' + top.map(e => `<span class="d">${S.stamp(e.t)}</span><span class="s big">${esc(e.s)}</span>`).join('') + '</div>';
    const eps = W.episodes.filter(e => e.n > (prev.epN || 0));
    if (eps.length) h += '<h3>Episodes you missed</h3>' + eps.slice(-4).reverse().map(ep => `<details class="ep"><summary><div class="ep-k">Episode ${ep.n} · ${S.stamp(ep.t)}</div><div class="ep-t">${esc(ep.title)}</div></summary><p>${esc(ep.text)}</p></details>`).join('');
    if (!top.length && !eps.length) h += '<p class="note">Quiet days. They fished, they slept, they watched each other.</p>';
    speech = `While you were gone, ${Math.round(days)} days passed on the island. ` + top.slice(-3).map(e => e.s).join(' ');
  }
  $('#recapBody').innerHTML = h;
  $('#recap').hidden = false;
  if (st.opts.narrator && st.opts.sound) narrate({ type: 'recap', speech });
  return true;
}

/* ---------- settings ---------- */
function renderSettings() {
  const o = st.opts;
  const tog = (k, label, note) => `<div class="srow"><div><div class="sl">${label}</div>${note ? `<div class="sn">${note}</div>` : ''}</div><button class="tgl" data-opt="${k}" aria-pressed="${o[k] ? 'true' : 'false'}"><span></span></button></div>`;
  const vs = voices();
  let h = `<div class="srow"><div><div class="sl">Graphics</div><div class="sn">Now ${esc(T.qname || 'auto')}. A change applies when the page reloads.</div></div><select id="optQuality">${['', 'low', 'medium', 'high', 'ultra'].map(q => `<option value="${q}"${o.quality === q ? ' selected' : ''}>${q ? q[0].toUpperCase() + q.slice(1) : 'Automatic'}</option>`).join('')}</select></div>`;
  h += tog('sound', 'Sound', 'Surf, wind, rain, fire and birds, all made in your browser.');
  h += `<div class="srow"><div><div class="sl">Volume</div></div><input id="optVolume" type="range" min="0" max="1" step="0.05" value="${o.volume}"></div>`;
  h += canSpeak() ? tog('narrator', 'Narrator', 'Reads episode recaps and confessionals aloud. Needs sound on.') : '<div class="srow"><div><div class="sl">Narrator</div><div class="sn">This browser cannot speak.</div></div></div>';
  if (canSpeak() && vs.length) h += `<div class="srow"><div><div class="sl">Narrator voice</div></div><select id="optVoice"><option value="">Default</option>${vs.map(v => `<option value="${esc(v.name)}"${o.voice === v.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>`;
  h += tog('names', 'Names over heads', 'Show who is who near the camera.');
  h += tog('bubbles', 'Speech bubbles', 'What people say to each other.');
  h += tog('minimap', 'Minimap', 'Click the map to fly there.');
  h += tog('director', 'Start with the director', 'Let the auto director pick shots when the page opens.');
  h += `<h3>Controls</h3><div class="keys"><span><kbd>Drag</kbd> look around</span><span><kbd>Right drag</kbd> pan</span><span><kbd>Scroll</kbd> zoom toward the pointer</span><span><kbd>W A S D</kbd> move</span><span><kbd>Q E</kbd> turn</span><span><kbd>R F</kbd> closer, farther</span><span><kbd>Shift</kbd> faster</span><span><kbd>Double-click</kbd> focus</span><span><kbd>C</kbd> director on or off</span><span><kbd>G</kbd> go to</span><span><kbd>Esc</kbd> close</span></div>`;
  h += `<h3>Owner</h3><p class="note">${st.ownerOk ? 'Owner tools are unlocked on this device. They are in the world menu.' : 'If you run this site, open your owner link once on this device to unlock world tools in the world menu.'}</p>`;
  $('#settingsBody').innerHTML = h;
}

/* ---------- menus ---------- */
function openMenu(id) {
  for (const m of ['#worldMenu', '#gotoMenu']) if (m !== id) $(m).hidden = true;
  const el = $(id), open = el.hidden;
  el.hidden = !open;
  if (open && id === '#gotoMenu') renderGoto();
  if (open && id === '#worldMenu') { renderWorlds(); fetchWorlds().then(() => { if (!el.hidden) renderWorlds(); }); }
}
function closeMenus() { $('#worldMenu').hidden = true; $('#gotoMenu').hidden = true; }
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

/* ---------- wiring ---------- */
export function showTab(t) {
  st.tab = t;
  $$('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
  ['cast', 'web', 'family', 'story', 'stats'].forEach(k => { $('#pane-' + k).hidden = k !== t; });
  castSig = storySig = statsSig = famSig = ''; webSig = '';
  panelTick(true);
}
function toggleSheet(min) {
  st.sheetMin = min == null ? !st.sheetMin : min;
  document.body.classList.toggle('sheet-min', st.sheetMin);
}
let webT = 0;
export function panelTick(force) {
  if (!S.W) return;
  if (!$('#inspector').hidden) { renderInspector(); return; }
  if (st.tab === 'cast') renderCast();
  else if (st.tab === 'story') renderStory();
  else if (st.tab === 'stats') renderStats();
  else if (st.tab === 'family') { if (force || !document.activeElement || document.activeElement.id !== 'famSel') renderFamily(); }
  else if (st.tab === 'web') { const now = performance.now(); if (force || now - webT > 2000) { webT = now; renderWeb(); } }
}
export function resetPanels() { castSig = storySig = statsSig = famSig = ''; webSig = ''; webPos.clear(); famRoot = 0; famFocus = 0; closeInspector(); panelTick(true); }
export function initUI(handlers) {
  H = handlers;
  onDirectorChange(on => { $('#btnDirector').setAttribute('aria-pressed', on ? 'true' : 'false'); if (!on) $('#letterbox').classList.remove('on'); });
  $$('.tab').forEach(b => b.addEventListener('click', () => { if (!$('#inspector').hidden) closeInspector(); showTab(b.dataset.tab); }));
  $('#panel').addEventListener('click', e => {
    const s = e.target.closest('[data-season]');
    if (s) { loadSeason(+s.dataset.season); s.remove(); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'close') { closeInspector(); panelTick(true); return; }
      if (a === 'follow') { st.follow = !st.follow; if (st.follow) setDirector(false); act.setAttribute('aria-pressed', st.follow ? 'true' : 'false'); return; }
      if (a === 'goto') { const r = RL.get(st.sel); if (r) { setDirector(false); flyTo(r.x, r.z, 7, r.gy); } return; }
      if (a === 'tree') { showFamilyOf(st.sel); return; }
    }
    const b = e.target.closest('[data-pid]');
    if (b) { famFocus = +b.dataset.pid; select(+b.dataset.pid); }
  });
  $('#panel').addEventListener('change', e => { if (e.target.id === 'famSel') { famRoot = +e.target.value; famFocus = 0; famSig = ''; renderFamily(); } });
  $('#web').addEventListener('click', e => { const c = e.target.closest('[data-pid]'); if (c) select(+c.dataset.pid); });
  $('#btnDirector').addEventListener('click', () => { setDirector(!st.director); if (st.director) closeInspector(); });
  $('#btnWide').addEventListener('click', () => { setDirector(false); st.follow = false; frameWide(false); });
  $('#btnGoto').addEventListener('click', e => { e.stopPropagation(); openMenu('#gotoMenu'); });
  $('#worldBtn').addEventListener('click', e => { e.stopPropagation(); openMenu('#worldMenu'); });
  $('#btnSound').addEventListener('click', () => { setSound(!st.opts.sound); saveOpts(); hudTick(performance.now() / 1000); });
  $('#btnSettings').addEventListener('click', () => { renderSettings(); openModal('#settings'); });
  $('#gotoMenu').addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.isle) frameIsland(+b.dataset.isle);
    else if (b.dataset.go === 'wide') { setDirector(false); st.follow = false; frameWide(false); }
    else if (b.dataset.go === 'wreck') { const w = S.W.wreck; setDirector(false); st.follow = false; flyTo(w.x, w.z, 30); }
    else if (b.dataset.camp) { const g = S.groupById(+b.dataset.camp); if (g) { setDirector(false); st.follow = false; flyTo(g.x, g.z, 22); } }
    else if (b.dataset.pid) { select(+b.dataset.pid, false); focusPerson(+b.dataset.pid); }
    else return;
    closeMenus();
  });
  $('#gotoMenu').addEventListener('input', e => { if (e.target.id === 'gotoFind') gotoFind(e.target.value); });
  $('#worldMenu').addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.own) { ownerAction(b); return; }
    if (b.dataset.world) { closeMenus(); if (st.mode !== 'live' || b.dataset.world !== st.wid) H.switchWorld(b.dataset.world); return; }
    if (b.dataset.sandbox === 'open') { closeMenus(); if (st.mode !== 'sandbox') H.openSandbox(); return; }
    if (b.dataset.sandbox === 'new') { closeMenus(); H.newSandbox(); }
  });
  document.addEventListener('click', e => { if (!e.target.closest('.menu')) closeMenus(); if (armed && performance.now() - armT > 5000) armed = ''; });
  $('#speedBar').addEventListener('click', e => { const b = e.target.closest('[data-speed]'); if (b) H.setSpeed(+b.dataset.speed); });
  $('#settings').addEventListener('click', e => {
    if (e.target.id === 'settings' || e.target.closest('[data-close]')) { closeModal('#settings'); return; }
    const t = e.target.closest('[data-opt]');
    if (!t) return;
    const k = t.dataset.opt;
    if (k === 'sound') setSound(!st.opts.sound);
    else st.opts[k] = !st.opts[k];
    if (k === 'narrator' && st.opts.narrator && !st.opts.sound) setSound(true);
    if (k === 'narrator' && !st.opts.narrator) stopNarration();
    saveOpts(); renderSettings();
  });
  $('#settings').addEventListener('change', e => {
    if (e.target.id === 'optQuality') { st.opts.quality = e.target.value; saveOpts(); toast('Reloading with the new graphics setting...'); setTimeout(() => H.reload(), 600); }
    if (e.target.id === 'optVoice') { st.opts.voice = e.target.value; saveOpts(); }
  });
  $('#settings').addEventListener('input', e => { if (e.target.id === 'optVolume') { setVolume(+e.target.value); saveOpts(); } });
  if (window.speechSynthesis) window.speechSynthesis.addEventListener('voiceschanged', () => { if (!$('#settings').hidden) renderSettings(); });
  $('#recap').addEventListener('click', e => { if (e.target.id === 'recap' || e.target.closest('[data-close]')) { closeModal('#recap'); stopNarration(); } });
  $('#cardX').addEventListener('click', () => { if (st.card) { st.card.until = 0; st.card.spoken = false; stopNarration(); } });
  const openLower = () => { const id = +$('#lower').dataset.pid; if (id) select(id); };
  $('#lower').addEventListener('click', openLower);
  $('#lower').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLower(); } });
  $('#grab').addEventListener('click', () => toggleSheet());
  $('#minimap').addEventListener('click', e => {
    const cv = $('#mmCanvas'), r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * 2 * S.B - S.B, z = (e.clientY - r.top) / r.height * 2 * S.B - S.B;
    setDirector(false); st.follow = false;
    flyTo(x, z, clamp(T.camera.position.distanceTo(T.controls.target), 18, 120));
  });
  const cv = T.renderer.domElement;
  let down = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; closeMenus(); });
  cv.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6 || e.button !== 0) return;
    const rect = cv.getBoundingClientRect();
    const p = pickPerson(e.clientX - rect.left, e.clientY - rect.top);
    if (p) select(p.id, false);
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || down) return;
    const rect = cv.getBoundingClientRect();
    const p = pickPerson(e.clientX - rect.left, e.clientY - rect.top);
    st.hover = p ? p.id : 0;
    cv.style.cursor = p ? 'pointer' : '';
  });
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea,select')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (!$('#settings').hidden) closeModal('#settings');
      else if (!$('#recap').hidden) { closeModal('#recap'); stopNarration(); }
      else if (!$('#worldMenu').hidden || !$('#gotoMenu').hidden) closeMenus();
      else if (st.card) { st.card.until = 0; st.card.spoken = false; stopNarration(); }
      else if (st.sel) { closeInspector(); panelTick(true); }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'c') setDirector(!st.director);
    else if (k === 'g') openMenu('#gotoMenu');
  });
  if (window.innerWidth < 760) toggleSheet(true);
  showTab('cast');
}
