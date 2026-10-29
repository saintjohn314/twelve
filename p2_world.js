
/* ---------- the cast ---------- */
const NAMES_M = ['Marcus', 'Tomas', 'Kai', 'Rafael', 'Jonah', 'Dmitri', 'Samuel', 'Arjun', 'Leo', 'Mateo', 'Owen', 'Hugo', 'Kofi', 'Ivan', 'Felix', 'Noah', 'Andre', 'Yusuf', 'Theo', 'Elias', 'Diego', 'Malik', 'Soren', 'Ezra'];
const NAMES_F = ['Elena', 'Amara', 'Ingrid', 'Leila', 'Mei', 'Nia', 'Sofia', 'Priya', 'Hana', 'Clara', 'Zara', 'Maya', 'Rosa', 'Freya', 'Lucia', 'Ada', 'Imani', 'Yara', 'Tess', 'Nadia', 'Iris', 'Paloma', 'Keiko', 'June'];
export const PROFS = {
  carpenter: { n: 'ship’s carpenter', know: ['boatbuilding'], build: 1.6, bias: { consc: 0.15 } },
  fisher: { n: 'fisherman', fish: 1.7 },
  nurse: { n: 'nurse', know: ['medicine'], bias: { agree: 0.15 } },
  cook: { n: 'ship’s cook', cook: 1.3 },
  soldier: { n: 'former soldier', fight: 0.25, hunt: 1.4, bias: { agree: -0.12, neuro: -0.1 } },
  farmer: { n: 'farmer', know: ['farming'], bias: { consc: 0.1 } },
  teacher: { n: 'teacher', teach: 2, bias: { agree: 0.1, open: 0.12 } },
  sailor: { n: 'sailor', know: ['navigation'], bias: { open: 0.1 } },
  merchant: { n: 'merchant', charm: 1.6, bias: { ambit: 0.18, extra: 0.12, honest: -0.08 } },
  musician: { n: 'musician', music: 1, bias: { extra: 0.15, open: 0.12 } },
  engineer: { n: 'engineer', know: ['firecraft', 'stonework'], bias: { open: 0.12, consc: 0.12 } },
  student: { n: 'student', learn: 1.6, bias: { open: 0.1 } },
  hunter: { n: 'hunter', know: ['spears'], hunt: 1.5 },
  pickpocket: { n: 'pickpocket', sneak: 1.7, bias: { honest: -0.32 } },
  lawyer: { n: 'lawyer', charm: 1.3, bias: { ambit: 0.15, extra: 0.08 } },
  miner: { n: 'miner', know: ['stonework'], fight: 0.12 },
};
export const TECH = {
  firecraft: { n: 'Making fire', ctx: ['wood', 'explore'], b: 0.0016, d: 'Starting a fire without the flint.' },
  stonework: { n: 'Stone tools', ctx: ['gather', 'wood', 'explore'], b: 0.0016, d: 'Knives and axes made from stone.' },
  spears: { n: 'Spears', ctx: ['wood', 'hunt', 'explore'], b: 0.0016, d: 'Hunting boar, and a weapon.' },
  farming: { n: 'Farming', ctx: ['gather'], b: 0.0004, d: 'Planting fields near camp.' },
  medicine: { n: 'Medicine', ctx: ['gather', 'ill'], b: 0.0006, d: 'Herbs for fevers, wounds and childbirth.' },
  boatbuilding: { n: 'Boatbuilding', ctx: ['shore', 'wood'], b: 0.0006, d: 'Boats that can cross to the far island.' },
  navigation: { n: 'Navigation', ctx: ['shore'], b: 0.0008, d: 'Reading the sea and the stars. Safer crossings.' },
  sailing: { n: 'Sailing', ctx: ['shore', 'boat'], b: 0.0007, need: 'boatbuilding', d: 'Sails. Faster, safer boats that can reach the high island.' },
  pottery: { n: 'Pottery', ctx: ['gather', 'wood'], b: 0.0005, d: 'Clay pots that keep food from rotting.' },
  smoking: { n: 'Smoking fish', ctx: ['shore'], b: 0.0007, d: 'Fish smoked over the fire keeps for months.' },
};
export const ITEMS = {
  knife: { n: 'steel knife', gather: 1.3, fight: 0.18, fish: 1.15 },
  axe: { n: 'steel axe', wood: 2.2, fight: 0.22 },
  net: { n: 'fishing net', fish: 2.0 },
  flint: { n: 'flint and steel', fire: true },
  spear: { n: 'spear', fight: 0.15, hunt: 1, fish: 1.3 },
  sknife: { n: 'stone knife', gather: 1.15, fight: 0.08 },
  saxe: { n: 'stone axe', wood: 1.5, fight: 0.1 },
};
const CAMP_NAMES = { coast: ['Wreck Beach', 'Driftwood Cove', 'Black Sand', 'Turtle Bay', 'Coral Point', 'Gull Rock', 'Shell Beach', 'the Lagoon', 'Windward'], inland: ['Palm Hollow', 'Fig Grove', 'Spring Camp', 'the Hollow', 'Fern Gully', 'Banyan Camp'], high: ['High Ridge', 'Red Rock', 'Stone Point', 'Cliffside', 'Cedar Hill', 'Lookout'], far: ['the Far Shore', 'New Landing', 'Sunrise Bay', 'Outer Camp'], third: ['High Landing', 'Ash Cove', 'Fire Mountain', 'the Green Shore', 'Summit Camp', 'Steam Vents'] };

