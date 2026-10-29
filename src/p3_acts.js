
/* ---------- spatial grid ---------- */
const GC = 10;
function buildGrid() {
  GRID.clear();
  for (const p of W.people) {
    if (p.dead) continue;
    const k = (Math.floor((p.x + B) / GC) << 8) | Math.floor((p.z + B) / GC);
    let a = GRID.get(k);
    if (!a) GRID.set(k, (a = []));
    a.push(p);
  }
}
function near(x, z, r, fn) {
  const i0 = Math.floor((x - r + B) / GC), i1 = Math.floor((x + r + B) / GC);
  const j0 = Math.floor((z - r + B) / GC), j1 = Math.floor((z + r + B) / GC);
  const r2 = r * r;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const a = GRID.get((i << 8) | j);
    if (!a) continue;
    for (const p of a) { if (p.dead) continue; const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz; if (d2 <= r2) fn(p, Math.sqrt(d2)); }
  }
}
function awakeNear(x, z, r, except) {
  const out = [];
  near(x, z, r, o => { if (o !== except && !o.sleeping && ageY(o) >= 5 && !(o.act && o.act.k === 'ride')) out.push(o); });
  return out;
}

/* ---------- movement ---------- */
const OFFS = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, 2.6, -2.6];
function canStand(x, z) {
  if (x < -B + 3 || x > B - 3 || z < -B + 3 || z > B - 3) return false;
  return height(x, z) >= -0.75;
}
function moveTo(e, tx, tz, spd, dt) {
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
  if (d < 0.7) return true;
  const st = Math.min(d, spd * dt);
  const base = Math.atan2(dz, dx);
  for (const off of OFFS) {
    const a = base + off, nx = e.x + Math.cos(a) * st, nz = e.z + Math.sin(a) * st;
    if (canStand(nx, nz)) {
      e.x = nx; e.z = nz; e.dir = a; e.moving = true;
      e.stuck = off === 0 ? 0 : (e.stuck || 0) + dt * 0.15;
      return off === 0 && d - st < 0.7;
    }
  }
  e.stuck = (e.stuck || 0) + dt;
  return false;
}
function randLand(isl, cx, cz, rmin, rmax, opt) {
  opt = opt || {};
  for (let k = 0; k < 40; k++) {
    const a = rand() * 6.283, r = rr(rmin, rmax);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (islandAt(x, z) !== isl) continue;
    const h = height(x, z);
    if (h < (opt.minH != null ? opt.minH : 0.8) || h > (opt.maxH != null ? opt.maxH : 13)) continue;
    if (opt.avoid && Math.hypot(x - opt.avoid.x, z - opt.avoid.z) < opt.avoidR) continue;
    return { x, z };
  }
  return null;
}
function speedOf(p) {
  const a = ageY(p);
  let s = 50 + 25 * p.g.spd;
  if (a < ADULT) s *= 0.5 + 0.5 * clamp((a - 3) / 10, 0, 1);
  if (a > 60) s *= 0.75;
  if (p.hp < 40) s *= 0.7;
  if (p.preg && W.t > p.preg.due - 48) s *= 0.8;
  return s;
}
const carryCap = p => (ageY(p) < ADULT ? 2 : Math.floor(4 + 3 * p.g.str + (hasItem(p, ['knife', 'sknife']) ? 2 : 0)));
const gatherTime = p => 0.4 / itemMul(p, 'gather') / (1 + p.sk.gather * 0.05);
function hutOf(p) {
  const m = p.partner ? PM.get(p.partner) : null;
  let h = p.home ? W.huts.find(h => h.id === p.home) : null;
  if (m && m.home && m.home !== p.home) { const mh = W.huts.find(x => x.id === m.home); if (mh && mh.isl === p.isl && (!h || (mh.done && !h.done) || (mh.done === h.done && mh.id < h.id))) { h = mh; p.home = mh.id; } }
  return h && islandAt(h.x, h.z) === p.isl ? h : null;
}
const hasHome = p => !!hutOf(p);
function inHut(p) { const h = hutOf(p); return !!(h && h.done && dist(h, p) < 2.6); }
function nearLitFire(p, r) {
  for (const g of W.groups) if (!g.dead && g.fire.lit && dist(g, p) < r) return true;
  for (const f of W.flames) if (dist(f, p) < r * 0.6) return true;
  return false;
}
function islandPop(isl) { let n = 0; for (const p of W.people) if (p.isl === isl && !p.dead) n++; return n; }
const crowd = isl => islandPop(isl) / (W.capEst[isl] || 40);

