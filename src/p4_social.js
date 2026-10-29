
/* ---------- kinship, attraction, wants ---------- */
function anc(p) {
  let m = ANC.get(p.id);
  if (m) return m;
  m = new Map();
  const walk = (id, d) => {
    if (!id || d > 3) return;
    if (!m.has(id) || m.get(id) > d) m.set(id, d);
    const r = PM.get(id) || W.arch[id];
    if (!r) return;
    walk(r.mom, d + 1); walk(r.dad, d + 1);
  };
  walk(p.id, 0);
  ANC.set(p.id, m);
  return m;
}
export function kin(a, b) {
  const A = anc(a), Bm = anc(b);
  let D = 99, n = 0;
  for (const [id, d] of A) if (Bm.has(id)) { const s = d + Bm.get(id); if (s < D) { D = s; n = 1; } else if (s === D) n++; }
  return D === 99 ? 0 : n * Math.pow(0.5, D);
}
function eligible(p, o) {
  if (o === p || o.dead || o.sex === p.sex || o.isl !== p.isl || o.partner || p.partner) return false;
  const ao = ageY(o), ap = ageY(p);
  if (ao < ADULT || ap < ADULT) return false;
  if ((o.sex === 'F' ? ao : ap) > 46 || ao > 62 || ap > 62) return false;
  if (W.t - o.widowT < HPY * 0.5 || W.t - p.widowT < HPY * 0.5) return false;
  if (o.grp && p.grp && o.grp !== p.grp && hostility(o.grp, p.grp) > 40) return false;
  return kin(p, o) < 0.25;
}
export function attraction(p, o) {
  const gap = Math.max(0, Math.abs(ageY(p) - ageY(o)) - 8) * 0.012;
  return clamp(0.42 * o.g.looks + 0.2 * (1 - Math.abs(p.p.extra - o.p.extra)) + 0.16 * o.p.agree + 0.22 * pairHash(p.id, o.id) - gap, 0, 1);
}
function hasEligible(p) { for (const o of W.people) if (eligible(p, o) && attraction(p, o) > 0.35) return true; return false; }
function temptation(p) {
  const m = PM.get(p.partner);
  if (!m || ageY(p) < ADULT) return null;
  const unhappy = (50 - relA(p, m)) / 100 + (1 - p.p.agree) * 0.15 + (1 - p.p.honest) * 0.22 + p.p.neuro * 0.08;
  let best = null, bs = 0.3;
  for (const o of W.people) {
    if (o === p || o === m || o.sex === p.sex || o.isl !== p.isl || ageY(o) < ADULT || ageY(o) > 55) continue;
    if (kin(p, o) >= 0.25 || relA(p, o) < 25) continue;
    const s = attraction(p, o) - attraction(p, m) + unhappy;
    if (s > bs) { bs = s; best = o; }
  }
  return best && rand() < 0.5 ? best : null;
}
function grudgeTarget(p) {
  const sum = new Map();
  for (const m of p.mem) {
    if (m.v > -15 || m.r || !m.w || W.t - m.t > 24 * 6) continue;
    sum.set(m.w, (sum.get(m.w) || 0) - m.v);
  }
  let best = null, bs = 25;
  for (const [id, s] of sum) {
    const o = PM.get(id);
    if (!o || o.isl !== p.isl || relA(p, o) > -8) continue;
    if (s > bs) { bs = s; best = o; }
  }
  return best ? { o: best, score: bs } : null;
}
function hatedTarget(p) {
  if (ageY(p) < ADULT) return null;
  for (const id in p.rel) {
    const r = p.rel[id];
    if (r[0] > -65 || r[1] > -45) continue;
    const o = PM.get(+id);
    if (!o || o.isl !== p.isl || ageY(o) < 12) continue;
    const revenge = p.mem.some(m => m.k === 'murder' && m.w === o.id);
    if (!revenge && (p.p.agree > 0.38 || p.p.neuro < 0.5)) continue;
    if (!revenge && p.mem.filter(m => m.w === o.id && m.v <= -15).length < 2) continue;
    if (dist(p, o) > 60) continue;
    let alone = true;
    near(o.x, o.z, 22, q => { if (q !== o && q !== p && !q.sleeping && ageY(q) >= 6) alone = false; });
    if (alone && rand() < 0.35) return o;
  }
  return null;
}
function stealTarget(p, mode) {
  let best = null, bd = 1e9;
  if (mode === 'food') {
    for (const h of W.huts) {
      if (h.isl !== p.isl || h.stash < 2 || h.own === p.id || h.id === p.home) continue;
      const o = PM.get(h.own);
      if (o && (o.id === p.partner || kin(o, p) >= 0.25)) continue;
      const d = dist(h, p);
      if (d < bd && d < 100) { bd = d; best = { type: 'hut', id: h.id, victim: h.own }; }
    }
    for (const g of W.groups) {
      if (g.dead || g.isl !== p.isl || g.id === p.grp || g.store < 3) continue;
      const d = dist(g, p) + 15;
      if (d < bd && d < 110) { bd = d; best = { type: 'store', id: g.id, victim: g.leader || 0 }; }
    }
  } else if (mode === 'item') {
    for (const it of W.items) {
      if (!it.owner || it.owner === p.id || ['knife', 'axe', 'net', 'flint'].indexOf(it.k) < 0) continue;
      const o = PM.get(it.owner);
      if (!o || o.isl !== p.isl || o.id === p.partner || kin(o, p) >= 0.25) continue;
      const d = dist(o, p);
      if (d < bd && d < 80) { bd = d; best = { type: 'item', id: it.id, victim: o.id }; }
    }
  } else if (mode === 'raid') {
    for (const g of W.groups) {
      if (g.dead || g.isl !== p.isl || g.id === p.grp || g.store < 5 || hostility(p.grp, g.id) < 8) continue;
      const d = dist(g, p);
      if (d < bd) { bd = d; best = { type: 'store', id: g.id, victim: g.leader || 0, raid: true }; }
    }
  }
  return best;
}
export function hostility(ga, gb) {
  if (!ga || !gb || ga === gb) return 0;
  const k = ga < gb ? ga + '-' + gb : gb + '-' + ga;
  return W.gRel[k] || 0;
}
function bestGroupToJoin(p) {
  let best = null, bs = 0;
  for (const g of W.groups) {
    if (g.dead || g.isl !== p.isl) continue;
    if (p.exiled === g.id && W.t - p.exileT < HPY * 3) continue;
    const ms = adultsOf(g);
    if (!ms.length) continue;
    let mine = 0, theirs = 0;
    for (const m of ms) { mine += opinion(p, m); theirs += opinion(m, p); }
    mine /= ms.length; theirs /= ms.length;
    if (theirs < -6) continue;
    const s = mine + 10 - dist(p, g) * 0.05;
    if (s > bs) { bs = s; best = g; }
  }
  return best;
}
function friendlyGroup(g) {
  let best = null, bs = 5;
  for (const o of W.groups) { if (o.dead || o === g || o.isl !== g.isl) continue; const h = -hostility(g.id, o.id); if (h > bs) { bs = h; best = o; } }
  return best;
}
function tryFoundWithFriends(p) {
  const friends = [];
  near(p.x, p.z, 70, o => { if (o !== p && !o.grp && ageY(o) >= ADULT && o.isl === p.isl && opinion(p, o) > 10 && opinion(o, p) > 10) friends.push(o); });
  if (!friends.length) return false;
  const pt = randLand(p.isl, p.x, p.z, 0, 20, { minH: 1 }) || { x: p.x, z: p.z };
  foundCamp(p, [p].concat(friends.slice(0, 6)), pt);
  return true;
}
function foundFirstCamp(p) {
  if (p.grp) return false;
  if (W.groups.some(g => !g.dead && g.isl === p.isl) && !p.exiled) return false;
  if (W.groups.length && !W.people.some(o => o !== p && !o.grp && o.isl === p.isl && ageY(o) >= ADULT && dist(o, p) < 90 && opinion(o, p) > -20)) return false;
  const pt = randLand(p.isl, p.x, p.z, 0, 8, { minH: 0.9 }) || { x: p.x, z: p.z };
  const g = newGroup(p, pt.x, pt.z, p.exiled ? (groupById(p.exiled) || {}).dia : null);
  joinGroup(p, g, true);
  g.fire.lit = true; g.fire.fuel = 60; g.fire.ever = true;
  let n = 1;
  for (const o of W.people) {
    if (o === p || o.grp || o.isl !== p.isl || dist(o, p) > 90 || opinion(o, p) < -20) continue;
    if (o.exiled && o.exiled !== 0 && W.t - o.exileT < 48) continue;
    joinGroup(o, g, true); n++;
  }
  const first = W.groups.length === 1;
  ev(first ? 'story' : 'split', first ? `As the light failed, ${p.name} struck the flint and lit a fire on the beach. One by one the others came to it. They call the place ${g.name}.` : `${p.name} lit a fire of their own and founded ${g.name}.`, [p.id], first ? 4 : 2);
  life(p, first ? `I lit the first fire. Everyone came to me.` : `I founded ${g.name}.`);
  near(p.x, p.z, 30, o => { if (o !== p) bump(o, p, 3, 3, 6); });
  return true;
}
function foundCamp(leader, followers, pt) {
  const old = grpOf(leader);
  const g = newGroup(leader, pt.x, pt.z, old ? old.dia : null);
  for (const f of followers) {
    if (old && old.leader === f.id) old.leader = 0;
    joinGroup(f, g, true);
    const h = hutOf(f);
    if (h && dist(h, g) > 40) { if (h.own === f.id) h.own = 0; f.home = 0; }
    for (const k of f.kids) { const kd = PM.get(k); if (kd && ageY(kd) < ADULT && kd.isl === f.isl) { joinGroup(kd, g, true); kd.home = 0; } }
    life(f, `I left ${old ? old.name : 'my old life'} and helped found ${g.name}.`);
  }
  g.leader = leader.id;
  if (followers.some(canLight)) { g.fire.lit = true; g.fire.fuel = 50; g.fire.ever = true; }
  return g;
}