/* ---------- small helpers ---------- */
export const ageY = p => (W.t - p.born) / HPY;
export const getP = id => PM.get(id) || null;
export const knows = (p, t) => p.know.indexOf(t) >= 0;
export function nameOf(id) { const p = PM.get(id) || (W && W.arch[id]); return p ? p.name : 'someone'; }
export const grpOf = p => (p.grp ? W.groups.find(g => g.id === p.grp && !g.dead) || null : null);
export const groupById = id => W.groups.find(g => g.id === id) || null;
export function seasonIdx() { return Math.floor((W.t % HPY) / (HPD * 4)); }
export function ev(k, s, ids, wt) {
  W.evN++;
  W.events.push({ n: W.evN, t: W.t, k, s, ids: ids || [], w: wt || 1 });
  if (W.events.length > 600) W.events.splice(0, W.events.length - 600);
}
function milestone(key, s, ids) {
  if (W.milestones[key]) return;
  W.milestones[key] = { t: W.t, s, g: W.stats.maxGen };
  ev('milestone', s, ids, 3);
}
export function R(p, o) {
  const id = typeof o === 'number' ? o : o.id;
  let r = p.rel[id];
  if (!r) { r = p.rel[id] = [0, 0, 0, 0]; }
  return r;
}
const relA = (p, o) => (p.rel[o.id] ? p.rel[o.id][0] : 0);
const relT = (p, o) => (p.rel[o.id] ? p.rel[o.id][1] : 0);
const relR = (p, o) => (p.rel[o.id] ? p.rel[o.id][2] : 0);
export function bump(p, o, da, dt, dr, df) {
  if (!p || !o || p === o) return;
  const r = R(p, o);
  r[0] = clamp(r[0] + (da || 0), -100, 100);
  r[1] = clamp(r[1] + (dt || 0), -100, 100);
  r[2] = clamp(r[2] + (dr || 0), -100, 100);
  r[3] = clamp(r[3] + (df || 0), 0, 100);
}
export function opinion(p, o) { const r = p.rel[o.id]; return r ? r[0] * 0.55 + r[1] * 0.45 : 0; }
export function mem(p, k, who, v, s) {
  p.mem.push({ t: W.t, k, w: who || 0, v: v || 0, s });
  if (p.mem.length > 18) p.mem.shift();
}
export function life(p, s) {
  p.life.push({ t: W.t, s });
  if (p.life.length > 26) p.life.shift();
}
function setAct(p, A) { A.t0 = W.t; p.act = A; return true; }
const isAdult = p => ageY(p) >= ADULT;

