import * as S from './public/sim.mjs';
S.newSeason(1, 1.7e12);
const stats = { wake: 0, noPartner: 0, isl: 0, bed: 0, cool: 0, hun: 0, roll: 0, preg: 0 };
let prevAct = new Map();
for (let i = 0; i < 24 * 30 / S.DT; i++) {
  for (const p of S.W.people) prevAct.set(p.id, p.act ? p.act.k + ':' + (p.act.ph || '') : '-');
  S.step(S.DT);
  for (const p of S.W.people) {
    if (p.sex !== 'F') continue;
    const was = prevAct.get(p.id);
    if (was === 'sleep:work' && (!p.act || p.act.k !== 'sleep')) {
      stats.wake++;
      const m = S.getP(p.partner);
      if (!m) { stats.noPartner++; continue; }
      if (S.W.t - p.bedT > 14) { stats.bed++; continue; }
      if (p.hun < 28 || m.hun < 20) { stats.hun++; continue; }
      stats.roll++;
    }
    if (p.preg && !p._c) { p._c = 1; stats.preg++; }
  }
}
console.log(stats);
const f = S.W.people.filter(p => p.sex === 'F' && p.partner);
for (const p of f) { const m = S.getP(p.partner); console.log(p.name, 'partner', m && m.name, 'home', p.home, m && m.home, 'act', p.act && p.act.k, 'relA', p.rel[m.id] && p.rel[m.id][0].toFixed(0), 'hun', p.hun.toFixed(0)); }