/* ---------- conversation, gossip, jealousy ---------- */
function compat(p, o) {
  let d = 0;
  for (const k of ['open', 'consc', 'extra', 'agree', 'honest']) d += Math.abs(p.p[k] - o.p[k]);
  return clamp(1 - (d / 5) * 2.2, 0, 1);
}
function chatTick(p, o, dt, mode) {
  const music = (p.prof === 'musician' || o.prof === 'musician') ? 1.3 : 1;
  p.soc = Math.min(100, p.soc + 30 * dt * music);
  o.soc = Math.min(100, o.soc + 30 * dt * music);
  const base = opinion(p, o);
  if (base < -25 && rand() < dt * (p.p.neuro + o.p.neuro) * 0.8) {
    bump(p, o, -5, -2); bump(o, p, -5, -2);
    say(p, 'confront', { o: o.name });
    return;
  }
  const cp = compat(p, o);
  if (cp < 0.5 && mode !== 'court' && rand() < dt * (p.p.neuro + o.p.neuro) * (0.6 - cp) * 1.2) {
    bump(p, o, -5, -2); bump(o, p, -5, -2);
    mem(p, 'insult', o.id, -12, `${o.name} and I got into it again.`); mem(o, 'insult', p.id, -12, `${p.name} and I got into it again.`);
    say(p, 'confront', { o: o.name }); if (rand() < 0.04) ev('conflict', `${p.name} and ${o.name} argued in front of everyone.`, [p.id, o.id], 1);
    return;
  }
  const gain = ((cp - 0.48) * 7 + ((p.p.agree + o.p.agree) / 2 - 0.45) * 4 - ((p.p.neuro + o.p.neuro) / 2 - 0.5) * 2 + (p.partner === o.id ? 2 : 0)) * dt * music;
  bump(p, o, gain, gain * 0.5); bump(o, p, gain, gain * 0.5);
  if (mode === 'court') { bump(p, o, attraction(p, o) * 4 * dt, 0.5 * dt); bump(o, p, attraction(o, p) * 4 * dt, 0.5 * dt); }
  if (rand() < dt * 2.2) { const s = rand() < 0.5 ? p : o, l = s === p ? o : p; say(s, mode === 'court' ? 'flirt' : s.partner === l.id ? 'love' : (rand() < 0.5 ? 'small' : 'greet'), { o: l.name }); }
}
function endChat(p, o, mode, done) {
  gossip(p, o); gossip(o, p);
  const teach = (a, b) => {
    for (const t of a.know) if (b.know.indexOf(t) < 0 && TECH[t]) {
      let ch = 0.25 * (0.5 + b.p.open) * ((PROFS[a.prof] && PROFS[a.prof].teach) || 1) * ((PROFS[b.prof] && PROFS[b.prof].learn) || 1);
      if (b.mom === a.id || b.dad === a.id) ch *= 1.5;
      if (ageY(b) < 8) ch *= 0.3;
      if (rand() < ch) learn(b, t, false, a);
    }
  };
  teach(p, o); teach(o, p);
  const ch = (PROFS[p.prof] && PROFS[p.prof].charm) || 1;
  bump(o, p, 0, 0, 0.6 * p.p.extra * ch);
  discover(p, 'talk', 1);
  if (mode === 'court' && done && eligible(p, o) && relA(p, o) > 46 && relA(o, p) > 42 && relT(p, o) > 18 && attraction(p, o) > 0.38 && attraction(o, p) > 0.34) pairUp(p, o);
}
function pairUp(p, o) {
  p.partner = o.id; o.partner = p.id;
  const m = p.sex === 'M' ? p : o, f = p.sex === 'M' ? o : p;
  ev('love', `${m.name} and ${f.name} are together now.`, [m.id, f.id], 2);
  life(p, `${o.name} and I got together.`); life(o, `${p.name} and I got together.`);
  if (p.grp !== o.grp && p.grp && o.grp) {
    const pg = grpOf(p), og = grpOf(o);
    const pk = members(pg).length, ok = members(og).length;
    const mover = relR(p, o) > relR(o, p) || pk > ok ? p : o;
    const dest = mover === p ? og : pg;
    joinGroup(mover, dest);
    ev('love', `${mover.name} moved to ${dest.name} to be with ${mover === p ? o.name : p.name}.`, [mover.id], 1);
  } else if (!p.grp && o.grp) joinGroup(p, grpOf(o));
  else if (!o.grp && p.grp) joinGroup(o, grpOf(p));
  const hp = hutOf(p), ho = hutOf(o);
  if (hp && ho) { const keep = hp.id < ho.id ? hp : ho; p.home = keep.id; o.home = keep.id; } else if (hp) o.home = hp.id; else if (ho) p.home = ho.id;
  for (const x of W.people) {
    if (x === p || x === o) continue;
    if (relA(x, p) > 45 && attraction(x, p) > 0.5 && x.sex !== p.sex && !x.partner) { mem(x, 'jealous', o.id, -18, `${o.name} took ${p.name} from me.`); bump(x, o, -12, -5); }
    if (relA(x, o) > 45 && attraction(x, o) > 0.5 && x.sex !== o.sex && !x.partner) { mem(x, 'jealous', p.id, -18, `${p.name} took ${o.name} from me.`); bump(x, p, -12, -5); }
  }
}
function gossip(sp, li) {
  const G = goalOf(sp);
  if (G && G.k === 'undermine' && G.o !== li.id && rand() < 0.55) {
    const o = PM.get(G.o);
    if (o) {
      const tf = clamp((relT(li, sp) + 60) / 120, 0.1, 1);
      bump(li, o, -5 * tf, -7 * tf);
      if (!li.mem.some(m => m.k === 'warned' && m.w === o.id && W.t - m.t < 48)) mem(li, 'warned', o.id, -8, `${sp.name} warned me about ${o.name}.`);
      say(sp, 'gossip', { s: o.name });
      return;
    }
  }
  if (rand() > 0.3 + sp.p.extra * 0.5) return;
  let best = null, bs = 0;
  for (const m of sp.mem) {
    if (m.sec || !m.w || m.w === li.id || m.w2 === li.id || Math.abs(m.v) < 12 || (m.h || 0) >= 2) continue;
    const age = W.t - m.t;
    if (age > 24 * 8) continue;
    const s = Math.abs(m.v) * (m.v < 0 ? 1.4 : 1) / (1 + age / 48);
    if (s > bs) { bs = s; best = m; }
  }
  if (!best) return;
  const subj = PM.get(best.w);
  const tf = clamp((relT(li, sp) + 60) / 120, 0.1, 1);
  if (subj) bump(li, subj, best.v * 0.16 * tf, best.v * 0.24 * tf, best.v > 0 ? best.v * 0.05 * tf : 0);
  if (best.w2 && PM.get(best.w2)) bump(li, PM.get(best.w2), best.v * 0.08 * tf, best.v * 0.12 * tf);
  const dup = li.mem.some(m => m.k === best.k && m.w === best.w && Math.abs(m.t - best.t) < 1);
  if (!dup) { li.mem.push({ t: best.t, k: best.k, w: best.w, w2: best.w2, v: Math.round(best.v * 0.6 * tf), s: `${sp.name} told me: ${best.s}`, h: (best.h || 0) + 1 }); if (li.mem.length > 18) li.mem.shift(); }
  say(sp, best.v < 0 ? 'gossip' : 'praise', { s: nameOf(best.w), s2: best.w2 ? nameOf(best.w2) : '' });
  if (best.k === 'affair' && !dup) {
    const cheater = PM.get(best.w), lover = PM.get(best.w2);
    if (cheater && li.partner === cheater.id) betrayal(li, cheater, lover, sp);
  }
}
function jealousy(p, o) {
  for (const x of [PM.get(p.partner), PM.get(o.partner)]) {
    if (!x || x === p || x === o || x.sleeping) continue;
    if (dist(x, p) > 22) continue;
    const mine = x.partner === p.id ? p : o, rival = mine === p ? o : p;
    mem(x, 'jealous', rival.id, -16, `I saw ${rival.name} flirting with ${mine.name}.`);
    bump(x, rival, -7 * (0.5 + x.p.neuro), -4);
    bump(x, mine, -3, -6 * (0.5 + x.p.neuro));
  }
}
function betrayal(x, cheater, lover, teller) {
  mem(x, 'betrayal', cheater.id, -55, `${cheater.name} cheated on me${lover ? ' with ' + lover.name : ''}.`);
  if (lover) { mem(x, 'betrayal', lover.id, -45, `${lover.name} went behind my back with ${cheater.name}.`); bump(x, lover, -40, -40); }
  bump(x, cheater, -35, -50);
  ev('scandal', `${x.name} found out about ${cheater.name}${lover ? ' and ' + lover.name : ''}${teller ? ` (${teller.name} told them)` : ''}.`, [x.id, cheater.id], 3);
  life(x, `I found out ${cheater.name} betrayed me.`);
}