function newPerson(o) {
  const p = {
    id: W.nextId++, name: o.name, sex: o.sex, born: o.born, gen: o.gen, mom: o.mom || 0, dad: o.dad || 0, partner: 0, kids: [], prof: o.prof || '',
    g: o.g, p: o.p, x: o.x, z: o.z, dir: rand() * 6.283, isl: islandAt(o.x, o.z) || 1, grp: o.grp || 0, home: 0,
    hun: o.hun != null ? o.hun : 85, en: 85, soc: 60, hp: o.hp || 100, food: 0, wood: 0, items: [], know: (o.know || []).slice(), sk: { gather: 0, hunt: 0, build: 0 },
    rel: {}, mem: [], life: [], act: null, preg: null, lastBirth: -1e9, ill: 0, venom: 0, care: 0, nursing: 0, say: null, nextCheck: 0, stuck: 0,
    lim: 0, exiled: 0, exileT: -1e9, widowT: -1e9, bedT: -1e9, lastVoyage: -1e9, lastConf: -1e9, secrets: [], lastAffairCheck: 0, grudgeT: 0,
  };
  p.lim = 58 + p.g.life * 24 + gauss() * 4;
  W.people.push(p);
  PM.set(p.id, p);
  return p;
}
function randomTraits(bias) {
  const t = {};
  for (const k of ['open', 'consc', 'extra', 'agree', 'neuro', 'ambit', 'honest']) t[k] = clamp(0.5 + gauss() * 0.2 + ((bias && bias[k]) || 0), 0.04, 0.96);
  return t;
}
function randomGenes() {
  return { str: clamp(0.5 + gauss() * 0.18, 0.05, 0.95), spd: clamp(0.5 + gauss() * 0.18, 0.05, 0.95), life: clamp(0.55 + gauss() * 0.16, 0.05, 0.95),
    fert: clamp(0.6 + gauss() * 0.16, 0.05, 0.95), looks: clamp(0.5 + gauss() * 0.2, 0.05, 0.95), size: clamp(0.5 + gauss() * 0.18, 0.05, 0.95),
    skin: rand(), hair: clamp(rand() * 0.9, 0, 1) };
}
function mkName() {
  const C = ['k', 't', 'm', 'n', 's', 'l', 'r', 'v', 'd', 'b', 'j', 'z'], V = ['a', 'e', 'i', 'o', 'u', 'ai', 'ei'];
  let n, k = 0;
  do { n = ''; const syl = 2 + (rand() < 0.3 ? 1 : 0); for (let i = 0; i < syl; i++) n += pick(C) + pick(V); if (rand() < 0.4) n += pick(['n', 'l', 'r', 's']); n = n[0].toUpperCase() + n.slice(1); k++; }
  while (W.people.some(p => p.name === n) && k < 20);
  return n;
}
function kidName(a, b) {
  const A = a.name, Bn = b ? b.name : mkName();
  for (let k = 0; k < 16; k++) {
    const x = rand() < 0.5 ? A : Bn, y = x === A ? Bn : A;
    const i = 2 + Math.floor(rand() * 2), j = 2 + Math.floor(rand() * 2);
    let n = (x.slice(0, i) + y.slice(-j)).toLowerCase();
    n = n[0].toUpperCase() + n.slice(1);
    if (n.length >= 3 && !/[^aeiouy]{3}/i.test(n) && !/[aeiouy]{3}/i.test(n) && !W.people.some(p => p.name === n) && n !== A && n !== Bn) return n;
  }
  return mkName();
}

