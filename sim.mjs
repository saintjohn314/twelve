/* Twelve: simulation core, shared by the server tick and the viewer. All world state lives in W as plain JSON. */
export const VERSION = 2;
export const HPD = 24, DPY = 16, HPY = HPD * DPY;      // 384 game hours per year
export const RATE = 1 / 50000;                          // game hours per real millisecond: 1 game hour = 50 real seconds
export const DT = 0.05;                                 // fixed step in game hours (2.5 real seconds)
export const B = 180, GN = 180, CELL = (2 * B) / GN, GV = GN + 1;
export const HOME = { x: -80, z: 10, r: 78 }, FAR = { x: 100, z: -30, r: 58 }, THIRD = { x: 82, z: 124, r: 46 };
export const ISLES = [null, HOME, FAR, THIRD];
export const ISLE_NAMES = ['', 'the home island', 'the far island', 'the high island'];
export const ADULT = 16, POP_CAP = 220;
export const SEASONS = ['Rains', 'High sun', 'Harvest', 'Storms'];

export let W = null;
let H = null, LAND = null, WOODS = [], ROCKS = [], SHORE = { 1: [], 2: [], 3: [] };
const PM = new Map(), ANC = new Map(), GRID = new Map();

/* ---------- utilities ---------- */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function rand() {
  let t = (W.rs = (W.rs + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function mkRng(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rr = (a, b) => a + (b - a) * rand();
const gauss = () => (rand() + rand() + rand() + rand() - 2) * 1.732;
const pick = arr => arr[Math.floor(rand() * arr.length)];
function hash2(ix, iz, s) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z, s) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x, z, s, oct) {
  let v = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < (oct || 4); i++) { v += amp * vnoise(x * f, z * f, s + i * 17); n += amp; amp *= 0.5; f *= 2.03; }
  return v / n;
}
export const forestAt = (x, z) => fbm(x * 0.035 + 7, z * 0.035 - 3, W.seed + 23, 3);
const pairHash = (a, b) => hash2(Math.min(a, b), Math.max(a, b), 977);

/* ---------- terrain ---------- */
function rawH(x, z, seed) {
  const n1 = fbm(x * 0.02 + 100, z * 0.02 + 100, seed, 5);
  const n2 = fbm(x * 0.05 - 40, z * 0.05 + 60, seed + 11, 4);
  const w = 1 + (n1 - 0.5) * 0.6;
  const dH = Math.hypot(x - HOME.x, z - HOME.z) / HOME.r * w;
  const dF = Math.hypot(x - FAR.x, z - FAR.z) / FAR.r * w;
  const dT = Math.hypot(x - THIRD.x, z - THIRD.z) / THIRD.r * w;
  let h = Math.max((1 - dH * dH) * 13, (1 - dF * dF) * 11, (1 - dT * dT) * 12 + Math.max(0, 0.42 - dT) * 22);
  const i1 = Math.hypot(x - 30, z + 120) / 15 * w, i2 = Math.hypot(x - 150, z + 120) / 12 * w;
  h = Math.max(h, (1 - i1 * i1) * 4, (1 - i2 * i2) * 3.5);
  if (h > 0) h += (n2 - 0.5) * 10 * Math.min(1, h / 3);
  return Math.max(h, -9);
}
function cellIdx(x, z) {
  const i = clamp(Math.floor((x + B) / CELL), 0, GN - 1), j = clamp(Math.floor((z + B) / CELL), 0, GN - 1);
  return j * GN + i;
}
export function height(x, z) {
  const fx = (x + B) / CELL, fz = (z + B) / CELL;
  const i = clamp(Math.floor(fx), 0, GN - 1), j = clamp(Math.floor(fz), 0, GN - 1);
  const u = clamp(fx - i, 0, 1), v = clamp(fz - j, 0, 1);
  const a = H[j * GV + i], b = H[j * GV + i + 1], c = H[(j + 1) * GV + i], d = H[(j + 1) * GV + i + 1];
  if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
  return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
export const islandAt = (x, z) => LAND[cellIdx(x, z)];
function buildTerrain() {
  H = new Float32Array(GV * GV);
  for (let j = 0; j < GV; j++) for (let i = 0; i < GV; i++) H[j * GV + i] = rawH(-B + i * CELL, -B + j * CELL, W.seed);
  const cellH = (i, j) => (H[j * GV + i] + H[j * GV + i + 1] + H[(j + 1) * GV + i] + H[(j + 1) * GV + i + 1]) / 4;
  const lab = new Int32Array(GN * GN).fill(-1);
  let comp = 0;
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    const s = j * GN + i;
    if (lab[s] !== -1 || cellH(i, j) <= 0.15) continue;
    const q = [s]; lab[s] = comp;
    while (q.length) {
      const c = q.pop(), ci = c % GN, cj = (c / GN) | 0;
      for (let k = 0; k < 4; k++) {
        const ni = ci + (k === 0 ? 1 : k === 1 ? -1 : 0), nj = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (ni < 0 || nj < 0 || ni >= GN || nj >= GN) continue;
        const kk = nj * GN + ni;
        if (lab[kk] !== -1 || cellH(ni, nj) <= 0.15) continue;
        lab[kk] = comp; q.push(kk);
      }
    }
    comp++;
  }
  const cH = lab[cellIdx(HOME.x, HOME.z)], cF = lab[cellIdx(FAR.x, FAR.z)], cT = lab[cellIdx(THIRD.x, THIRD.z)];
  LAND = new Uint8Array(GN * GN);
  for (let k = 0; k < GN * GN; k++) { const c = lab[k]; LAND[k] = c < 0 ? 0 : c === cH ? 1 : c === cF ? 2 : c === cT ? 3 : 4; }
  SHORE = { 1: [], 2: [], 3: [] };
  for (let j = 1; j < GN - 1; j++) for (let i = 1; i < GN - 1; i++) {
    const L = LAND[j * GN + i];
    if (L < 1 || L > 3) continue;
    if (cellH(i, j) > 2.0) continue;
    let wet = false;
    for (let dj = -1; dj <= 1 && !wet; dj++) for (let di = -1; di <= 1; di++) if (LAND[(j + dj) * GN + i + di] === 0) { wet = true; break; }
    if (wet) SHORE[L].push({ x: -B + (i + 0.5) * CELL, z: -B + (j + 0.5) * CELL });
  }
}
function genStatic() {
  const R = mkRng(W.seed ^ 0x9e3779b9);
  WOODS = []; ROCKS = [];
  let tries = 0;
  while (WOODS.length < 620 && tries < 50000) {
    tries++;
    const x = -B + R() * 2 * B, z = -B + R() * 2 * B;
    const h = height(x, z);
    if (h < 1.0 || h > 12.5) continue;
    const isl = islandAt(x, z);
    if (!isl) continue;
    if (W.wreck && Math.hypot(x - W.wreck.x, z - W.wreck.z) < 12) continue;
    const f = forestAt(x, z);
    if (f < (isl === 2 ? 0.46 : 0.5) && R() > 0.08) continue;
    let k = isl === 1 ? (h > 6.5 ? 0 : (R() < 0.35 ? 0 : (R() < 0.5 ? 1 : 2))) : isl === 3 ? (h > 9 ? 0 : R() < 0.55 ? 1 : 2) : (R() < 0.55 ? 2 : 1);
    if (h < 2.2) k = 2;
    WOODS.push({ x, z, k, s: 0.8 + R() * 0.6, isl, r: R() * 6.283 });
  }
  tries = 0;
  while (ROCKS.length < 110 && tries < 10000) {
    tries++;
    const x = -B + R() * 2 * B, z = -B + R() * 2 * B, h = height(x, z);
    if (h < 0.4 || !islandAt(x, z)) continue;
    if (h < 6 && R() > (islandAt(x, z) === 3 ? 0.25 : 0.12)) continue;
    ROCKS.push({ x, z, s: 0.5 + R() * 1.4, r: R() * 6.283 });
  }
}

/* ---------- dialect: English that drifts, group by group ---------- */
export const WORDS = ['fish', 'food', 'fire', 'water', 'home', 'child', 'love', 'friend', 'thief', 'leader', 'boat', 'island', 'camp', 'sun',
  'night', 'eat', 'go', 'come', 'stop', 'help', 'good', 'bad', 'mine', 'together', 'sea', 'storm', 'tree', 'fruit', 'meat', 'sleep',
  'sick', 'dead', 'baby', 'mother', 'father', 'knife', 'hut', 'ship', 'liar', 'traitor', 'enough', 'listen', 'vote', 'hungry', 'rain'];
const baseDialect = () => { const d = {}; for (const w of WORDS) d[w] = w; return d; };
function mutateWord(w) {
  const vs = 'aeiouy', idx = [];
  for (let i = 0; i < w.length; i++) if (vs.includes(w[i])) idx.push(i);
  const r = rand();
  if (r < 0.55 && idx.length) {
    const i = idx[Math.floor(rand() * idx.length)];
    let nv = 'aeiou'[Math.floor(rand() * 5)];
    if (nv === w[i]) nv = 'aeiou'[(('aeiou'.indexOf(nv)) + 2) % 5];
    return w.slice(0, i) + nv + w.slice(i + 1);
  }
  if (r < 0.85) {
    const map = { k: 'g', t: 'd', p: 'b', s: 'z', f: 'v', g: 'h', d: 'th', m: 'n', l: 'r', c: 'k', w: 'v', h: '', r: 'l', b: 'p', v: 'w', n: 'm' };
    for (let i = w.length - 1; i >= 0; i--) if (map[w[i]] !== undefined && rand() < 0.5) { const nw = w.slice(0, i) + map[w[i]] + w.slice(i + 1); if (nw.length >= 2) return nw; }
  }
  if (w.length > 3 && rand() < 0.5) return w.slice(0, -1);
  return w + pick(['a', 'o', 'e', 'i']);
}
function driftDialect(g) {
  let ex = null;
  for (const w of WORDS) if (rand() < 0.14) { const old = g.dia[w], nw = mutateWord(old); if (nw !== old) { g.dia[w] = nw; if (!ex || rand() < 0.3) ex = { w, old, nw }; } }
  if (ex) ev('culture', `${g.name} talks a little differently now. Their “${ex.old}” has become “${ex.nw}”.`, [], 1);
}

/* ---------- speech ---------- */
const LINES = {
  wake: ['Where are we?', 'Is anyone else alive?', 'The {ship} is gone.', 'Help! Over here!', 'My head...'],
  greet: ['Morning, {o}.', '{good} {sun} today.', 'You eat yet, {o}?', 'Hey, {o}.', 'There you are.'],
  small: ['We need more {fish}.', 'Another {storm} is coming.', 'I miss {home}.', 'This {island}...', 'The {sea} looks calm.', 'Did you sleep?', 'The {fire} needs wood.'],
  gossip: ['Did you hear about {s}?', 'Watch {s}. Trust me.', 'I saw what {s} did.', 'Don’t trust {s}.', '{s} is a {liar}.', '{s} is no {leader}.', 'Keep this between us.'],
  praise: ['{s} fed us all yesterday.', '{s} is {good}.', 'We owe {s}.'],
  flirt: ['Sit with me by the {fire}?', 'Walk with me, {o}.', 'You make this {island} bearable.', 'Stay with me tonight.', 'I like your laugh.'],
  love: ['I {love} you, {o}.', 'Come here.', 'We’ll be okay.', 'Our {hut}. Our {home}.'],
  kid: ['Come here, little one.', '{eat}, {o}.', 'Stay close to the {fire}.', 'Good, {o}.'],
  confront: ['I know what you did, {o}.', 'Where is my {food}, {o}?', '{thief}!', 'Stay away from me.', 'Say it to my face.', 'You think I didn’t see?'],
  deny: ['It wasn’t me!', 'You’re lying.', 'Prove it.', 'Get away from me.'],
  sorry: ['I’m sorry.', 'I was {hungry}.', 'It won’t happen again.'],
  fight: ['Back off!', '{enough}!', '{stop}!', 'Get off me!'],
  council: ['We need a {leader}.', 'Who speaks for the {camp}?', '{vote}.', '{enough} talk.', '{listen} to me.', 'We decide {together}.'],
  accuse: ['{s} is a {thief}.', '{s} must go.', 'We can’t trust {s}.', '{s} is a {traitor}.'],
  mourn: ['No... {s}.', 'Why {s}?', 'Not {s}.', '{s} is {dead}.'],
  hungry: ['I’m starving.', 'Any {food} left?', 'There’s nothing to {eat}.', 'The kids need {food}.'],
  share: ['Here. Take some.', '{eat}, {o}.', 'We share, or we die.'],
  work: ['Pass me that.', 'Almost done.', 'Hold it steady.', 'More wood.', 'Like this.'],
  boat: ['There’s land out there.', 'We could leave.', 'The {boat} will hold.', 'Far {island}.'],
  storm: ['Get inside!', '{storm}!', 'Hold on!'],
  leave: ['We’re leaving.', 'Come with us.', 'This {camp} is finished.'],
  trade: ['{fish} for {fruit}?', 'Fair trade.', 'Deal.'],
  welcome: ['Welcome, {o}.', 'You can stay.', 'Sit by our {fire}.'],
  exile: ['Go.', 'Don’t come back.', 'You’re not one of us.'],
  demand: ['Give me that.', 'That’s {mine} now.', 'Hand it over, {o}.', 'You don’t need all that.'],
  refuse: ['No.', 'Get your own.', 'Back off, {o}.', 'Make me.'],
};
function say(p, cat, vars, g) {
  if (p.lines && vars && vars.o && p.lines[vars.o] && cat !== 'fight' && cat !== 'mourn') {
    const t = p.lines[vars.o];
    delete p.lines[vars.o];
    p.say = { w: t, g: '', until: W.t + 0.5, c: cat, ai: 1 };
    return;
  }
  const lines = LINES[cat] || LINES.small;
  const tpl = pick(lines);
  const grp = g || W.groups.find(x => x.id === p.grp);
  const dia = grp ? grp.dia : null;
  let diff = false;
  const fill = (dialect) => tpl.replace(/\{(\w+)\}/g, (m, k) => {
    if (k === 'o') return vars && vars.o ? vars.o : 'friend';
    if (k === 's') return vars && vars.s ? vars.s : 'them';
    if (k === 's2') return vars && vars.s2 ? vars.s2 : 'someone';
    const base = k;
    if (!dialect || !dia) return base;
    const f = dia[k] || base;
    if (f !== base) diff = true;
    return f;
  });
  let text = fill(true);
  text = text.charAt(0).toUpperCase() + text.slice(1);
  let gloss = '';
  if (diff) { gloss = fill(false); gloss = gloss.charAt(0).toUpperCase() + gloss.slice(1); }
  p.say = { w: text, g: gloss, until: W.t + 0.35, c: cat };
}

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
