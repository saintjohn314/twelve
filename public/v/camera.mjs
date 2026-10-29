/* The camera: a free camera (orbit, zoom to cursor, WASD, double-click to focus) and the auto director that picks the shots. */
import * as THREE from 'three';
import { S, st, R, T, clamp } from './state.mjs';
import { groundH } from './world.mjs';
import { RL, renderList, pickPerson } from './actors.mjs';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _tgt = new THREE.Vector3(), _cp = new THREE.Vector3();
const keys = new Set();
let onDirector = () => {};
export function onDirectorChange(fn) { onDirector = fn; }

export function initCamera() {
  const { controls } = T;
  controls.addEventListener('start', () => { if (st.director) setDirector(false); st.camTween = null; });
  const cv = T.renderer.domElement;
  cv.addEventListener('dblclick', e => {
    const rect = cv.getBoundingClientRect(), cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const p = pickPerson(cx, cy);
    if (p) { focusPerson(p.id); return; }
    const hit = groundPoint(cx, cy);
    if (hit) { setDirector(false); st.follow = false; flyTo(hit.x, hit.z, Math.min(40, T.camera.position.distanceTo(controls.target) * 0.55)); }
  });
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) >= 0) {
      keys.add(k);
      if (st.director) setDirector(false);
      st.camTween = null; st.follow = false;
      if (k.startsWith('arrow')) e.preventDefault();
    }
    if (e.key === 'Shift') keys.add('shift');
  });
  window.addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); if (e.key === 'Shift') keys.delete('shift'); });
  window.addEventListener('blur', () => keys.clear());
}
const ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
export function groundPoint(cx, cy) {
  const c = T.renderer.domElement;
  _ndc.set(cx / c.clientWidth * 2 - 1, -(cy / c.clientHeight) * 2 + 1);
  ray.setFromCamera(_ndc, T.camera);
  if (R.terrain) { const h = ray.intersectObject(R.terrain, false)[0]; if (h && h.point.y > -0.3) return h.point; }
  const o = ray.ray.origin, d = ray.ray.direction;
  if (d.y >= -1e-4) return null;
  const t = -o.y / d.y;
  return _v2.set(o.x + d.x * t, 0, o.z + d.z * t);
}

/* ---------- moves ---------- */
export function flyTo(x, z, dist, y) {
  const { camera, controls } = T;
  const gy = y != null ? y : Math.max(0, groundH(x, z));
  const dir = _v.subVectors(camera.position, controls.target).setY(0).normalize();
  if (!isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0.6, 0, 0.8);
  const d = dist || 16;
  st.camTween = { t: 0, dur: 1.6, fromT: controls.target.clone(), toT: new THREE.Vector3(x, gy + 0.8, z), fromP: camera.position.clone(), toP: new THREE.Vector3(x + dir.x * d, gy + d * 0.5 + 1, z + dir.z * d) };
}
export function focusPerson(id, dist) {
  const r = RL.get(id);
  st.sel = id;
  setDirector(false);
  st.follow = true;
  if (r) flyTo(r.x, r.z, dist || 9, r.gy);
}
export function frameWide(instant) {
  const tx = 30, tz = 20;
  const toT = new THREE.Vector3(tx, 0, tz), toP = new THREE.Vector3(tx + 60, 230, tz + 250);
  if (instant) { T.controls.target.copy(toT); T.camera.position.copy(toP); T.controls.update(); }
  else st.camTween = { t: 0, dur: 2.2, fromT: T.controls.target.clone(), toT, fromP: T.camera.position.clone(), toP };
}
export function frameIsland(isl) {
  const c = S.ISLES[isl];
  if (!c) return;
  setDirector(false); st.follow = false;
  flyTo(c.x, c.z, c.r * 1.6, 0);
}
export function setDirector(on) {
  st.director = on;
  if (on) { st.follow = false; st.camTween = null; st.shot = null; dirT = 0; }
  onDirector(on);
}

