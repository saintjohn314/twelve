
/* ---------- animals ---------- */
function spawnAnimal(sp, isl, avoid, minD) {
  const c = ISLES[isl];
  for (let k = 0; k < 60; k++) {
    const pt = randLand(isl, c.x, c.z, 4, c.r * 0.95, { minH: sp === 'goat' ? 3 : 1, maxH: 12 });
    if (!pt) continue;
    if (avoid && Math.hypot(pt.x - avoid.x, pt.z - avoid.z) < (minD || 30)) continue;
    W.animals.push({ id: W.nextId++, sp, x: pt.x, z: pt.z, tx: pt.x, tz: pt.z, dir: rand() * 6.283, isl, born: W.t, home: { x: pt.x, z: pt.z }, stam: 0.8, nc: 0, next: 0 });
    return true;
  }
  return false;
}
function spawnSnake(isl, avoid, minD) {
  const c = ISLES[isl];
  for (let k = 0; k < 40; k++) {
    const pt = randLand(isl, c.x, c.z, 4, c.r * 0.95, { minH: 1, maxH: 9 });
    if (!pt) continue;
    if (avoid && Math.hypot(pt.x - avoid.x, pt.z - avoid.z) < (minD || 20)) continue;
    W.snakes.push({ id: W.nextId++, x: pt.x, z: pt.z, dir: rand() * 6.283, isl, cd: 0, home: { x: pt.x, z: pt.z } });
    return true;
  }
  return false;
}
function animalStep(dt) {
  for (const a of W.animals) {
    if (a.dead) continue;
    a.moving = false;
    if (W.t >= a.nc) {
      a.nc = W.t + 0.1;
      a.thr = 0;
      let bd = a.sp === 'goat' ? 12 : 8;
      near(a.x, a.z, 12, (p, d) => { if (p.isl !== a.isl || ageY(p) < 8) return; const lim = p.act && p.act.k === 'hunt' ? (a.sp === 'goat' ? 12 : 8) : 3.5; if (d < lim && d < bd) { bd = d; a.thr = p.id; } });
    }
    const thr = a.thr ? PM.get(a.thr) : null;
    if (thr && a.stam > 0) {
      const d = Math.max(0.1, dist(a, thr));
      a.stam -= dt;
      moveTo(a, a.x + (a.x - thr.x) / d * 10, a.z + (a.z - thr.z) / d * 10, a.sp === 'goat' ? 62 : 52, dt);
    } else {
      a.stam = Math.min(0.9, a.stam + dt * 0.45);
      if (Math.hypot(a.home.x - a.x, a.home.z - a.z) > 40) a.home = { x: a.x, z: a.z };
      if (W.t >= a.next) {
        const pt = randLand(a.isl, a.home.x, a.home.z, 0, 16, { minH: a.sp === 'goat' ? 2.5 : 0.9, maxH: 12 });
        if (pt) { a.tx = pt.x; a.tz = pt.z; }
        a.next = W.t + 1.5 + rand() * 4;
      }
      moveTo(a, a.tx, a.tz, 10, dt);
    }
  }
  W.animals = W.animals.filter(a => !a.dead);
  for (const s of W.snakes) {
    if (s.dead) continue;
    s.moving = false;
    let hunter = null;
    near(s.x, s.z, 7, p => { if (p.act && p.act.k === 'snake' && p.act.who === s.id) hunter = p; });
    if (hunter) { const d = Math.max(0.1, dist(s, hunter)); moveTo(s, s.x + (s.x - hunter.x) / d * 6, s.z + (s.z - hunter.z) / d * 6, 30, dt); }
    else {
      if (W.t >= (s.next || 0)) { const pt = randLand(s.isl, s.home.x, s.home.z, 0, 18, { minH: 0.8, maxH: 9 }); if (pt) { s.tx = pt.x; s.tz = pt.z; } s.next = W.t + 3 + rand() * 6; }
      moveTo(s, s.tx || s.x, s.tz || s.z, 11, dt);
    }
    if (s.cd < W.t && W.t >= (s.bc || 0)) {
      s.bc = W.t + 0.1;
      near(s.x, s.z, 1.5, p => { if (s.cd > W.t || p.isl !== s.isl || (p.act && p.act.k === 'ride')) return; if (rand() < 0.15) bite(p, s); });
    }
  }
  W.snakes = W.snakes.filter(s => !s.dead);
}
function bite(p, s) {
  p.venom = 8; p.lastHurt = 'venom'; s.cd = W.t + 6;
  life(p, 'A snake bit me.');
  ev('danger', `A snake bit ${p.name}.`, [p.id], 1);
}