/* ---------- theft ---------- */
function considerSteal(p, tgt) { return raise(p, 'steal', tgt); }
function actSteal(p, c) {
  p.lastCrime = W.t;
  const hour = W.t % 24, desperate = p.hun < 20;
  const wait = !desperate && hour >= 6 && hour < 20;
  return setAct(p, { k: 'sneak', c, ph: wait ? 'wait' : 'go', max: 20 });
}
function stealPos(c) {
  if (c.type === 'hut') { const h = W.huts.find(h => h.id === c.id); return h ? { x: h.x, z: h.z, isl: h.isl } : null; }
  if (c.type === 'store') { const g = groupById(c.id); return g && !g.dead ? { x: g.x + 2.2, z: g.z + 0.6, isl: g.isl } : null; }
  if (c.type === 'item') { const it = W.items.find(i => i.id === c.id); const o = it && PM.get(it.owner); return o ? { x: o.x, z: o.z, isl: o.isl } : null; }
  return null;
}
function runSneak(p, A, sp, dt) {
  const pos = stealPos(A.c);
  if (!pos || pos.isl !== p.isl) { p.act = null; return; }
  if (A.ph === 'wait') {
    const hour = W.t % 24;
    if (hour >= 21 || hour < 5) { A.ph = 'go'; return; }
    if (dist(p, pos) > 30) moveTo(p, pos.x + 24, pos.z, sp * 0.5, dt);
    return;
  }
  if (A.ph === 'go') {
    if (A.c.type === 'item') { const it = W.items.find(i => i.id === A.c.id); const o = it && PM.get(it.owner); if (!o || (!o.sleeping && dist(o, p) < 8)) { p.act = null; return; } }
    if (moveTo(p, pos.x, pos.z, sp * 0.7, dt) || dist(p, pos) < 1.5) { A.ph = 'take'; A.until = W.t + 0.2; }
    return;
  }
  if (W.t < A.until) return;
  const victim = PM.get(A.c.victim);
  const ws = awakeNear(p.x, p.z, 12, p).filter(w => w.id !== p.partner);
  let loot = '', what = '';
  let line = '';
  if (A.c.type === 'hut') { const h = W.huts.find(h => h.id === A.c.id); if (h) { const n = Math.min(Math.floor(h.stash), 5); h.stash -= n; p.food += n; loot = n + ' food'; what = `${nameOf(h.own)}’s hut`; line = `stole ${n} food from ${what}`; } }
  else if (A.c.type === 'store') { const g = groupById(A.c.id); if (g) { const n = Math.min(Math.floor(g.store), A.c.raid ? 7 : 5); g.store -= n; p.food += n; loot = n + ' food'; what = `${g.name}’s store`; line = `stole ${n} food from ${what}`; } }
  else if (A.c.type === 'item') { const it = W.items.find(i => i.id === A.c.id); if (it && it.owner === A.c.victim) { giveItem(it, p); loot = ITEMS[it.k].n; what = nameOf(A.c.victim); line = `stole ${what}’s ${loot}`; } }
  p.act = null;
  if (!loot) return;
  W.stats.thefts++;
  if (!ws.length) {
    p.secrets.push({ t: W.t, s: `I ${line}.` });
    if (p.secrets.length > 6) p.secrets.shift();
    mem(p, 'stole', A.c.victim, 0, `I ${line}.`);
    ev('crime', `${p.name} ${line} in the night. No one saw.`, [p.id], 2);
    if (A.c.type === 'store') { const g = groupById(A.c.id); if (g) g.raided = (g.raided || 0) + 1; if (g && p.grp) adjustHostility(p.grp, g.id, 6); }
    if (A.c.type === 'item' && victim) { mem(victim, 'theft', 0, -10, `My ${loot} is gone.`); }
    return;
  }
  const w0 = ws[0];
  ev('crime', `${p.name} ${line}, and ${w0.name} saw it happen.`, [p.id, w0.id], 3);
  milestone('firstTheft', `The first theft caught on the island: ${p.name} ${line}.`, [p.id]);
  for (const w of ws) witnessCrime(w, p, victim, 'theft', `${p.name} ${line}.`, -32);
  if (A.c.type === 'store' && p.grp) adjustHostility(p.grp, A.c.id, 18);
  if (victim && victim !== p && ws.indexOf(victim) >= 0 && (1 - victim.p.agree) + victim.p.neuro > 0.9) startConfront(victim, p, 'theft');
}
function witnessCrime(w, actor, victim, k, text, v) {
  const friend = opinion(w, actor) > 40 || kin(w, actor) >= 0.25 || w.partner === actor.id;
  if (friend && w !== victim) {
    if (wantsAI(w) && W.pend.length < 4) { raise(w, 'report', { actor: actor.id, victim: victim ? victim.id : 0, k, text }); return; }
    if (DIL.report.rule(w, { actor: actor.id, victim: victim ? victim.id : 0 }) === 'secret') { mem(w, k, actor.id, -8, text); w.mem[w.mem.length - 1].sec = true; bump(w, actor, -3, -6); return; }
  }
  mem(w, k, actor.id, v, text);
  bump(w, actor, v * 0.4, v * 0.9, -3);
  if (victim && victim !== w) bump(w, victim, 2, 0);
}
function noticeTheft(owner, h) {
  const missing = Math.round(h.seen - h.stash);
  let sus = null, low = -6;
  for (const o of W.people) {
    if (o === owner || o.id === owner.partner || o.isl !== owner.isl || ageY(o) < 12 || kin(o, owner) >= 0.25) continue;
    const op = opinion(owner, o) - (owner.mem.some(m => m.w === o.id && (m.k === 'theft' || m.k === 'greed')) ? 30 : 0);
    if (op < low) { low = op; sus = o; }
  }
  if (sus && rand() < 0.7) {
    mem(owner, 'suspect', sus.id, -22, `Someone took ${missing} food from my hut. I think it was ${sus.name}.`);
    bump(owner, sus, -8, -14);
    const guilty = sus.secrets.some(s => W.t - s.t < 48 && s.s.indexOf(owner.name) >= 0);
    ev('crime', `${owner.name} found food missing from their hut and blames ${sus.name}${guilty ? '. They’re right.' : '. It wasn’t them.'}`, [owner.id, sus.id], 2);
  } else {
    mem(owner, 'theft', 0, -10, `Someone took ${missing} food from my hut.`);
  }
}

