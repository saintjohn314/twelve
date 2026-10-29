/* ===== Twelve viewer: sync, story cards, panels ===== */
const POLL_MS = 45000;
const seenEv = new Set();
let clock = null, time = 0, lastPoll = 0, lastOk = 0, aiInfo = { on: false };

/* ---------- server sync ---------- */
async function fetchState(q) {
  const r = await fetch('/api/state' + (q || ''), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const o = await r.json();
  if (!o || !o.v) throw new Error('empty world');
  return o;
}
function catchUp(maxSteps) {
  return S.advanceTo(S.targetT(Date.now()), { maxSteps: maxSteps || 30000 });
}
function applyState(o, first) {
  const prev = S.W;
  if (!first && prev && o.season === prev.season && (o.ver || 0) <= st.ver) return false;
  const old = new Map();
  for (const r of renderList) old.set(r.p.id, [r.x, r.z]);
  aiInfo = Object.assign({}, o.ai || {});
  S.load(o);
  st.ver = o.ver || 0;
  S.W.ai.on = false;            // the browser never asks Claude; the server's choices arrive with the next save
  catchUp();
  clearSnaps(); snapshot();
  const newSeason = !prev || prev.seed !== S.W.seed;
  if (!newSeason && !first) for (const p of S.W.people) { const a = old.get(p.id); if (!a) continue; const dx = a[0] - p.x, dz = a[1] - p.z; if (Math.hypot(dx, dz) < 25) smooth.set(p.id, [dx, dz]); }
  ingest(first || newSeason, first);
  if (newSeason && renderer) { buildWorld(); st.shot = null; }
  return true;
}
async function poll() {
  if (st.mode !== 'live') return;
  lastPoll = Date.now();
  try { const o = await fetchState(); lastOk = Date.now(); applyState(o, false); }
  catch (e) { /* keep simulating locally; the next poll will resync */ }
}

/* ---------- new events, confessionals and episodes become ticker lines and cards ---------- */
const evKey = e => e.k + '|' + e.t.toFixed(2) + '|' + e.s;
const confKey = c => c.t.toFixed(2) + '|' + c.id + '|' + c.kind;
function ingest(reset, firstVisit) {
  const W = S.W, now = performance.now() / 1000;
  if (reset) {
    seenEv.clear();
    for (const e of W.events) seenEv.add(evKey(e));
    st.seenConf.clear();
    for (const c of W.confs) st.seenConf.add(confKey(c));
    const last = W.episodes[W.episodes.length - 1];
    st.seenEp = last ? last.n : 0;
    if (firstVisit) {
      let fresh = true;
      try { fresh = !localStorage.getItem('twelve-welcome'); localStorage.setItem('twelve-welcome', '1'); } catch (e) { /* storage blocked */ }
      if (fresh) st.cardQ.push({ type: 'welcome', dur: 24 });
      if (last) st.cardQ.push({ type: 'ep', ep: last, prev: true, dur: cardDur(last.text, 10) });
      const lc = W.confs.filter(c => c.kind === 'conf').slice(-1)[0];
      if (lc && W.t - lc.t < 30) st.cardQ.push(confCard(lc));
    } else st.cardQ.push({ type: 'season', dur: 12 });
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
    if (st.seenConf.has(k)) continue;
    st.seenConf.add(k);
    if (W.t - c.t < 40 && st.cardQ.length < 6) st.cardQ.push(confCard(c));
  }
  for (const ep of W.episodes) {
    if (ep.n <= st.seenEp) continue;
    st.seenEp = ep.n;
    st.cardQ.push({ type: 'ep', ep, dur: cardDur(ep.text, 10) });
  }
}
function cardDur(text, base) { return Math.min(22, base + String(text || '').length * 0.042); }
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
function localShow() {
  // with no server (opened as a local file), the browser writes simple confessionals and recaps itself
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
    W.epLastN = W.evN; W.epFromT = W.t; W.nextEp = W.t + 144;
  }
}
function afterSteps() {
  if (st.mode === 'local') localShow();
  ingest(false);
}

