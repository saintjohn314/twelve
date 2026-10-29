
/* ---------- goals: what each adult is trying to do these days ---------- */
const GOAL_TEXT = {
  court: o => `Win ${o}’s heart`,
  befriend: o => `Get closer to ${o}`,
  reconcile: o => `Make peace with ${o}`,
  undermine: o => `Turn the camp against ${o}`,
  revenge: o => `Get even with ${o}`,
  provide: (o, g) => `Keep ${g || 'the family'} fed`,
  hut: () => 'Build a hut of their own',
  boat: () => 'Build a boat',
  leave: (o, g) => (o ? `Get away from ${o}` : `Leave ${g || 'this place'} behind`),
  lead: (o, g) => `Take over ${g || 'the camp'}`,
  keep: (o, g) => `Hold on to ${g || 'the camp'}`,
  protect: () => 'Keep their children safe',
  explore: () => 'See what is on the other islands',
};
export function goalOf(p) { return p.goal && W.t < p.goal.until ? p.goal : null; }
export function goalLabel(G) {
  if (!G) return '';
  const k = G.k === 'build' ? G.what : G.k;
  return (GOAL_TEXT[k] || (() => G.k))(G.o ? nameOf(G.o) : '', G.g ? (groupById(G.g) || {}).name : '');
}
function goalActions(p, G, add) {
  const o = G.o ? PM.get(G.o) : null;
  switch (G.k) {
    case 'court': if (o && !p.partner && eligible(p, o)) add(50, () => actTalkTo(p, o, 'court')); break;
    case 'befriend': case 'reconcile': if (o) add(38, () => actTalkTo(p, o, 'talk')); break;
    case 'undermine': add(26, () => actTalk(p, 'chat')); break;
    case 'revenge': if (o && o.isl === p.isl && W.t - p.grudgeT > 60 && dist(p, o) < 50) add(30, () => considerConfront(p, { o, score: 45 })); break;
    case 'provide': add(32, () => actStock(p)); add(16, () => actFish(p)); break;
    case 'build':
      if (G.what === 'hut' && !hasHome(p)) add(36, () => actWood(p, 'hut', 6));
      if (G.what === 'boat' && knows(p, 'boatbuilding') && hasItem(p, ['axe', 'saxe']) && !W.boats.some(b => !b.sail && b.isl === p.isl)) add(36, () => actWood(p, 'boat', 10));
      break;
    case 'lead': case 'keep': add(18, () => actStock(p)); break;
    case 'protect': { const hk = hungryKid(p); if (hk) add(44, () => actFeed(p, hk)); break; }
    case 'explore': add(28, () => actExplore(p)); break;
  }
}
export function goalOptionsFor(p) {
  const g = grpOf(p), out = [];
  const push = (score, o) => { if (!out.some(x => x.k === o.k && x.o === o.o && x.what === o.what)) out.push(Object.assign({ score }, o)); };
  const rels = topRelations(p, 12);
  const foes = rels.filter(x => x.r[0] < -35 && x.o.isl === p.isl).sort((a, b) => a.r[0] - b.r[0]);
  for (const f of foes.slice(0, 2)) {
    const hurt = p.mem.filter(m => m.w === f.o.id && m.v <= -15 && !m.r).length;
    if (hurt >= 2) push(6 + p.p.neuro * 22 + (1 - p.p.agree) * 18 + hurt * 3, { k: 'revenge', o: f.o.id });
    if (g && f.o.grp === g.id) push(18 + p.p.extra * 22 + p.p.ambit * 12 + hurt * 3, { k: 'undermine', o: f.o.id });
    push(10 + p.p.agree * 40 - p.p.neuro * 10, { k: 'reconcile', o: f.o.id });
  }
  if (!p.partner && ageY(p) <= 50) {
    let best = null, bs = 0.25;
    for (const o of W.people) { if (o.isl !== p.isl || !eligible(p, o)) continue; const s = attraction(p, o) + relA(p, o) / 200; if (s > bs) { bs = s; best = o; } }
    if (best) push(30 + p.p.extra * 14 + bs * 20 + (ageY(p) < 30 ? 8 : 0), { k: 'court', o: best.id });
  }
  const warm = rels.filter(x => x.r[0] > 8 && x.r[0] < 45 && x.o.id !== p.partner && ageY(x.o) >= 14 && x.o.isl === p.isl).sort((a, b) => b.r[2] + b.r[0] - a.r[2] - a.r[0])[0];
  if (warm) push(14 + p.p.extra * 18 + (100 - p.soc) * 0.1, { k: 'befriend', o: warm.o.id });
  if (g) {
    const n = members(g).length;
    if (g.store < n * 3) push(28 + p.p.consc * 22 + (g.store < n ? 14 : 0), { k: 'provide', g: g.id });
    const L = PM.get(g.leader);
    if (L && L !== p && p.p.ambit > 0.5) push(14 + p.p.ambit * 34 - opinion(p, L) / 6, { k: 'lead', g: g.id });
    if (!L && p.p.ambit > 0.55 && n >= 3) push(18 + p.p.ambit * 30, { k: 'lead', g: g.id });
    if (L === p) push(26 + p.p.ambit * 16, { k: 'keep', g: g.id });
    if (L && L !== p && opinion(p, L) < -30) push(14 + p.p.open * 16 - opinion(p, L) / 5, { k: 'leave', o: L.id, g: g.id });
  } else push(18, { k: 'provide' });
  if (!hasHome(p) && (p.partner || ageY(p) > 19)) push(22 + p.p.consc * 18, { k: 'build', what: 'hut' });
  if (knows(p, 'boatbuilding') && !W.boats.some(b => b.isl === p.isl && !b.sail) && (crowd(p.isl) > 0.75 || !W.milestones.farLanding || (W.milestones.sawThird && !W.milestones.thirdLanding))) push(16 + p.p.open * 22, { k: 'build', what: 'boat' });
  if (p.kids.some(id => { const k = PM.get(id); return k && ageY(k) < 10; })) push(18 + p.p.agree * 20 + (p.sex === 'F' ? 4 : 0), { k: 'protect' });
  if (p.p.open > 0.6 && (!W.milestones.farLanding || !W.milestones.thirdLanding)) push(10 + p.p.open * 24, { k: 'explore' });
  if (crowd(p.isl) > 0.85) push(12 + p.p.open * 12 + (crowd(p.isl) - 0.85) * 40, { k: 'leave', g: g ? g.id : 0 });
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 6);
}
export function setGoal(p, opt, thought, lines, ai) {
  const old = p.goal;
  p.goal = { k: opt.k, o: opt.o || 0, g: opt.g || 0, what: opt.what || '', t: W.t, until: W.t + (ai ? 36 : 48 + rand() * 48), ai: !!ai, why: thought ? String(thought).slice(0, 240) : '' };
  if (lines) { p.lines = {}; for (const n in lines) if (typeof lines[n] === 'string' && lines[n].length < 120) p.lines[n] = lines[n]; }
  const changed = !old || old.k !== p.goal.k || old.o !== p.goal.o;
  if (changed && (ai || W.spot.indexOf(p.id) >= 0)) mem(p, 'goal', p.goal.o || 0, 0, `I made up my mind: ${goalLabel(p.goal).toLowerCase()}.`);
  return p.goal;
}
function assignGoals() {
  for (const p of W.people) {
    if (ageY(p) < ADULT || p.dead) continue;
    const G = goalOf(p);
    if (G && !goalDone(p, G)) continue;
    const opts = goalOptionsFor(p);
    if (!opts.length) { p.goal = null; continue; }
    let best = opts[0], bs = -1e9;
    for (const o of opts) { const s = o.score + rand() * 14; if (s > bs) { bs = s; best = o; } }
    setGoal(p, best, '', null, false);
  }
}
function goalDone(p, G) {
  const o = G.o ? PM.get(G.o) : null;
  if (G.o && !o) return true;
  switch (G.k) {
    case 'court': return !!p.partner;
    case 'reconcile': case 'befriend': return o && relA(p, o) > 45;
    case 'revenge': return o && (relA(p, o) > -10 || !p.mem.some(m => m.w === o.id && m.v <= -15 && !m.r));
    case 'build': return G.what === 'hut' ? hasHome(p) : W.boats.some(b => b.isl === p.isl && !b.sail);
    case 'lead': { const g = groupById(G.g); return !g || g.dead || g.leader === p.id; }
    case 'leave': return G.g ? p.grp !== G.g : W.t - p.lastVoyage < 24;
    case 'explore': return !!(W.milestones.farLanding && W.milestones.thirdLanding);
  }
  return false;
}