/* ---------- boats ---------- */
function launch(p, b, dest) {
  if (!dest || dest === p.isl || (dest === 3 && !b.rig) || (p.isl === 3 && !b.rig && dest !== nearestIsle(3))) dest = p.isl === 1 ? 2 : p.isl === 2 ? 1 : nearestIsle(3);
  const to = W.docks[dest];
  b.sail = { cap: p.id, from: p.isl, to: dest, tx: to.x, tz: to.z, pax: [p.id] };
  p.lastVoyage = W.t;
  setAct(p, { k: 'ride', boat: b.id, max: -1 });
  const m = PM.get(p.partner), fam = [];
  if (m && m.isl === p.isl && dist(m, p) < 50 && ageY(m) < 58 && !(m.act && (m.act.k === 'ride' || m.act.k === 'fight' || m.act.k === 'ponder'))) fam.push(m);
  for (const o of W.people) {
    if (o === p || o.isl !== p.isl || ageY(o) >= 12 || dist(o, p) > 50 || fam.length >= 6) continue;
    if ([o.mom, o.dad, o.care].some(id => id && (id === p.id || (m && id === m.id)))) fam.push(o);
  }
  const g = grpOf(p);
  if (!W.milestones.farLanding && g) for (const o of members(g)) { if (fam.length >= 4 || o === p || fam.indexOf(o) >= 0 || ageY(o) < ADULT || dist(o, p) > 40 || o.p.open < 0.6) continue; if (o.act && !LOW.has(o.act.k)) continue; fam.push(o); }
  for (const o of fam) { b.sail.pax.push(o.id); setAct(o, { k: 'ride', boat: b.id, max: -1 }); o.lastVoyage = W.t; }
  W.stats.voyages++;
  const first = !W.milestones.firstVoyage;
  if (first) milestone('firstVoyage', `${p.name} pushed the boat into the surf${fam.length ? ' with ' + fam.map(x => x.name).join(', ') : ''}. They are trying to get off the island.`, [p.id]);
  else ev('voyage', `${p.name} set out by boat for ${ISLE_NAMES[dest]}${fam.length ? ' with ' + fam.length + ' others' : ''}.`, [p.id], 2);
  say(p, 'boat');
}
function boatStep(dt) {
  for (const b of W.boats) {
    if (!b.sail) continue;
    const s = b.sail;
    const dx = s.tx - b.x, dz = s.tz - b.z, d = Math.hypot(dx, dz);
    b.dir = Math.atan2(dz, dx);
    const st = Math.min(d, (b.rig ? 62 : 40) * dt);
    if (d > 0.5) { b.x += dx / d * st; b.z += dz / d * st; }
    s.pax.forEach((id, i) => { const o = PM.get(id); if (!o) return; const off = (i - (s.pax.length - 1) / 2) * 0.75; o.x = b.x + Math.cos(b.dir) * off; o.z = b.z + Math.sin(b.dir) * off; o.dir = b.dir; });
    if (W.wx.storm > 0 && !s.stormChecked) {
      s.stormChecked = true;
      const nav = s.pax.some(id => { const o = PM.get(id); return o && knows(o, 'navigation'); });
      if (rand() < (nav ? 0.25 : 0.55) * (b.rig ? 0.55 : 1)) { capsize(b); continue; }
    }
    if (d <= 0.6) arrive(b);
  }
}
function capsize(b) {
  const s = b.sail;
  const nav = s.pax.some(id => { const o = PM.get(id); return o && knows(o, 'navigation'); });
  const lost = [];
  for (const id of s.pax) {
    const o = PM.get(id);
    if (!o) continue;
    if (rand() < (nav ? 0.2 : 0.45)) { killP(o, 'drowned'); lost.push(o.name); }
    else { const pt = randLand(s.from, W.docks[s.from].x, W.docks[s.from].z, 1, 6, { minH: 0.3 }) || W.docks[s.from]; o.x = pt.x; o.z = pt.z; o.isl = s.from; o.act = null; life(o, 'The storm smashed our boat. I barely made it back to shore.'); }
  }
  W.boats = W.boats.filter(x => x !== b);
  ev('death', `A storm caught the boat at sea and smashed it apart.${lost.length ? ' ' + lost.join(', ') + (lost.length > 1 ? ' drowned.' : ' drowned.') : ' Everyone swam back.'}`, [], 4);
}
function arrive(b) {
  const s = b.sail, dest = s.to;
  b.isl = dest; b.sail = null;
  const cap = PM.get(s.cap);
  const pax = s.pax.map(id => PM.get(id)).filter(Boolean);
  for (const o of pax) {
    const pt = randLand(dest, W.docks[dest].x, W.docks[dest].z, 1, 4, { minH: 0.3 }) || W.docks[dest];
    o.x = pt.x; o.z = pt.z; o.isl = dest; o.act = null; o.stuck = 0;
    if (o.home && !W.huts.find(h => h.id === o.home && h.isl === dest)) o.home = 0;
  }
  if (dest === 2 && !W.milestones.farLanding) {
    const yrs = Math.floor(W.t / HPY);
    milestone('farLanding', `${cap ? cap.name : 'They'} reached the far island${yrs ? ' in year ' + (yrs + 1) : ''}. They had hoped for rescue. They found only another island.`, cap ? [cap.id] : []);
  }
  if (dest === 3 && !W.milestones.thirdLanding) milestone('thirdLanding', `${cap ? cap.name : 'They'} brought the sailboat through the rough water to the high island. Warm vents steam in the rocks, and the forest is heavy with fruit.`, cap ? [cap.id] : []);
  const there = W.groups.filter(g => !g.dead && g.isl === dest);
  let joinG = null, bs = -10;
  for (const g of there) { if (pax.some(o => o.exiled === g.id && W.t - o.exileT < 3 * HPY && ageY(o) >= ADULT)) continue; let sc = 0; const ms = adultsOf(g); for (const m of ms) for (const o of pax) sc += opinion(o, m); sc = ms.length ? sc / ms.length / pax.length : 0; if (sc > bs) { bs = sc; joinG = g; } }
  if (joinG && cap) { for (const o of pax) joinGroup(o, joinG); ev('voyage', `${cap.name}’s boat landed and they joined ${joinG.name}.`, [cap.id], 2); }
  else if (cap && pax.filter(o => ageY(o) >= ADULT).length < 2) { for (const o of pax) { const og = grpOf(o); if (og && og.isl !== dest) { if (og.leader === o.id) og.leader = 0; o.grp = 0; } } }
  else if (cap) {
    const land = W.docks[dest], c = ISLES[dest];
    const pt = randLand(dest, land.x + (c.x - land.x) * 0.25, land.z + (c.z - land.z) * 0.25, 0, 12, { minH: 1.2 }) || randLand(dest, c.x, c.z, 0, 25, { minH: 1 }) || { x: c.x, z: c.z };
    const ng = foundCamp(cap, pax.filter(o => ageY(o) >= 3), pt);
    ev('voyage', `${cap.name} and the others who crossed made a new camp: ${ng.name}.`, [cap.id], 3);
  }
  for (const o of pax) life(o, dest === 1 ? 'We sailed back across to the island of the wreck.' : `We crossed the sea to ${ISLE_NAMES[dest]}.`);
}

/* ---------- discovery ---------- */
function discover(p, ctx, hours) {
  if (ageY(p) < 8) return;
  for (const id in TECH) {
    const T = TECH[id];
    if (p.know.indexOf(id) >= 0 || T.ctx.indexOf(ctx) < 0 || (T.need && p.know.indexOf(T.need) < 0)) continue;
    let pr = T.b * (0.3 + 1.7 * p.p.open) * hours;
    if (W.techs[id] && W.techs[id].lost) pr *= 1.5;
    if (rand() < pr) learn(p, id, true);
  }
}
function learn(p, id, discovered, from) {
  if (p.know.indexOf(id) >= 0) return;
  p.know.push(id);
  const T = TECH[id];
  if (discovered) {
    if (!W.techs[id]) { W.techs[id] = { by: p.id, t: W.t, lost: false }; ev('tech', `${p.name} worked out ${T.n.toLowerCase()}.`, [p.id], 2); life(p, `I figured out ${T.n.toLowerCase()}.`); }
    else if (W.techs[id].lost) { W.techs[id].lost = false; ev('tech', `${p.name} rediscovered ${T.n.toLowerCase()}.`, [p.id], 2); }
  } else if (from && ageY(p) < 22) life(p, `${from.name} taught me ${T.n.toLowerCase()}.`);
  if (!W.techs[id]) W.techs[id] = { by: p.id, t: W.t, lost: false };
}