/* ---------- confrontations & fights ---------- */
function considerConfront(p, gt) { p.grudgeT = W.t; return raise(p, 'confront', { o: gt.o.id, score: Math.round(gt.score) }); }
function startConfront(p, o, why) {
  for (const m of p.mem) if (m.w === o.id && m.v < 0) m.r = true;
  return setAct(p, { k: 'confront', who: o.id, why: why || 'grudge', ph: 'go', max: 3 });
}
function runConfront(p, A, sp, dt) {
  const o = PM.get(A.who);
  if (!o || o.isl !== p.isl || o.dead) { p.act = null; return; }
  if (A.ph === 'go') {
    if (moveTo(p, o.x + 0.8, o.z + 0.3, sp, dt) || dist(p, o) < 1.8) {
      if (A.attack && !(o.act && (o.act.k === 'ride' || o.act.k === 'fight'))) { p.act = null; ev('conflict', `${p.name} went after ${o.name}.`, [p.id, o.id], 2); startFight(p, o, 'grudge'); return; }
      if (o.act && (o.act.k === 'ride' || o.act.k === 'fight' || o.act.k === 'council' || o.act.k === 'murder')) { p.act = null; return; }
      A.ph = 'face'; A.until = W.t + 0.3;
      setAct(o, { k: 'chat', with: p.id, until: W.t + 0.3, max: 1 });
      p.dir = Math.atan2(o.z - p.z, o.x - p.x); o.dir = p.dir + Math.PI;
      say(p, 'confront', { o: o.name });
      ev('conflict', `${p.name} confronted ${o.name}.`, [p.id, o.id], 2);
    }
    return;
  }
  if (W.t < A.until) { if (rand() < dt * 4) say(rand() < 0.5 ? p : o, rand() < 0.5 ? 'confront' : 'deny', { o: rand() < 0.5 ? o.name : p.name }); return; }
  p.act = null;
  const guilty = o.secrets.some(s => s.s.indexOf(p.name) >= 0) || p.mem.some(m => m.w === o.id && m.k === 'theft' && !m.h);
  const confess = guilty && (o.p.honest > 0.6 || R(o, p)[3] > 40 || o.p.agree > 0.75);
  const heat = (p.p.neuro + o.p.neuro) * 0.35 + (1 - (p.p.agree + o.p.agree) / 2) * 0.35 + (relA(p, o) < -50 ? 0.15 : 0);
  if (confess) {
    say(o, 'sorry');
    bump(p, o, 8, 4); bump(o, p, 2, 0, 2);
    o.secrets = o.secrets.filter(s => s.s.indexOf(p.name) < 0);
    ev('conflict', `${o.name} admitted it to ${p.name} and said sorry.`, [o.id, p.id], 1);
    return;
  }
  say(o, 'deny');
  bump(p, o, -6, -6); bump(o, p, guilty ? -6 : -14, guilty ? -4 : -12);
  if (rand() < heat && W.t - (p.lastFight || -1e9) > 72 && W.t - (o.lastFight || -1e9) > 48) startFight(p, o, 'confrontation');
}
function startFight(a, b, cause) {
  a.lastFight = W.t; b.lastFight = W.t;
  setAct(a, { k: 'fight', with: b.id, until: W.t + 0.22, agg: true, cause, max: 1 });
  setAct(b, { k: 'fight', with: a.id, until: W.t + 0.22, agg: false, cause, max: 1 });
  a.dir = Math.atan2(b.z - a.z, b.x - a.x); b.dir = a.dir + Math.PI;
  say(a, 'fight'); say(b, 'fight');
}
function runFight(p, A, dt) {
  const o = PM.get(A.with);
  if (!o || o.dead) { p.act = null; return; }
  p.dir = Math.atan2(o.z - p.z, o.x - p.x);
  if (!A.agg) { if (W.t >= A.until + 0.05) p.act = null; return; }
  let stopped = null;
  if (rand() < dt * 3) near(p.x, p.z, 10, w => { if (!stopped && w !== p && w !== o && !w.sleeping && ageY(w) >= ADULT && w.p.agree > 0.6 && rand() < 0.4) stopped = w; });
  if (stopped) { ev('conflict', `${stopped.name} pulled ${p.name} and ${o.name} apart.`, [stopped.id], 1); bump(p, stopped, 0, 0, 1); A.until = W.t; }
  if (W.t < A.until) { if (rand() < dt * 5) say(rand() < 0.5 ? p : o, 'fight'); return; }
  resolveFight(p, o, A.cause, !!stopped);
  p.act = null;
  if (o.act && o.act.k === 'fight') o.act = null;
}
function power(p) { return 0.5 * p.g.str + ((PROFS[p.prof] && PROFS[p.prof].fight) || 0) + fightBonus(p) + p.hp / 250 + (ageY(p) > 55 ? -0.15 : 0) + rand() * 0.45; }
function resolveFight(a, b, cause, stopped) {
  W.stats.fights++;
  milestone('firstFight', `${a.name} and ${b.name} had the island’s first fight.`, [a.id, b.id]);
  const pa = power(a), pb = power(b);
  const win = pa >= pb ? a : b, lose = win === a ? b : a;
  const armed = fightBonus(win) >= 0.15;
  const dmg = (stopped ? 6 : 12) + rand() * (stopped ? 10 : 26) * (armed ? 1.5 : 1);
  hurt(lose, dmg, 'fight', win);
  hurt(win, 3 + rand() * 9, 'fight', lose);
  bump(a, b, -20, -10); bump(b, a, -20, -10);
  bump(lose, win, 0, 0, 3, 25);
  const ws = awakeNear(a.x, a.z, 18, a).filter(w => w !== b);
  for (const w of ws) {
    const just = opinion(w, b) < -10;
    if (just) bump(w, a, 0, 2, 3);
    else { bump(w, a, -6, -6, -4); mem(w, 'assault', a.id, -18, `${a.name} attacked ${b.name}.`); }
  }
  if (lose.dead) {
    ev('death', `${win.name} killed ${lose.name} in a fight.`, [win.id, lose.id], 4);
    for (const w of ws) mem(w, 'murder', win.id, -70, `${win.name} killed ${lose.name}.`);
    W.stats.murders++;
    const g = grpOf(win);
    if (g) g.accuse.push({ by: ws[0] ? ws[0].id : 0, vs: win.id, k: 'murder' });
  } else ev('fight', `${a.name} and ${b.name} came to blows${stopped ? ' until others pulled them apart' : ''}. ${lose.name} came off worse.`, [a.id, b.id], 3);
  life(lose, `${win.name} beat me in a fight.`);
  life(win, `I fought ${lose.name}${lose.dead ? ' and killed them' : ' and won'}.`);
}

/* ---------- bullying ---------- */
function bullyTarget(p) {
  let best = null, bs = 1e9;
  const mine = 0.5 * p.g.str + fightBonus(p) + ((PROFS[p.prof] && PROFS[p.prof].fight) || 0);
  near(p.x, p.z, 40, o => {
    if (o === p || o.grp !== p.grp || ageY(o) < 14 || o.id === p.partner || kin(o, p) >= 0.25 || o.sleeping) return;
    if (o.act && !LOW.has(o.act.k) && o.act.k !== 'eat' && o.act.k !== 'stock' && o.act.k !== 'fish') return;
    const theirs = 0.5 * o.g.str + fightBonus(o) + ((PROFS[o.prof] && PROFS[o.prof].fight) || 0);
    if (theirs >= mine || opinion(p, o) > 30) return;
    const worth = o.food + (itemsOf(o).length ? 4 : 0);
    if (worth < 2) return;
    const s = theirs - worth * 0.05;
    if (s < bs) { bs = s; best = o; }
  });
  return best;
}
function actBully(p, v) { p.lastBully = W.t; return setAct(p, { k: 'demand', who: v.id, ph: 'go', max: 3 }); }
function runDemand(p, A, sp, dt) {
  const v = PM.get(A.who);
  if (!v || v.isl !== p.isl) { p.act = null; return; }
  if (A.ph === 'go') {
    if (moveTo(p, v.x + 0.8, v.z + 0.3, sp, dt) || dist(p, v) < 1.8) {
      if (v.act && (v.act.k === 'ride' || v.act.k === 'fight' || v.act.k === 'council')) { p.act = null; return; }
      A.ph = 'face'; A.until = W.t + 0.25;
      setAct(v, { k: 'chat', with: p.id, until: W.t + 0.25, max: 1 });
      p.dir = Math.atan2(v.z - p.z, v.x - p.x); v.dir = p.dir + Math.PI;
      say(p, 'demand', { o: v.name });
    }
    return;
  }
  if (W.t < A.until) return;
  p.act = null;
  const ws = awakeNear(p.x, p.z, 16, p).filter(w => w !== v);
  const gives = R(v, p)[3] > 25 || (v.p.neuro + (1 - v.p.agree) < 0.95 && v.g.str < p.g.str);
  if (gives) {
    const its = itemsOf(v).filter(i => !itemsOf(p).some(j => j.k === i.k));
    let what = '';
    if (its.length && rand() < 0.5) { giveItem(its[0], p); what = `${v.name}’s ${ITEMS[its[0].k].n}`; }
    else { const n = Math.max(1, Math.floor(v.food / 2)); v.food -= n; p.food += n; what = `${n} of ${v.name}’s food`; }
    mem(v, 'bullied', p.id, -20, `${p.name} took ${what.replace(v.name + '’s ', 'my ')} and I let them.`);
    bump(v, p, -12, -14, 0, 12);
    for (const w of ws) { mem(w, 'bully', p.id, -10, `${p.name} pushed ${v.name} around.`); bump(w, p, -4, -5, w.p.agree < 0.4 ? 3 : -1, 6); }
    ev('conflict', `${p.name} made ${v.name} hand over ${what}.`, [p.id, v.id], 2);
    milestone('firstBully', `${p.name} was the first to take what they wanted by force.`, [p.id]);
    return;
  }
  say(v, 'refuse', { o: p.name });
  bump(v, p, -8, -8); bump(p, v, -10, -4);
  mem(v, 'bullied', p.id, -14, `${p.name} tried to take my things.`);
  if ((p.p.neuro > 0.5 || p.p.agree < 0.25) && W.t - (p.lastFight || -1e9) > 72) { ev('conflict', `${v.name} refused to give ${p.name} anything. It turned ugly.`, [p.id, v.id], 2); startFight(p, v, 'demand'); }
  else { for (const w of ws) bump(w, p, 0, 0, -3); ev('conflict', `${v.name} stood up to ${p.name}, who backed down.`, [p.id, v.id], 1); }
}