/* ---------- decisions ---------- */
const LOW = new Set(['idle', 'explore', 'play', 'talk', 'court', 'chat', 'follow', 'mourn', 'wander', 'trade', 'join']);
function interrupts(p) {
  const A = p.act, k = A ? A.k : '';
  if (k === 'ride' || k === 'ponder' || k === 'fight' || k === 'council' || k === 'wake' || k === 'confront' || k === 'murder') return;
  const a = ageY(p);
  if (a < 3) return;
  if (W.wx.storm > 0 && k !== 'shelter' && k !== 'sleep' && !inHut(p)) { actShelter(p); return; }
  if (p.exiled && k !== 'exile') {
    const og = groupById(p.exiled);
    if (og && !og.dead && og.isl === p.isl && dist(og, p) < 26 && W.t - p.exileT < HPY * 2) { actLeaveArea(p, og); return; }
  }
  if (p.hun < 15 && k !== 'eat' && k !== 'sleep' && k !== 'feed' && k !== 'sneak' && !(p.food > 0 && (k === 'stock' || k === 'hunt' || k === 'fish'))) {
    if (p.food > 0) { setAct(p, { k: 'eat', ph: 'work', until: W.t + 0.4 }); return; }
    if (actEat(p)) return;
  }
  const hour = W.t % 24;
  if ((hour >= 22 || hour < 5) && p.en < 35 && LOW.has(k) && k !== 'follow') actSleep(p);
}
function decide(p) {
  const a = ageY(p);
  if (a < 3) return setAct(p, { k: 'follow', who: p.care, max: 3 });
  const hour = W.t % 24, night = hour < 6 || hour >= 21, season = seasonIdx();
  const g = grpOf(p), C = [];
  const add = (s, f) => C.push([s + rand() * 8, f]);
  if (night && p.en < 90) add(95 + (100 - p.en) * 0.2, () => actSleep(p));
  else if (p.en < 22) add(120, () => actSleep(p));
  if (p.hun < 70) { const u = (100 - p.hun) / 100; add(170 * u * u + (p.hun < 25 ? 60 : 0), () => actEat(p)); }
  if (p.soc < 78) add((100 - p.soc) * 0.65 + p.p.extra * 16, () => actTalk(p, 'chat'));
  if (a < ADULT) {
    if (a < 7) add(32, () => setAct(p, { k: 'follow', who: PM.get(p.mom) ? p.mom : p.dad, max: 2 }));
    if (a < 13) add(30 + rand() * 12, () => actPlay(p));
    if (a >= 9) add(18, () => actStock(p));
    if (a >= 12) add(8 + p.p.open * 15, () => actExplore(p));
  } else {
    if (W.items.some(i => !i.owner && i.isl === p.isl)) add(46 + p.p.ambit * 30 + (1 - p.p.agree) * 15 - (p.hun < 30 ? 30 : 0), () => actSalvage(p));
    const hk = hungryKid(p);
    if (hk && (p.food >= 2 || (g && g.store >= 2))) add(70 * (0.6 + p.p.agree * 0.6), () => actFeed(p, hk));
    const n = g ? members(g).length : 1;
    const target = g ? n * (season === 2 ? 7 : 4) : 5;
    const h = hutOf(p);
    const have = g ? g.store : ((h ? h.stash : 0) + p.food);
    if (have < target && p.hun > 40) add(30 * (0.5 + p.p.consc * 0.7) * clamp((target - have) / target, 0.25, 1) + (season === 2 ? 12 : 0), () => actStock(p));
    add(14 + (hasItem(p, 'net') ? 18 : 0) + (p.prof === 'fisher' ? 12 : 0) + (have < target ? 8 : 0), () => actFish(p));
    if (hasItem(p, ['spear', 'knife', 'axe']) || knows(p, 'spears')) {
      let prey = 0; for (const an of W.animals) if (an.isl === p.isl && !an.dead) prey++;
      if (prey) add((10 + p.p.ambit * 10 + (1 - p.p.neuro) * 8 + (PROFS[p.prof] && PROFS[p.prof].hunt ? 14 : 0) + (have < target ? 8 : 0)) * clamp(prey / 10, 0.2, 1), () => actHunt(p));
    }
    if (g) {
      if (!g.fire.lit && canLight(p) && (hour > 15 || !g.fire.ever)) add(58, () => actWood(p, 'fire', 2));
      else if (g.fire.lit && g.fire.fuel < 35) add(38 + (hour > 16 ? 14 : 0), () => actWood(p, 'fire', 2));
      if (!hasHome(p) && !(p.partner && PM.get(p.partner) && hasHome(PM.get(p.partner))) && (p.partner || a > 19)) add(32 * (0.5 + p.p.consc * 0.8) + (season === 3 ? 14 : 0), () => actWood(p, 'hut', 6));
      if (knows(p, 'farming')) add(farmScore(p, g, season), () => actFarm(p));
    } else if (canLight(p) && hour > 16 && hour < 21) add(70, () => foundFirstCamp(p));
    const hh = W.huts.find(x => x.own === p.id && !x.done && x.prog > 0 && x.isl === p.isl);
    if (hh) add(40, () => actWood(p, 'hut', 3));
    if (knows(p, 'stonework') && !hasItem(p, ['knife', 'sknife'])) add(20 + p.p.consc * 10, () => actCraft(p, 'sknife'));
    if (knows(p, 'stonework') && !hasItem(p, ['axe', 'saxe'])) add(14 + p.p.consc * 10, () => actCraft(p, 'saxe'));
    if (knows(p, 'spears') && !hasItem(p, 'spear')) add(18 + p.p.ambit * 10, () => actCraft(p, 'spear'));
    if (knows(p, 'boatbuilding') && hasItem(p, ['axe', 'saxe']) && boatWanted(p)) add(22 + p.p.open * 18 + crowd(p.isl) * 15, () => actWood(p, 'boat', 10));
    if (W.boats.some(b => !b.sail && b.isl === p.isl) && W.t - p.lastVoyage > HPY * 0.4 && a < 55) { const v = voyagePlan(p); if (v.s > 12) add(v.s, () => considerVoyage(p, v.dest)); }
    if (!p.partner && a <= 52 && hasEligible(p)) add(30 + p.p.extra * 10 + (a < 30 ? 8 : 0), () => actTalk(p, 'court'));
    if (p.partner && W.t - p.lastAffairCheck > 30) { p.lastAffairCheck = W.t; const o = temptation(p); if (o) add(36, () => considerAffair(p, o)); }
    const gt = grudgeTarget(p);
    if (gt && W.t - p.grudgeT > 20) add(26 + p.p.neuro * 22 + gt.score * 0.25, () => considerConfront(p, gt));
    const foe = W.t - (p.lastKillThought || -1e9) > 96 ? hatedTarget(p) : null;
    if (foe) add(30, () => { p.lastKillThought = W.t; return considerKill(p, foe); });
    const crimeOk = W.t - (p.lastCrime || -1e9) > 36 || p.hun < 12;
    if (crimeOk && p.hun < 32 && p.food < 1) { const st = stealTarget(p, 'food'); if (st) add(46 + (32 - p.hun) * 1.2, () => considerSteal(p, st)); }
    if (crimeOk && (1 - p.p.honest) * p.p.ambit > 0.3 && !hasItem(p, ['knife', 'axe']) && rand() < 0.3) { const st = stealTarget(p, 'item'); if (st) add(22, () => considerSteal(p, st)); }
    if (crimeOk && W.t - (p.lastCrime || -1e9) > 72 && g && g.store < n * 1.5 && p.p.honest < 0.5 && p.p.neuro > 0.4) { const st = stealTarget(p, 'raid'); if (st) add(24 + (1 - p.p.honest) * 20, () => considerSteal(p, st)); }
    if (g && p.p.ambit > 0.58 && p.p.agree < 0.42 && W.t - (p.lastBully || -1e9) > 60) { const v = bullyTarget(p); if (v) add(26 + (p.p.ambit - p.p.agree) * 34, () => actBully(p, v)); }
    if (!g) {
      const jg = W.t - (p.lastJoin || -1e9) > 48 ? bestGroupToJoin(p) : null;
      if (jg) add(36 + p.p.extra * 10, () => actJoin(p, jg));
      else if (W.t - p.exileT > 30) add(20, () => tryFoundWithFriends(p));
    }
    if (g && g.store > n * 7 && W.t - (p.lastTrade || -1e9) > 72 && W.t - (g.lastTrade || -1e9) > 24) { const fg = friendlyGroup(g); if (fg) add(14 + p.p.agree * 10, () => { p.lastTrade = W.t; g.lastTrade = W.t; return actTrade(p, fg); }); }
    add(6 + p.p.open * 22 - (p.hun < 50 ? 12 : 0), () => actExplore(p));
    const sn = nearestSnake(p, 16);
    if (sn && (1 - p.p.neuro) > 0.45) add(20 + (1 - p.p.neuro) * 14, () => setAct(p, { k: 'snake', who: sn.id, max: 3 }));
    const G = goalOf(p);
    if (G) goalActions(p, G, add);
  }
  add(10, () => actIdle(p));
  C.sort((x, y) => y[0] - x[0]);
  for (const c of C) if (c[1]()) return;
  actIdle(p);
}
function hungryKid(p) {
  let best = null, bh = 40;
  near(p.x, p.z, 60, o => {
    if (o.isl !== p.isl || o.hun >= bh) return;
    const a = ageY(o);
    if (a < 3 || a >= 12) return;
    if (o.mom === p.id || o.dad === p.id || (o.grp === p.grp && p.p.agree > 0.6 && rand() < 0.3)) { bh = o.hun; best = o; }
  });
  return best;
}
function nearestSnake(p, r) {
  let best = null, bd = r;
  for (const s of W.snakes) if (!s.dead && s.isl === p.isl) { const d = dist(s, p); if (d < bd) { bd = d; best = s; } }
  return best;
}
function farmScore(p, g, season) {
  if (W.farms.some(f => f.g === g.id && f.planted && f.grow >= 1)) return 55;
  if (season === 3) return 0;
  if (W.farms.some(f => f.g === g.id && !f.planted)) return 30;
  const n = W.farms.filter(f => f.g === g.id).length;
  return n < Math.max(1, members(g).length / 4) ? 24 * (0.6 + p.p.consc * 0.6) : 0;
}
function boatWanted(p) {
  if (W.boats.some(b => (!b.sail && b.isl === p.isl) || (b.sail && b.sail.from === p.isl))) return false;
  const g = grpOf(p);
  if (g && g.split && g.split.leader === p.id) return true;
  if (!W.milestones.farLanding) return !!W.milestones.sawFar && W.t > 24 * 10;
  return crowd(p.isl) > 0.8 || (p.p.open > 0.7 && rand() < 0.3);
}
function reachable(p) {
  const b = W.boats.find(b => !b.sail && b.isl === p.isl);
  if (!b) return [];
  if (b.rig) return [1, 2, 3].filter(i => i !== p.isl);
  return p.isl === 1 ? [2] : [1];
}
function desireTo(p, dest) {
  const m = PM.get(p.partner);
  if (m && m.isl === dest && m.lastVoyage > p.lastVoyage) return 90;
  const g = grpOf(p);
  const banned = p.exiled && W.t - p.exileT < 3 * HPY && W.groups.filter(x => !x.dead && x.isl === dest).every(x => x.id === p.exiled);
  if (islandPop(p.isl) <= 2 && islandPop(dest) >= 4 && W.t - p.lastVoyage > HPY && !banned) return 40;
  if (banned) return 0;
  if (!g && p.exiled && W.t - p.exileT < HPY) return 25 + p.p.open * 30 + (islandPop(dest) === 0 ? 6 : 0);
  if (dest === 2 && !W.milestones.farLanding) return 6 + p.p.open * 36;
  if (dest === 3 && !W.milestones.thirdLanding) return W.milestones.sawThird ? 10 + p.p.open * 40 : 0;
  return crowd(p.isl) > 0.8 ? (crowd(p.isl) - crowd(dest)) * 50 + p.p.open * 10 - 18 + (dest === 3 ? 6 : 0) : 0;
}
function voyagePlan(p) {
  let best = { s: 0, dest: 0 };
  const G = goalOf(p);
  for (const d of reachable(p)) {
    let bonus = 0;
    if (G && G.k === 'leave' && (!G.g || p.grp === G.g)) bonus = 26;
    if (G && G.k === 'explore' && islandPop(d) === 0 && (d === 3 ? !W.milestones.thirdLanding : !W.milestones.farLanding)) bonus = 30;
    const s = desireTo(p, d) + bonus;
    if (s > best.s) best = { s, dest: d };
  }
  return best;
}