/* ---------- birth & death ---------- */
function tryConceive(f) {
  if (f.sex !== 'F' || f.preg) return;
  const a = ageY(f);
  if (a < ADULT || a > 44) return;
  const m = PM.get(f.partner);
  if (!m || m.isl !== f.isl) return;
  if (W.t - f.bedT > 14 || W.t - f.lastBirth < 0.8 * HPY) return;
  if (f.hun < 28 || m.hun < 20 || W.people.length >= POP_CAP) return;
  let pr = 0.15 * (0.4 + 1.2 * (f.g.fert + m.g.fert) / 2);
  if (a > 36) pr *= 0.45;
  if (relA(f, m) < 10) pr *= 0.5;
  if (rand() < pr) { f.preg = { due: W.t + 0.75 * HPY, dad: m.id }; life(f, 'I am carrying a child.'); }
}
function inherit(a, b) {
  const o = {};
  for (const k in a) { let v = (a[k] + b[k]) / 2 + gauss() * 0.07; if (rand() < 0.04) v += gauss() * 0.2; o[k] = clamp(v, 0.03, 0.97); }
  return o;
}
function birth(mom) {
  const dad = PM.get(mom.preg.dad) || W.arch[mom.preg.dad];
  const secret = mom.preg.secret;
  const g = inherit(mom.g, dad ? dad.g : mom.g);
  g.skin = clamp((mom.g.skin + (dad ? dad.g.skin : mom.g.skin)) / 2 + gauss() * 0.05, 0, 1);
  const pers = inherit(mom.p, dad ? dad.p : mom.p);
  const kid = newPerson({ name: kidName(mom, dad), sex: rand() < 0.5 ? 'M' : 'F', born: W.t, gen: Math.max(mom.gen, dad ? dad.gen : mom.gen) + 1, mom: mom.id, dad: dad ? dad.id : 0, g, p: pers, x: mom.x + 0.6, z: mom.z + 0.4, grp: mom.grp, hun: 100 });
  kid.home = mom.home; kid.care = mom.id; kid.isl = mom.isl;
  for (const sid of mom.kids) { const sb = PM.get(sid); if (sb) { bump(sb, kid, 25, 20); bump(kid, sb, 25, 20); } }
  mom.kids.push(kid.id);
  if (dad && dad.kids) dad.kids.push(kid.id);
  bump(kid, mom, 60, 60); bump(mom, kid, 70, 50);
  const live = dad && PM.get(dad.id);
  if (live) { bump(kid, live, 50, 50); bump(live, kid, 60, 40); }
  const putative = secret ? PM.get(mom.partner) : null;
  if (putative && putative !== live) { bump(putative, kid, 55, 40); bump(kid, putative, 45, 40); kid.pdad = putative.id; }
  mom.preg = null; mom.lastBirth = W.t;
  W.stats.births++;
  if (kid.gen > W.stats.maxGen) W.stats.maxGen = kid.gen;
  const word = kid.sex === 'M' ? 'son' : 'daughter';
  const father = secret && putative ? putative.name : dad ? dad.name : '';
  ev('birth', `${mom.name}${father ? ' and ' + father : ''} had a ${word}, ${kid.name}${secret ? `. Only ${mom.name} knows the father is really ${dad ? dad.name : 'someone else'}` : ''}.`, [kid.id, mom.id], secret ? 3 : 1);
  milestone('firstBirth', `${kid.name}, ${mom.name}’s ${word}, is the first child born on the island.`, [kid.id, mom.id]);
  life(mom, `My ${word} ${kid.name} was born.`);
  if (live) life(live, `My ${word} ${kid.name} was born.`);
  if (putative && putative !== live) life(putative, `My ${word} ${kid.name} was born.`);
  const n = W.people.length;
  for (const m of [25, 50, 100]) if (n >= m) milestone('pop' + m, `There are ${m} people on the islands now.`);
  if (rand() < (knowsNear(mom, 'medicine', 20) ? 0.006 : 0.02)) killP(mom, 'childbirth');
}
function knowsNear(p, t, r) {
  if (knows(p, t)) return true;
  let f = false;
  near(p.x, p.z, r, o => { if (!f && o.isl === p.isl && knows(o, t)) f = true; });
  return f;
}
function killP(p, cause, by) { if (!p.dead) { p.dead = cause || 'injuries'; p.killer = by || 0; } }
function hurt(p, amt, cause, by) { p.hp -= amt; p.lastHurt = cause; if (p.hp <= 0) killP(p, cause, by && by.id); }
const DEATH_TEXT = {
  'old age': n => `${n} died of old age`, starvation: n => `${n} starved`, boar: n => `A boar gored ${n}`, venom: n => `${n} died of a snake bite`,
  fever: n => `${n} died of a fever`, childbirth: n => `${n} died giving birth`, drowned: n => `${n} drowned`, fight: n => `${n} died of wounds from a fight`,
};
function processDeaths() {
  let any = false;
  for (const p of W.people) if (p.dead) { any = true; die(p); }
  if (!any) return;
  W.people = W.people.filter(p => !p.dead);
  if (!W.people.length && !W.over) { W.over = W.t; ev('end', `The last castaway is gone. Season ${W.season} is over.`, [], 5); }
}
function die(p) {
  const cause = p.dead, a = ageY(p);
  W.arch[p.id] = { id: p.id, name: p.name, sex: p.sex, born: p.born, died: W.t, cause, gen: p.gen, mom: p.mom, dad: p.dad, partner: p.partner, kids: p.kids.slice(), g: p.g, p: p.p, prof: p.prof, grp: p.grp, killer: p.killer || 0, know: p.know.slice() };
  PM.delete(p.id);
  W.stats.deaths++;
  if (cause !== 'murder' && cause !== 'fight' && cause !== 'drowned') ev('death', (DEATH_TEXT[cause] || (n => `${n} died`))(p.name) + (a >= 1 ? ` at ${Math.floor(a)}` : ' as a baby') + '.', [p.id], ageY(p) > 3 ? 2 : 1);
  milestone('firstDeath', `${p.name} was the first of them to die on the island.`, [p.id]);
  const partner = PM.get(p.partner);
  if (partner) { partner.partner = 0; partner.widowT = W.t; }
  for (const o of W.people) {
    if (o.dead || o === p) continue;
    const close = (p.rel && relA(o, p) > 40) || o.id === p.partner || o.mom === p.id || o.dad === p.id || p.mom === o.id || p.dad === o.id;
    if (!close) continue;
    life(o, `${p.name} died.`);
    if (o.isl === p.isl && ageY(o) >= 4 && dist(o, p) < 80 && !(o.act && (o.act.k === 'ride' || o.act.k === 'fight' || o.act.k === 'council' || o.act.k === 'ponder'))) setAct(o, { k: 'mourn', s: p.name, tx: p.x + rr(-2, 2), tz: p.z + rr(-2, 2), stay: 1.2, max: 4 });
    o.soc = Math.max(0, o.soc - 15);
    if (cause === 'murder' || cause === 'fight') { const k = PM.get(p.killer); if (k && cause === 'fight') { mem(o, 'murder', k.id, -70, `${k.name} killed ${p.name}.`); bump(o, k, -60, -60); } }
  }
  const its = itemsOf(p);
  if (its.length) {
    const heir = (partner && partner.isl === p.isl) ? partner : p.kids.map(id => PM.get(id)).filter(k => k && ageY(k) >= 14).sort((x, y) => x.born - y.born)[0];
    for (const it of its) { if (heir) giveItem(it, heir); else { it.owner = 0; it.x = p.x; it.z = p.z; it.isl = p.isl; } }
    if (heir) life(heir, `I inherited ${p.name}’s ${its.map(i => ITEMS[i.k].n).join(' and ')}.`);
  }
  const g = grpOf(p);
  if (g && g.leader === p.id) { g.leader = 0; ev('leader', `${g.name} has lost its leader.`, [], 2); }
  for (const h of W.huts) if (h.own === p.id) { const heir = partner || p.kids.map(id => PM.get(id)).find(Boolean); h.own = heir ? heir.id : 0; }
  for (const t of p.know) if (!W.people.some(o => !o.dead && o !== p && o.know.indexOf(t) >= 0) && W.techs[t]) { W.techs[t].lost = true; ev('lost', `With ${p.name} gone, no one remembers ${TECH[t].n.toLowerCase()}.`, [p.id], 2); }
}