/* ---------- groups (camps) ---------- */
function campName(isl, x, z) {
  const used = new Set(W.groups.map(g => g.name));
  const h = height(x, z);
  let near = false;
  if (W.wreck && isl === 1 && Math.hypot(W.wreck.x - x, W.wreck.z - z) < 35 && !used.has('Wreck Beach')) return 'Wreck Beach';
  for (const s of SHORE[isl] || []) if (Math.hypot(s.x - x, s.z - z) < 24) { near = true; break; }
  const lists = isl === 3 ? [CAMP_NAMES.third, CAMP_NAMES.high] : isl === 2 ? [CAMP_NAMES.far, CAMP_NAMES.coast] : h > 6 ? [CAMP_NAMES.high, CAMP_NAMES.inland] : near ? [CAMP_NAMES.coast, CAMP_NAMES.inland] : [CAMP_NAMES.inland, CAMP_NAMES.high];
  for (const l of lists) for (const n of l) if (!used.has(n)) return n;
  return 'Camp ' + (W.groups.length + 1);
}
function newGroup(founder, x, z, dia) {
  const isl = islandAt(x, z) || founder.isl;
  const g = { id: W.nextId++, name: campName(isl, x, z), isl, x, z, leader: 0, store: 0, fire: { fuel: 0, lit: false, ever: false }, founded: W.t,
    color: W.nextColor++ % 8, dia: dia ? JSON.parse(JSON.stringify(dia)) : baseDialect(), nextCouncil: W.t + 30, council: null, split: null, accuse: [], dead: false, by: founder.id, gen: 1, maxGenSeen: 1 };
  W.groups.push(g);
  return g;
}
export const members = g => W.people.filter(p => p.grp === g.id);
const adultsOf = g => W.people.filter(p => p.grp === g.id && ageY(p) >= 14);
function joinGroup(p, g, quiet) {
  const old = grpOf(p);
  if (old && old.leader === p.id) old.leader = 0;
  p.grp = g.id;
  p.exiled = 0;
  if (!quiet) { mem(p, 'join', 0, 5, `I joined ${g.name}.`); }
}

/* ---------- items ---------- */
export const itemsOf = p => W.items.filter(i => i.owner === p.id);
const hasItem = (p, k) => W.items.some(i => i.owner === p.id && (Array.isArray(k) ? k.indexOf(i.k) >= 0 : i.k === k));
function itemMul(p, stat) { let m = 1; for (const i of W.items) if (i.owner === p.id && ITEMS[i.k][stat] && ITEMS[i.k][stat] !== true) m = Math.max(m, ITEMS[i.k][stat]); return m; }
function fightBonus(p) { let b = 0; for (const i of W.items) if (i.owner === p.id && ITEMS[i.k].fight) b = Math.max(b, ITEMS[i.k].fight); return b; }
const canLight = p => knows(p, 'firecraft') || hasItem(p, 'flint');
function giveItem(it, to, why) { it.owner = to ? to.id : 0; if (to) { it.x = to.x; it.z = to.z; } }

