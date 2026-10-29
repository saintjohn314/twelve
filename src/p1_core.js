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