/* ---------- act constructors ---------- */
function findFood(p, maxD) {
  let best = null, bs = 1e9;
  const consider = (o, t, key) => {
    if (o.f < 1 || o.isl !== p.isl) return;
    const d = Math.hypot(o.x - p.x, o.z - p.z);
    if (d > maxD) return;
    let s = d - Math.min(o.f, 4) * 3;
    if (p.exiled) { const og = groupById(p.exiled); if (og && Math.hypot(o.x - og.x, o.z - og.z) < 28) return; }
    if (s < bs) { bs = s; best = { t, i: key, x: o.x, z: o.z }; }
  };
  for (let i = 0; i < W.trees.length; i++) consider(W.trees[i], 'tree', i);
  for (let i = 0; i < W.bushes.length; i++) consider(W.bushes[i], 'bush', i);
  return best;
}
function getSrc(s) { if (!s) return null; return s.t === 'tree' ? W.trees[s.i] : W.bushes[s.i]; }
function actEat(p) {
  if (p.food >= 1) return setAct(p, { k: 'eat', ph: 'work', until: W.t + 0.4 });
  const g = grpOf(p);
  if (g && g.store >= 1 && dist(p, g) < 110) return setAct(p, { k: 'eat', ph: 'store', tx: g.x + rr(-1.5, 1.5), tz: g.z + rr(-1.5, 1.5), max: 6 });
  const h = hutOf(p);
  if (h && h.stash >= 1 && dist(p, h) < 110) return setAct(p, { k: 'eat', ph: 'stash', tx: h.x + 1, tz: h.z + 1, max: 6 });
  const src = findFood(p, ageY(p) < 6 ? 30 : 140);
  if (!src) return false;
  return setAct(p, { k: 'eat', ph: 'go', src, tx: src.x + 0.9, tz: src.z + 0.5, max: 8 });
}
function actStock(p) {
  const src = findFood(p, 130);
  if (!src) return false;
  return setAct(p, { k: 'stock', ph: 'go', src, tx: src.x + 0.9, tz: src.z + 0.5, max: 10 });
}
function actSleep(p) {
  let spot = null, hut = 0;
  const h = hutOf(p);
  if (h && h.done) { spot = { x: h.x, z: h.z }; hut = h.id; }
  else {
    const g = grpOf(p);
    if (g && dist(p, g) < 110) {
      const m = PM.get(p.partner), key = m && m.isl === p.isl ? Math.min(p.id, m.id) : p.id;
      let k2 = key;
      if (ageY(p) < ADULT) { const mo = PM.get(p.mom) || PM.get(p.dad); if (mo) k2 = PM.get(mo.partner) ? Math.min(mo.id, mo.partner) : mo.id; }
      const ang = k2 * 2.39996, r = 4 + (k2 % 6) * 1.2;
      spot = { x: g.x + Math.cos(ang) * r + (p.sex === 'M' ? -0.5 : 0.5), z: g.z + Math.sin(ang) * r };
      if (!canStand(spot.x, spot.z)) spot = { x: g.x, z: g.z };
    } else spot = { x: p.x, z: p.z };
  }
  return setAct(p, { k: 'sleep', ph: 'go', tx: spot.x, tz: spot.z, hut, max: 16 });
}
function actShelter(p) {
  const h = hutOf(p), g = grpOf(p);
  const tgt = h && h.done ? h : g ? g : null;
  if (!tgt) return setAct(p, { k: 'shelter', tx: p.x, tz: p.z, stay: 2, max: 8 });
  return setAct(p, { k: 'shelter', tx: tgt.x + rr(-1, 1), tz: tgt.z + rr(-1, 1), stay: 2, max: 8 });
}
function actTalk(p, mode) {
  let best = null, bs = -1e9;
  near(p.x, p.z, 55, (o, d) => {
    if (o === p || o.isl !== p.isl || o.sleeping || ageY(o) < 3) return;
    if (o.act && !LOW.has(o.act.k)) return;
    if (o.act && (o.act.k === 'chat' || ((o.act.k === 'talk' || o.act.k === 'court') && o.act.ph === 'chat'))) return;
    let s = opinion(p, o) * 0.8 - d * 0.5 + rand() * 25;
    if (o.id === p.partner) s += 22;
    if (o.grp && o.grp !== p.grp) s -= 15 + hostility(p.grp, o.grp) * 0.5;
    if (mode === 'court') { if (!eligible(p, o)) return; s += attraction(p, o) * 60 - kin(p, o) * 200; }
    if (s > bs) { bs = s; best = o; }
  });
  if (!best || (mode === 'chat' && bs < -40)) return false;
  return setAct(p, { k: mode === 'court' ? 'court' : 'talk', ph: 'go', who: best.id, max: 4 });
}
function actTalkTo(p, o, mode) {
  if (!o || o.isl !== p.isl || o.sleeping || dist(p, o) > 90) return false;
  if (o.act && !LOW.has(o.act.k)) return false;
  return setAct(p, { k: mode === 'court' ? 'court' : 'talk', ph: 'go', who: o.id, max: 4 });
}
function actWood(p, what, need) {
  if (what === 'hut') { const h = W.huts.find(h => h.own === p.id && !h.done && h.isl === p.isl); if (h && p.wood >= need) return setAct(p, { k: 'build', what, need, ph: 'site', hut: h.id, tx: h.x, tz: h.z, max: 30 }); }
  if (p.wood >= need) { const s = siteFor(p, what); if (!s) return false; return setAct(p, { k: 'build', what, need, ph: 'site', tx: s.x, tz: s.z, hut: s.hut || 0, max: 30 }); }
  const w = nearestWood(p);
  if (!w) return false;
  return setAct(p, { k: 'build', what, need, ph: 'wood', wi: w.i, tx: w.x + 0.9, tz: w.z + 0.6, max: 30 });
}
function nearestWood(p) {
  let best = null, bd = 120;
  for (let i = 0; i < WOODS.length; i++) {
    const w = WOODS[i];
    if (w.isl !== p.isl) continue;
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    if (d < bd) { bd = d; best = { i, x: w.x, z: w.z }; }
  }
  return best;
}
function findSite(c, rmin, rmax, spacing) {
  for (let k = 0; k < 50; k++) {
    const pt = randLand(c.isl, c.x, c.z, rmin, rmax, { minH: 0.9, maxH: 8 });
    if (!pt) continue;
    if (Math.hypot(pt.x - c.x, pt.z - c.z) < 6) continue;
    if (W.huts.some(h => Math.hypot(h.x - pt.x, h.z - pt.z) < spacing)) continue;
    if (W.farms.some(f => Math.hypot(f.x - pt.x, f.z - pt.z) < 5)) continue;
    if (W.trees.some(t => Math.hypot(t.x - pt.x, t.z - pt.z) < 2.5)) continue;
    if (W.groups.some(g => !g.dead && g !== c && Math.hypot(g.x - pt.x, g.z - pt.z) < 12)) continue;
    return pt;
  }
  return null;
}
function siteFor(p, what) {
  const g = grpOf(p);
  if (what === 'fire') return g ? { x: g.x + 0.6, z: g.z + 0.6 } : null;
  if (what === 'boat') return W.docks[p.isl];
  if (!g) return null;
  const old = W.huts.find(h => h.own === p.id && !h.done && h.isl === p.isl);
  if (old) return { x: old.x, z: old.z, hut: old.id };
  const pt = findSite(g, 7, 26 + Math.sqrt(members(g).length) * 3, 5.5);
  if (!pt) return null;
  const h = { id: W.nextId++, x: pt.x, z: pt.z, prog: 0, done: false, own: p.id, isl: g.isl, r: rand() * 6.283, stash: 0, seen: 0, g: g.id };
  W.huts.push(h);
  return { x: h.x, z: h.z, hut: h.id };
}
function actHunt(p) {
  let best = null, bd = 90;
  for (const an of W.animals) { if (an.isl !== p.isl || an.dead) continue; const d = dist(p, an); if (d < bd) { bd = d; best = an; } }
  if (!best) return false;
  return setAct(p, { k: 'hunt', ph: 'chase', who: best.id, max: 6 });
}
function actFish(p) {
  const pts = SHORE[p.isl];
  if (!pts || !pts.length) return false;
  let best = null, bd = 1e9;
  for (let i = 0; i < pts.length; i += 2) {
    const s = pts[i], d = Math.hypot(s.x - p.x, s.z - p.z) + (W.t * 7 + i * 13) % 17;
    if (p.exiled) { const og = groupById(p.exiled); if (og && Math.hypot(s.x - og.x, s.z - og.z) < 28) continue; }
    if (d < bd) { bd = d; best = s; }
  }
  if (!best || bd > 140) return false;
  return setAct(p, { k: 'fish', ph: 'go', tx: best.x, tz: best.z, max: 12 });
}
function actFarm(p) {
  const g = grpOf(p);
  if (!g) return false;
  const ripe = W.farms.find(f => f.g === g.id && f.planted && f.grow >= 1);
  if (ripe) return setAct(p, { k: 'farm', ph: 'go', what: 'harvest', id: ripe.id, tx: ripe.x, tz: ripe.z, max: 10 });
  if (seasonIdx() === 3) return false;
  let f = W.farms.find(f => f.g === g.id && !f.planted);
  if (!f) {
    if (W.farms.filter(f => f.g === g.id).length >= Math.max(1, members(g).length / 4)) return false;
    const s = findSite(g, 10, 34, 4.5);
    if (!s) return false;
    f = { id: W.nextId++, x: s.x, z: s.z, grow: 0, g: g.id, isl: g.isl, planted: false, r: rand() * 3.14 };
    W.farms.push(f);
  }
  return setAct(p, { k: 'farm', ph: 'go', what: 'plant', id: f.id, tx: f.x, tz: f.z, max: 12 });
}
function actCraft(p, what) {
  const w = what === 'spear' ? nearestWood(p) : null;
  const g = grpOf(p);
  const base = w || g || p;
  return setAct(p, { k: 'craft', what, tx: base.x + 1, tz: base.z + 0.5, stay: what === 'spear' ? 1.5 : 2.5, max: 6 });
}
function actExplore(p) {
  let pt = null, coast = false;
  if (rand() < 0.45 && SHORE[p.isl] && SHORE[p.isl].length) {
    for (let k = 0; k < 10 && !pt; k++) { const s = pick(SHORE[p.isl]); if (Math.hypot(s.x - p.x, s.z - p.z) < 140) { pt = s; coast = true; } }
  }
  if (!pt) pt = randLand(p.isl, p.x, p.z, 25, 70);
  if (!pt) return false;
  return setAct(p, { k: 'explore', tx: pt.x, tz: pt.z, stay: 1, coast, max: 10 });
}
function actPlay(p) {
  const g = grpOf(p), base = g || p;
  const pt = randLand(p.isl, base.x, base.z, 3, 14);
  if (!pt) return false;
  return setAct(p, { k: 'play', tx: pt.x, tz: pt.z, stay: 0.8 });
}
function actIdle(p) {
  const h = hutOf(p), g = grpOf(p);
  const base = (h && h.done) ? h : g;
  const pt = base ? randLand(p.isl, base.x, base.z, 1.5, 7, { minH: 0.3 }) : null;
  if (pt) return setAct(p, { k: 'idle', tx: pt.x, tz: pt.z, stay: 0.8 + rand() });
  return setAct(p, { k: 'idle', stay: 1 });
}
function actFeed(p, kid) {
  if (p.food >= 2) return setAct(p, { k: 'feed', ph: 'go', kid: kid.id, max: 4 });
  const g = grpOf(p);
  if (g && g.store >= 2 && dist(p, g) < 80) return setAct(p, { k: 'feed', ph: 'fetch', kid: kid.id, tx: g.x, tz: g.z, max: 6 });
  return false;
}
function actSalvage(p) {
  let best = null, bd = 1e9;
  for (const it of W.items) { if (it.owner || it.isl !== p.isl) continue; const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bd) { bd = d; best = it; } }
  if (!best || bd > 120) return false;
  return setAct(p, { k: 'salvage', item: best.id, tx: best.x, tz: best.z, max: 4 });
}
function actLeaveArea(p, og) {
  const d = Math.max(0.1, dist(p, og));
  let tx = p.x + (p.x - og.x) / d * 30, tz = p.z + (p.z - og.z) / d * 30;
  if (!canStand(tx, tz)) { const pt = randLand(p.isl, og.x, og.z, 40, 70); if (pt) { tx = pt.x; tz = pt.z; } }
  return setAct(p, { k: 'exile', tx, tz, max: 3 });
}
function actJoin(p, g) { p.lastJoin = W.t; return setAct(p, { k: 'join', g: g.id, tx: g.x + rr(-2, 2), tz: g.z + rr(-2, 2), max: 6 }); }
function actTrade(p, fg) {
  const g = grpOf(p);
  if (!g || g.store < 6) return false;
  g.store -= 4; p.food += 4;
  return setAct(p, { k: 'trade', g: fg.id, tx: fg.x + rr(-2, 2), tz: fg.z + rr(-2, 2), max: 10 });
}

