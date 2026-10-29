/* ===== Twelve viewer: live updates, director, labels ===== */

/* ---------- interpolation between fixed sim steps ---------- */
const prevP = new Map(), prevA = new Map(), prevB = new Map(), prevS = new Map();
const smooth = new Map();       // id -> [dx, dz] offset that decays after a server resync
function snapOne(map, o) { let a = map.get(o.id); if (!a) map.set(o.id, a = [0, 0, 0]); a[0] = o.x; a[1] = o.z; a[2] = o.dir || 0; }
function snapshot() {
  const W = S.W;
  for (const p of W.people) snapOne(prevP, p);
  for (const a of W.animals) snapOne(prevA, a);
  for (const b of W.boats) snapOne(prevB, b);
  for (const s of W.snakes) snapOne(prevS, s);
}
function clearSnaps() { prevP.clear(); prevA.clear(); prevB.clear(); prevS.clear(); }
const IP = { x: 0, z: 0, moved: 0 };
function ip(map, o) {
  const a = map.get(o.id);
  if (!a) { IP.x = o.x; IP.z = o.z; IP.moved = 0; return IP; }
  const dx = o.x - a[0], dz = o.z - a[1], d = Math.hypot(dx, dz);
  if (d > 12) { IP.x = o.x; IP.z = o.z; IP.moved = 0; return IP; }
  IP.x = a[0] + dx * st.alpha; IP.z = a[1] + dz * st.alpha; IP.moved = d;
  return IP;
}