/* ---------- the auto director ---------- */
const DRAMA = { fight: 100, murder: 94, confront: 78, tryst: 70, exile: 62, ride: 56, snake: 50, ponder: 48, mourn: 44, voyage: 42, council: 40, join: 36, court: 33, trade: 30, demand: 60, hunt: 22, salvage: 20, talk: 16, chat: 16, craft: 12, feed: 12, fish: 10, farm: 9, play: 10, follow: 6, stock: 8, eat: 6, idle: 4, wake: 30, shelter: 14 };
function dramaOf(p, now) {
  const A = p.act;
  let s = A ? (DRAMA[A.k] || 6) : 4;
  if (A && A.k === 'sneak') s = A.ph === 'wait' ? 26 : 64;
  if (A && A.k === 'build') s = A.what === 'boat' ? 26 : A.ph === 'wood' ? 14 : 12;
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
export function shotPos(sh, out) {
  const W = S.W;
  if (sh.kind === 'person' || sh.kind === 'pair') {
    const r = RL.get(sh.id);
    if (!r) return false;
    let x = r.x, z = r.z, y = r.gy + r.size * 0.55;
    if (sh.kind === 'pair') { const r2 = RL.get(sh.id2); if (r2 && Math.hypot(r2.x - x, r2.z - z) < 30) { x = (x + r2.x) / 2; z = (z + r2.z) / 2; sh.sep = Math.hypot(r2.x - r.x, r2.z - r.z); } }
    out.set(x, Math.max(y, 0.3), z);
    return true;
  }
  if (sh.kind === 'camp') { const g = W.groups.find(g => g.id === sh.gid && !g.dead); if (!g) return false; out.set(g.x, Math.max(0, groundH(g.x, g.z)) + 1, g.z); return true; }
  if (sh.kind === 'boat') { const b = W.boats.find(b => b.id === sh.bid); if (!b || !b.sail) return false; out.set(b.x, 0.6, b.z); return true; }
  if (sh.kind === 'wreck') { const w = W.wreck; out.set(w.x, Math.max(0, groundH(w.x, w.z)) + 1, w.z); return true; }
  if (sh.kind === 'isle') { const c = S.ISLES[sh.isl]; out.set(c.x, 2, c.z); return true; }
  out.set(30, 0, 20);
  return true;
}
function newShot(kind, o, now) {
  const close = kind === 'person' || kind === 'pair';
  const sh = Object.assign({ kind, since: now, hold: 14, score: 0, ang: Math.random() * Math.PI * 2, spin: (Math.random() < 0.5 ? -1 : 1) * (close ? 0.07 : 0.03), cut: true }, o);
  if (kind === 'person') { sh.r = sh.r || 6.5; sh.h = sh.h || 2.2; }
  else if (kind === 'pair') { sh.r = 8; sh.h = 2.8; }
  else if (kind === 'camp') { sh.r = 22; sh.h = 11; sh.hold = 13; }
  else if (kind === 'boat') { sh.r = 14; sh.h = 5; sh.hold = 14; }
  else if (kind === 'wreck') { sh.r = 24; sh.h = 9; sh.hold = 10; }
  else if (kind === 'isle') { sh.r = S.ISLES[sh.isl].r * 1.5; sh.h = S.ISLES[sh.isl].r * 0.75; sh.hold = 11; sh.spin = 0.02; }
  else { sh.r = 210; sh.h = 170; sh.hold = 12; sh.spin = 0.012; }
  return sh;
}
let dirT = 0, estN = 0;
function directorTick(now) {
  const W = S.W;
  const cur = st.shot;
  if (st.card && st.card.pid) {
    if (!cur || cur.id !== st.card.pid || cur.kind !== 'person') {
      const r = RL.get(st.card.pid);
      if (r && !r.hidden) st.shot = newShot('person', { id: st.card.pid, r: 3.6, h: 0.5, hold: 99, card: true, spin: 0.025 }, now);
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
    const kind = pid && ['fight', 'confront', 'talk', 'court', 'tryst', 'chat', 'murder', 'follow', 'feed', 'demand'].indexOf(best.act.k) >= 0 ? 'pair' : 'person';
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
  else if (estN % 8 === 4 && (S.popOf(3) > 0 || S.popOf(2) > 0)) sh = newShot('isle', { isl: S.popOf(3) > 0 && estN % 16 === 4 ? 3 : 2 }, now);
  else sh = newShot('wide', {}, now);
  st.shot = sh;
}

/* ---------- per frame ---------- */
export function updateCamera(dt, now) {
  const { camera, controls } = T;
  if (st.director) {
    dirT -= dt;
    if (dirT <= 0) { dirT = 0.5; directorTick(now); }
    const sh = st.shot;
    if (sh && shotPos(sh, _tgt)) {
      sh.ang += sh.spin * dt;
      let r = sh.r, h = sh.h;
      if (sh.kind === 'pair' && sh.sep) r = Math.max(r, sh.sep * 1.4 + 4);
      _cp.set(_tgt.x + Math.cos(sh.ang) * r, _tgt.y + h, _tgt.z + Math.sin(sh.ang) * r);
      if (sh.card) { const k = window.innerWidth < 760 ? 0 : 1.1; _tgt.x -= Math.sin(sh.ang) * k; _tgt.z += Math.cos(sh.ang) * k; _cp.x -= Math.sin(sh.ang) * k; _cp.z += Math.cos(sh.ang) * k; }
      const gy = Math.max(groundH(_cp.x, _cp.z), 0) + 1.2;
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
      const dx = r.x - controls.target.x, dy = (r.gy + r.size * 0.55) - controls.target.y, dz = r.z - controls.target.z;
      const k = Math.min(1, dt * 4);
      controls.target.x += dx * k; controls.target.y += dy * k; controls.target.z += dz * k;
      camera.position.x += dx * k; camera.position.y += dy * k; camera.position.z += dz * k;
    }
  }
  if (keys.size) keyMove(dt);
  const tg = controls.target;
  const ox = tg.x, oz = tg.z;
  tg.x = clamp(tg.x, -S.B - 40, S.B + 40); tg.z = clamp(tg.z, -S.B - 40, S.B + 40);
  camera.position.x += tg.x - ox; camera.position.z += tg.z - oz;
  controls.update();
  const cy = Math.max(groundH(camera.position.x, camera.position.z), 0) + 0.8;
  if (camera.position.y < cy) camera.position.y = cy;
}
function keyMove(dt) {
  const { camera, controls } = T;
  const fwd = _v.subVectors(controls.target, camera.position).setY(0);
  const dist = camera.position.distanceTo(controls.target);
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = _v2.set(-fwd.z, 0, fwd.x);
  const sp = clamp(dist * 0.9, 6, 160) * (keys.has('shift') ? 2.5 : 1) * dt;
  let mx = 0, mz = 0;
  if (keys.has('w') || keys.has('arrowup')) { mx += fwd.x; mz += fwd.z; }
  if (keys.has('s') || keys.has('arrowdown')) { mx -= fwd.x; mz -= fwd.z; }
  if (keys.has('d') || keys.has('arrowright')) { mx += right.x; mz += right.z; }
  if (keys.has('a') || keys.has('arrowleft')) { mx -= right.x; mz -= right.z; }
  controls.target.x += mx * sp; controls.target.z += mz * sp;
  camera.position.x += mx * sp; camera.position.z += mz * sp;
  const ty = Math.max(0, groundH(controls.target.x, controls.target.z));
  const dy = (ty + 0.5 - controls.target.y) * Math.min(1, dt * 3);
  controls.target.y += dy; camera.position.y += dy;
  if (keys.has('q') || keys.has('e')) {
    const a = (keys.has('q') ? 1 : -1) * dt * 1.2;
    const ox = camera.position.x - controls.target.x, oz = camera.position.z - controls.target.z;
    camera.position.x = controls.target.x + ox * Math.cos(a) - oz * Math.sin(a);
    camera.position.z = controls.target.z + ox * Math.sin(a) + oz * Math.cos(a);
  }
  if (keys.has('r') || keys.has('f')) {
    const k = keys.has('r') ? Math.exp(-dt * 1.6) : Math.exp(dt * 1.6);
    const off = _v.subVectors(camera.position, controls.target).multiplyScalar(k);
    const len = off.length();
    if (len > controls.minDistance && len < controls.maxDistance) camera.position.copy(controls.target).add(off);
  }
}