/* ---------- act runner ---------- */
function goStay(p, A, spd, dt) {
  if (!A.here) {
    if (A.tx === undefined || moveTo(p, A.tx, A.tz, spd, dt)) { A.here = true; A.until = W.t + (A.stay || 1); }
    return false;
  }
  return W.t >= A.until;
}
function deposit(p) {
  const g = grpOf(p), h = hutOf(p);
  if (!g) { if (h) { h.stash += Math.max(0, p.food - 1); p.food = Math.min(p.food, 1); } return; }
  const share = clamp(0.25 + p.p.agree * 0.5 + p.p.consc * 0.2 - (1 - p.p.honest) * 0.15 + (g.leader === p.id ? 0.1 : 0), 0.1, 1);
  const total = Math.max(0, p.food - (p.hun < 60 ? 1 : 0));
  let toStore = Math.round(total * share), toStash = total - toStore;
  if (!h) { toStore = total; toStash = 0; }
  g.store += toStore;
  p.contrib = (p.contrib || 0) + toStore;
  if (h) { h.stash += toStash; h.seen = h.stash; }
  p.food -= toStore + toStash;
  if (toStore >= 2) {
    const gain = Math.min(3, toStore * 0.4) * (PROFS[p.prof] && PROFS[p.prof].charm ? 1.2 : 1);
    near(g.x, g.z, 28, o => { if (o !== p && o.grp === g.id && !o.sleeping) bump(o, p, 0.4, 0.8, gain); });
  }
}
function deliverPhase(p, A, sp, dt) {
  const g = grpOf(p), h = hutOf(p);
  const tgt = g || h;
  if (!tgt) { p.act = null; return; }
  if (moveTo(p, tgt.x + rr(-1, 1), tgt.z + rr(-1, 1), sp, dt) || dist(p, tgt) < 2) { deposit(p); p.act = null; }
}
function takeFromStore(p, g) {
  const n = members(g).length;
  const greedy = p.p.agree < 0.35 && p.p.honest < 0.55;
  let take = Math.min(Math.floor(g.store), greedy ? 4 : 2);
  if (take < 1) return 0;
  g.store -= take; p.food += take;
  p.took = (p.took || 0) + take;
  if (ageY(p) >= ADULT && p.took > (p.contrib || 0) * 1.5 + 8 && g.store < n * 6 && rand() < 0.5) {
    const fw = awakeNear(p.x, p.z, 16, p).filter(o => o.grp === g.id && ageY(o) >= ADULT && (o.contrib || 0) > (o.took || 0));
    for (const w of fw) { mem(w, 'freeloader', p.id, -10, `${p.name} eats from the store but hardly adds to it.`); bump(w, p, -2, -4, -3); }
    if (fw.length && rand() < 0.05) ev('conflict', `People in ${g.name} are muttering that ${p.name} takes more than they give.`, [p.id], 1);
  }
  if (greedy && g.store < n * 4) {
    const ws = awakeNear(p.x, p.z, 16, p).filter(o => o.grp === g.id && ageY(o) >= ADULT);
    for (const w of ws) { mem(w, 'greed', p.id, -12, `${p.name} took more than their share from the store.`); bump(w, p, -3, -5, -2); }
    if (ws.length && rand() < 0.25) ev('conflict', `${p.name} was seen taking more than their share from ${g.name}’s store.`, [p.id], 1);
  }
  return take;
}
function runAct(p, dt) {
  let A = p.act;
  if (!A) { decide(p); A = p.act; if (!A) return; }
  if (A.max !== -1 && W.t - A.t0 > (A.max || 8)) { p.act = null; return; }
  if (p.stuck > 2.5) { p.stuck = 0; p.act = null; return; }
  const sp = speedOf(p);
  switch (A.k) {
    case 'wake': if (W.t >= A.until) { p.act = null; if (rand() < 0.7) say(p, 'wake'); } break;
    case 'idle': case 'play': case 'mourn': case 'shelter': {
      if (A.k === 'play' && rand() < dt * 0.7) say(p, 'greet', { o: 'friend' });
      if (A.k === 'mourn' && rand() < dt * 0.5) say(p, 'mourn', { s: A.s || 'them' });
      if (goStay(p, A, A.k === 'shelter' ? sp : sp * 0.5, dt)) p.act = null;
      break;
    }
    case 'explore': if (goStay(p, A, sp * 0.8, dt)) { discover(p, A.coast ? 'shore' : 'explore', 1); if (A.coast) seeFar(p); p.act = null; } break;
    case 'exile': if (moveTo(p, A.tx, A.tz, sp, dt)) p.act = null; break;
    case 'ponder': break;
    case 'sleep': {
      if (A.ph === 'go') { if (moveTo(p, A.tx, A.tz, sp, dt) || W.t - A.t0 > 4) A.ph = 'work'; break; }
      const hut = A.hut ? W.huts.find(h => h.id === A.hut && h.done) : null;
      p.en = Math.min(100, p.en + (hut ? 12 : 9) * dt);
      if (p.partner) { const m = PM.get(p.partner); if (m && m.sleeping && dist(m, p) < 4) { p.bedT = W.t; m.bedT = W.t; } }
      const hour = W.t % 24;
      if (hour >= 6 && hour < 20 && p.en >= 70) { p.act = null; p.sleeping = false; tryConceive(p); }
      break;
    }
    case 'eat': case 'stock': {
      if (A.ph === 'store' || A.ph === 'stash') {
        if (moveTo(p, A.tx, A.tz, sp, dt)) {
          let got = 0;
          if (A.ph === 'store') { const g = grpOf(p); if (g) got = takeFromStore(p, g); }
          else { const h = hutOf(p); if (h && h.stash >= 1) { got = Math.min(3, Math.floor(h.stash)); if (h.seen > h.stash + 2.5) noticeTheft(p, h); h.stash -= got; h.seen = h.stash; p.food += got; } }
          if (got) { A.ph = 'work'; A.until = W.t + 0.4; } else p.act = null;
        }
        break;
      }
      if (A.ph === 'go') { if (moveTo(p, A.tx, A.tz, sp, dt)) { A.ph = 'gather'; A.until = W.t + gatherTime(p); } break; }
      if (A.ph === 'gather') {
        if (W.t < A.until) break;
        const o = getSrc(A.src);
        if (!o || o.f < 1) {
          if (A.k === 'stock' && p.food < carryCap(p)) { const nx = findFood(p, 25); if (nx) { A.src = nx; A.tx = nx.x + 0.9; A.tz = nx.z + 0.5; A.ph = 'go'; break; } }
          if (p.food > 0) { if (A.k === 'stock') A.ph = 'deliver'; else { A.ph = 'work'; A.until = W.t + 0.4; } } else p.act = null;
          break;
        }
        o.f -= 1; p.food += 1;
        p.sk.gather = Math.min(10, p.sk.gather + 0.02);
        discover(p, 'gather', gatherTime(p));
        const full = p.food >= carryCap(p);
        if (A.k === 'eat' && (p.food >= 2 || full || o.f < 1)) { A.ph = 'work'; A.until = W.t + 0.4; }
        else if (A.k === 'stock' && full) A.ph = 'deliver';
        else A.until = W.t + gatherTime(p);
        if (rand() < 0.04) say(p, 'work');
        break;
      }
      if (A.ph === 'deliver') { deliverPhase(p, A, sp, dt); break; }
      if (A.ph === 'work' && W.t >= A.until) {
        if (p.food >= 1) {
          p.food -= 1;
          const cooked = nearLitFire(p, 12);
          p.hun = Math.min(100, p.hun + 22 * (cooked ? 1.3 : 1));
        }
        if (p.hun < 92 && p.food >= 1) A.until = W.t + 0.4;
        else if (A.k === 'stock') A.ph = 'deliver';
        else p.act = null;
      }
      break;
    }
    case 'feed': {
      const kid = PM.get(A.kid);
      if (!kid || kid.isl !== p.isl) { p.act = null; break; }
      if (A.ph === 'fetch') {
        if (moveTo(p, A.tx, A.tz, sp, dt)) { const g = grpOf(p); if (g && g.store >= 2) { g.store -= 2; p.food += 2; A.ph = 'go'; } else p.act = null; }
        break;
      }
      if (moveTo(p, kid.x + 0.7, kid.z, sp, dt) || dist(p, kid) < 1.4) {
        const give = Math.min(2, p.food);
        p.food -= give; kid.food += give;
        say(p, 'kid', { o: kid.name });
        bump(p, kid, 2, 1); bump(kid, p, 4, 3, 1);
        if (!kid.act || kid.act.k !== 'sleep') setAct(kid, { k: 'eat', ph: 'work', until: W.t + 0.4 });
        p.act = null;
      }
      break;
    }
    case 'talk': case 'court': {
      const o = PM.get(A.who);
      if (!o || o.sleeping || o.isl !== p.isl) { p.act = null; break; }
      if (A.ph === 'go') {
        if (moveTo(p, o.x + 0.9, o.z + 0.4, sp, dt) || dist(p, o) < 1.8) {
          if (o.act && !LOW.has(o.act.k)) { p.act = null; break; }
          if (o.act && (o.act.k === 'chat' || ((o.act.k === 'talk' || o.act.k === 'court') && o.act.ph === 'chat'))) { p.act = null; break; }
          setAct(o, { k: 'chat', with: p.id, until: W.t + 1, max: 2 });
          A.ph = 'chat'; A.until = W.t + 1;
          p.dir = Math.atan2(o.z - p.z, o.x - p.x); o.dir = p.dir + Math.PI;
          say(p, A.k === 'court' ? 'flirt' : opinion(p, o) < -25 ? 'confront' : (p.partner === o.id ? 'love' : 'greet'), { o: o.name });
          if (A.k === 'court') jealousy(p, o);
        }
        break;
      }
      if (!o.act || o.act.k !== 'chat' || o.act.with !== p.id) { endChat(p, o, A.k, false); p.act = null; break; }
      chatTick(p, o, dt, A.k);
      if (W.t >= A.until) { endChat(p, o, A.k, true); p.act = null; if (o.act && o.act.k === 'chat' && o.act.with === p.id) o.act = null; }
      break;
    }
    case 'chat': {
      const o = PM.get(A.with);
      if (!o || W.t >= A.until) { p.act = null; break; }
      p.dir = Math.atan2(o.z - p.z, o.x - p.x);
      break;
    }
    case 'salvage': {
      const it = W.items.find(i => i.id === A.item);
      if (!it || it.owner) { p.act = null; break; }
      if (moveTo(p, it.x, it.z, sp, dt) || dist(p, it) < 1.2) {
        giveItem(it, p);
        life(p, `I found a ${ITEMS[it.k].n} in the wreckage and kept it.`);
        ev('item', `${p.name} found a ${ITEMS[it.k].n} washed up from the wreck.`, [p.id], it.k === 'flint' || it.k === 'axe' ? 2 : 1);
        const ws = awakeNear(p.x, p.z, 18, p);
        for (const w of ws) if (w.p.ambit > 0.6) { bump(w, p, -2, -1); mem(w, 'envy', p.id, -6, `${p.name} grabbed the ${ITEMS[it.k].n} for themselves.`); }
        p.act = null;
      }
      break;
    }
    case 'build': runBuild(p, A, sp, dt); break;
    case 'hunt': {
      if (A.ph === 'deliver') { deliverPhase(p, A, sp, dt); break; }
      const an = W.animals.find(a => a.id === A.who && !a.dead);
      if (!an || an.isl !== p.isl) { p.act = null; break; }
      moveTo(p, an.x, an.z, sp * 1.05, dt);
      const d = dist(p, an);
      discover(p, 'hunt', dt);
      if (d < 6 && W.t >= (A.next || 0)) {
        A.next = W.t + 0.1;
        const huntMul = (PROFS[p.prof] && PROFS[p.prof].hunt) || 1;
        const ch = (0.12 + p.g.str * 0.12 + p.sk.hunt * 0.02 + (hasItem(p, 'spear') ? 0.14 : 0.04)) * huntMul - (d > 3 ? 0.05 : 0);
        if (rand() < ch) {
          an.dead = true;
          p.food += an.sp === 'boar' ? 8 : 6;
          p.sk.hunt = Math.min(10, p.sk.hunt + 0.25);
          milestone('firstHunt', `${p.name} brought down a ${an.sp}. Meat for the first time since the wreck.`, [p.id]);
          const g = grpOf(p);
          if (g) near(p.x, p.z, 30, o => { if (o !== p && o.grp === g.id) bump(o, p, 1, 1, 3); });
          A.ph = 'deliver';
        } else if (an.sp === 'boar' && d < 2.5 && rand() < 0.08) { hurt(p, 18 + rand() * 20, 'boar'); if (p.dead) break; }
      }
      break;
    }
    case 'fish': {
      if (A.ph === 'go') { if (moveTo(p, A.tx, A.tz, sp, dt)) { A.ph = 'work'; A.until = W.t + 2; } break; }
      if (A.ph === 'work') {
        if (W.t >= A.until) {
          const mul = itemMul(p, 'fish') * ((PROFS[p.prof] && PROFS[p.prof].fish) || 1) * (seasonIdx() === 3 ? 0.6 : 1);
          p.food += Math.max(1, Math.round((0.9 + p.sk.hunt * 0.08) * mul * (knows(p, 'smoking') ? 1.35 : 1) + rand() * 0.8));
          p.sk.hunt = Math.min(10, p.sk.hunt + 0.04);
          discover(p, 'shore', 2);
          seeFar(p);
          if (p.hun < 60) setAct(p, { k: 'eat', ph: 'work', until: W.t + 0.4 });
          else A.ph = 'deliver';
        }
        break;
      }
      deliverPhase(p, A, sp, dt);
      break;
    }
    case 'farm': {
      const f = W.farms.find(f => f.id === A.id);
      if (!f) { p.act = null; break; }
      if (A.ph === 'go') { if (moveTo(p, f.x + 1.2, f.z, sp, dt)) { A.ph = 'work'; A.until = W.t + (A.what === 'plant' ? 4 : 2); } break; }
      if (A.what === 'harvest' && (!f.planted || f.grow < 1)) { p.act = null; break; }
      if (W.t >= A.until) {
        if (A.what === 'plant') { f.planted = true; f.grow = 0; milestone('firstField', `${p.name} planted the island’s first field.`, [p.id]); }
        else { const g = groupById(f.g); if (g) g.store += 18; f.grow = 0; }
        discover(p, 'gather', 1);
        p.act = null;
      }
      break;
    }
    case 'craft': {
      if (goStay(p, A, sp, dt)) {
        W.items.push({ id: W.nextId++, k: A.what, x: p.x, z: p.z, owner: p.id, isl: p.isl });
        if (A.what === 'spear') milestone('firstSpear', `${p.name} carved the first spear.`, [p.id]);
        p.act = null;
      } else if (A.here && rand() < dt * 0.4) say(p, 'work');
      break;
    }
    case 'voyage': {
      const b = W.boats.find(b => b.id === A.boat);
      if (!b || b.sail || b.isl !== p.isl || W.t - A.t0 > 10) { p.act = null; break; }
      if (moveTo(p, b.x, b.z, sp, dt) || dist(p, b) < 2.5) launch(p, b, A.dest);
      break;
    }
    case 'ride': if (!W.boats.find(b => b.id === A.boat && b.sail)) p.act = null; break;
    case 'follow': {
      const t = PM.get(A.who);
      if (!t || t.isl !== p.isl) { p.act = null; break; }
      if (dist(p, t) > 2.2) moveTo(p, t.x - Math.cos(t.dir) * 1.1, t.z - Math.sin(t.dir) * 1.1, Math.max(sp, speedOf(t)) * 1.05, dt);
      break;
    }
    case 'snake': {
      const s = W.snakes.find(s => s.id === A.who && !s.dead);
      if (!s || s.isl !== p.isl) { p.act = null; break; }
      moveTo(p, s.x, s.z, sp * 1.05, dt);
      if (dist(p, s) < 1.6 && W.t >= (A.next || 0)) {
        A.next = W.t + 0.1;
        if (rand() < 0.4 + 0.35 * p.g.str + fightBonus(p)) { s.dead = true; p.act = null; }
        else if (rand() < 0.3) bite(p, s);
      }
      break;
    }
    case 'join': {
      const g = groupById(A.g);
      if (!g || g.dead) { p.act = null; break; }
      if (moveTo(p, A.tx, A.tz, sp * 0.8, dt) || dist(p, g) < 3) { askToJoin(p, g); p.act = null; }
      break;
    }
    case 'trade': {
      const fg = groupById(A.g);
      if (!fg || fg.dead) { p.act = null; break; }
      if (moveTo(p, A.tx, A.tz, sp, dt) || dist(p, fg) < 3) { doTrade(p, fg); p.act = null; }
      break;
    }
    case 'sneak': runSneak(p, A, sp, dt); break;
    case 'confront': runConfront(p, A, sp, dt); break;
    case 'demand': runDemand(p, A, sp, dt); break;
    case 'fight': runFight(p, A, dt); break;
    case 'tryst': runTryst(p, A, sp, dt); break;
    case 'murder': runMurder(p, A, sp, dt); break;
    case 'council': {
      if (!A.here) { if (moveTo(p, A.tx, A.tz, sp, dt)) A.here = true; break; }
      const g = groupById(A.g);
      if (g) p.dir = Math.atan2(g.z - p.z, g.x - p.x);
      if (!g || !g.council) { p.act = null; break; }
      if (rand() < dt * (g.leader === p.id ? 1.6 : 0.5)) councilSpeech(p, g);
      break;
    }
    default: p.act = null;
  }
}
function runBuild(p, A, sp, dt) {
  if (A.ph === 'wood') {
    if (!A.here) { if (moveTo(p, A.tx, A.tz, sp, dt)) { A.here = true; A.until = W.t + 1.2 / itemMul(p, 'wood'); } return; }
    if (W.t < A.until) return;
    p.wood += 2;
    discover(p, 'wood', 1.2);
    if (rand() < 0.15) say(p, 'work');
    if (p.wood >= A.need) {
      const s = A.what === 'hut' && A.hut ? W.huts.find(h => h.id === A.hut) : siteFor(p, A.what);
      if (!s) { p.act = null; return; }
      A.ph = 'site'; A.tx = s.x; A.tz = s.z; A.hut = s.hut || s.id || 0; A.here = false;
    } else A.until = W.t + 1.2 / itemMul(p, 'wood');
    return;
  }
  if (A.ph === 'site') {
    const ox = A.what === 'fire' ? 0.8 : A.what === 'hut' ? 1.6 : 0, oz = A.what === 'boat' ? 0 : 0.6;
    if (moveTo(p, A.tx + ox, A.tz + oz, sp, dt) || (A.what === 'boat' && dist(p, { x: A.tx, z: A.tz }) < 2.5) || W.t - A.t0 > 25) { A.ph = 'work'; A.until = W.t + (A.what === 'fire' ? 0.5 : 0); }
    return;
  }
  if (A.what === 'fire') {
    if (W.t < A.until) return;
    const g = grpOf(p);
    if (g) {
      const first = !g.fire.ever;
      if (!g.fire.lit && !canLight(p)) { p.act = null; return; }
      g.fire.fuel = Math.min(100, g.fire.fuel + 55); g.fire.lit = true; g.fire.ever = true;
      p.wood = Math.max(0, p.wood - 2);
      if (first) { ev('build', `${p.name} lit the fire at ${g.name}.`, [p.id], 1); near(g.x, g.z, 30, o => { if (o !== p && o.grp === g.id) bump(o, p, 1, 1, 3); }); }
    }
    p.act = null;
  } else if (A.what === 'hut') {
    const h = W.huts.find(h => h.id === A.hut);
    if (!h || h.done) { p.act = null; return; }
    const bm = (PROFS[p.prof] && PROFS[p.prof].build) || 1;
    h.prog = Math.min(1, h.prog + dt / (9 / (bm * itemMul(p, 'wood') ** 0.5 * (1 + p.sk.build * 0.08))));
    p.sk.build = Math.min(10, p.sk.build + dt * 0.02);
    if (rand() < dt * 0.3) say(p, 'work');
    if (h.prog >= 1) {
      const wasDamaged = h.built;
      h.done = true; h.built = true; h.own = p.id;
      p.wood = Math.max(0, p.wood - 6);
      p.home = h.id;
      const m = PM.get(p.partner);
      if (m && !hasHome(m)) m.home = h.id;
      for (const k of p.kids) { const kd = PM.get(k); if (kd && ageY(kd) < ADULT) kd.home = h.id; }
      if (!wasDamaged) { milestone('firstHut', `${p.name} built the first hut on the island.`, [p.id]); life(p, 'I built a hut of my own.'); }
      p.act = null;
    }
  } else if (A.what === 'boat') {
    if (W.boats.some(b => !b.sail && b.isl === p.isl)) { p.act = null; return; }
    const bm = (PROFS[p.prof] && PROFS[p.prof].build) || 1;
    W.yards[p.isl] = (W.yards[p.isl] || 0) + dt / 14 * bm * Math.sqrt(itemMul(p, 'wood'));
    if (rand() < dt * 0.3) say(p, 'boat');
    discover(p, 'boat', dt);
    if (W.yards[p.isl] >= 1) {
      W.yards[p.isl] = 0;
      const d = W.docks[p.isl];
      const rig = knows(p, 'sailing');
      W.boats.push({ id: W.nextId++, x: d.x, z: d.z, isl: p.isl, sail: null, dir: 0, by: p.id, rig });
      if (rig) milestone('firstSail', `${p.name} rigged a boat with a sail. Now the high island is within reach.`, [p.id]);
      p.wood = Math.max(0, p.wood - 10);
      milestone('firstBoat', `${p.name} finished a boat that might survive the open sea.`, [p.id]);
      life(p, 'I built a boat.');
      p.act = null;
    } else if (W.t - A.t0 > 24) p.act = null;
  }
}
function seeFar(p) {
  if (!W.milestones.sawThird && W.milestones.farLanding && p.isl !== 3 && Math.hypot(p.x - THIRD.x, p.z - THIRD.z) - THIRD.r < 100) {
    milestone('sawThird', `${p.name} spotted a third island, high and green, with smoke rising from its peak.`, [p.id]);
    life(p, 'I saw a third island, with smoke on its mountain.');
  }
  if (p.isl !== 1 || W.milestones.sawFar) return;
  if (Math.hypot(p.x - FAR.x, p.z - FAR.z) - FAR.r < 95) {
    milestone('sawFar', `${p.name} saw land across the water. They are not alone in the sea.`, [p.id]);
    life(p, 'I saw another island across the water.');
  }
}