/* ---------- affairs ---------- */
function considerAffair(p, o) { return raise(p, 'affair', { o: o.id, m: p.partner }); }
function actTryst(p, o) {
  const ok = relA(o, p) > 30 && attraction(o, p) > 0.38 && (!o.partner || relA(o, PM.get(o.partner) || o) < 30 || (1 - o.p.honest) > 0.45);
  if (!ok || (o.act && !LOW.has(o.act.k))) { bump(p, o, -2, 0); return false; }
  const g = grpOf(p) || p;
  const pt = randLand(p.isl, g.x, g.z, 22, 40, { minH: 1 }) || { x: p.x + 20, z: p.z };
  setAct(p, { k: 'tryst', who: o.id, tx: pt.x, tz: pt.z, ph: 'go', max: 5 });
  setAct(o, { k: 'tryst', who: p.id, tx: pt.x + 0.8, tz: pt.z + 0.4, ph: 'go', max: 5, follower: true });
  return true;
}
function runTryst(p, A, sp, dt) {
  const o = PM.get(A.who);
  if (!o || o.dead || !o.act || o.act.k !== 'tryst') { p.act = null; return; }
  if (A.ph === 'go') { if (moveTo(p, A.tx, A.tz, sp, dt)) { A.ph = 'wait'; } return; }
  if (A.ph === 'wait') { if (o.act.ph !== 'go' && dist(p, o) < 3) { A.ph = 'with'; A.until = W.t + 1; } return; }
  if (A.follower) { if (W.t >= A.until + 0.1) p.act = null; return; }
  p.dir = Math.atan2(o.z - p.z, o.x - p.x);
  if (rand() < dt * 1.5) say(p, 'flirt', { o: o.name });
  if (!A.seen && rand() < dt * 2) {
    const ws = awakeNear(p.x, p.z, 18, p).filter(w => w !== o);
    if (ws.length) { A.seen = true; caught(p, o, ws); }
  }
  if (W.t >= A.until) {
    bump(p, o, 14, 6); bump(o, p, 14, 6);
    const f = p.sex === 'F' ? p : o, m = f === p ? o : p;
    if (!f.preg && ageY(f) < 44 && W.t - f.lastBirth > HPY * 0.8 && rand() < 0.12 * (0.5 + f.g.fert)) {
      f.preg = { due: W.t + 0.75 * HPY, dad: m.id, secret: f.partner && f.partner !== m.id };
      if (f.preg.secret) f.secrets.push({ t: W.t, s: `The child I carry is ${m.name}’s, not ${nameOf(f.partner)}’s.` });
    }
    if (!A.seen) { const s = `I met ${o.name} in secret.`; p.secrets.push({ t: W.t, s }); o.secrets.push({ t: W.t, s: `I met ${p.name} in secret.` }); if (p.secrets.length > 6) p.secrets.shift(); if (o.secrets.length > 6) o.secrets.shift(); }
    W.stats.affairs++;
    ev('love', `${p.name} and ${o.name} slipped away together in secret.`, [p.id, o.id], 2);
    p.act = null;
  }
}
function caught(p, o, ws) {
  const cheaters = [p, o].filter(x => x.partner && x.partner !== p.id && x.partner !== o.id);
  for (const w of ws) {
    for (const c of cheaters) {
      const other = c === p ? o : p;
      if (w.id === c.partner) betrayal(w, c, other, null);
      else { mem(w, 'affair', c.id, -16, `I saw ${c.name} with ${other.name}.`); w.mem[w.mem.length - 1].w2 = other.id; bump(w, c, -4, -8); }
    }
  }
  ev('scandal', `${ws[0].name} caught ${p.name} and ${o.name} together.`, [p.id, o.id, ws[0].id], 3);
  milestone('firstScandal', `The island’s first scandal: ${p.name} and ${o.name}.`, [p.id, o.id]);
}

/* ---------- murder ---------- */
function considerKill(p, o) { return raise(p, 'kill', { o: o.id }); }
function runMurder(p, A, sp, dt) {
  const o = PM.get(A.who);
  if (!o || o.dead || o.isl !== p.isl) { p.act = null; return; }
  moveTo(p, o.x, o.z, sp * 1.05, dt);
  if (dist(p, o) > 1.6) return;
  p.act = null;
  const ws = awakeNear(o.x, o.z, 16, p).filter(w => w !== o);
  if (ws.length) { startFight(p, o, 'attack'); return; }
  if (power(p) + 0.25 < power(o) && rand() < 0.5) { startFight(p, o, 'attack'); return; }
  killP(o, 'murder', p.id);
  W.stats.murders++;
  W.bodies.push({ id: o.id, name: o.name, x: o.x, z: o.z, t: W.t, killer: p.id, found: false });
  p.secrets.push({ t: W.t, s: `I killed ${o.name}. No one saw.` });
  mem(p, 'killed', o.id, 0, `I killed ${o.name}.`);
  ev('murder', `${p.name} killed ${o.name} where no one could see.`, [p.id, o.id], 5);
  milestone('firstMurder', `${p.name} committed the island’s first murder.`, [p.id]);
  life(p, `I killed ${o.name}.`);
}
function checkBodies() {
  for (const b of W.bodies) {
    if (b.found) continue;
    if (W.t - b.t > 72) { b.found = true; continue; }
    let finder = null;
    near(b.x, b.z, 9, q => { if (!finder && q.id !== b.killer && !q.sleeping && ageY(q) >= 10) finder = q; });
    if (!finder) continue;
    b.found = true;
    ev('murder', `${finder.name} found ${b.name}’s body.`, [finder.id], 3);
    const known = new Map();
    for (const q of W.people) {
      if (q.isl !== finder.isl) continue;
      mem(q, 'grief', 0, -5, `${b.name} was found dead. Someone killed them.`);
      for (const m of q.mem) if (m.w && m.w !== b.id && (m.k === 'assault' || m.k === 'murder' || m.k === 'jealous' || m.k === 'betrayal')) known.set(m.w, (known.get(m.w) || 0) + 1);
    }
    let sus = null, sc = 0;
    for (const [id, n] of known) { const s = n + (id === b.killer ? 1.5 : 0) * rand(); if (s > sc) { sc = s; sus = PM.get(id); } }
    const g = grpOf(finder);
    if (sus && g && sus.grp === g.id) { g.accuse.push({ by: finder.id, vs: sus.id, k: 'murder' }); for (const q of members(g)) if (q !== sus) bump(q, sus, -10, -20); ev('murder', `People in ${g.name} are whispering that ${sus.name} did it${sus.id === b.killer ? '' : '. They didn’t'}.`, [sus.id], 2); }
  }
  if (W.bodies.length > 10) W.bodies = W.bodies.filter(b => !b.found || W.t - b.t < 24);
}