/* ---------- periodic upkeep ---------- */
function resourceStep(dt) {
  const s = seasonIdx(), storm = W.wx.storm > 0;
  const TR = [2.4, 2.8, 2.0, 0.5], BR = [1.7, 2.0, 1.3, 0.25];
  const dr = W.wx.drought > 0 ? 0.25 : 1;
  for (const t of W.trees) t.f = Math.min(t.m, t.f + TR[s] * (t.isl === 2 ? 1.1 : t.isl === 3 ? 1.2 : 1) * dr / 24 * dt);
  for (const b of W.bushes) b.f = Math.min(b.m, b.f + BR[s] * dr / 24 * dt);
  for (const f of W.farms) if (f.planted && s !== 3 && f.grow < 1) f.grow = Math.min(1, f.grow + dt / 60 * (dr < 1 ? 0.3 : 1));
  if (W.wx.drought > 0) { W.wx.drought = Math.max(0, W.wx.drought - dt); if (W.wx.drought <= 0) ev('nature', 'The rains came back. The drought is over.', [], 2); }
  for (const g of W.groups) {
    if (g.dead) continue;
    const tk = g.tk || {};
    g.store = Math.max(0, g.store * (1 - (tk.pot ? 0.012 : 0.035) * (tk.smoke ? 0.7 : 1) / 24 * dt));
    if (g.fire.lit) { g.fire.fuel -= (storm ? 6 : 1.2) * dt; if (g.fire.fuel <= 0) { g.fire.fuel = 0; g.fire.lit = false; } }
  }
  for (const h of W.huts) if (h.stash > 0) { const f = 1 - 0.04 / 24 * dt; h.stash = Math.max(0, h.stash * f); h.seen = (h.seen || 0) * f; }
  if (W.flames.length) W.flames = W.flames.filter(f => f.until > W.t);
  if (W.wx.storm > 0) W.wx.storm = Math.max(0, W.wx.storm - dt);
}
function hourly() {
  for (const p of W.people) p.nursing = 0;
  for (const p of W.people) {
    if (ageY(p) >= 3) { p.care = 0; continue; }
    let c = PM.get(p.mom);
    if (!c || c.isl !== p.isl) c = PM.get(p.dad);
    if (!c || c.isl !== p.isl) { c = null; let best = -1; for (const o of W.people) { if (o === p || o.isl !== p.isl || ageY(o) < 14) continue; const k = kin(p, o) + (o.sex === 'F' ? 0.01 : 0) + (o.grp === p.grp ? 0.05 : 0); if (k > best) { best = k; c = o; } } }
    p.care = c ? c.id : 0;
    if (c) c.nursing++;
  }
  expirePending();
  contagion();
  const hour = Math.floor(W.t % 24);
  for (const g of W.groups) {
    if (g.dead) continue;
    if (!g.council && W.t >= g.nextCouncil && hour >= 18 && hour < 20 && W.wx.storm <= 0) startCouncil(g);
    if (g.split && W.t >= g.split.depart) departSplit(g);
  }
  checkBodies();
}
function contagion() {
  const sick = W.people.filter(p => p.ill > 0);
  if (!sick.length) return;
  const caught = [];
  for (const s of sick) near(s.x, s.z, 4, o => {
    if (o === s || o.ill > 0 || (o.immune || 0) > W.t || caught.indexOf(o) >= 0) return;
    if (rand() < 0.007 * (knowsNear(o, 'medicine', 10) ? 0.5 : 1)) { o.ill = 20 + rand() * 30; mem(o, 'sick', s.id, -3, `I caught the fever from ${s.name}.`); caught.push(o); }
  });
  const n = sick.length + caught.length;
  if (n >= 4 && W.t - (W.lastOutbreak || -1e9) > 96) {
    W.lastOutbreak = W.t;
    const cnt = {};
    for (const p of sick.concat(caught)) if (p.grp) cnt[p.grp] = (cnt[p.grp] || 0) + 1;
    const gid = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0], g = gid ? groupById(+gid) : null;
    ev('danger', `A fever is spreading${g ? ' through ' + g.name : ''}. ${n} people are sick.`, sick.slice(0, 4).map(p => p.id), 3);
    milestone('firstOutbreak', `The first outbreak of fever swept the camps.`, []);
  }
}
function inheritFeuds() {
  for (const p of W.people) {
    if (p.inh || ageY(p) < 13) continue;
    p.inh = true;
    let told = false;
    for (const pid of [p.mom, p.dad, p.pdad]) {
      const par = PM.get(pid);
      if (!par) continue;
      for (const id in par.rel) {
        const r = par.rel[id], o = PM.get(+id);
        if (!o || o === p || kin(p, o) > 0.1 || ageY(o) < 10) continue;
        if (r[0] < -45) {
          bump(p, o, r[0] * 0.35, r[1] * 0.3);
          mem(p, 'feud', o.id, -8, `${par.name} raised me never to trust ${o.name}.`);
          if (r[0] < -60 && !told) { told = true; ev('conflict', `${p.name} has grown up hating ${o.name}, just like ${par.name} does.`, [p.id, o.id, par.id], 2); }
        } else if (r[0] > 55 && o.id !== par.partner) bump(p, o, r[0] * 0.2, r[1] * 0.2);
      }
    }
  }
}
function weather(s) {
  if (W.wx.drought <= 0 && s === 1 && rand() < 0.035) {
    W.wx.drought = 96 + rand() * 120;
    ev('nature', 'A drought has settled over the islands. Fruit is shriveling on the branch.', [], 3);
    milestone('firstDrought', 'The first drought came. The castaways learned what hunger really means.', []);
  }
  if (W.wx.drought > 0 && W.wx.storm > 0) { W.wx.drought = 0; ev('nature', 'The storm broke the drought.', [], 2); }
}
function daily() {
  const pops = { 1: islandPop(1), 2: islandPop(2), 3: islandPop(3) };
  sampleDaily(pops);
  for (const p of W.people) {
    const a = ageY(p);
    if (p.ill <= 0 && (p.immune || 0) < W.t && rand() < 0.006 * ((a < 5 || a > 60) ? 2 : 1) * (1 + (pops[p.isl] || 0) / 150)) { p.ill = 24 + rand() * 40; mem(p, 'sick', 0, -5, 'I burned with fever.'); }
    if (a > p.lim && rand() < 0.002 + 0.0035 * (a - p.lim)) killP(p, 'old age');
    const m = PM.get(p.partner);
    if (m && p.id < m.id && (relA(p, m) < -15 || relT(p, m) < -45 || relA(m, p) < -15)) {
      p.partner = 0; m.partner = 0; p.widowT = W.t - HPY * 0.4; m.widowT = W.t - HPY * 0.4;
      ev('love', `${p.name} and ${m.name} have split up.`, [p.id, m.id], 2);
      life(p, `${m.name} and I split up.`); life(m, `${p.name} and I split up.`);
      const h = hutOf(p);
      if (h && h.own !== p.id) p.home = 0; else if (h) m.home = 0;
    }
    for (const id in p.rel) {
      const r = p.rel[id], o = PM.get(+id);
      if (!o && !W.arch[+id]) { delete p.rel[id]; continue; }
      r[2] *= 0.985; r[3] *= 0.97;
      if (!o) continue;
      if (o.id === p.partner) { const sp = 35 + compat(p, o) * 55 - p.p.neuro * 20; r[0] += (sp - r[0]) * 0.025; }
      else if (o.mom === p.id || o.dad === p.id || p.mom === o.id || p.dad === o.id) r[0] += (45 - r[0]) * 0.01;
      else { r[0] *= 0.988; r[1] *= 0.992; if (p.grp && p.grp === o.grp && p.p.ambit > 0.62 && o.p.ambit > 0.62 && ageY(o) >= ADULT) { r[0] -= 1.5; r[1] -= 1; } }
    }
  }
  const s = seasonIdx();
  for (const sp of ['boar', 'goat']) for (const isl of [1, 2, 3]) {
    const list = W.animals.filter(a => a.sp === sp && a.isl === isl);
    const cap = sp === 'boar' ? [0, 14, 12, 8][isl] : [0, 16, 8, 14][isl];
    for (const a of list) if ((W.t - a.born) / HPY > 10 && rand() < 0.03) a.dead = true;
    if (s !== 3 && list.length < cap) for (const a of list) if (rand() < 0.06) { const pt = randLand(isl, a.x, a.z, 1, 5, { minH: 0.9 }); if (pt) W.animals.push({ id: W.nextId++, sp, x: pt.x, z: pt.z, tx: pt.x, tz: pt.z, dir: 0, isl, born: W.t, home: { x: pt.x, z: pt.z }, stam: 0.8, nc: 0, next: 0 }); }
    if (list.length < 3 && rand() < 0.15) spawnAnimal(sp, isl);
  }
  W.animals = W.animals.filter(a => !a.dead);
  for (const isl of [1, 2, 3]) if (W.snakes.filter(sn => sn.isl === isl).length < [0, 5, 4, 3][isl] && rand() < 0.05) spawnSnake(isl);
  if (W.wx.storm <= 0 && rand() < (s === 3 ? 0.22 : 0.03)) startStorm();
  weather(s);
  inheritFeuds();
  assignGoals();
  for (const g of W.groups) {
    if (g.dead) continue;
    const ms = members(g);
    if (!ms.length) { g.dead = true; g.leader = 0; ev('split', `${g.name} is empty now. No one lives there anymore.`, [], 2); continue; }
    g.tk = { pot: ms.some(p => knows(p, 'pottery')), smoke: ms.some(p => knows(p, 'smoking')) };
    const mg = ms.reduce((m, p) => Math.max(m, p.gen), 1);
    if (mg > g.maxGenSeen) { g.maxGenSeen = mg; if (mg >= 2) driftDialect(g); }
    if (g.leader && !ms.some(p => p.id === g.leader)) g.leader = 0;
  }
  updateGroupRelations();
  fallbackCamp();
  pickSpotlight();
}
function startStorm() {
  W.wx.storm = 6 + rand() * 8;
  let dmg = 0;
  for (const h of W.huts) if (h.done && rand() < 0.15) { h.done = false; h.prog = 0.6; dmg++; }
  for (const g of W.groups) if (!g.dead) { g.fire.lit = false; g.fire.fuel = 0; }
  ev('storm', `A storm tore across the islands${dmg ? ` and wrecked ${dmg} hut${dmg > 1 ? 's' : ''}` : ''}. Every fire went out.`, [], 2);
  W.flash = { t: W.t, n: (W.flash ? W.flash.n : 0) + 1 };
}
export function pickSpotlight() {
  const sc = [];
  for (const p of W.people) {
    if (ageY(p) < ADULT) continue;
    let s = 0;
    for (const g of W.groups) if (!g.dead && g.leader === p.id) s += 40;
    for (const id in p.rel) { const r = p.rel[id]; if (Math.abs(r[0]) > 50) s += 4; if (r[0] < -50) s += 3; }
    for (const m of p.mem) if (Math.abs(m.v) >= 25 && W.t - m.t < 48) s += 6;
    if (p.exiled) s += 15;
    if (p.secrets.length) s += 8 + p.secrets.length * 2;
    s += (p.p.ambit + p.p.neuro + p.p.extra + (1 - p.p.agree)) * 10;
    sc.push([s, p.id]);
  }
  sc.sort((a, b) => b[0] - a[0]);
  W.spot = sc.slice(0, 6).map(x => x[1]);
}
function wealth(p) {
  const h = W.huts.find(x => x.id === p.home && x.own === p.id);
  return p.food + (h ? h.stash : 0) + itemsOf(p).length * 6 + (h ? 4 : 0);
}
function gini(vals) {
  const v = vals.slice().sort((a, b) => a - b), n = v.length;
  if (!n) return 0;
  const sum = v.reduce((a, b) => a + b, 0);
  if (!sum) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * v[i];
  return acc / (n * sum);
}
function sampleDaily(pops) {
  if (!W.daily) W.daily = [];
  const adults = W.people.filter(p => ageY(p) >= ADULT);
  let ts = 0, tn = 0;
  for (const p of adults) for (const o of adults) if (p !== o && p.rel[o.id]) { ts += p.rel[o.id][1]; tn++; }
  W.daily.push({ d: Math.floor(W.t / 24), pop: W.people.length, far: pops[2] || 0, third: pops[3] || 0, sick: W.people.filter(p => p.ill > 0).length, dr: W.wx.drought > 0 ? 1 : 0, g: W.groups.filter(g => !g.dead).length, trust: tn ? +(ts / tn).toFixed(1) : 0, gini: +gini(adults.map(wealth)).toFixed(3), v: W.stats.fights + W.stats.murders * 3 + W.stats.thefts });
  if (W.daily.length > 240) W.daily = W.daily.filter((h, i) => i % 2 === 0 || i === W.daily.length - 1);
}
function recordHistory(y) {
  const adults = W.people.filter(p => ageY(p) >= ADULT);
  let ts = 0, tn = 0;
  for (const p of adults) for (const o of adults) if (p !== o && p.rel[o.id]) { ts += p.rel[o.id][1]; tn++; }
  const prev = W.history[W.history.length - 1];
  W.history.push({ y, pop: W.people.length, groups: W.groups.filter(g => !g.dead).length, trust: tn ? +(ts / tn).toFixed(1) : 0, gini: +gini(adults.map(wealth)).toFixed(3),
    violence: W.stats.fights + W.stats.murders * 3 - (prev ? prev.vRaw : 0), vRaw: W.stats.fights + W.stats.murders * 3, gen: W.people.reduce((m, p) => Math.max(m, p.gen), 1), far: islandPop(2) });
  if (W.history.length > 400) W.history = W.history.filter((h, i) => i % 2 === 0 || i === W.history.length - 1);
}
function pruneArchive() {
  const need = new Set();
  for (const p of W.people) for (const id of anc(p).keys()) need.add(id);
  for (const id in W.arch) { const a = W.arch[id]; if (need.has(+id) || W.t - a.died < HPY * 4) continue; delete W.arch[id]; }
  ANC.clear();
}