/* ---------- cards ---------- */
function showCard(now) {
  if (st.card && now < st.card.until) return;
  if (st.card) hideCard();
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
    text = `Six men and six women washed ashore after a shipwreck. Nobody controls them. They find food, fall in love, steal, fight, form camps and cast each other out on their own, live, around the clock. Claude speaks for a few of them at a time: their confessionals and their hardest choices.`;
    meta = 'One day on the island is twenty minutes of real time. The director picks the shots. Drag to look around, or tap anyone to follow them.';
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
  if (c.pid && st.director) { st.shot = null; dirT = 0; }
}
function hideCard() {
  st.card = null;
  $('#card').classList.add('hide');
  $('#letterbox').classList.remove('on');
  if (st.director) { st.shot = null; dirT = 0; }
}

/* ---------- heads-up display ---------- */
function hudTick(now) {
  const W = S.W, tl = S.timeLabel(W.t + st.alpha * S.DT);
  setText('#hWhen', `Season ${W.season} · Day ${tl.day}${tl.year > 1 ? ' · Year ' + tl.year : ''}`);
  setText('#hClock', tl.clock);
  const camps = W.groups.filter(g => !g.dead).length;
  setText('#hSub', `${W.people.length} alive · ${camps} ${camps === 1 ? 'camp' : 'camps'} · ${tl.season}${W.wx.storm > 0 ? ' · storm' : ''}`);
  const live = st.mode === 'live' && Date.now() - lastOk < 4 * 60 * 1000;
  $('#live').classList.toggle('off', !live);
  setText('#liveTxt', st.mode === 'local' ? 'LOCAL PREVIEW' : live ? 'LIVE' : 'RECONNECTING');
  // lower third
  let name = '', role = '', act = '', hex = NO_CAMP, pid = 0;
  const sh = st.director ? st.shot : null;
  const subj = sh && (sh.kind === 'person' || sh.kind === 'pair') ? sh.id : (!st.director && st.sel ? st.sel : 0);
  const p = subj && S.getP(subj);
  if (p) { name = p.name; role = S.roleLabel(p); act = S.actLabel(p); hex = personHex(p); pid = p.id; }
  else if (sh && sh.kind === 'camp') {
    const g = W.groups.find(g => g.id === sh.gid);
    if (g) { const m = S.members(g).length; name = g.name; role = `${m} ${m === 1 ? 'person' : 'people'} · ${g.isl === 2 ? 'the far island' : 'the home island'}`; act = (g.leader ? 'Led by ' + S.nameOf(g.leader) : 'No leader') + (g.fire.lit ? ' · fire burning' : ' · no fire'); hex = campHex(g); }
  } else if (sh && sh.kind === 'boat') {
    const b = W.boats.find(b => b.id === sh.bid);
    if (b && b.sail) { name = 'At sea'; role = 'Crossing open water'; act = (b.sail.pax || []).map(S.nameOf).join(', '); }
  } else if (sh && sh.kind === 'wreck') { name = 'The wreck'; role = 'Where it started'; act = `${Math.floor(W.t / 24)} days ago, twelve strangers crawled out of the surf here.`; }
  else if (sh && sh.kind === 'wide') { name = 'The islands'; role = `${W.people.length} alive · ${camps} camps`; act = `${S.popOf(1)} on the home island, ${S.popOf(2)} on the far island.`; }
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
}
function setText(sel, v) { const el = typeof sel === 'string' ? $(sel) : sel; const s = String(v); if (el && el.textContent !== s) el.textContent = s; }