/* ---------- people ---------- */
const walk = new Map();
let renderList = [];
const RL = new Map();
const _base = M4(), _loc = M4();
function sleepHidden(p) {
  if (!p.home) return false;
  const h = S.W.huts.find(h => h.id === p.home && h.done);
  return !!(h && Math.hypot(h.x - p.x, h.z - p.z) < 2.6);
}
function updatePeople(dt) {
  const W = S.W;
  let n = 0, nl = 0, nld = 0;
  renderList = [];
  RL.clear();
  const leaders = new Set(W.groups.filter(g => !g.dead && g.leader).map(g => g.leader));
  for (const p of W.people) {
    if (n >= CAP_P) break;
    const a = S.ageY(p);
    const riding = p.act && p.act.k === 'ride';
    const hidden = p.sleeping && sleepHidden(p);
    const pos = ip(prevP, p);
    let x = pos.x, z = pos.z;
    const off = smooth.get(p.id);
    if (off) { x += off[0]; z += off[1]; }
    const kid = clamp(0.36 + 0.64 * a / 16, 0.36, 1);
    const size = 1.75 * (0.88 + 0.24 * p.g.size) * kid;
    let y = riding ? 0.2 + waveAt(x, z) : groundY(x, z);
    const rec = { p, x, y: y + size * 1.05, z, size, hidden };
    RL.set(p.id, rec);
    if (hidden) continue;
    const walking = !riding && !p.sleeping && pos.moved > 0.05;
    let ph = walk.get(p.id) || 0;
    if (walking) { ph += dt * (5 + pos.moved * 1.6) / Math.max(0.6, size * 0.6); walk.set(p.id, ph); }
    const swing = walking ? Math.sin(ph) * 0.6 : 0;
    const bob = walking ? Math.abs(Math.cos(ph)) * 0.035 * size : 0;
    let dir = p.dir;
    const pa = prevP.get(p.id);
    if (pa) { let dd = p.dir - pa[2]; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI; dir = pa[2] + dd * st.alpha; }
    _q.setFromAxisAngle(_v.set(0, 1, 0), Math.PI / 2 - dir);
    _base.compose(_v.set(x, y + bob, z), _q, _s.set(size, size, size));
    if (p.sleeping && !riding) { _rot.makeRotationX(-Math.PI / 2); _base.multiply(_tr.makeTranslation(0, 0.1, 0)).multiply(_rot); }
    else if (riding) _base.multiply(_tr.makeTranslation(0, -0.35, 0));
    else if (p.act && p.act.k === 'mourn') _base.multiply(_tr.makeTranslation(0, -0.22, 0));
    if (p.preg && W.t > p.preg.due - 96) R.pTorso.setMatrixAt(n, _m.copy(_base).multiply(_sc.makeScale(1.18, 1, 1.28)));
    else R.pTorso.setMatrixAt(n, _base);
    R.pSkin.setMatrixAt(n, _base);
    R.pHair.setMatrixAt(n, _base);
    let s2 = swing;
    if (p.act && p.act.k === 'fight') s2 = Math.sin(performance.now() / 90 + p.id) * 0.9;
    _loc.makeTranslation(0.065, 0.46, 0).multiply(_rot.makeRotationX(s2));
    R.pLegs.setMatrixAt(n * 2, _m.copy(_base).multiply(_loc));
    _loc.makeTranslation(-0.065, 0.46, 0).multiply(_rot.makeRotationX(-s2));
    R.pLegs.setMatrixAt(n * 2 + 1, _m.copy(_base).multiply(_loc));
    personColors(p, a);
    R.pTorso.setColorAt(n, cCloth); R.pSkin.setColorAt(n, cSkin); R.pHair.setColorAt(n, cHair);
    R.pLegs.setColorAt(n * 2, cSkin); R.pLegs.setColorAt(n * 2 + 1, cSkin);
    if (p.sex === 'F' && a >= 6) { R.pLong.setMatrixAt(nl, _base); R.pLong.setColorAt(nl, cHair); nl++; }
    if (leaders.has(p.id) && !p.sleeping && nld < 16) { R.lead.setMatrixAt(nld++, compose(_m, x, y + size * 1.22 + Math.sin(performance.now() / 500 + p.id) * 0.05, z, performance.now() / 700, 1)); }
    renderList.push(rec);
    n++;
  }
  for (const m of [R.pTorso, R.pSkin, R.pHair]) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  R.pLegs.count = n * 2; R.pLegs.instanceMatrix.needsUpdate = true; if (R.pLegs.instanceColor) R.pLegs.instanceColor.needsUpdate = true;
  R.pLong.count = nl; R.pLong.instanceMatrix.needsUpdate = true; if (R.pLong.instanceColor) R.pLong.instanceColor.needsUpdate = true;
  R.lead.count = nld; R.lead.instanceMatrix.needsUpdate = true;
  if (smooth.size) { const k = Math.exp(-dt * 2.2); for (const [id, o] of smooth) { o[0] *= k; o[1] *= k; if (Math.abs(o[0]) + Math.abs(o[1]) < 0.02) smooth.delete(id); } }
}
function updateAnimals(time) {
  const W = S.W, counts = { boar: 0, goat: 0 };
  for (const a of W.animals) {
    const mesh = R.an[a.sp];
    if (!mesh || counts[a.sp] >= mesh.instanceMatrix.count) continue;
    const pos = ip(prevA, a);
    const bob = pos.moved > 0.05 ? Math.abs(Math.sin(time * 9 + a.id)) * 0.06 : 0;
    mesh.setMatrixAt(counts[a.sp]++, compose(_m, pos.x, groundY(pos.x, pos.z) + bob, pos.z, -a.dir, a.sp === 'goat' ? 0.95 : 1));
  }
  for (const k in R.an) { R.an[k].count = counts[k]; R.an[k].instanceMatrix.needsUpdate = true; }
}
const cSn1 = new THREE.Color(0.42, 0.4, 0.2), cSn2 = new THREE.Color(0.3, 0.24, 0.14);
function updateSnakes(time) {
  const W = S.W;
  let n = 0;
  for (const s of W.snakes) {
    if (n > R.snake.instanceMatrix.count - 12) break;
    const pos = ip(prevS, s);
    const fx = Math.cos(s.dir), fz = Math.sin(s.dir), mv = pos.moved > 0.02 ? 1 : 0.35;
    for (let k = 0; k < 12; k++) {
      const wig = Math.sin(time * 6 - k * 0.9) * 0.13 * mv;
      const x = pos.x - fx * k * 0.19 - fz * wig, z = pos.z - fz * k * 0.19 + fx * wig;
      R.snake.setMatrixAt(n, compose(_m, x, groundY(x, z) + 0.08, z, 0, k === 0 ? 1.25 : 1 - k * 0.045));
      R.snake.setColorAt(n, k % 3 === 1 ? cSn2 : cSn1);
      n++;
    }
  }
  R.snake.count = n;
  R.snake.instanceMatrix.needsUpdate = true;
  if (R.snake.instanceColor) R.snake.instanceColor.needsUpdate = true;
}
function updateStructures() {
  const W = S.W;
  let q = 0;
  W.trees.forEach((t, i) => {
    const sl = R.slots[i], vis = Math.floor(t.f), by = S.height(t.x, t.z) - 0.1;
    for (let k = 0; k < sl.length; k++) R.fruit.setMatrixAt(q++, k < vis ? compose(_m, sl[k][0], by + sl[k][1], sl[k][2], 0, 1) : ZERO);
  });
  R.fruit.instanceMatrix.needsUpdate = true;
  q = 0;
  W.bushes.forEach((b, i) => {
    const vis = Math.floor(b.f), by = S.height(b.x, b.z);
    for (let k = 0; k < 5; k++) { const a = k * 1.256 + i; R.berry.setMatrixAt(q++, k < vis ? compose(_m, b.x + Math.cos(a) * 0.62, by + 0.5 + (k % 2) * 0.18, b.z + Math.sin(a) * 0.55, 0, 1) : ZERO); }
  });
  R.berry.instanceMatrix.needsUpdate = true;
  let n = 0;
  for (const h of W.huts) {
    if (n >= 200) break;
    const g = S.groupById(h.g);
    R.huts.setMatrixAt(n, compose(_m, h.x, S.height(h.x, h.z) - 0.05, h.z, h.r || 0, 1, 0.12 + 0.88 * (h.done ? 1 : h.prog), 1));
    if (!h.done) R.huts.setColorAt(n, _c.setRGB(0.78, 0.74, 0.66));
    else if (g && !g.dead) R.huts.setColorAt(n, _c.copy(campCols[g.color % 8]).lerp(cFabric, 0.82).multiplyScalar(1.45));
    else R.huts.setColorAt(n, _c.setRGB(0.85, 0.82, 0.78));
    n++;
  }
  R.huts.count = n; R.huts.instanceMatrix.needsUpdate = true; if (R.huts.instanceColor) R.huts.instanceColor.needsUpdate = true;
  n = 0; let nc = 0;
  for (const f of W.farms) {
    if (n >= 90) break;
    const y = S.height(f.x, f.z), r = f.r || 0;
    R.farms.setMatrixAt(n++, compose(_m, f.x, y - 0.02, f.z, r, 1));
    if (f.planted) {
      const gr = clamp(f.grow, 0, 1), gsc = 0.2 + 0.8 * gr;
      _c.setRGB(lerp(0.42, 0.9, gr), lerp(0.68, 0.74, gr), lerp(0.28, 0.3, gr));
      for (let i = 0; i < 12; i++) {
        const lx = ((i % 4) - 1.5) * 0.95, lz = (Math.floor(i / 4) - 1) * 0.9;
        const x = f.x + Math.cos(r) * lx + Math.sin(r) * lz, z = f.z - Math.sin(r) * lx + Math.cos(r) * lz;
        R.crops.setMatrixAt(nc, compose(_m, x, y + 0.08, z, i, gsc));
        R.crops.setColorAt(nc, _c);
        nc++;
      }
    }
  }
  R.farms.count = n; R.farms.instanceMatrix.needsUpdate = true;
  R.crops.count = nc; R.crops.instanceMatrix.needsUpdate = true; if (R.crops.instanceColor) R.crops.instanceColor.needsUpdate = true;
  n = 0;
  for (const it of W.items) { if (it.owner || n >= 40) continue; R.crates.setMatrixAt(n++, compose(_m, it.x, groundY(it.x, it.z), it.z, it.id, 1)); }
  R.crates.count = n; R.crates.instanceMatrix.needsUpdate = true;
  n = 0;
  for (const b of W.bodies) { if (n >= 12 || (b.found && W.t - b.t > 12)) continue; R.bodies.setMatrixAt(n++, compose(_m, b.x, groundY(b.x, b.z), b.z, b.id, 1)); }
  R.bodies.count = n; R.bodies.instanceMatrix.needsUpdate = true;
  n = 0;
  for (const isl of [1, 2]) {
    const y = W.yards && W.yards[isl], d = W.docks && W.docks[isl];
    if (!y || !d || y < 0.02) continue;
    R.yard.setMatrixAt(n++, compose(_m, d.x, groundY(d.x, d.z) + 0.02, d.z, isl, 1, clamp(y, 0.15, 1), 1));
  }
  R.yard.count = n; R.yard.instanceMatrix.needsUpdate = true;
}
function updateCamps(time, night) {
  const W = S.W, seen = new Set();
  for (const g of W.groups) {
    if (g.dead) continue;
    seen.add(g.id);
    let o = R.camps.get(g.id);
    if (!o) { o = makeCamp(g); R.camps.set(g.id, o); }
    o.g.position.set(g.x, S.height(g.x, g.z), g.z);
    const lit = g.fire.lit;
    o.fire.visible = lit;
    if (lit) { const f = 0.75 + 0.25 * Math.sin(time * 13 + g.x) * Math.sin(time * 7.3); const s = 0.6 + 0.6 * clamp(g.fire.fuel / 60, 0.2, 1); o.fire.scale.set(s, s * f, s); }
    o.light.intensity = lit ? (0.5 + 1.7 * night) * (0.85 + 0.15 * Math.sin(time * 11)) : 0;
    o.mound.scale.set(...(g.store > 0.5 ? [clamp(Math.cbrt(g.store) * 0.24, 0.25, 1.05), clamp(Math.cbrt(g.store) * 0.16, 0.18, 0.7), clamp(Math.cbrt(g.store) * 0.24, 0.25, 1.05)] : [0.001, 0.001, 0.001]));
    o.flagMat.color.set(campHex(g));
    const fp = o.flag.geometry.attributes.position;
    for (let i = 0; i < fp.count; i++) { const bx = o.base[i * 3]; fp.array[i * 3 + 2] = Math.sin(time * 4 + bx * 3 + g.id) * 0.12 * bx; }
    fp.needsUpdate = true;
  }
  for (const [id, o] of R.camps) if (!seen.has(id)) { R.root.remove(o.g); disposeTree(o.g); R.camps.delete(id); }
  const bseen = new Set();
  for (const b of W.boats) {
    bseen.add(b.id);
    let g = R.boats.get(b.id);
    if (!g) { g = makeBoat(); R.boats.set(b.id, g); }
    const pos = ip(prevB, b);
    const y = b.sail ? 0.12 + waveAt(pos.x, pos.z) : Math.max(0.12 + waveAt(pos.x, pos.z) * 0.5, S.height(pos.x, pos.z) + 0.15);
    g.position.set(pos.x, y, pos.z);
    let dir = b.dir || 0;
    if (!b.sail) { const o = b.isl === 1 ? S.FAR : S.HOME; dir = Math.atan2(o.z - b.z, o.x - b.x); }
    g.rotation.set(0, -dir, b.sail ? Math.sin(time * 2) * 0.05 : 0);
  }
  for (const [id, g] of R.boats) if (!bseen.has(id)) { R.root.remove(g); disposeTree(g); R.boats.delete(id); }
}