/* ---------- the step ---------- */
export function step(dt) {
  if (!W) return;
  if (W.over) { if (W.t - W.over > 24) newSeason((W.seed * 16807) % 2147483647, W.epoch + W.t / RATE, W); else { W.t += dt; return; } }
  W.t += dt;
  buildGrid();
  resourceStep(dt);
  animalStep(dt);
  boatStep(dt);
  for (let i = 0; i < W.people.length; i++) personStep(W.people[i], dt);
  for (const g of W.groups) if (g.council && W.t >= g.council.end) resolveCouncil(g);
  processDeaths();
  const hr = Math.floor(W.t);
  if (hr !== W.lastHour) { W.lastHour = hr; hourly(); processDeaths(); }
  const day = Math.floor(W.t / 24);
  if (day !== W.lastDay) { W.lastDay = day; daily(); processDeaths(); }
  const yr = Math.floor(W.t / HPY);
  if (yr !== W.lastYear) { W.lastYear = yr; recordHistory(yr); pruneArchive(); }
}
function personStep(p, dt) {
  if (p.dead) return;
  p.moving = false;
  const a = ageY(p), A0 = p.act;
  p.sleeping = !!(A0 && A0.k === 'sleep' && A0.ph === 'work');
  if (a < 3) {
    const c = PM.get(p.care);
    if (c && c.isl === p.isl && dist(c, p) < 8 && c.hun > 25) p.hun = Math.min(100, p.hun + 8 * dt); else p.hun -= 2.2 * dt;
    if (c) p.sleeping = !!(c.sleeping && dist(c, p) < 3);
  } else {
    let hr = 2.0 * (0.8 + 0.25 * p.g.str + 0.2 * p.g.size);
    if (a < ADULT) hr *= 0.45 + 0.55 * clamp((a - 3) / 13, 0, 1);
    if (p.preg) hr *= 1.15;
    hr *= 1 + 0.25 * p.nursing;
    p.hun -= hr * dt;
  }
  if (!p.sleeping && a >= 3) p.en -= ((A0 && (A0.k === 'hunt' || A0.k === 'fight')) ? 4.6 : 3.4) * dt;
  p.soc -= 1.3 * dt;
  p.hun = clamp(p.hun, 0, 100); p.en = clamp(p.en, 0, 100); p.soc = clamp(p.soc, 0, 100);
  let dmg = 0, cause = '';
  if (p.hun <= 0) { dmg += 3; cause = 'starvation'; }
  if (p.ill > 0) { const med = knowsNear(p, 'medicine', 20); dmg += (med ? 0.35 : 1.25) * (a < 6 || a > 60 ? 1.5 : 1); p.ill -= dt * (med ? 2.5 : 1); if (p.ill <= 0) p.immune = W.t + HPY * 1.5; if (!cause) cause = 'fever'; discover(p, 'ill', dt * 0.5); }
  if (p.venom > 0) { const med = knowsNear(p, 'medicine', 20); dmg += (med ? 1.4 : 3.4) * (a < 12 ? 1.4 : 1); p.venom -= dt; cause = 'venom'; }
  if (dmg > 0) { p.hp -= dmg * dt; p.lastHurt = cause; if (p.hp <= 0) { killP(p, cause); return; } }
  else if (p.hun > 35 && p.en > 15) p.hp = Math.min(100, p.hp + 1.5 * dt);
  if (p.preg && W.t >= p.preg.due) { birth(p); if (p.dead) return; }
  if (W.t >= p.nextCheck) { p.nextCheck = W.t + 0.4 + rand() * 0.3; interrupts(p); }
  runAct(p, dt);
  if (p.say && W.t > p.say.until) p.say = null;
  const il = islandAt(p.x, p.z);
  if (il === 1 || il === 2) p.isl = il;
}
export function targetT(realMs) { return (realMs - W.epoch) * RATE; }
export function advanceTo(target, opt) {
  opt = opt || {};
  let n = 0;
  while (W.t + DT <= target + 1e-9) {
    step(DT);
    n++;
    if (opt.stopOnPending && W.pend.some(d => !d.asked)) return { n, why: 'pending' };
    if (opt.deadline && (n & 63) === 0 && Date.now() > opt.deadline) return { n, why: 'time' };
    if (opt.maxSteps && n >= opt.maxSteps) return { n, why: 'steps' };
  }
  return { n, why: 'done' };
}