/* ---------- panel: cast ---------- */
let castSig = '';
function ageOf(p) { return Math.floor(S.ageY(p)); }
function personRow(p, g) {
  const lead = g && g.leader === p.id, ai = aiInfo.on && S.W.spot.indexOf(p.id) >= 0;
  return `<button class="prow" data-pid="${p.id}"><span class="chip" style="background:${personHex(p)};border-radius:50%"></span><span class="nm">${esc(p.name)}</span><span class="ag">${ageOf(p)}</span>${lead ? '<span class="badge lead">Leads</span>' : ''}${p.exiled && !g ? '<span class="badge out">Outcast</span>' : ''}${ai ? '<span class="badge ai" title="Claude speaks for this person right now">Claude</span>' : ''}<span class="ac">${esc(S.actLabel(p))}</span></button>`;
}
function renderCast() {
  const W = S.W;
  const groups = W.groups.filter(g => !g.dead).map(g => ({ g, m: S.members(g) })).sort((a, b) => b.m.length - a.m.length);
  const order = (g, list) => list.slice().sort((a, b) => (b.id === g.leader) - (a.id === g.leader) || S.ageY(b) - S.ageY(a));
  let h = '';
  if (!groups.length) h += `<p class="note">No camps yet. The castaways are still finding their feet.</p>`;
  for (const { g, m } of groups) {
    const fed = g.store >= m.length * 2;
    h += `<div class="camp"><div class="camp-h"><span class="chip" style="background:${campHex(g)}"></span><div><div class="camp-n">${esc(g.name)}</div><div class="camp-m">${m.length} ${m.length === 1 ? 'person' : 'people'} · ${g.isl === 2 ? 'far island' : 'home island'}</div></div><div class="camp-r">${g.leader ? 'Led by ' + esc(S.nameOf(g.leader)) : 'No leader'}<br>${g.fire.lit ? 'Fire lit' : 'No fire'} · ${fed ? 'food ok' : 'food low'}</div></div>${order(g, m).map(p => personRow(p, g)).join('')}</div>`;
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
      let ex = P[i].x - P[j].x, ey = P[i].y - P[j].y;
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
    const st2 = e.k === 'love' ? 'stroke="var(--love)" stroke-width="2.4"' : e.k === 'friend' ? 'stroke="rgba(239,230,214,.32)" stroke-width="1.2"' : 'stroke="var(--foe)" stroke-width="1.4" stroke-dasharray="4 3" opacity=".85"';
    h += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" ${st2}/>`;
  }
  for (const p of nodes) {
    const o = webPos.get(p.id), lead = leaders.has(p.id), sel = p.id === st.sel;
    const r = lead ? 7 : 5;
    h += `<circle data-pid="${p.id}" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${r}" fill="${personHex(p)}" stroke="${sel ? '#fff' : 'var(--panel-solid)'}" stroke-width="${sel ? 2.5 : 1.5}"><title>${esc(p.name)}${lead ? ', leader' : ''}</title></circle>`;
    if (showAll || lead || sel || W.spot.indexOf(p.id) >= 0) { const right = o.x > Wd * 0.62; h += `<text class="lbl" x="${(o.x + (right ? -r - 3 : r + 3)).toFixed(1)}" y="${(o.y + 3.5).toFixed(1)}"${right ? ' text-anchor="end"' : ''}>${esc(p.name)}</text>`; }
  }
  svg.setAttribute('viewBox', `0 0 ${Wd} ${Ht}`);
  svg.innerHTML = h;
  $('#webLegend').innerHTML = `<span><i class="ln" style="border-color:var(--love)"></i>Partners</span><span><i class="ln" style="border-color:rgba(239,230,214,.45)"></i>Close friends</span><span><i class="ln" style="border-color:var(--foe);border-top-style:dashed"></i>Enemies</span>` +
    W.groups.filter(g => !g.dead).map(g => `<span><span class="chip" style="background:${campHex(g)}"></span>${esc(g.name)}</span>`).join('');
}

/* ---------- panel: story ---------- */
let storySig = '';
function quoteHTML(c) {
  const p = S.getP(c.id);
  const hex = p ? personHex(p) : NO_CAMP;
  return `<div class="quote"><span class="bar" style="background:${hex}"></span><div><div class="who">${p ? `<button data-pid="${c.id}">${esc(c.name)}</button>` : esc(c.name) + ' <span class="muted">(dead)</span>'} <span class="muted small" style="text-transform:none;letter-spacing:0;font-family:var(--f-body)">· ${c.kind === 'conf' ? 'confessional' : 'decision'} · ${S.stamp(c.t)}${c.ai ? ' · Claude' : ''}</span></div><div class="txt">${esc(c.text)}</div>${c.choice ? `<div class="ch">Chose: ${esc(c.choice)}</div>` : ''}</div></div>`;
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
  box.innerHTML = '<p class="note">Loading…</p>';
  try {
    const d = await (await fetch('/api/state?season=' + n)).json();
    box.innerHTML = (d.episodes || []).slice().reverse().map(ep => `<details class="ep" style="margin-top:8px"><summary><div class="ep-k">Episode ${ep.n}</div><div class="ep-t">${esc(ep.title)}</div></summary><p>${esc(ep.text)}</p></details>`).join('') || '<p class="note">No episodes were saved for this season.</p>';
  } catch (e) { box.innerHTML = '<p class="note">That season could not be loaded.</p>'; }
}