/* ---------- sky, light, weather ---------- */
const skyNight = new THREE.Color(0.03, 0.05, 0.11), skyDay = new THREE.Color(0.56, 0.74, 0.9), skyDusk = new THREE.Color(0.92, 0.55, 0.36);
const skyC = new THREE.Color();
const SEASON_TINT = [[1, 1, 1], [1.02, 1.03, 0.95], [1.35, 0.95, 0.6], [0.92, 0.95, 1.05]];
function updateEnv(dt, time) {
  const W = S.W, hour = (W.t + st.alpha * S.DT) % 24;
  const elev = Math.sin((hour - 5.5) / 14 * Math.PI);
  const day = clamp(elev * 1.7, 0, 1), dusk = clamp(1 - Math.abs(elev) * 3.2, 0, 1) * (hour > 3 && hour < 22 ? 1 : 0);
  const night = 1 - day;
  const storm = W.wx.storm > 0 ? clamp(W.wx.storm / 2, 0, 1) : 0;
  skyC.copy(skyNight).lerp(skyDay, day).lerp(skyDusk, dusk * 0.45);
  if (storm) skyC.lerp(_c.setRGB(0.32, 0.36, 0.41), (0.55 * day + 0.1) * storm);
  scene.background = skyC;
  scene.fog.color.copy(skyC);
  scene.fog.near = lerp(170, 60, storm);
  scene.fog.far = lerp(860, 330, storm);
  const ang = (hour - 5.5) / 14 * Math.PI;
  const tg = controls.target;
  if (day > 0.02) { sun.position.set(tg.x + Math.cos(ang) * -170, Math.max(25, Math.sin(ang) * 220), tg.z + 70); sun.color.setRGB(1, lerp(0.75, 0.95, day), lerp(0.55, 0.85, day)); sun.intensity = (0.15 + 0.8 * day) * (1 - storm * 0.55); }
  else { const ma = ang + Math.PI; sun.position.set(tg.x + Math.cos(ma) * -170, 160, tg.z - 60); sun.color.setRGB(0.62, 0.72, 1); sun.intensity = 0.22; }
  sun.target.position.copy(tg);
  hemi.intensity = (0.28 + 0.38 * day) * (1 - storm * 0.3);
  hemi.color.setRGB(lerp(0.55, 0.85, day), lerp(0.62, 0.9, day), lerp(0.85, 1, day));
  R.waterMat.specular.setRGB(lerp(0.08, 0.54, day), lerp(0.1, 0.72, day), lerp(0.14, 0.8, day));
  R.waterMat.shininess = lerp(20, 80, day);
  R.starMat.opacity = clamp(night * 1.3 - 0.3, 0, 1) * (1 - storm);
  R.stars.position.set(tg.x, 0, tg.z);
  R.broadMat.color.setRGB(...SEASON_TINT[S.seasonIdx()]);
  waterT += dt * (1 + storm * 1.5);
  const wp = R.water.geometry.attributes.position, base = R.waterBase;
  R.water.position.x = Math.round(tg.x / 18.75) * 18.75;
  R.water.position.z = Math.round(tg.z / 18.75) * 18.75;
  const amp = 1 + storm * 2.2;
  for (let i = 0; i < wp.count; i++) { const x = base[i * 3] + R.water.position.x, z = base[i * 3 + 2] + R.water.position.z; wp.array[i * 3 + 1] = waveAt(x, z) * amp; }
  wp.needsUpdate = true;
  R.flameMat.color.setRGB(1, 0.6 + 0.08 * Math.sin(time * 20), 0.25);
  R.rain.visible = storm > 0;
  if (R.rain.visible) {
    const rp = R.rain.geometry.attributes.position;
    for (let i = 0; i < rp.count; i++) { let y = rp.array[i * 3 + 1] - dt * 48; if (y < 0) y += 60; rp.array[i * 3 + 1] = y; rp.array[i * 3] += dt * 6; if (rp.array[i * 3] > 85) rp.array[i * 3] -= 170; }
    rp.needsUpdate = true;
    R.rain.position.set(tg.x, 0, tg.z);
  }
  if (W.flash && W.flash.n !== st.flashN) {
    const first = st.flashN === 0;
    st.flashN = W.flash.n;
    if (!first && storm > 0) {
      st.bolt = 0.35;
      const p = R.bolt.geometry.attributes.position, fx = tg.x + (Math.random() - 0.5) * 120, fz = tg.z + (Math.random() - 0.5) * 120, gy = Math.max(0, S.height(fx, fz));
      for (let i = 0; i < 16; i++) { const k = i / 15; p.setXYZ(i, fx + (i && i < 15 ? (Math.random() - 0.5) * 4 : 0), lerp(95, gy, k), fz + (i && i < 15 ? (Math.random() - 0.5) * 4 : 0)); }
      p.needsUpdate = true;
    }
  }
  if (st.bolt > 0) { st.bolt -= dt; R.bolt.visible = true; R.bolt.material.opacity = clamp(st.bolt / 0.35, 0, 1); hemi.intensity += st.bolt * 3; } else R.bolt.visible = false;
  return night;
}

