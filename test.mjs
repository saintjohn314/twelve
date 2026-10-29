import * as S from './public/sim.mjs';
const seeds = (process.argv[2] || '1,2').split(',').map(Number);
const YEARS = +(process.argv[3] || 10);
const verbose = process.argv[4];
for (const seed of seeds) {
  const t0 = Date.now();
  S.newSeason(seed, 1.7e12);
  let ly = -1, steps = 0;
  const rows = [];
  while (S.W.t < YEARS * S.HPY && S.W.season === 1) {
    S.step(S.DT); steps++;
    const y = Math.floor(S.W.t / S.HPY);
    if (y !== ly) { ly = y; const W = S.W; rows.push(`y${y} pop ${W.people.length} grp ${W.groups.filter(g=>!g.dead).map(g=>g.name+':'+S.members(g).length+(g.leader?'('+S.nameOf(g.leader)+')':'')).join(' | ')} gen ${W.stats.maxGen} | b${W.stats.births} d${W.stats.deaths} theft${W.stats.thefts} fight${W.stats.fights} murder${W.stats.murders} exile${W.stats.exiles} split${W.stats.splits} voy${W.stats.voyages} aff${W.stats.affairs} | far ${S.popOf(2)} third ${S.popOf(3)} sick ${W.people.filter(p=>p.ill>0).length}${W.wx.drought>0?" DROUGHT":""}`); }
  }
  const W = S.W;
  console.log(`\n=== seed ${seed} season ${W.season} | ${(Date.now()-t0)/1000}s ${steps} steps`);
  console.log(rows.join('\n'));
  const counts = {}; for (const e of W.events) counts[e.k] = (counts[e.k]||0)+1;
  console.log('events', JSON.stringify(counts));
  console.log('milestones:', Object.entries(W.milestones).map(([k,v])=>k+'@d'+Math.floor(v.t/24)).join(' '));
  const causes = {}; for (const id in W.arch) { const c = W.arch[id].cause; causes[c]=(causes[c]||0)+1; } console.log('deaths', JSON.stringify(causes));
  if (verbose) for (const e of W.events.filter(e=>e.w>=2).slice(-70)) console.log(S.stamp(e.t), e.k, e.s);
  console.log('save size', JSON.stringify(W).length);
}