/* ---------- councils, leadership, exile, splits ---------- */
function startCouncil(g) {
  const att = [];
  for (const p of W.people) {
    if (p.grp !== g.id || ageY(p) < 14 || p.isl !== g.isl || dist(p, g) > 100) continue;
    const k = p.act ? p.act.k : '';
    if (k === 'ride' || k === 'fight' || k === 'murder' || k === 'tryst' || k === 'sneak') continue;
    att.push(p);
  }
  if (att.length < 3) { g.nextCouncil = W.t + 24; return; }
  g.council = { start: W.t, end: W.t + 1.5, att: att.map(p => p.id), challenger: 0 };
  for (const p of att) { const G = goalOf(p); if (G && G.k === 'undermine' && !G.acc && att.some(o => o.id === G.o) && !g.accuse.some(a => a.vs === G.o) && p.mem.some(m => m.w === G.o && m.v <= -15)) { G.acc = true; g.accuse.push({ by: p.id, vs: G.o, k: 'grudge' }); } }
  att.forEach((p, i) => { const a = i / att.length * Math.PI * 2; setAct(p, { k: 'council', g: g.id, tx: g.x + Math.cos(a) * 4.5, tz: g.z + Math.sin(a) * 4.5, max: 3 }); });
  if (g.accuse.length) ev('council', `${g.name} gathered around the fire. ${nameOf(g.accuse[0].by)} has an accusation to make against ${nameOf(g.accuse[0].vs)}.`, [g.accuse[0].vs], 2);
  const leader = PM.get(g.leader);
  if (leader) {
    let best = null, bs = 0;
    for (const p of att) {
      if (p === leader || p.p.ambit < 0.5) continue;
      let sup = 0, lsup = 0;
      for (const v of att) { sup += relR(v, p) + relA(v, p) * 0.4; lsup += relR(v, leader) + relA(v, leader) * 0.4; }
      const G = goalOf(p), want = G && G.k === 'lead' ? 0.6 : 0;
      const s = sup / Math.max(1, lsup) + p.p.ambit - opinion(p, leader) / 100 + want;
      if ((sup > lsup * 0.6 || (want && sup > lsup * 0.4)) && s > bs) { bs = s; best = p; }
    }
    if (best) raise(best, 'challenge', { g: g.id, leader: leader.id });
  }
}
function councilSpeech(p, g) {
  const acc = g.accuse[0];
  if (acc && rand() < 0.5) say(p, 'accuse', { s: nameOf(acc.vs) }, g);
  else say(p, 'council', {}, g);
}
function resolveCouncil(g) {
  const att = g.council.att.map(id => PM.get(id)).filter(p => p && p.grp === g.id);
  for (const d of W.pend.slice()) if (d.kind === 'challenge' && d.ctx.g === g.id) resolvePending(d.id, null, null, false);
  const done = new Set();
  for (const a of g.accuse) {
    if (done.has(a.vs)) continue;
    done.add(a.vs);
    const S = PM.get(a.vs);
    if (!S || S.grp !== g.id) continue;
    const accuser = PM.get(a.by);
    let yes = 0, no = 0;
    for (const v of att) {
      if (v === S) continue;
      let s = -relT(v, S) * 0.6 - relA(v, S) * 0.3 + (accuser ? relT(v, accuser) * 0.3 : 0) + (a.k === 'murder' ? 20 : 0);
      if (kin(v, S) >= 0.25) s -= 60;
      if (v.partner === S.id) s -= 80;
      if (s > 12) yes++; else no++;
    }
    if (yes > no && yes >= 2) exile(S, g, a.k, yes, no);
    else {
      ev('council', `${g.name} would not cast out ${S.name}${accuser ? `, whatever ${accuser.name} said` : ''} (${yes} for, ${no} against).`, [S.id], 2);
      if (accuser) { for (const v of att) if (v !== accuser) bump(v, accuser, 0, -2, -3); bump(S, accuser, -15, -10); }
    }
  }
  g.accuse = [];
  const voters = att.filter(p => p.grp === g.id && ageY(p) >= ADULT);
  if (voters.length >= 3) {
    const tally = new Map(), ch = g.council.challenger;
    for (const v of voters) {
      let best = null, bs = -1e9;
      for (const c of voters) {
        let s = relR(v, c) * 0.7 + relA(v, c) * 0.3 + (v.rel[c.id] ? v.rel[c.id][3] * 0.35 : 0);
        if (c === v) s += v.p.ambit > 0.6 ? (v.p.ambit - 0.6) * 70 : -12;
        if (c.id === ch) s += c.p.extra * 25;
        if (c.id === g.leader) s += 16;
        if (ageY(c) < 20) s -= 25;
        if (s > bs) { bs = s; best = c; }
      }
      tally.set(best.id, (tally.get(best.id) || 0) + 1);
    }
    let top = 0, tv = 0;
    for (const [id, n] of tally) if (n > tv) { tv = n; top = id; }
    const old = g.leader;
    const incVotes = tally.get(old) || 0;
    if (tv >= Math.max(2, voters.length * 0.3) && top !== old && (!old || !PM.get(old) || PM.get(old).grp !== g.id || tv > incVotes + 1)) {
      g.leader = top;
      const L = PM.get(top);
      const was = PM.get(old);
      ev('leader', ch === top && was ? `${L.name} challenged ${was.name} in front of everyone and took over ${g.name} (${tv} of ${voters.length}).` : was ? `${g.name} turned to ${L.name}. ${was.name} no longer leads (${tv} of ${voters.length}).` : `${g.name} chose ${L.name} to lead them (${tv} of ${voters.length}).`, [top], 3);
      milestone('firstLeader', `${L.name} became the island’s first leader.`, [top]);
      life(L, `I became the leader of ${g.name}.`);
      if (was) { life(was, `I lost the lead of ${g.name} to ${L.name}.`); bump(was, L, -15, -10); mem(was, 'humiliated', L.id, -20, `${L.name} took ${g.name} from me.`); }
    } else if (ch && ch !== top) {
      const C = PM.get(ch), L = PM.get(g.leader);
      if (C && L) { ev('leader', `${C.name} challenged ${L.name} for ${g.name} and lost.`, [ch, g.leader], 3); for (const v of voters) bump(v, C, 0, -2, -4); bump(L, C, -20, -15); bump(C, L, -10, -5); mem(L, 'challenge', C.id, -15, `${C.name} tried to take ${g.name} from me.`); }
    }
    const L = PM.get(g.leader);
    if (L) for (const v of voters) if (v !== L) bump(v, L, 0, 0, 0.8);
  }
  if (!g.split) checkSplit(g, att);
  for (const p of att) if (p.act && p.act.k === 'council') p.act = null;
  g.council = null;
  g.nextCouncil = W.t + 60 + rand() * 16;
}
function exile(S, g, k, yes, no) {
  const why = k === 'murder' ? 'murder' : k === 'theft' ? 'stealing' : k === 'assault' ? 'violence' : 'what they did';
  S.grp = 0; S.exiled = g.id; S.exileT = W.t;
  if (g.leader === S.id) g.leader = 0;
  const h = hutOf(S);
  if (h && h.own === S.id) h.own = 0;
  S.home = 0;
  W.stats.exiles++;
  ev('exile', `${g.name} voted ${yes} to ${no} to cast out ${S.name} for ${why}.`, [S.id], 4);
  milestone('firstExile', `${S.name} became the island’s first outcast.`, [S.id]);
  life(S, `${g.name} cast me out for ${why}.`);
  mem(S, 'exiled', g.leader || 0, -40, `${g.name} threw me out.`);
  say(S, 'deny');
  const m = PM.get(S.partner);
  if (m && m.grp === g.id) {
    let groupLove = 0, n = 0;
    for (const o of members(g)) if (o !== m) { groupLove += relA(m, o); n++; }
    groupLove = n ? groupLove / n : 0;
    if (relA(m, S) > groupLove + 15) {
      m.grp = 0; m.home = 0;
      for (const kd of m.kids.map(id => PM.get(id)).filter(k => k && ageY(k) < ADULT)) { kd.grp = 0; kd.home = 0; }
      ev('exile', `${m.name} went with ${S.name} rather than stay.`, [m.id], 2);
    } else if (rand() < 0.5) { m.partner = 0; S.partner = 0; m.widowT = W.t - HPY * 0.4; ev('love', `${m.name} stayed behind. Their time with ${S.name} is over.`, [m.id], 2); }
  }
  actLeaveArea(S, g);
}
function checkSplit(g, att) {
  const L = PM.get(g.leader);
  const ms = adultsOf(g);
  if (!L || ms.length < 6) return;
  const dis = ms.filter(p => p !== L && (relT(p, L) < -18 || relA(p, L) < -28));
  let F = null, fs = 0;
  for (const c of dis) { if (c.p.ambit < 0.42) continue; let s = 0; for (const d of dis) s += relR(d, c) + relA(d, c) * 0.5; if (s > fs) { fs = s; F = c; } }
  const crowded = ms.length > 16 || members(g).length > 24;
  if (!F && crowded) { let best = null, bs = 0; for (const c of ms) { if (c === L || c.p.ambit < 0.5) continue; let s = 0; for (const d of ms) s += relR(d, c); if (s > bs) { bs = s; best = c; } } F = best; }
  if (!F) return;
  const cand = ms.filter(p => p !== F && p !== L && opinion(p, F) > opinion(p, L) + 5 && opinion(p, F) > 5);
  if (cand.length < 2 || cand.length + 1 > ms.length - 2) return;
  const hrs = ((32 - W.t % 24) % 24) || 24;
  g.split = { leader: F.id, cand: cand.map(p => p.id), follow: [F.id], depart: W.t + hrs };
  ev('split', `${F.name} has had enough of ${L.name} and wants to leave ${g.name}. ${cand.length} others are thinking about going too.`, [F.id, L.id], 3);
  for (const c of cand) raise(c, 'leave', { g: g.id, f: F.id, l: L.id });
}
function departSplit(g) {
  const s = g.split;
  g.split = null;
  const F = PM.get(s.leader);
  if (!F || F.grp !== g.id) return;
  const fol = s.follow.map(id => PM.get(id)).filter(p => p && p.grp === g.id);
  if (fol.length < 3) { ev('split', `${F.name}’s plan to leave ${g.name} fell apart. Not enough people would go.`, [F.id], 2); bump(F, PM.get(g.leader) || F, -5, -5); return; }
  let pt = null;
  for (let k = 0; k < 30 && !pt; k++) { const c = ISLES[g.isl]; const q = randLand(g.isl, c.x, c.z, 10, c.r * 0.9, { minH: 1, maxH: 8 }); if (q && W.groups.every(o => o.dead || Math.hypot(o.x - q.x, o.z - q.z) > 45)) pt = q; }
  if (!pt) { ev('split', `${F.name} wanted to leave ${g.name}, but there was nowhere left to go on this island.`, [F.id], 1); return; }
  const ng = foundCamp(F, fol, pt);
  W.stats.splits++;
  adjustHostility(g.id, ng.id, 25);
  ev('split', `${F.name} led ${fol.length - 1} people out of ${g.name}. They founded ${ng.name}.`, fol.map(p => p.id), 4);
  milestone('firstSplit', `The castaways split for the first time. ${F.name} founded ${ng.name}.`, [F.id]);
}
function askToJoin(p, g) {
  const ms = adultsOf(g).filter(o => dist(o, g) < 40);
  if (!ms.length) { joinGroup(p, g); return; }
  if (p.exiled === g.id && W.t - p.exileT < HPY * 3) { say(ms[0], 'exile'); bump(p, ms[0], -5, -5); return; }
  let s = 0;
  for (const o of ms) s += opinion(o, p);
  s /= ms.length;
  const L = PM.get(g.leader);
  if (s > -6 && (!L || opinion(L, p) > -15)) {
    joinGroup(p, g);
    say(ms[0], 'welcome', { o: p.name }, g);
    ev('join', `${g.name} took in ${p.name}${p.exiled ? ', an outcast' : ''}.`, [p.id], 2);
    for (const o of ms) bump(p, o, 4, 3);
  } else {
    say(ms[0], 'exile', {}, g);
    mem(p, 'rejected', L ? L.id : ms[0].id, -12, `${g.name} turned me away.`);
    if (rand() < 0.3) ev('join', `${g.name} turned ${p.name} away.`, [p.id], 1);
  }
}
function doTrade(p, fg) {
  if (p.food <= 0) return;
  fg.store += p.food;
  const amt = p.food;
  p.food = 0;
  near(fg.x, fg.z, 30, o => { if (o.grp === fg.id) { bump(o, p, 4, 4, 2); } });
  if (p.grp) { adjustHostility(p.grp, fg.id, -6); const k = p.grp < fg.id ? p.grp + '-' + fg.id : fg.id + '-' + p.grp; const r = W.routes[k] || (W.routes[k] = { a: Math.min(p.grp, fg.id), b: Math.max(p.grp, fg.id), n: 0, t: 0 }); r.n++; r.t = W.t; if (r.n === 5) ev('trade', `${(groupById(r.a) || {}).name} and ${(groupById(r.b) || {}).name} trade so often now that a path has worn between the two camps.`, [], 2); }
  say(p, 'trade', {}, grpOf(p));
  if (rand() < 0.06) ev('trade', `${p.name} carried ${amt} food to ${fg.name} as a gift between camps.`, [p.id], 1);
}
function adjustHostility(a, b, d) {
  if (!a || !b || a === b) return;
  const k = a < b ? a + '-' + b : b + '-' + a;
  W.gRel[k] = clamp((W.gRel[k] || 0) + d, -100, 100);
}
function updateGroupRelations() {
  const live = W.groups.filter(g => !g.dead);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const A = adultsOf(live[i]), Bm = adultsOf(live[j]);
    let s = 0, n = 0;
    for (const a of A) for (const b of Bm) { s += opinion(a, b) + opinion(b, a); n += 2; }
    const base = n ? -s / n : 0;
    const k = live[i].id < live[j].id ? live[i].id + '-' + live[j].id : live[j].id + '-' + live[i].id;
    W.gRel[k] = clamp((W.gRel[k] || 0) * 0.85 + base * 0.15 + (live[i].isl !== live[j].isl ? -1 : 0), -100, 100);
  }
}