/* ---------- panel: stats ---------- */
let statsSig = '';
const SERIES = ['#3987e5', '#d95926'];
function niceMax(v) { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); const f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; }
function lineChart(series, o) {
  const Wd = 352, Ht = o.h || 132, L = 30, Rr = 64, T = 8, Bt = 18;
  const xs = series[0].pts.map(p => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(x0 + 1, ...xs);
  let y0 = o.min != null ? o.min : 0, y1 = o.max != null ? o.max : niceMax(Math.max(...series.flatMap(s => s.pts.map(p => p[1]))) * 1.05);
  if (o.min == null && Math.min(...series.flatMap(s => s.pts.map(p => p[1]))) < 0) { const m = niceMax(Math.max(...series.flatMap(s => s.pts.map(p => Math.abs(p[1]))))); y0 = -m; y1 = m; }
  const X = x => L + (x - x0) / (x1 - x0) * (Wd - L - Rr), Y = y => T + (1 - (y - y0) / (y1 - y0 || 1)) * (Ht - T - Bt);
  let h = `<svg viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${esc(o.label)}">`;
  for (let i = 0; i <= 2; i++) { const v = y0 + (y1 - y0) * i / 2; h += `<line class="grid" x1="${L}" x2="${Wd - Rr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${L - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${o.fmt ? o.fmt(v) : Math.round(v)}</text>`; }
  h += `<text class="ax" x="${L}" y="${Ht - 4}">Day ${x0 + 1}</text><text class="ax" x="${Wd - Rr}" y="${Ht - 4}" text-anchor="end">Day ${x1 + 1}</text>`;
  series.forEach((s, i) => {
    const d = s.pts.map((p, j) => (j ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
    h += `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = s.pts[s.pts.length - 1];
    h += `<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3" fill="${s.c}"/><text class="dl" x="${(X(last[0]) + 7).toFixed(1)}" y="${(Y(last[1]) + 4 + (i && series.length > 1 && Math.abs(Y(last[1]) - Y(series[0].pts[series[0].pts.length - 1][1])) < 12 ? 12 : 0)).toFixed(1)}" fill="${s.c}">${esc(s.name)} ${o.fmt ? o.fmt(last[1]) : last[1]}</text>`;
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
    h += '<h3>Population</h3><div class="chart">' + lineChart([{ name: 'All', c: SERIES[0], pts: D.map(d => [d.d, d.pop]) }, { name: 'Far isl.', c: SERIES[1], pts: D.map(d => [d.d, d.far]) }], { label: 'Population by day' }) + '</div>';
    h += '<h3>Trust</h3><div class="chart">' + lineChart([{ name: 'Avg', c: SERIES[0], pts: D.map(d => [d.d, d.trust]) }], { label: 'Average trust between adults', h: 110, fmt: v => (v > 0 ? '+' : '') + Math.round(v) }) + '</div><div class="chart-cap">How much the adults trust each other on average, from -100 to +100.</div>';
    h += '<h3>Inequality</h3><div class="chart">' + lineChart([{ name: 'Gini', c: SERIES[0], pts: D.map(d => [d.d, d.gini]) }], { label: 'Inequality of food and belongings', h: 110, min: 0, max: 1, fmt: v => v.toFixed(2) }) + '</div><div class="chart-cap">0 means everyone has the same food and belongings; 1 means one person has everything.</div>';
  } else h += '<p class="note" style="margin-top:14px">Charts fill in as the days go by.</p>';
  const camps = W.groups.filter(g => !g.dead).map(g => ({ g, n: S.members(g).length })).sort((a, b) => b.n - a.n);
  if (camps.length) {
    const mx = Math.max(...camps.map(c => c.n));
    h += '<h3>Camp sizes</h3><div class="bars">' + camps.map(c => `<div class="brow"><span class="bn">${esc(c.g.name)}</span><span class="bt" style="width:${Math.max(3, c.n / mx * 100)}%;background:${campHex(c.g)}"></span><span class="bv">${c.n}</span></div>`).join('') + '</div>';
  }
  const ms = Object.values(W.milestones).sort((a, b) => a.t - b.t);
  if (ms.length) h += '<h3>Firsts</h3><div class="ms">' + ms.map(m => `<span class="d">${S.stamp(m.t)}</span><span>${esc(m.s)}</span>`).join('') + '</div>';
  h += `<p class="note" style="margin-top:16px">One day on the island is twenty minutes of real time; a year is sixteen days. ${aiInfo.on ? 'Claude is voicing the spotlight cast right now.' : 'Claude is not connected right now, so built-in rules make every choice and write the recaps.'}</p>`;
  if (h !== statsSig) { statsSig = h; $('#pane-stats').innerHTML = h; }
}

/* ---------- inspector ---------- */
let inspSig = '';
function meter(k, v, invert) { const f = clamp(v, 0, 100); return `<div class="meter${f < 25 ? ' low' : ''}"><div class="k"><span>${k}</span><span>${Math.round(f)}</span></div><div class="t"><div class="f" style="width:${f}%"></div></div></div>`; }
function linkBtn(id, label) { const p = S.getP(id); const a = !p && S.W.arch[id]; if (!p && !a) return ''; return `<button class="lk${p ? '' : ' dead'}" ${p ? `data-pid="${id}"` : ''}>${esc(label || (p || a).name)}</button>`; }
function renderInspector() {
  const box = $('#inspector');
  const p = st.sel && S.getP(st.sel);
  if (!p) {
    const a = st.sel && S.W.arch[st.sel];
    if (a) { const h = `<div class="insp-h"><button class="back" data-act="close" aria-label="Back">&larr;</button><div><div class="insp-name">${esc(a.name)}</div><div class="insp-sub">Died: ${esc(a.cause || 'unknown')}</div></div></div><div class="pane"><p class="note">${esc((a.life || []).slice(-6).map(m => m.s || m).join(' '))}</p></div>`; if (h !== inspSig) { inspSig = h; box.innerHTML = h; } }
    else closeInspector();
    return;
  }
  const W = S.W, g = S.grpOf(p), a = S.ageY(p);
  const origin = p.prof ? `Before the wreck: ${S.PROFS[p.prof].n}` : `Born on the island, generation ${p.gen}`;
  const ai = aiInfo.on && W.spot.indexOf(p.id) >= 0;
  let h = `<div class="insp-h"><button class="back" data-act="close" aria-label="Back">&larr;</button><div style="min-width:0"><div class="insp-name">${esc(p.name)}</div><div class="insp-sub"><span class="chip" style="display:inline-block;background:${personHex(p)};border-radius:50%;width:8px;height:8px;margin-right:5px"></span>${p.sex === 'M' ? 'Man' : 'Woman'}, ${Math.floor(a)} · ${esc(S.roleLabel(p))}</div><div class="insp-sub">${esc(origin)}${ai ? ' <span class="badge ai">Claude</span>' : ''}</div><div class="insp-act">${esc(S.actLabel(p))}</div></div><button class="follow" data-act="follow" aria-pressed="${st.follow ? 'true' : 'false'}">Follow</button></div><div class="pane">`;
  h += `<div class="meters">${meter('Fed', p.hun)}${meter('Rested', p.en)}${meter('Company', p.soc)}${meter('Health', p.hp)}</div>`;
  h += '<h3>Personality</h3><div class="traits">' + S.TRAITS.map(([k, n]) => `<div class="trait"><span>${n}</span><span class="t"><i style="left:${(p.p[k] * 100).toFixed(0)}%"></i></span></div>`).join('') + `</div><p class="note small" style="margin:6px 0 0">${esc(S.traitWords(p.p))}</p>`;
  const fam = [];
  if (p.partner) fam.push(['Partner', [p.partner]]);
  if (p.mom || p.dad) fam.push(['Parents', [p.mom, p.dad].filter(Boolean)]);
  if (p.kids.length) fam.push(['Children', p.kids]);
  if (fam.length) h += '<h3>Family</h3>' + fam.map(([k, ids]) => `<div style="display:flex;gap:10px;align-items:baseline;margin-bottom:6px"><span class="muted small" style="width:64px;flex:none">${k}</span><div class="links">${ids.map(id => linkBtn(id)).join('')}</div></div>`).join('');
  const rels = S.topRelations(p, 9);
  if (rels.length) h += '<h3>People</h3><div class="rels">' + rels.map(x => { const v = x.r[0]; const w = Math.abs(v) / 2; return `<button class="rel" data-pid="${x.o.id}"><span class="chip" style="background:${personHex(x.o)};border-radius:50%"></span><span class="rn">${esc(x.o.name)}</span><span class="sw"><i style="left:${v < 0 ? 50 - w : 50}%;width:${w}%;background:${v < 0 ? 'var(--foe)' : 'var(--love)'}"></i></span><span class="rw">${esc(S.relWords(x.r))}</span></button>`; }).join('') + '</div>';
  if (p.secrets.length) h += '<h3>Secrets</h3>' + p.secrets.slice(-4).map(s => `<div class="secret">${esc(s.s)}</div>`).join('');
  const items = S.itemsOf(p);
  if (items.length) h += `<h3>Owns</h3><p class="note" style="margin:0">${items.map(i => esc(S.ITEMS[i.k].n)).join(', ')}</p>`;
  const cf = W.confs.filter(c => c.id === p.id).slice(-3).reverse();
  if (cf.length) h += '<h3>In their words</h3>' + cf.map(quoteHTML).join('');
  if (p.mem.length) h += '<h3>Lately</h3>' + p.mem.slice(-8).reverse().map(m => `<div class="mem">${esc(m.s)}</div>`).join('');
  if (p.life.length) h += '<h3>Life so far</h3>' + p.life.slice(-10).map(m => `<div class="mem">${esc(m.s)}</div>`).join('');
  h += '</div>';
  if (h !== inspSig) { const pane = box.querySelector('.pane'), y = pane ? pane.scrollTop : 0; inspSig = h; box.innerHTML = h; const np = box.querySelector('.pane'); if (np && box.dataset.pid === String(p.id)) np.scrollTop = y; box.dataset.pid = p.id; }
}
function select(id, fly) {
  st.sel = id;
  inspSig = '';
  $('#inspector').hidden = !id;
  if (!id) return;
  setDirector(false);
  st.follow = true;
  renderInspector();
  const r = RL.get(id);
  if (fly !== false && r) flyTo(r.x, r.z, 14);
  if (window.innerWidth < 760 && st.sheetMin) toggleSheet(false);
}
function closeInspector() { st.sel = 0; st.follow = false; $('#inspector').hidden = true; inspSig = ''; }

/* ---------- interface wiring ---------- */
function showTab(t) {
  st.tab = t;
  $$('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
  ['cast', 'web', 'story', 'stats'].forEach(k => { $('#pane-' + k).hidden = k !== t; });
  castSig = storySig = statsSig = ''; webSig = '';
  panelTick(true);
}
function toggleSheet(min) {
  st.sheetMin = min == null ? !st.sheetMin : min;
  document.body.classList.toggle('sheet-min', st.sheetMin);
}
let webT = 0;
function panelTick(force) {
  if (!$('#inspector').hidden) { renderInspector(); return; }
  if (st.tab === 'cast') renderCast();
  else if (st.tab === 'story') renderStory();
  else if (st.tab === 'stats') renderStats();
  else if (st.tab === 'web') { const now = performance.now(); if (force || now - webT > 2000) { webT = now; renderWeb(); } }
}
function initUI() {
  $$('.tab').forEach(b => b.addEventListener('click', () => { if (!$('#inspector').hidden) closeInspector(); showTab(b.dataset.tab); }));
  $('#panel').addEventListener('click', e => {
    const s = e.target.closest('[data-season]');
    if (s) { loadSeason(+s.dataset.season); s.remove(); return; }
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'close') { closeInspector(); panelTick(true); return; }
    if (act && act.dataset.act === 'follow') { st.follow = !st.follow; if (st.follow) setDirector(false); act.setAttribute('aria-pressed', st.follow ? 'true' : 'false'); return; }
    const b = e.target.closest('[data-pid]');
    if (b) select(+b.dataset.pid);
  });
  $('#web').addEventListener('click', e => { const c = e.target.closest('[data-pid]'); if (c) select(+c.dataset.pid); });
  $('#btnDirector').addEventListener('click', () => { setDirector(!st.director); if (st.director) closeInspector(); });
  $('#btnWide').addEventListener('click', () => { setDirector(false); st.follow = false; frameWide(false); });
  $('#cardX').addEventListener('click', () => { if (st.card) st.card.until = 0; });
  const openLower = () => { const id = +$('#lower').dataset.pid; if (id) select(id); };
  $('#lower').addEventListener('click', openLower);
  $('#lower').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLower(); } });
  $('#grab').addEventListener('click', () => toggleSheet());
  const cv = renderer.domElement;
  let down = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    const rect = cv.getBoundingClientRect();
    const p = pickPerson(e.clientX - rect.left, e.clientY - rect.top);
    if (p) select(p.id);
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || down) return;
    const rect = cv.getBoundingClientRect();
    const p = pickPerson(e.clientX - rect.left, e.clientY - rect.top);
    st.hover = p ? p.id : 0;
    cv.style.cursor = p ? 'pointer' : '';
  });
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea')) return;
    if (e.key === 'Escape') { if (st.card) st.card.until = 0; else if (st.sel) { closeInspector(); panelTick(true); } }
    if (e.key === 'd' || e.key === 'D') setDirector(!st.director);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastPoll > 20000) poll(); });
  if (window.innerWidth < 760) toggleSheet(true);
  showTab('cast');
}