/* ---------- the auto director ---------- */
const DRAMA = { fight: 100, murder: 94, confront: 78, tryst: 70, exile: 62, ride: 56, snake: 50, ponder: 48, mourn: 44, voyage: 42, council: 40, join: 36, court: 33, trade: 30, hunt: 22, salvage: 20, talk: 16, chat: 16, craft: 12, feed: 12, fish: 10, farm: 9, play: 10, follow: 6, stock: 8, eat: 6, idle: 4, wake: 30, shelter: 14 };
function dramaOf(p, now) {
  const A = p.act;
  let s = A ? (DRAMA[A.k] || 6) : 4;
  if (A && A.k === 'sneak') s = A.ph === 'wait' ? 26 : 64;
  if (A && A.k === 'build') s = A.what === 'boat' ? 26 : 10;
  if (A && A.k === 'council') { const g = S.grpOf(p); if (g && g.council && (g.council.challenger === p.id || g.leader === p.id)) s = 58; }
  if (p.say && p.say.until > S.W.t) s += 8;
  const b = st.boost.get(p.id);
  if (b && b.until > now) s += b.v;
  if (S.W.spot.indexOf(p.id) >= 0) s += 4;
  if (p.sleeping) s = Math.min(s, 2);
  return s;
}
function partnerOf(p) {
  const A = p.act;
  if (!A) return 0;
  const id = A.who || A.with || 0;
  return id && S.getP(id) ? id : 0;
}
function shotPos(sh, out) {
  const W = S.W;
  if (sh.kind === 'person' || sh.kind === 'pair') {
    const r = RL.get(sh.id);
    if (!r) return false;
    let x = r.x, z = r.z, y = r.y - r.size * 0.45;
    if (sh.kind === 'pair') { const r2 = RL.get(sh.id2); if (r2 && Math.hypot(r2.x - x, r2.z - z) < 30) { x = (x + r2.x) / 2; z = (z + r2.z) / 2; sh.sep = Math.hypot(r2.x - r.x, r2.z - r.z); } }
    out.set(x, Math.max(y, 0.3), z);
    return true;
  }
  if (sh.kind === 'camp') { const g = W.groups.find(g => g.id === sh.gid && !g.dead); if (!g) return false; out.set(g.x, Math.max(0, S.height(g.x, g.z)), g.z); return true; }
  if (sh.kind === 'boat') { const b = W.boats.find(b => b.id === sh.bid); if (!b || !b.sail) return false; const pos = ip(prevB, b); out.set(pos.x, 0.3, pos.z); return true; }
  if (sh.kind === 'wreck') { const w = W.wreck; out.set(w.x, Math.max(0, S.height(w.x, w.z)), w.z); return true; }
  out.set((S.HOME.x + S.FAR.x) / 2, 0, (S.HOME.z + S.FAR.z) / 2);
  return true;
}
function newShot(kind, o, now) {
  const close = kind === 'person' || kind === 'pair';
  const sh = Object.assign({ kind, since: now, hold: 14, score: 0, ang: Math.random() * Math.PI * 2, spin: (Math.random() < 0.5 ? -1 : 1) * (close ? 0.06 : 0.03), cut: true }, o);
  if (kind === 'person') { sh.r = sh.r || 11; sh.h = sh.h || 5.2; }
  else if (kind === 'pair') { sh.r = 13; sh.h = 6; }
  else if (kind === 'camp') { sh.r = 34; sh.h = 24; sh.hold = 13; }
  else if (kind === 'boat') { sh.r = 22; sh.h = 10; sh.hold = 14; }
  else if (kind === 'wreck') { sh.r = 30; sh.h = 16; sh.hold = 10; }
  else { sh.r = 175; sh.h = 150; sh.hold = 12; sh.spin = 0.012; }
  return sh;
}
let dirT = 0, estN = 0;
function directorTick(now) {
  const W = S.W;
  const cur = st.shot;
  if (st.card && st.card.pid) {
    if (!cur || cur.id !== st.card.pid || cur.kind !== 'person') {
      if (RL.get(st.card.pid) && !RL.get(st.card.pid).hidden) st.shot = newShot('person', { id: st.card.pid, r: 8, h: 2.3, hold: 99, card: true }, now);
    }
    return;
  }
  let best = null, bs = -1;
  for (const r of renderList) { const s = dramaOf(r.p, now); if (s > bs) { bs = s; best = r.p; } }
  const age = cur ? now - cur.since : 1e9;
  let curScore = 0, alive = false;
  if (cur && (cur.kind === 'person' || cur.kind === 'pair')) { const r = RL.get(cur.id); alive = !!(r && !r.hidden); if (alive) curScore = dramaOf(r.p, now); }
  else if (cur) alive = shotPos(cur, _v);
  const hold = cur ? (cur.card ? 4 : cur.hold) : 0;
  const bored = !cur || !alive || age > hold || cur.card;
  const better = best && cur && bs > curScore + 30 && age > 4 && !(cur.id === best.id);
  if (!bored && !better) { if (cur) cur.score = curScore; return; }
  if (best && bs >= 15) {
    if (cur && cur.id === best.id && alive && !cur.card) { cur.since = now; cur.hold = 10 + Math.min(16, bs / 6); return; }
    const pid = partnerOf(best);
    const kind = pid && ['fight', 'confront', 'talk', 'court', 'tryst', 'chat', 'murder', 'follow', 'feed'].indexOf(best.act.k) >= 0 ? 'pair' : 'person';
    st.shot = newShot(kind, { id: best.id, id2: pid, hold: 10 + Math.min(18, bs / 5), score: bs }, now);
    if (cur && shotPos(cur, _v) && shotPos(st.shot, _v2) && _v.distanceTo(_v2) < 28) st.shot.cut = false;
    return;
  }
  // nothing dramatic: an establishing shot
  estN++;
  const camps = W.groups.filter(g => !g.dead);
  const sailing = W.boats.find(b => b.sail);
  let sh;
  if (sailing && estN % 2 === 0) sh = newShot('boat', { bid: sailing.id }, now);
  else if (camps.length && estN % 4 !== 0) sh = newShot('camp', { gid: camps[estN % camps.length].id }, now);
  else if (W.t < 48 || estN % 8 === 3) sh = newShot('wreck', {}, now);
  else sh = newShot('wide', {}, now);
  st.shot = sh;
}
const _v2 = new THREE.Vector3(), _tgt = new THREE.Vector3(), _cp = new THREE.Vector3();
function updateCamera(dt, now) {
  if (st.director) {
    dirT -= dt;
    if (dirT <= 0) { dirT = 0.5; directorTick(now); }
    const sh = st.shot;
    if (sh && shotPos(sh, _tgt)) {
      sh.ang += sh.spin * dt;
      let r = sh.r, h = sh.h;
      if (sh.kind === 'pair' && sh.sep) r = Math.max(r, sh.sep * 1.5 + 6);
      _cp.set(_tgt.x + Math.cos(sh.ang) * r, _tgt.y + h, _tgt.z + Math.sin(sh.ang) * r);
      if (sh.card) { const k = window.innerWidth < 760 ? 0 : 2.1; _tgt.x -= Math.sin(sh.ang) * k; _tgt.z += Math.cos(sh.ang) * k; _cp.x -= Math.sin(sh.ang) * k; _cp.z += Math.cos(sh.ang) * k; _tgt.y -= 0.45; }
      const gy = Math.max(S.height(_cp.x, _cp.z), 0) + 2;
      if (_cp.y < gy) _cp.y = gy;
      if (sh.cut) { controls.target.copy(_tgt); camera.position.copy(_cp); sh.cut = false; }
      else {
        const k = 1 - Math.exp(-dt * 1.8);
        controls.target.lerp(_tgt, k);
        camera.position.lerp(_cp, k);
      }
    }
  } else if (st.camTween) {
    const c = st.camTween;
    c.t += dt;
    const k = clamp(c.t / c.dur, 0, 1), e = k * k * (3 - 2 * k);
    controls.target.lerpVectors(c.fromT, c.toT, e);
    camera.position.lerpVectors(c.fromP, c.toP, e);
    if (k >= 1) st.camTween = null;
  } else if (st.follow && st.sel) {
    const r = RL.get(st.sel);
    if (r) {
      const dx = r.x - controls.target.x, dy = (r.y - 1) - controls.target.y, dz = r.z - controls.target.z;
      const k = Math.min(1, dt * 4);
      controls.target.x += dx * k; controls.target.y += dy * k; controls.target.z += dz * k;
      camera.position.x += dx * k; camera.position.y += dy * k; camera.position.z += dz * k;
    }
  }
  const tg = controls.target;
  const ox = tg.x, oz = tg.z;
  tg.x = clamp(tg.x, -S.B + 10, S.B - 10); tg.z = clamp(tg.z, -S.B + 10, S.B - 10);
  camera.position.x += tg.x - ox; camera.position.z += tg.z - oz;
  controls.update();
  const cy = Math.max(S.height(camera.position.x, camera.position.z), 0) + 1.5;
  if (camera.position.y < cy) camera.position.y = cy;
}
function frameWide(instant) {
  const tx = (S.HOME.x + S.FAR.x) / 2, tz = (S.HOME.z + S.FAR.z) / 2;
  const toT = new THREE.Vector3(tx, 0, tz), toP = new THREE.Vector3(tx + 40, 190, tz + 210);
  if (instant) { controls.target.copy(toT); camera.position.copy(toP); controls.update(); }
  else st.camTween = { t: 0, dur: 2.2, fromT: controls.target.clone(), toT, fromP: camera.position.clone(), toP };
}
function flyTo(x, z, dist) {
  const y = Math.max(0, S.height(x, z));
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize();
  if (!isFinite(dir.x)) dir.set(0.6, 0, 0.8);
  const d = dist || 16;
  st.camTween = { t: 0, dur: 1.6, fromT: controls.target.clone(), toT: new THREE.Vector3(x, y + 0.8, z), fromP: camera.position.clone(), toP: new THREE.Vector3(x + dir.x * d, y + d * 0.55, z + dir.z * d) };
}
function setDirector(on) {
  st.director = on;
  const b = $('#btnDirector');
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on) { st.follow = false; st.camTween = null; st.shot = null; dirT = 0; }
}