/* ---------- dilemmas (the decisions Claude can make for the spotlight cast) ---------- */
export const DIL = {
  steal: {
    opts: (p, c) => [['steal', c.type === 'item' ? `Steal ${nameOf(c.victim)}’s ${ITEMS[(W.items.find(i => i.id === c.id) || { k: 'knife' }).k].n}` : 'Steal the food'], ['honest', 'Stay honest']],
    text: (p, c) => { const what = c.type === 'hut' ? `${nameOf(c.victim)}’s hut, where they keep a private stash of food` : c.type === 'store' ? `the food store of ${(groupById(c.id) || {}).name || 'another camp'}` : `the ${ITEMS[(W.items.find(i => i.id === c.id) || { k: 'knife' }).k].n} that ${nameOf(c.victim)} owns`; return `You are ${p.hun < 30 ? 'hungry' : 'thinking'}${p.food < 1 ? ' and have nothing to eat' : ''}. You could sneak over to ${what} and take it, hoping no one sees.`; },
    rule: (p, c) => ((1 - p.p.honest) * 0.7 + clamp((32 - p.hun) / 32, 0, 1) * 0.55 + (1 - p.p.agree) * 0.2 + (c.raid ? 0.1 : 0) > 0.62 ? 'steal' : 'honest'),
    apply: (p, c, k) => (k === 'steal' ? actSteal(p, c) : false),
  },
  report: {
    noPonder: true,
    opts: (p, c) => [['tell', 'Tell the others what you saw'], ['secret', `Keep ${nameOf(c.actor)}’s secret`]],
    text: (p, c) => `You just saw ${nameOf(c.actor)}, someone you care about, do something wrong: ${c.text} Nobody else noticed.`,
    rule: (p, c) => { const a = PM.get(c.actor), v = PM.get(c.victim); return p.p.honest * 0.7 + (v ? opinion(p, v) / 200 : 0) > (a ? opinion(p, a) / 150 : 0) + 0.25 ? 'tell' : 'secret'; },
    apply: (p, c, k) => { const a = PM.get(c.actor); if (!a) return false; if (k === 'tell') { mem(p, c.k || 'theft', a.id, -30, c.text); bump(p, a, -10, -25); } else { mem(p, c.k || 'theft', a.id, -8, c.text); p.mem[p.mem.length - 1].sec = true; } return false; },
  },
  confront: {
    opts: (p, c) => { const o = PM.get(c.o); const g = grpOf(p); const o2 = [['face', `Confront ${o ? o.name : 'them'} face to face`], ['fight', `Attack ${o ? o.name : 'them'}`], ['forgive', 'Let it go']]; if (g && o && o.grp === g.id) o2.unshift(['accuse', `Accuse ${o.name} in front of the camp at the next council`]); return o2; },
    text: (p, c) => { const o = PM.get(c.o); const why = p.mem.filter(m => m.w === c.o && m.v < 0).slice(-3).map(m => m.s).join(' '); return `${o ? o.name : 'Someone'} has wronged you. What you know: ${why || 'it has been building for a while.'}`; },
    rule: (p, c) => { const o = PM.get(c.o), g = grpOf(p); if (!o) return 'forgive'; if (p.p.agree > 0.72 && c.score < 50) return 'forgive'; if (p.p.neuro > 0.62 && p.g.str > o.g.str - 0.1 && p.p.agree < 0.45) return 'fight'; if (g && o.grp === g.id && (p.p.extra > 0.5 || c.score > 45)) return 'accuse'; return 'face'; },
    apply: (p, c, k) => { const o = PM.get(c.o); if (!o) return false; for (const m of p.mem) if (m.w === o.id && m.v < 0) m.r = true; if (k === 'accuse') { const g = grpOf(p); if (g) { const why = p.mem.filter(m => m.w === o.id && m.v < 0).slice(-1)[0]; g.accuse.push({ by: p.id, vs: o.id, k: why ? why.k : 'grudge' }); ev('conflict', `${p.name} plans to accuse ${o.name} at the next council.`, [p.id, o.id], 2); } return false; } if (k === 'fight') { if (dist(p, o) < 60) return setAct(p, { k: 'confront', who: o.id, why: 'attack', ph: 'go', max: 3, attack: true }); return false; } if (k === 'face') return startConfront(p, o, 'grudge'); bump(p, o, 6, 2); mem(p, 'forgave', o.id, 4, `I decided to let it go with ${o.name}.`); return false; },
  },
  affair: {
    opts: (p, c) => [['meet', `Meet ${nameOf(c.o)} in secret`], ['loyal', `Stay faithful to ${nameOf(c.m)}`]],
    text: (p, c) => `You are with ${nameOf(c.m)}, but you can’t stop thinking about ${nameOf(c.o)}, who seems to want you too. You could slip away with ${nameOf(c.o)} tonight.`,
    rule: (p, c) => { const o = PM.get(c.o), m = PM.get(c.m); if (!o || !m) return 'loyal'; const G = goalOf(p); return (1 - p.p.agree) * 0.35 + (1 - p.p.honest) * 0.3 + (attraction(p, o) - attraction(p, m)) * 0.8 + p.p.neuro * 0.1 + (relA(p, m) < 10 ? 0.15 : 0) + (G && G.k === 'court' && G.o === o.id ? 0.3 : 0) > 0.55 ? 'meet' : 'loyal'; },
    apply: (p, c, k) => { const o = PM.get(c.o); if (k === 'meet' && o) return actTryst(p, o); if (o) bump(p, o, -3, 0); return false; },
  },
  kill: {
    opts: (p, c) => [['kill', `Kill ${nameOf(c.o)} while no one is watching`], ['walk', 'Walk away']],
    text: (p, c) => `You hate ${nameOf(c.o)}. ${p.mem.filter(m => m.w === c.o && m.v < 0).slice(-3).map(m => m.s).join(' ')} Right now ${nameOf(c.o)} is alone, and no one else is around.`,
    rule: (p, c) => { const revenge = p.mem.some(m => m.k === 'murder' && m.w === c.o); const G = goalOf(p); return rand() < 0.07 + (1 - p.p.agree) * 0.1 + p.p.neuro * 0.06 + (revenge ? 0.25 : 0) + (G && G.k === 'revenge' && G.o === c.o ? 0.1 : 0) ? 'kill' : 'walk'; },
    apply: (p, c, k) => { const o = PM.get(c.o); if (k === 'kill' && o) return setAct(p, { k: 'murder', who: o.id, max: 3 }); return false; },
  },
  challenge: {
    noPonder: true,
    opts: (p, c) => [['challenge', `Challenge ${nameOf(c.leader)} for the lead tonight`], ['quiet', 'Stay quiet for now']],
    text: (p, c) => `The camp is gathered around the fire. ${nameOf(c.leader)} leads ${(groupById(c.g) || {}).name}. Some people respect you more than you think. You could stand up and challenge ${nameOf(c.leader)} for the leadership right now.`,
    rule: (p, c) => { const L = PM.get(c.leader), G = goalOf(p); return p.p.ambit * 0.6 + p.p.extra * 0.25 - (L ? opinion(p, L) / 150 : 0) + (G && G.k === 'lead' ? 0.3 : 0) > 0.55 ? 'challenge' : 'quiet'; },
    apply: (p, c, k) => { const g = groupById(c.g); if (k === 'challenge' && g && g.council) { g.council.challenger = p.id; say(p, 'council', {}, g); } return false; },
  },
  leave: {
    noPonder: true,
    opts: (p, c) => [['follow', `Leave with ${nameOf(c.f)}`], ['stay', `Stay in ${(groupById(c.g) || {}).name}`]],
    text: (p, c) => `${nameOf(c.f)} is leaving ${(groupById(c.g) || {}).name} tomorrow morning to start a new camp, because of ${nameOf(c.l)}. ${nameOf(c.f)} asked you to come.`,
    rule: (p, c) => { const f = PM.get(c.f), l = PM.get(c.l), G = goalOf(p); if (!f) return 'stay'; return opinion(p, f) + (G && G.k === 'leave' ? 25 : 0) > (l ? opinion(p, l) : 0) + 8 ? 'follow' : 'stay'; },
    apply: (p, c, k) => { const g = groupById(c.g); if (k === 'follow' && g && g.split && g.split.leader === c.f) { g.split.follow.push(p.id); const m = PM.get(p.partner); if (m && m.grp === g.id && g.split.follow.indexOf(m.id) < 0 && opinion(m, p) > 30) g.split.follow.push(m.id); } return false; },
  },
  voyage: {
    opts: (p, c) => [['sail', `Sail for ${ISLE_NAMES[c.dest || 2]}`], ['stay', 'Stay here']],
    text: (p, c) => { const d = c.dest || 2; if (d === 2 && !W.milestones.farLanding) return 'There is a boat at the shore. No one has crossed the open water to the island on the horizon. It might be safe land, or the sea might take you.'; if (d === 3 && !W.milestones.thirdLanding) return 'There is a boat with a sail at the shore. No one has reached the high island, with the smoke on its mountain. The water around it is rough.'; return `There is a boat at the shore. People have crossed to ${ISLE_NAMES[d]} before (${islandPop(d)} live there now). You could go and start over there.`; },
    rule: (p, c) => (desireTo(p, c.dest || 2) + rand() * 20 > 40 ? 'sail' : 'stay'),
    apply: (p, c, k) => { if (k !== 'sail') return false; const b = W.boats.find(b => !b.sail && b.isl === p.isl); if (!b) return false; return setAct(p, { k: 'voyage', boat: b.id, dest: c.dest || 0, max: 10 }); },
  },
};
function considerVoyage(p, dest) { return raise(p, 'voyage', { dest }); }
function wantsAI(p) {
  const a = W.ai;
  return !!(a.on && a.live && W.spot.indexOf(p.id) >= 0 && a.used + a.pending < a.allow && W.pend.length < 4);
}
function raise(p, kind, ctx) {
  const D = DIL[kind];
  if (wantsAI(p)) {
    const d = { id: W.nextId++, pid: p.id, kind, ctx, t: W.t, due: W.t + 8 };
    W.pend.push(d);
    W.ai.pending++;
    if (!D.noPonder) setAct(p, { k: 'ponder', d: d.id, max: -1 });
    return !D.noPonder;
  }
  return D.apply(p, ctx, D.rule(p, ctx), null) || false;
}
export function resolvePending(id, key, thought, fromAI) {
  const i = W.pend.findIndex(d => d.id === id);
  if (i < 0) return false;
  const d = W.pend[i];
  W.pend.splice(i, 1);
  W.ai.pending = Math.max(0, W.ai.pending - 1);
  if (fromAI) W.ai.used++;
  const p = PM.get(d.pid);
  if (!p) return false;
  if (p.act && p.act.k === 'ponder' && p.act.d === d.id) p.act = null;
  const D = DIL[d.kind];
  const opts = D.opts(p, d.ctx).map(o => o[0]);
  if (!key || opts.indexOf(key) < 0) key = D.rule(p, d.ctx);
  if (thought) {
    const label = (D.opts(p, d.ctx).find(o => o[0] === key) || [key, key])[1];
    W.confs.push({ t: W.t, id: p.id, name: p.name, text: String(thought).slice(0, 400), kind: d.kind, choice: label, ai: true });
    if (W.confs.length > 80) W.confs.shift();
    mem(p, 'thought', 0, 0, String(thought).slice(0, 140));
  }
  D.apply(p, d.ctx, key, thought);
  return key;
}
export function pendingInfo(d) {
  const p = PM.get(d.pid);
  if (!p) return null;
  const D = DIL[d.kind];
  return { p, kind: d.kind, text: D.text(p, d.ctx), opts: D.opts(p, d.ctx) };
}
function expirePending() {
  for (const d of W.pend.slice()) if (W.t > d.due || !PM.get(d.pid)) resolvePending(d.id, null, null, false);
}