/* ---------- main loop ---------- */
let uiT = 0, slowT = 0, panelT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, clock.getDelta());
  time += dt;
  const now = performance.now() / 1000;
  const target = S.targetT(Date.now());
  let n = 0;
  while (S.W.t + S.DT <= target && n < 30) { snapshot(); S.step(S.DT); n++; }
  if (n >= 30 && S.W.t + S.DT <= target) {
    if (target - S.W.t > 6 && st.mode === 'live' && Date.now() - lastPoll > 5000) poll();
    catchUp(3000); clearSnaps(); snapshot();
  }
  if (n) afterSteps();
  if (S.W.seed !== st.seed) { buildWorld(); st.shot = null; clearSnaps(); snapshot(); ingest(true, false); }
  st.alpha = clamp((target - S.W.t) / S.DT, 0, 1);
  updatePeople(dt);
  updateAnimals(time);
  updateSnakes(time);
  const night = updateEnv(dt, time);
  slowT -= dt;
  if (slowT <= 0) { slowT = 0.25; updateStructures(); }
  updateCamps(time, night);
  showCard(now);
  updateCamera(dt, now);
  renderer.render(scene, camera);
  updateLabels();
  uiT -= dt;
  if (uiT <= 0) { uiT = 0.25; hudTick(now); }
  panelT -= dt;
  if (panelT <= 0) { panelT = 1; panelTick(false); }
}

/* ---------- boot ---------- */
async function boot() {
  if (typeof THREE === 'undefined' || !THREE.OrbitControls) {
    $('#bootMsg').innerHTML = '<div class="err">The 3D engine did not download. Check your connection and reload the page.</div>';
    return;
  }
  let o = null;
  try { o = await fetchState(); st.mode = 'live'; lastOk = lastPoll = Date.now(); } catch (e) { st.mode = 'local'; }
  if (o) applyState(o, true);
  else { S.newSeason(((Math.random() * 2147483646) | 0) + 1, Date.now()); S.W.ai.on = false; ingest(true, true); }
  initThree();
  buildWorld();
  clearSnaps(); snapshot();
  initUI();
  frameWide(true);
  clock = new THREE.Clock();
  requestAnimationFrame(frame);
  setInterval(poll, POLL_MS);
  setTimeout(() => $('#boot').classList.add('done'), 150);
  window.__twelve = { S, st, R, get camera() { return camera; } };
}
boot();