/* ---------- world creation ---------- */
function pickWreck() {
  let best = null, bs = -1e9;
  for (const s of SHORE[1]) { if (Math.abs(s.x - HOME.x) > 45) continue; if (s.z > bs) { bs = s.z; best = s; } }
  if (!best) best = { x: HOME.x, z: HOME.z + HOME.r };
  let dx = 0, dz = 0;
  for (let a = 0; a < 16; a++) { const ang = a / 16 * Math.PI * 2; if (height(best.x + Math.cos(ang) * 6, best.z + Math.sin(ang) * 6) < -0.5) { dx += Math.cos(ang); dz += Math.sin(ang); } }
  const dl = Math.hypot(dx, dz) || 1;
  return { x: best.x, z: best.z, sx: best.x + dx / dl * 7, sz: best.z + dz / dl * 7, dir: Math.atan2(dz, dx) };
}
function genResources() {
  const Rg = mkRng(W.seed * 7 + 3);
  const far = (x, z, list, d) => list.every(o => Math.hypot(o.x - x, o.z - z) >= d);
  const scatter = (isl, n, arr, mk, spacing) => {
    const c = ISLES[isl];
    let t = 0, made = 0;
    while (made < n && t < 9000) {
      t++;
      const a = Rg() * 6.283, r = Math.sqrt(Rg()) * c.r * 1.05;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (islandAt(x, z) !== isl) continue;
      const h = height(x, z);
      if (h < 1.1 || h > 8.5) continue;
      if (Math.hypot(x - W.wreck.x, z - W.wreck.z) < 10) continue;
      if (!far(x, z, W.trees, spacing) || !far(x, z, W.bushes, spacing * 0.6)) continue;
      arr.push(mk(x, z, isl)); made++;
    }
  };
  scatter(1, 32, W.trees, (x, z, isl) => { const m = 5 + Math.floor(Rg() * 3); return { x, z, f: m * 0.8, m, isl }; }, 4.5);
  scatter(2, 60, W.trees, (x, z, isl) => { const m = 5 + Math.floor(Rg() * 3); return { x, z, f: m * 0.8, m, isl }; }, 4.5);
  scatter(1, 44, W.bushes, (x, z, isl) => { const m = 3 + Math.floor(Rg() * 2); return { x, z, f: m, m, isl }; }, 3.2);
  scatter(2, 46, W.bushes, (x, z, isl) => { const m = 3 + Math.floor(Rg() * 2); return { x, z, f: m, m, isl }; }, 3.2);
  scatter(3, 44, W.trees, (x, z, isl) => { const m = 6 + Math.floor(Rg() * 3); return { x, z, f: m * 0.8, m, isl }; }, 4.5);
  scatter(3, 36, W.bushes, (x, z, isl) => { const m = 3 + Math.floor(Rg() * 2); return { x, z, f: m, m, isl }; }, 3.2);
  for (const isl of [1, 2, 3]) {
    let cap = 0;
    for (const t of W.trees) if (t.isl === isl) cap += t.m * 0.9;
    for (const b of W.bushes) if (b.isl === isl) cap += b.m * 0.5;
    W.capEst[isl] = Math.max(20, cap / 6);
  }
  const target = isl => { const o = ISLES[nearestIsle(isl)], c = ISLES[isl]; let best = null, bd = 1e9; for (const s of SHORE[isl]) { const d = Math.hypot(s.x - o.x, s.z - o.z); if (d < bd) { bd = d; best = s; } } if (best) return best; const dl = Math.hypot(o.x - c.x, o.z - c.z); return { x: c.x + (o.x - c.x) / dl * c.r, z: c.z + (o.z - c.z) / dl * c.r }; };
  W.docks[1] = target(1); W.docks[2] = target(2); W.docks[3] = target(3);
}
export function nearestIsle(isl) {
  let best = 0, bd = 1e9;
  for (let i = 1; i <= 3; i++) { if (i === isl) continue; const d = Math.hypot(ISLES[i].x - ISLES[isl].x, ISLES[i].z - ISLES[isl].z) - ISLES[i].r; if (d < bd) { bd = d; best = i; } }
  return best;
}
function castaways() {
  const Rn = mkRng(W.seed * 31 + 7);
  const sh = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Rn() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const ms = sh(NAMES_M).slice(0, 6), fs = sh(NAMES_F).slice(0, 6);
  const profs = sh(Object.keys(PROFS)).slice(0, 12);
  const wr = W.wreck;
  const cast = [];
  for (let i = 0; i < 12; i++) {
    const sex = i % 2 === 0 ? 'M' : 'F', name = sex === 'M' ? ms[i >> 1] : fs[i >> 1];
    const prof = profs[i], P = PROFS[prof];
    let spot = null;
    for (let k = 0; k < 40 && !spot; k++) { const a = rand() * 6.283, r = 3 + rand() * 14; const x = wr.x + Math.cos(a) * r, z = wr.z + Math.sin(a) * r; if (islandAt(x, z) === 1 && height(x, z) > 0.3) spot = { x, z }; }
    spot = spot || { x: wr.x, z: wr.z };
    const age = 19 + Math.floor(rand() * 32);
    const p = newPerson({ name, sex, born: W.t - age * HPY, gen: 1, prof, g: randomGenes(), p: randomTraits(P.bias), x: spot.x, z: spot.z, know: P.know || [], hun: 50 + rand() * 20, hp: 70 + rand() * 25 });
    setAct(p, { k: 'wake', until: W.t + 0.4 + rand() * 1.2, max: -1 });
    life(p, `Washed ashore after the wreck. Before, I was a ${P.n}.`);
    cast.push(p);
  }
  if (rand() < 0.5) {
    const m = pick(cast.filter(p => p.sex === 'M')), f = pick(cast.filter(p => p.sex === 'F' && Math.abs(ageY(p) - ageY(m)) < 14));
    if (m && f) { m.partner = f.id; f.partner = m.id; bump(m, f, 70, 60, 20); bump(f, m, 70, 60, 20); life(m, `${f.name} and I were married before the wreck.`); life(f, `${m.name} and I were married before the wreck.`); W.couple = [m.id, f.id]; }
  }
  const kinds = ['knife', 'knife', 'axe', 'net', 'flint'];
  for (const k of kinds) {
    let spot = null;
    for (let t = 0; t < 40 && !spot; t++) { const a = rand() * 6.283, r = 4 + rand() * 12; const x = wr.x + Math.cos(a) * r, z = wr.z + Math.sin(a) * r; if (islandAt(x, z) === 1 && height(x, z) > 0.2) spot = { x, z }; }
    spot = spot || { x: wr.x, z: wr.z };
    W.items.push({ id: W.nextId++, k, x: spot.x, z: spot.z, owner: 0, isl: 1 });
  }
}
export function newSeason(seed, realNow, prev) {
  seed = (seed >>> 0) || 1;
  const seasons = prev ? (prev.seasons || []).concat([seasonSummary(prev)]).slice(-24) : [];
  W = {
    v: VERSION, seed, rs: (seed ^ 0x51ed27) | 0, season: prev ? prev.season + 1 : 1, seasons, epoch: realNow - 7 / RATE, t: 7, nextId: 1, evN: 0,
    people: [], arch: {}, trees: [], bushes: [], animals: [], snakes: [], huts: [], groups: [], farms: [], boats: [], items: [], flames: [],
    techs: {}, events: [], confs: [], episodes: [], epN: 0, nextEp: 7 + 30, history: [], daily: [], milestones: {},
    stats: { births: 0, deaths: 0, murders: 0, fights: 0, thefts: 0, exiles: 0, splits: 0, voyages: 0, affairs: 0, maxGen: 1 },
    wx: { storm: 0, nextStorm: 0, drought: 0 }, routes: {}, pend: [], ai: { on: false, live: true, allow: 0, used: 0, pending: 0, day: '' }, spot: [],
    lastDay: 0, lastHour: 7, lastYear: 0, yards: { 1: 0, 2: 0, 3: 0 }, bodies: [], docks: {}, capEst: {}, gRel: {}, nextColor: 0, lastConfT: 0, wreck: null, flash: null, couple: null, ver: 0,
  };
  PM.clear(); ANC.clear();
  buildTerrain();
  W.wreck = pickWreck();
  genStatic();
  genResources();
  castaways();
  for (let i = 0; i < 10; i++) spawnAnimal('boar', 1, W.wreck, 30);
  for (let i = 0; i < 8; i++) spawnAnimal('boar', 2);
  for (let i = 0; i < 12; i++) spawnAnimal('goat', 1, W.wreck, 25);
  for (let i = 0; i < 6; i++) spawnAnimal('goat', 2);
  for (let i = 0; i < 5; i++) spawnSnake(1, W.wreck, 25);
  for (let i = 0; i < 4; i++) spawnSnake(2);
  for (let i = 0; i < 5; i++) spawnAnimal('boar', 3);
  for (let i = 0; i < 12; i++) spawnAnimal('goat', 3);
  for (let i = 0; i < 3; i++) spawnSnake(3);
  ev('story', `Season ${W.season}. A ship broke apart on the reef in the night. Twelve strangers wash up on the beach.`, W.people.map(p => p.id), 4);
  if (W.couple) ev('story', `${nameOf(W.couple[0])} and ${nameOf(W.couple[1])} were married before the wreck. The other ten are strangers.`, W.couple, 2);
  pickSpotlight();
  recordHistory(0);
  return W;
}
function seasonSummary(w) {
  const yrs = Math.floor(w.t / HPY);
  const gens = w.stats.maxGen;
  const top = w.events.filter(e => e.k === 'milestone').slice(-4).map(e => e.s);
  return { season: w.season, years: yrs, gens, born: w.stats.births, murders: w.stats.murders, groups: w.groups.length, ended: w.t, notes: top };
}
export function load(json) {
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  if (!o || o.v !== VERSION) throw new Error('incompatible world');
  W = o;
  PM.clear(); ANC.clear();
  for (const p of W.people) PM.set(p.id, p);
  buildTerrain();
  genStatic();
  return W;
}
export const save = () => JSON.stringify(W);