/* ---------- words for the viewer and for Claude ---------- */
export function timeLabel(t) {
  if (t == null) t = W.t;
  const hh = Math.floor(t % 24), mm = Math.floor((t % 1) * 60);
  const y = Math.floor(t / HPY) + 1, doy = Math.floor((t % HPY) / 24);
  return { day: Math.floor(t / 24) + 1, year: y, season: SEASONS[Math.floor(doy / 4)], clock: String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') };
}
export function stamp(t) { const l = timeLabel(t); return `Day ${l.day}`; }
export function actLabel(p) {
  const A = p.act;
  if (!A) return 'Thinking';
  const nm = id => nameOf(id);
  switch (A.k) {
    case 'wake': return 'Coming to on the sand';
    case 'sleep': return A.ph === 'go' ? 'Going to sleep' : (A.hut ? 'Asleep in the hut' : 'Asleep by the fire');
    case 'eat': return A.ph === 'work' ? 'Eating' : A.ph === 'store' ? 'Taking food from the store' : A.ph === 'stash' ? 'Going to their food stash' : 'Gathering food';
    case 'stock': return A.ph === 'deliver' ? 'Carrying food back' : 'Gathering food';
    case 'feed': return 'Bringing food to ' + nm(A.kid);
    case 'talk': return (A.ph === 'chat' ? 'Talking with ' : 'Going to see ') + nm(A.who);
    case 'court': return (A.ph === 'chat' ? 'Flirting with ' : 'Looking for ') + nm(A.who);
    case 'chat': return 'Talking with ' + nm(A.with);
    case 'build': return A.ph === 'wood' ? 'Cutting wood' : A.what === 'fire' ? 'Tending the fire' : A.what === 'hut' ? 'Building a hut' : 'Building a boat';
    case 'hunt': return A.ph === 'deliver' ? 'Carrying meat home' : 'Hunting';
    case 'fish': return A.ph === 'work' ? 'Fishing' : A.ph === 'deliver' ? 'Carrying fish home' : 'Walking to the water';
    case 'farm': return A.what === 'harvest' ? 'Harvesting' : 'Planting';
    case 'craft': return 'Making a ' + ITEMS[A.what].n;
    case 'salvage': return 'Searching the wreckage';
    case 'voyage': return 'Heading for the boat';
    case 'ride': return 'At sea';
    case 'explore': return A.coast ? 'Walking the coast' : 'Exploring';
    case 'play': return 'Playing';
    case 'follow': return 'Staying close to ' + nm(A.who);
    case 'mourn': return 'Grieving';
    case 'idle': return 'Resting';
    case 'shelter': return 'Sheltering from the storm';
    case 'exile': return 'Leaving';
    case 'ponder': return 'Deciding something';
    case 'join': return 'Asking to join ' + ((groupById(A.g) || {}).name || 'a camp');
    case 'trade': return 'Carrying gifts to ' + ((groupById(A.g) || {}).name || 'another camp');
    case 'sneak': return A.ph === 'wait' ? 'Waiting for dark' : 'Sneaking';
    case 'confront': return 'Confronting ' + nm(A.who);
    case 'fight': return 'Fighting ' + nm(A.with);
    case 'tryst': return 'Slipping away with ' + nm(A.who);
    case 'murder': return 'Stalking ' + nm(A.who);
    case 'council': return 'At the council fire';
    case 'snake': return 'Killing a snake';
  }
  return 'Busy';
}
export function roleLabel(p) {
  const g = grpOf(p);
  if (g && g.leader === p.id) return 'Leader of ' + g.name;
  if (g) return g.name;
  if (p.exiled) return 'Outcast';
  return 'On their own';
}
export const TRAITS = [['open', 'Curiosity'], ['consc', 'Discipline'], ['extra', 'Sociability'], ['agree', 'Kindness'], ['neuro', 'Temper'], ['ambit', 'Ambition'], ['honest', 'Honesty']];
export function traitWords(t) {
  const w = [];
  if (t.open > 0.68) w.push('curious'); else if (t.open < 0.32) w.push('set in their ways');
  if (t.consc > 0.68) w.push('hard-working'); else if (t.consc < 0.32) w.push('lazy');
  if (t.extra > 0.68) w.push('outgoing'); else if (t.extra < 0.32) w.push('quiet');
  if (t.agree > 0.68) w.push('kind'); else if (t.agree < 0.32) w.push('selfish');
  if (t.neuro > 0.68) w.push('hot-tempered and jealous'); else if (t.neuro < 0.32) w.push('calm');
  if (t.ambit > 0.68) w.push('ambitious'); else if (t.ambit < 0.32) w.push('content to follow');
  if (t.honest > 0.68) w.push('honest'); else if (t.honest < 0.32) w.push('dishonest');
  return w.length ? w.join(', ') : 'ordinary in most ways';
}
export function relWords(r) {
  const [a, t, re, f] = r;
  const w = [];
  if (a > 60) w.push('loves'); else if (a > 30) w.push('likes'); else if (a < -60) w.push('hates'); else if (a < -25) w.push('dislikes');
  if (t > 50) w.push('trusts'); else if (t < -40) w.push('distrusts');
  if (re > 30) w.push('respects');
  if (f > 30) w.push('fears');
  return w.join(', ') || 'barely knows';
}
export function topRelations(p, n) {
  const list = [];
  for (const id in p.rel) { const o = PM.get(+id); if (!o) continue; const r = p.rel[id]; list.push({ o, r, s: Math.abs(r[0]) + Math.abs(r[1]) * 0.5 + r[2] * 0.3 + r[3] * 0.3 }); }
  list.sort((a, b) => b.s - a.s);
  return list.slice(0, n || 6);
}
export function describe(p) {
  const g = grpOf(p), a = ageY(p), tl = timeLabel();
  const feel = [];
  if (p.hun < 20) feel.push('starving'); else if (p.hun < 45) feel.push('hungry');
  if (p.en < 30) feel.push('exhausted');
  if (p.soc < 30) feel.push('lonely');
  if (p.hp < 45) feel.push('hurt or ill');
  if (p.preg) feel.push('pregnant');
  const origin = p.prof ? `Before the wreck: ${PROFS[p.prof].n}.` : `Born on the island to ${nameOf(p.mom)}${p.dad ? ' and ' + nameOf(p.dad) : ''}.`;
  const rels = topRelations(p, 6).map(x => `${x.o.name} (${relWords(x.r)})`).join('; ');
  const kids = p.kids.map(id => nameOf(id) + (PM.get(id) ? '' : ' (dead)')).join(', ');
  const items = itemsOf(p).map(i => ITEMS[i.k].n).join(', ');
  const camp = g ? `${g.name}: ${members(g).length} people, ${g.leader ? (g.leader === p.id ? 'you lead it' : 'led by ' + nameOf(g.leader)) : 'no leader'}, ${g.store < members(g).length * 2 ? 'food is running low' : 'food is ok'}.` : p.exiled ? `You were cast out of ${(groupById(p.exiled) || {}).name || 'your camp'}.` : 'You belong to no camp.';
  return [
    `${p.name}, ${p.sex === 'M' ? 'man' : 'woman'}, ${Math.floor(a)}. ${origin}`,
    `Personality: ${traitWords(p.p)}.`,
    `Camp: ${camp}`,
    goalOf(p) ? `What you are trying to do these days: ${goalLabel(goalOf(p))}.` : '',
    `Partner: ${p.partner ? nameOf(p.partner) : 'none'}.${kids ? ' Children: ' + kids + '.' : ''}${items ? ' Owns: ' + items + '.' : ''}`,
    feel.length ? `Feeling: ${feel.join(', ')}.` : '',
    rels ? `People: ${rels}.` : '',
    p.secrets.length ? `Secrets: ${p.secrets.map(s => s.s).join(' ')}` : '',
    `Recently: ${p.mem.slice(-6).map(m => m.s).join(' ') || 'nothing much.'}`,
    `Life so far: ${p.life.slice(-6).map(m => m.s).join(' ')}`,
    `It is day ${tl.day} on the island (year ${tl.year}, ${tl.season.toLowerCase()}). ${W.people.length} people are alive in ${W.groups.filter(x => !x.dead).length} camps.`,
  ].filter(Boolean).join('\n');
}
export function templateConfessional(p) {
  const bits = [];
  const sec = p.secrets[p.secrets.length - 1];
  if (sec && rand() < 0.7) bits.push('Nobody knows this. ' + sec.s);
  const rels = topRelations(p, 8);
  const foe = rels.filter(x => x.r[0] < -30).sort((a, b) => a.r[0] - b.r[0])[0];
  const friend = rels.filter(x => x.r[0] > 40 && x.o.id !== p.partner).sort((a, b) => b.r[0] - a.r[0])[0];
  if (foe) { const why = p.mem.filter(m => m.w === foe.o.id && m.v < 0).slice(-1)[0]; bits.push(`I don’t trust ${foe.o.name}.${why ? ' ' + why.s.replace(/^.*? told me: /, '') : ''}`); }
  const g = grpOf(p);
  if (g && g.leader === p.id) bits.push('They chose me to lead. Now everything that goes wrong is my fault.');
  else if (g && g.leader && opinion(p, PM.get(g.leader) || p) < -15) bits.push(`${nameOf(g.leader)} shouldn’t be in charge.`);
  if (p.hun < 35) bits.push('We are running out of food, and nobody wants to say it.');
  if (friend && bits.length < 3) bits.push(`${friend.o.name} is the one person here I would trust with my life.`);
  if (p.partner && bits.length < 3) bits.push(relA(p, PM.get(p.partner) || p) > 40 ? `${nameOf(p.partner)} is the only reason I’m still standing.` : `Things with ${nameOf(p.partner)} aren’t what they were.`);
  if (!bits.length) bits.push('Some days I forget there was a world before this island.');
  return bits.slice(0, 3).join(' ');
}
export function episodeEvents(from, to) { return W.events.filter(e => e.n > from && e.n <= to && e.k !== 'culture'); }
export function templateEpisode(evs) {
  const seen = new Set(), kinds = {};
  const pool = evs.filter(e => { if (seen.has(e.s)) return false; seen.add(e.s); return true; }).sort((a, b) => b.w - a.w || b.n - a.n);
  const top = [];
  for (const e of pool) { if (top.length >= 6) break; if ((kinds[e.k] || 0) >= 2 && e.w < 3) continue; kinds[e.k] = (kinds[e.k] || 0) + 1; top.push(e); }
  top.sort((a, b) => a.n - b.n);
  const k = top.length ? top.slice().sort((a, b) => b.w - a.w || b.n - a.n)[0] : null;
  const T = { murder: 'Blood in the Sand', exile: 'Cast Out', split: 'The Breaking', leader: 'A New Voice', scandal: 'Caught', crime: 'Thief in the Night', storm: 'The Storm', birth: 'New Blood', voyage: 'Over the Horizon', milestone: 'Firsts', fight: 'Fists at Dawn', conflict: 'Bad Blood', love: 'Pairing Off', danger: 'Close Call', join: 'New Faces', council: 'Around the Fire', death: 'Loss', build: 'Hands at Work', tech: 'Learning', trade: 'Gifts and Debts', item: 'Salvage', story: 'Days on the Island' };
  const title = !k ? 'Quiet Days' : T[k.k] || 'Days on the Island';
  return { title, text: top.map(e => e.s).join(' ') || 'Nothing much happened. They fished, they slept, they watched each other.' };
}
export const PERSON = id => PM.get(id) || null;
export const popOf = isl => islandPop(isl);
export function fallbackCamp() {
  for (const isl of [1, 2, 3]) {
    if (W.groups.some(g => !g.dead && g.isl === isl)) continue;
    const loners = W.people.filter(p => !p.grp && p.isl === isl && ageY(p) >= ADULT);
    if (loners.length < 3 || W.t < 40) continue;
    loners.sort((a, b) => b.p.extra - a.p.extra);
    const f = loners[0];
    const pt = randLand(isl, f.x, f.z, 0, 10, { minH: 1 }) || { x: f.x, z: f.z };
    const g = foundCamp(f, loners.filter(o => opinion(o, f) > -15), pt);
    ev('story', `With no fire to gather around, ${f.name} talked the others into making camp together at ${g.name}.`, [f.id], 3);
  }
}
export const woods = () => WOODS, rocks = () => ROCKS, heights = () => H, shore = () => SHORE;