/* ---------- labels ---------- */
const bubPool = [], tagPool = [];
const _p = new THREE.Vector3();
function project(x, y, z) {
  _p.set(x, y, z).project(camera);
  if (_p.z > 1 || _p.z < -1) return null;
  const c = renderer.domElement;
  return { x: (_p.x + 1) / 2 * c.clientWidth, y: (1 - _p.y) / 2 * c.clientHeight };
}
function updateLabels() {
  const host = $('#labels'), W = S.W, cam = camera.position;
  let used = 0;
  const near = [];
  for (const r of renderList) { const d = Math.hypot(r.x - cam.x, r.y - cam.y, r.z - cam.z); if (d < 110) near.push([d, r]); }
  near.sort((a, b) => a[0] - b[0]);
  const talking = new Set();
  for (const [, r] of near) {
    if (used >= 8) break;
    const p = r.p;
    const think = p.act && p.act.k === 'ponder';
    if (!think && (!p.say || p.say.until < W.t)) continue;
    const s = project(r.x, r.y + 0.12 * r.size, r.z);
    if (!s) continue;
    let b = bubPool[used];
    if (!b) { b = document.createElement('div'); b.className = 'bub'; b.innerHTML = '<b></b><i></i>'; host.appendChild(b); bubPool.push(b); }
    const w = think ? 'Thinking it over…' : p.say.w, g = think ? '' : (p.say.g || '');
    if (b._w !== w) { b._w = w; b.firstChild.textContent = w; b.lastChild.textContent = g; b.classList.toggle('think', think); }
    b.style.transform = `translate(${s.x | 0}px, ${(s.y - 6) | 0}px) translate(-50%, -100%)`;
    b.hidden = false;
    talking.add(p.id);
    used++;
  }
  for (let i = used; i < bubPool.length; i++) bubPool[i].hidden = true;
  // name tags: selected, hovered, shot subject, and a few people near a close camera
  const ids = [];
  const sh = st.director && st.shot;
  if (st.sel) ids.push(st.sel);
  if (st.hover && st.hover !== st.sel) ids.push(st.hover);
  if (sh && sh.id && ids.indexOf(sh.id) < 0) ids.push(sh.id);
  if (sh && sh.id2 && ids.indexOf(sh.id2) < 0) ids.push(sh.id2);
  for (const [d, r] of near) { if (ids.length >= 9 || d > 34) break; if (ids.indexOf(r.p.id) < 0) ids.push(r.p.id); }
  let nt = 0;
  const placed = [];
  for (const id of ids) {
    const r = RL.get(id);
    if (!r || r.hidden) continue;
    const s = project(r.x, r.y + 0.1 * r.size, r.z);
    if (!s) continue;
    const ty = s.y - (talking.has(id) ? 44 : 4);
    if (placed.some(q => Math.abs(q[0] - s.x) < 58 && Math.abs(q[1] - ty) < 15)) continue;
    placed.push([s.x, ty]);
    let t = tagPool[nt];
    if (!t) { t = document.createElement('div'); t.className = 'tag'; t.innerHTML = '<span class="cdot"></span><span></span>'; host.appendChild(t); tagPool.push(t); }
    const hex = personHex(r.p);
    if (t._n !== r.p.name || t._c !== hex) { t._n = r.p.name; t._c = hex; t.lastChild.textContent = r.p.name; t.firstChild.style.background = hex; }
    t.classList.toggle('sel', id === st.sel);
    t.style.transform = `translate(${s.x | 0}px, ${(s.y - (talking.has(id) ? 44 : 4)) | 0}px) translate(-50%, -100%)`;
    t.hidden = false;
    nt++;
  }
  for (let i = nt; i < tagPool.length; i++) tagPool[i].hidden = true;
  const r = st.sel && RL.get(st.sel);
  if (r && !r.hidden) { R.selRing.visible = true; R.selRing.position.set(r.x, (r.p.act && r.p.act.k === 'ride' ? 0.3 : groundY(r.x, r.z)) + 0.05, r.z); R.selRing.scale.setScalar(r.size / 1.75 + 0.3); }
  else R.selRing.visible = false;
}

/* ---------- picking ---------- */
function pickPerson(cx, cy) {
  let best = null, bd = 30;
  for (const r of renderList) {
    const s = project(r.x, r.y - 0.45 * r.size, r.z);
    if (!s) continue;
    const d = Math.hypot(s.x - cx, s.y - cy);
    if (d < bd) { bd = d; best = r.p; }
  }
  return best;
}
