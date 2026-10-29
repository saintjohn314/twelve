/* People, animals and everything the castaways build: camps, fires, huts, farms, boats, pots, racks and the dead. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { S, st, R, T, clamp, lerp, smoothstep, hash01, CAMP_HEX } from './state.mjs';
import { groundH, groundY, TX, U, env, paintGround } from './world.mjs';

const CAP = 280;                 // people, plus a few bodies
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler(), _lm = new THREE.Matrix4(), _pm = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const SRGB = THREE.SRGBColorSpace;
const srgb = (c, r, g, b) => c.setRGB(r, g, b, SRGB);

/* ---------- interpolation between fixed sim steps ---------- */
const prevP = new Map(), prevA = new Map(), prevB = new Map(), prevS = new Map();
export const smooth = new Map();     // id -> [dx, dz] offset that decays after a server resync
function snapOne(map, o) { let a = map.get(o.id); if (!a) map.set(o.id, a = [0, 0, 0]); a[0] = o.x; a[1] = o.z; a[2] = o.dir || 0; }
export function snapshot() {
  const W = S.W;
  for (const p of W.people) snapOne(prevP, p);
  for (const a of W.animals) snapOne(prevA, a);
  for (const b of W.boats) snapOne(prevB, b);
  for (const s of W.snakes) snapOne(prevS, s);
}
export function clearSnaps() { prevP.clear(); prevA.clear(); prevB.clear(); prevS.clear(); }
const IP = { x: 0, z: 0, moved: 0, dir: 0 };
function ip(map, o) {
  const a = map.get(o.id);
  IP.dir = o.dir || 0;
  if (!a) { IP.x = o.x; IP.z = o.z; IP.moved = 0; return IP; }
  const dx = o.x - a[0], dz = o.z - a[1], d = Math.hypot(dx, dz);
  if (d > 12) { IP.x = o.x; IP.z = o.z; IP.moved = 0; return IP; }
  IP.x = a[0] + dx * st.alpha; IP.z = a[1] + dz * st.alpha; IP.moved = d;
  let dd = (o.dir || 0) - a[2]; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI;
  IP.dir = a[2] + dd * st.alpha;
  return IP;
}
const STEP_SEC = S.DT / S.RATE / 1000;      // real seconds per sim step

/* ---------- geometry helpers ---------- */
function lathe(prof, seg = 12) { return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg); }
function limbGeo(len, r0, r1, seg = 10) {
  const pts = [];
  for (let i = 0; i <= 4; i++) { const a = i / 4 * Math.PI / 2; pts.push([Math.sin(a) * r0, Math.cos(a) * r0 * 0.7]); }
  for (let i = 0; i <= 4; i++) { const a = i / 4 * Math.PI / 2; pts.push([Math.cos(a) * r1, -len - Math.sin(a) * r1 * 0.7]); }
  return lathe(pts, seg);
}
function tint(g, hex) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  _c.set(hex);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const merge = list => mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)));
function sphere(r, sx, sy, sz, x, y, z, w = 10, h = 8) { const g = new THREE.SphereGeometry(r, w, h); g.scale(sx, sy, sz); g.translate(x, y, z); return g; }
function cyl(r0, r1, h, x, y, z, seg = 8) { const g = new THREE.CylinderGeometry(r1, r0, h, seg); g.translate(x, y, z); return g; }
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = SRGB;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- local textures: cloth weave, hide, tilled soil ---------- */
let LT = null;
function localTextures() {
  if (LT) return LT;
  LT = {};
  LT.cloth = canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = '#e6e6e6'; x.fillRect(0, 0, w, h);
    const r = rng(41);
    for (let y = 0; y < h; y += 2) { x.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.08})`; x.fillRect(0, y, w, 1); }
    for (let xx = 0; xx < w; xx += 2) { x.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.05})`; x.fillRect(xx, 0, 1, h); }
    for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(90,80,70,${r() * 0.12})`; x.beginPath(); x.arc(r() * w, r() * h, 2 + r() * 8, 0, 6.3); x.fill(); }
  }, true);
  LT.hide = canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = '#d8d0c4'; x.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 140; i++) { const g = 150 + r() * 90; x.fillStyle = `rgba(${g},${g * 0.9},${g * 0.78},0.35)`; x.beginPath(); x.ellipse(r() * w, r() * h, 3 + r() * 12, 2 + r() * 6, r() * 3, 0, 6.3); x.fill(); }
    for (let i = 0; i < 400; i++) { x.strokeStyle = `rgba(60,45,30,${0.08 + r() * 0.12})`; const px = r() * w, py = r() * h; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 3, py + 2 + r() * 4); x.stroke(); }
  }, true);
  LT.soil = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#4e3a28'; x.fillRect(0, 0, w, h);
    const r = rng(3);
    // furrows: soft, uneven ridges of turned earth
    for (let i = 0; i < 7; i++) {
      const y0 = (i + 0.5) * h / 7;
      for (let xx = 0; xx < w; xx += 3) {
        const y = y0 + Math.sin(xx * 0.05 + i) * 2 + (r() - 0.5) * 3, rad = 7 + r() * 4;
        const g = x.createRadialGradient(xx, y, 0, xx, y, rad);
        g.addColorStop(0, 'rgba(122,94,64,0.32)'); g.addColorStop(1, 'rgba(122,94,64,0)');
        x.fillStyle = g; x.fillRect(xx - rad, y - rad, rad * 2, rad * 2);
      }
    }
    for (let i = 0; i < 2600; i++) { const v = r(); x.fillStyle = v < 0.5 ? `rgba(30,20,12,${0.2 + r() * 0.3})` : `rgba(${110 + r() * 50},${85 + r() * 40},${55 + r() * 30},${0.2 + r() * 0.3})`; const s2 = 1 + r() * 2.5; x.beginPath(); x.arc(r() * w, r() * h, s2, 0, 6.3); x.fill(); }
    for (let i = 0; i < 40; i++) { x.strokeStyle = `rgba(150,140,90,${0.25 + r() * 0.2})`; x.lineWidth = 1; const px = r() * w, py = r() * h; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 8, py + (r() - 0.5) * 3); x.stroke(); }
  }, false);
  LT.clay = canvasTex(64, 64, (x, w, h) => {
    x.fillStyle = '#c8754a'; x.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let y = 0; y < h; y += 3) { x.fillStyle = `rgba(${r() < 0.5 ? '80,35,20' : '230,150,110'},0.12)`; x.fillRect(0, y, w, 1); }
    x.fillStyle = 'rgba(60,25,15,0.5)'; x.fillRect(0, h * 0.3, w, 3); x.fillRect(0, h * 0.36, w, 2);
  }, true);
  return LT;
}

/* ---------- the human body ---------- */
// Joints in meters for an adult 1.75 m tall; every person is the same rig scaled to their height.
const ROOT_H = 0.93, SPINE_Y = 0.09, NECK_Y = 0.47, UARM = 0.29, FARM = 0.29, THIGH = 0.44, SHIN = 0.42;
function bodyGeos() {
  const G = {};
  G.pelvis = lathe([[0, -0.12], [0.1, -0.115], [0.135, -0.07], [0.148, 0], [0.14, 0.06], [0.125, 0.1], [0, 0.11]], 14);
  G.pelvis.scale(1.25, 1, 0.85);
  const chest = f => {
    const g = lathe([[0, -0.02], [f ? 0.11 : 0.122, 0], [f ? 0.112 : 0.126, 0.08], [f ? 0.128 : 0.142, 0.2], [f ? 0.134 : 0.155, 0.3], [f ? 0.132 : 0.16, 0.37], [f ? 0.124 : 0.15, 0.42], [0.1, 0.455], [0.05, 0.48], [0, 0.49]], 16);
    g.scale(1.3, 1, 0.8);
    if (!f) return g;
    return merge([g, sphere(0.06, 1, 0.9, 0.85, 0.066, 0.285, 0.078), sphere(0.06, 1, 0.9, 0.85, -0.066, 0.285, 0.078)]);
  };
  G.chestM = chest(false); G.chestF = chest(true);
  const nose = new THREE.ConeGeometry(0.017, 0.045, 6); nose.rotateX(Math.PI / 2); nose.translate(0, 0.128, 0.106);
  G.head = merge([sphere(0.105, 0.9, 1.1, 1.0, 0, 0.142, 0, 18, 14), sphere(0.07, 1, 0.8, 1, 0, 0.088, 0.034), cyl(0.048, 0.042, 0.1, 0, 0.03, -0.005, 10), nose,
    sphere(0.022, 0.5, 1, 0.8, 0.093, 0.135, 0), sphere(0.022, 0.5, 1, 0.8, -0.093, 0.135, 0)]);
  G.eyes = merge([sphere(0.013, 1, 1, 0.6, 0.034, 0.152, 0.092, 6, 5), sphere(0.013, 1, 1, 0.6, -0.034, 0.152, 0.092, 6, 5)]);
  const cap = new THREE.SphereGeometry(0.114, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.56); cap.scale(0.93, 1.1, 1.04); cap.translate(0, 0.148, -0.01);
  G.hairS = cap;
  G.hairL = merge([cap.clone(), sphere(0.1, 1.05, 1.75, 0.5, 0, 0.07, -0.072, 12, 10)]);
  G.beard = new THREE.SphereGeometry(0.074, 12, 8, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58); G.beard.scale(0.95, 1.0, 0.82);
  G.band = new THREE.TorusGeometry(0.102, 0.012, 6, 22); G.band.rotateX(Math.PI / 2); G.band.scale(0.93, 1, 1.04); G.band.translate(0, 0.19, -0.006);
  G.uArm = limbGeo(UARM - 0.02, 0.048, 0.038);
  G.fArm = merge([limbGeo(FARM - 0.06, 0.037, 0.029), sphere(0.04, 0.75, 1.25, 0.5, 0, -FARM + 0.01, 0.005, 8, 6)]);
  G.thigh = limbGeo(THIGH - 0.02, 0.074, 0.05);
  G.shin = limbGeo(SHIN - 0.02, 0.05, 0.034);
  G.foot = sphere(0.05, 0.8, 0.5, 2.0, 0, -0.025, 0.055);
  G.kilt = lathe([[0.152, 0.07], [0.16, 0], [0.178, -0.12], [0.205, -0.28]], 18); G.kilt.scale(1.25, 1, 0.9);
  G.sash = new THREE.TorusGeometry(0.168, 0.022, 5, 28); G.sash.rotateX(Math.PI / 2); G.sash.scale(1.33, 1, 0.86); G.sash.rotateZ(0.62); G.sash.translate(0, 0.27, 0.005);
  G.axe = merge([tint(cyl(0.016, 0.014, 0.66, 0, -0.2, 0), 0x6b4a2c), tint(new THREE.BoxGeometry(0.03, 0.1, 0.17).translate(0, -0.47, 0.07), 0x8e8a84)]);
  const shaft = new THREE.CylinderGeometry(0.014, 0.016, 2.0, 6); shaft.rotateX(Math.PI / 2); shaft.translate(0, 0, 0.2);
  const tip = new THREE.ConeGeometry(0.03, 0.18, 6); tip.rotateX(Math.PI / 2); tip.translate(0, 0, 1.28);
  G.spear = merge([tint(shaft, 0x7a5a38), tint(tip, 0x5a5650)]);
  G.bundle = merge([tint(sphere(0.13, 1.3, 0.8, 0.9, 0, 0, 0), 0x8a6a3a), tint(sphere(0.07, 1, 1, 1, 0.06, 0.07, 0.03), 0xc8401e), tint(sphere(0.06, 1, 1, 1, -0.07, 0.06, -0.02), 0x6a8a2a)]);
  return G;
}
const P = {};               // instanced body parts by name
const cnt = {};
function partMesh(name, geo, mat, per, shadow) {
  const m = new THREE.InstancedMesh(geo, mat, CAP * per);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false; m.castShadow = !!shadow; m.receiveShadow = true;
  _c.setRGB(1, 1, 1);
  for (let i = 0; i < CAP * per; i++) m.setColorAt(i, _c);
  m.count = 0;
  R.actors.add(m);
  P[name] = m;
  return m;
}
function put(name, M, col, sx, sy, sz) {
  const m = P[name], i = cnt[name]++;
  if (i >= m.instanceMatrix.count) { cnt[name]--; return; }
  if (sx !== undefined) { _pm.copy(M).scale(_s.set(sx, sy, sz)); m.setMatrixAt(i, _pm); } else m.setMatrixAt(i, M);
  if (col) m.setColorAt(i, col);
}
function flush(names) {
  for (const n of names) {
    const m = P[n];
    m.count = cnt[n];
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}
const PARTS = ['pelvis', 'chestM', 'chestF', 'head', 'eyes', 'hairS', 'hairL', 'beard', 'band', 'uArm', 'fArm', 'thigh', 'shin', 'foot', 'kilt', 'sash', 'axe', 'spear', 'bundle'];

/* ---------- colors and clothes ---------- */
const SKIN = [[0.3, 0.18, 0.11], [0.52, 0.34, 0.2], [0.76, 0.55, 0.38], [0.95, 0.8, 0.67]];
const HAIR = [[0.05, 0.04, 0.035], [0.2, 0.12, 0.07], [0.45, 0.27, 0.13], [0.82, 0.66, 0.4]];
const SHIRTS = [[0.9, 0.88, 0.82], [0.2, 0.25, 0.37], [0.66, 0.6, 0.45], [0.55, 0.23, 0.2], [0.42, 0.44, 0.45], [0.78, 0.7, 0.54], [0.25, 0.35, 0.29], [0.85, 0.82, 0.75], [0.36, 0.46, 0.6]];
const TROUSERS = [[0.23, 0.25, 0.29], [0.42, 0.35, 0.26], [0.17, 0.2, 0.28], [0.54, 0.5, 0.44], [0.29, 0.25, 0.22]];
const HIDES = [[0.46, 0.33, 0.21], [0.55, 0.41, 0.27], [0.36, 0.27, 0.19], [0.72, 0.64, 0.5], [0.62, 0.5, 0.36]];
function stop3(stops, t, out) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  return srgb(out, lerp(stops[i][0], stops[i + 1][0], f), lerp(stops[i][1], stops[i + 1][1], f), lerp(stops[i][2], stops[i + 1][2], f));
}
const FADE = new THREE.Color();
srgb(FADE, 0.8, 0.76, 0.68);
const campCols = CAMP_HEX.map(h => new THREE.Color(h));
const gold = new THREE.Color(0xd9b04a), eyeCol = new THREE.Color(0x1a1410);
// what someone wears: ship clothes that tear, fade and finally give way to hides
const OF = { skin: new THREE.Color(), hair: new THREE.Color(), shirt: new THREE.Color(), pants: new THREE.Color(), hide: new THREE.Color(), sash: new THREE.Color(),
  chest: null, uArm: null, fArm: null, thigh: null, shin: null, pelvis: null, kilt: null, longHair: false, beard: 0, sashOn: false };
function outfit(p, a, dead) {
  const W = S.W, h = hash01(p.id * 97 + 13);
  const g = p.g || { skin: 0.5, hair: 0.3 };
  stop3(SKIN, g.skin, OF.skin);
  stop3(HAIR, g.hair, OF.hair);
  if (a > 44) OF.hair.lerp(_c.setRGB(0.7, 0.69, 0.66), clamp((a - 44) / 24, 0, 0.9));
  if (p.ill > 0 && !dead) OF.skin.lerp(_c.setRGB(0.62, 0.66, 0.5), 0.22);
  if (dead) OF.skin.lerp(_c.setRGB(0.5, 0.5, 0.52), 0.45);
  const castaway = !!p.prof;
  const wear = castaway ? clamp(W.t / (S.HPY * 2.2) + (h - 0.5) * 0.35, 0, 1.2) : 2;
  const hd = HIDES[Math.floor(hash01(p.id * 7 + 1) * HIDES.length)];
  srgb(OF.hide, hd[0], hd[1], hd[2]);
  const sh = SHIRTS[Math.floor(h * SHIRTS.length)], tr = TROUSERS[Math.floor(hash01(p.id * 31) * TROUSERS.length)];
  srgb(OF.shirt, sh[0], sh[1], sh[2]).lerp(FADE, clamp(wear, 0, 1) * 0.45);
  srgb(OF.pants, tr[0], tr[1], tr[2]).lerp(FADE, clamp(wear, 0, 1) * 0.35);
  if (wear > 0.55) { OF.shirt.multiplyScalar(0.92); OF.pants.multiplyScalar(0.9); }
  const skin = OF.skin, female = p.sex === 'F', dress = female && hash01(p.id * 5) < 0.45;
  OF.kilt = null;
  if (wear < 1) {
    const longS = hash01(p.id * 3) < 0.5;
    OF.chest = OF.shirt;
    OF.uArm = wear < 0.62 ? OF.shirt : skin;
    OF.fArm = wear < 0.3 && longS ? OF.shirt : skin;
    OF.pelvis = dress ? OF.shirt : OF.pants;
    OF.thigh = dress ? skin : wear < 0.75 ? OF.pants : skin;
    OF.shin = dress ? skin : wear < 0.35 ? OF.pants : skin;
    if (dress) OF.kilt = OF.shirt;
  } else {
    // hides: wraps for women and older girls, a kilt for everyone past toddling; men go bare-chested except in the storm season
    const kid = a < 5;
    OF.chest = (female && a >= 11) || (!female && S.seasonIdx() === 3 && a >= 11) ? OF.hide : skin;
    OF.uArm = skin; OF.fArm = skin; OF.thigh = skin; OF.shin = skin;
    OF.pelvis = OF.hide;
    OF.kilt = kid ? null : OF.hide;
  }
  OF.longHair = female ? a >= 4 : castaway && W.t > S.HPY * 0.9 && hash01(p.id * 11) < 0.45;
  OF.beard = 0;
  if (!female && a >= 17) {
    if (castaway) OF.beard = hash01(p.id * 19) < 0.8 ? clamp(W.t / (S.HPY * 0.35), 0.15, 1) : 0;
    else OF.beard = hash01(p.id * 23) < 0.55 ? clamp((a - 17) / 8, 0.2, 1) : 0;
  }
  const grp = S.grpOf(p);
  OF.sashOn = !!grp && a >= 9 && !dead;
  if (grp) OF.sash.copy(campCols[grp.color % 8]);
  return OF;
}

/* ---------- poses ---------- */
// channels: 0 drop, 1 lean, 2 twist, 3 head pitch, 4 head yaw, 5-7 left shoulder pitch/roll/elbow, 8-10 right, 11-12 left hip/knee, 13-14 right, 15 lie, 16 roll, 17 leg spread
const NCH = 18;
const anim = new Map();
function setStand(o) { o.fill(0); o[6] = 0.08; o[9] = 0.08; o[7] = 0.15; o[10] = 0.15; o[12] = 0.04; o[14] = 0.04; }
function setSit(o) { o[0] = 0.78; o[1] = 0.14; o[11] = o[13] = 1.95; o[12] = o[14] = 1.05; o[17] = 0.2; o[5] = o[8] = 0.7; o[7] = o[10] = 0.6; o[6] = o[9] = 0.12; }
function setKneel(o) { o[0] = 0.4; o[1] = 0.25; o[11] = o[13] = 0.05; o[12] = o[14] = 1.65; o[17] = 0.08; }
function setSquat(o) { o[0] = 0.5; o[1] = 0.55; o[11] = o[13] = 1.6; o[12] = o[14] = 2.25; o[17] = 0.22; }
function setLie(o, side) { o.fill(0); o[15] = 1; o[16] = side; o[5] = o[8] = 0.1; o[6] = o[9] = 0.25; o[7] = o[10] = 0.3; if (side) { o[11] = o[13] = 0.5; o[12] = o[14] = 0.7; o[5] = o[8] = 0.6; o[7] = o[10] = 1.2; } }
function gesture(o, t, id, amt) { const s = Math.sin(t * 2.1 + id), s2 = Math.sin(t * 1.3 + id * 2); o[8] = 0.45 + amt * (0.35 + 0.3 * s); o[10] = 0.9 + 0.5 * s2 * amt; o[9] = 0.15 + 0.15 * s2; o[3] = 0.05 * Math.sin(t * 3 + id); }
// target pose for what someone is doing; returns the tool in their hands
function targetPose(p, A, o, ctx) {
  const t = ctx.time, id = p.id, k = A ? A.k : '', ph = A ? A.ph : '';
  setStand(o);
  let tool = '';
  if (ctx.a > 58) o[1] += 0.14;
  if (p.sleeping || (k === 'sleep' && ph === 'work')) { setLie(o, hash01(id * 3 + Math.floor(S.W.t / 24)) < 0.5 ? 0 : (hash01(id) < 0.5 ? 1.2 : -1.2)); return ''; }
  if (k === 'wake') { setLie(o, 0); o[3] = -0.5 + 0.2 * Math.sin(t * 0.7 + id); o[5] = 1.2; o[7] = 1.6; return ''; }
  if (ctx.dead) { setLie(o, hash01(id) < 0.5 ? 1.35 : -1.35); o[3] = 0.4; return ''; }
  if (k === 'ride') {
    setSit(o); o[11] = o[13] = 1.55; o[12] = o[14] = 0.55;
    if (ctx.paddle) { const s = Math.sin(t * 3.2 + id); o[5] = 1.0 + 0.5 * s; o[8] = 1.0 - 0.5 * s; o[7] = o[10] = 0.5; o[2] = 0.3 * s; }
    return '';
  }
  const moving = ctx.moving;
  if (moving) {
    if ((k === 'stock' || k === 'eat' || k === 'hunt' || k === 'fish' || k === 'feed') && (ph === 'deliver' || ph === 'fetch')) { o[5] = o[8] = 0.75; o[7] = o[10] = 1.45; o[6] = o[9] = 0.05; tool = 'bundle'; }
    else if (k === 'hunt') tool = 'spear';
    else if (k === 'sneak' || k === 'murder') { o[0] = 0.12; o[1] = 0.4; o[11] = o[13] = 0.35; o[12] = o[14] = 0.6; }
    else if (k === 'build' && ph === 'wood' && ctx.hasAxe) tool = 'axe';
    else if (k === 'fish' && ctx.hasSpear) tool = 'spear';
    return tool;
  }
  switch (k) {
    case 'eat': case 'stock':
      if (ph === 'work') { setSit(o); const s = Math.sin(t * 2.4 + id); o[8] = 1.25 + 0.35 * Math.max(0, s); o[10] = 1.7 + 0.8 * Math.max(0, s); o[3] = 0.15; }
      else if (ph === 'gather') {
        if (hash01(id * 5 + Math.floor(S.W.t * 2)) < 0.5) { const s = Math.sin(t * 2.6 + id); o[5] = 2.5 + 0.3 * s; o[8] = 2.5 - 0.3 * s; o[7] = o[10] = 0.2; o[3] = -0.45; o[6] = o[9] = 0.2; }
        else { o[1] = 0.95; o[0] = 0.08; o[11] = o[13] = 0.25; o[12] = o[14] = 0.4; const s = Math.sin(t * 2.2 + id); o[5] = 1.1 + 0.25 * s; o[8] = 1.1 - 0.25 * s; o[3] = 0.3; }
      }
      break;
    case 'build':
      if (ph === 'wood') { const s = Math.sin(t * 4.6 + id); const up = 0.5 + 0.5 * s; o[5] = o[8] = lerp(0.7, 2.9, up); o[7] = o[10] = lerp(0.15, 0.6, up); o[1] = lerp(0.45, 0.02, up); o[11] = o[13] = 0.15; o[12] = o[14] = 0.25; o[17] = 0.12; tool = ctx.hasAxe ? 'axe' : ''; }
      else if (A.what === 'fire') { setSquat(o); o[5] = o[8] = 1.1; o[7] = o[10] = 0.5; o[3] = 0.3; }
      else if (A.what === 'boat') { setKneel(o); const s = Math.sin(t * 6 + id); o[8] = 1.3 + 0.5 * s; o[10] = 1.0 - 0.6 * s; o[5] = 1.1; o[7] = 0.6; o[1] = 0.55; }
      else { const s = Math.sin(t * 5.5 + id); o[8] = 1.7 + 0.45 * s; o[10] = 1.1 - 0.6 * s; o[5] = 1.5; o[7] = 0.5; o[3] = -0.15; o[1] = 0.05; }
      break;
    case 'fish':
      if (ph === 'work') {
        const s = Math.sin(t * 1.4 + id), thrust = Math.max(0, Math.sin(t * 1.4 + id + 1.2)) ** 6;
        o[1] = 0.35 + thrust * 0.25; o[11] = o[13] = 0.25; o[12] = o[14] = 0.4; o[0] = 0.06; o[17] = 0.15;
        o[8] = 1.35 + thrust * 0.4 + 0.05 * s; o[10] = 1.2 - thrust * 0.9; o[5] = 0.9; o[7] = 1.1; o[3] = 0.35;
        tool = 'spear';
      }
      break;
    case 'hunt': tool = 'spear'; o[8] = 1.4; o[10] = 1.3; o[1] = 0.15; break;
    case 'farm': {
      const s = Math.sin(t * 2.5 + id);
      o[1] = 1.0 + 0.1 * s; o[0] = 0.06; o[11] = o[13] = 0.2; o[12] = o[14] = 0.35; o[17] = 0.18; o[5] = 1.2 + 0.35 * s; o[8] = 1.2 - 0.35 * s; o[3] = 0.25;
      break;
    }
    case 'craft': setSit(o); { const s = Math.sin(t * 5 + id); o[5] = o[8] = 0.95; o[7] = 1.3 + 0.15 * s; o[10] = 1.3 - 0.15 * s; o[3] = 0.45; } break;
    case 'salvage': setSquat(o); { const s = Math.sin(t * 3 + id); o[5] = 1.0 + 0.4 * s; o[8] = 1.0 - 0.4 * s; o[3] = 0.4; } break;
    case 'talk': case 'court': case 'chat': case 'trade': case 'join':
      if (ctx.atCamp && !ctx.day) { setSit(o); gesture(o, t, id, 0.5); o[1] = 0.1; }
      else gesture(o, t, id, k === 'court' ? 0.35 : 0.8);
      break;
    case 'confront': case 'demand': { const s = Math.sin(t * 2.6 + id); o[1] = 0.18; o[8] = s > 0.2 ? 1.5 : 0.5; o[10] = s > 0.2 ? 0.1 : 0.6; o[9] = 0.2; o[5] = 0.3; o[6] = 0.35; o[3] = -0.08; break; }
    case 'fight': {
      const s = Math.sin(t * 7 + id * 1.7), jab = Math.max(0, s) ** 3, jab2 = Math.max(0, -s) ** 3;
      o[1] = 0.28; o[0] = 0.08; o[11] = 0.35; o[13] = -0.1; o[12] = 0.5; o[14] = 0.3; o[17] = 0.2;
      o[5] = 1.1 + jab2 * 0.4; o[7] = 2.1 - jab2 * 1.9; o[8] = 1.1 + jab * 0.4; o[10] = 2.1 - jab * 1.9; o[2] = 0.35 * (jab - jab2); o[3] = 0.15;
      break;
    }
    case 'murder': { const s = Math.max(0, Math.sin(t * 5 + id)) ** 2; o[1] = 0.35; o[8] = 2.6 - s * 1.6; o[10] = 0.4; o[11] = 0.3; o[12] = 0.4; break; }
    case 'tryst': o[5] = o[8] = 1.25; o[6] = o[9] = 0.35; o[7] = o[10] = 1.4; o[3] = -0.05; break;
    case 'mourn': setKneel(o); o[1] = 0.55; o[3] = 0.55; o[5] = o[8] = 1.7; o[7] = o[10] = 2.45; o[6] = o[9] = 0.05; break;
    case 'shelter': setSquat(o); o[5] = o[8] = 2.6; o[7] = o[10] = 2.3; o[3] = 0.6; break;
    case 'ponder': o[8] = 1.15; o[10] = 2.45; o[5] = 0.55; o[7] = 1.65; o[3] = 0.25 + 0.05 * Math.sin(t * 0.8); o[4] = 0.2 * Math.sin(t * 0.3 + id); break;
    case 'council': {
      const g = S.grpOf(p), speaking = g && g.council && (g.council.challenger === id || g.leader === id);
      if (speaking) gesture(o, t, id, 1);
      else { setSit(o); o[3] = -0.1; }
      break;
    }
    case 'play': { const j = Math.abs(Math.sin(t * 5.5 + id)); o[0] = -j * 0.18; o[5] = o[8] = 2.4 * j + 0.3; o[12] = o[14] = 0.6 * (1 - j); o[11] = o[13] = 0.3 * (1 - j); break; }
    case 'snake': { const s = Math.max(0, Math.sin(t * 6 + id)) ** 2; o[1] = 0.45; o[5] = o[8] = 2.2 - s * 1.4; o[7] = o[10] = 0.3; o[3] = 0.5; break; }
    case 'sneak': if (ph === 'wait') { setSquat(o); o[3] = -0.2; } break;
    case 'feed': setKneel(o); o[5] = o[8] = 1.0; o[7] = o[10] = 1.2; o[3] = 0.4; break;
    case 'idle': case 'shelterless':
      if (ctx.atCamp || hash01(id * 13 + Math.floor(S.W.t / 6)) < 0.55) { setSit(o); o[3] = 0.05 * Math.sin(t * 0.4 + id); }
      else { o[4] = 0.4 * Math.sin(t * 0.25 + id); o[2] = 0.05 * Math.sin(t * 0.5 + id); }
      break;
    default: o[4] = 0.25 * Math.sin(t * 0.3 + id);
  }
  return tool;
}
function addGait(o, ph, w, run, ctx) {
  const s = Math.sin(ph), c = Math.cos(ph), amp = (run ? 0.78 : 0.44) * w;
  o[11] += s * amp; o[13] -= s * amp;
  o[12] += (run ? 0.25 : 0.06) * w + Math.max(0, c) * (run ? 1.35 : 0.65) * w;
  o[14] += (run ? 0.25 : 0.06) * w + Math.max(0, -c) * (run ? 1.35 : 0.65) * w;
  if (!ctx.carry) { o[5] -= s * amp * 0.85; o[8] += s * amp * 0.85; o[7] += (run ? 1.25 : 0.25) * w; o[10] += (run ? 1.25 : 0.25) * w; }
  o[1] += (run ? 0.22 : 0.05) * w;
  o[2] += s * 0.12 * w;
  o[0] -= Math.abs(c) * (run ? 0.06 : 0.025) * w;
}

/* ---------- building the rig, one person at a time ---------- */
const Mroot = new THREE.Matrix4(), Mspine = new THREE.Matrix4(), Mhead = new THREE.Matrix4(), Msh = new THREE.Matrix4(), Mel = new THREE.Matrix4(), Mhip = new THREE.Matrix4(), Mkn = new THREE.Matrix4(), Mft = new THREE.Matrix4(), Mt = new THREE.Matrix4(), Mhand = new THREE.Matrix4();
function child(out, parent, tx, ty, tz, rx, ry, rz, order) {
  _e.set(rx, ry, rz, order || 'ZYX');
  _lm.makeRotationFromEuler(_e);
  _lm.setPosition(tx, ty, tz);
  return out.multiplyMatrices(parent, _lm);
}
const handR = new THREE.Vector3(), handL = new THREE.Vector3();
function drawRig(p, x, y, z, yaw, sc, o, a, of, tool, extra) {
  const female = p.sex === 'F';
  const kidT = clamp(a / 16, 0, 1);
  const headS = lerp(1.42, 1, kidT);
  const strW = 0.94 + ((p.g && p.g.str) || 0.5) * 0.14;
  _q.setFromAxisAngle(UP, yaw);
  Mroot.compose(_v.set(x, y + (ROOT_H - lerp(o[0], 0.8, o[15])) * sc, z), _q, _s.set(sc, sc, sc));
  if (o[15] > 0.001) Mroot.multiply(_lm.makeRotationX(-o[15] * Math.PI / 2)).multiply(Mt.makeRotationY(o[16] * o[15]));
  put('pelvis', Mroot, of.pelvis, female ? 1.08 : 1, 1, 1);
  if (of.kilt) put('kilt', Mroot, of.kilt, female ? 1.06 : 1, 1, 1);
  child(Mspine, Mroot, 0, SPINE_Y, 0, o[1], o[2], 0, 'XYZ');
  const preg = extra && extra.preg ? 1 + extra.preg * 0.28 : 1;
  put(female ? 'chestF' : 'chestM', Mspine, of.chest, (female ? 0.94 : 1) * strW, 1, preg);
  if (of.sashOn) put('sash', Mspine, of.sash, (female ? 0.95 : 1) * strW, 1, preg);
  child(Mhead, Mspine, 0, NECK_Y, 0, o[3], o[4], 0, 'YXZ');
  if (headS !== 1) Mhead.scale(_s.set(headS, headS, headS));
  put('head', Mhead, of.skin);
  if (!extra || !extra.dead) put('eyes', Mhead, eyeCol);
  put(of.longHair ? 'hairL' : 'hairS', Mhead, of.hair);
  if (of.beard > 0.05) { Mt.copy(Mhead).multiply(_lm.makeTranslation(0, 0.1, 0.038)).scale(_s.set(1, 0.55 + of.beard * 0.7, 1)); put('beard', Mt, of.hair); }
  if (extra && extra.leader) put('band', Mhead, gold);
  const shx = female ? 0.168 : 0.185 * strW;
  for (const side of [1, -1]) {
    const b = side > 0 ? 5 : 8;
    child(Msh, Mspine, side * shx, 0.41, 0, -o[b], 0, side * o[b + 1], 'XYZ');
    put('uArm', Msh, of.uArm);
    child(Mel, Msh, 0, -UARM, 0, -o[b + 2], 0, 0);
    put('fArm', Mel, of.fArm);
    Mhand.copy(Mel).multiply(_lm.makeTranslation(0, -FARM + 0.02, 0));
    (side > 0 ? handL : handR).setFromMatrixPosition(Mhand);
    if (side < 0 && tool === 'axe') put('axe', Mhand, null);
  }
  const hx = female ? 0.098 : 0.09;
  for (const side of [1, -1]) {
    const b = side > 0 ? 11 : 13;
    child(Mhip, Mroot, side * hx, -0.06, 0, -o[b], 0, side * o[17], 'XYZ');
    put('thigh', Mhip, of.thigh, female ? 1.05 : 1, 1, 1);
    child(Mkn, Mhip, 0, -THIGH, 0, o[b + 1], 0, 0);
    put('shin', Mkn, of.shin);
    child(Mft, Mkn, 0, -SHIN, 0, clamp(o[b] - o[b + 1], -1.2, 1.2) * 0.8, 0, 0);
    put('foot', Mft, of.skin);
  }
  if (tool === 'spear' || tool === 'bundle') {
    Mt.copy(Mspine);
    if (tool === 'bundle') { _v.addVectors(handL, handR).multiplyScalar(0.5); Mt.setPosition(_v); put('bundle', Mt, null); }
    else { Mt.setPosition(handR); Mt.multiply(_lm.makeRotationX(extra && extra.spearPitch != null ? extra.spearPitch : -1.15)); put('spear', Mt, null); }
  }
}

/* ---------- animals ---------- */
function animalGeos() {
  const boar = merge([
    tint(sphere(1, 0.27, 0.3, 0.56, 0, 0.55, 0, 14, 10), 0x4a3a30),
    tint(sphere(1, 0.19, 0.2, 0.27, 0, 0.52, 0.56, 12, 8), 0x43342b),
    tint(cyl(0.075, 0.07, 0.14, 0, 0, 0, 10).rotateX(Math.PI / 2).translate(0, 0.46, 0.84), 0x6b4a40),
    tint(new THREE.ConeGeometry(0.02, 0.11, 5).rotateX(-0.6).translate(0.07, 0.44, 0.8), 0xeee6d6),
    tint(new THREE.ConeGeometry(0.02, 0.11, 5).rotateX(-0.6).translate(-0.07, 0.44, 0.8), 0xeee6d6),
    tint(new THREE.ConeGeometry(0.06, 0.13, 5).rotateZ(0.4).translate(0.12, 0.72, 0.5), 0x33271f),
    tint(new THREE.ConeGeometry(0.06, 0.13, 5).rotateZ(-0.4).translate(-0.12, 0.72, 0.5), 0x33271f),
    tint(new THREE.BoxGeometry(0.06, 0.1, 0.7).translate(0, 0.84, 0.05), 0x231a14),
    tint(cyl(0.015, 0.01, 0.22, 0, 0, 0, 5).rotateX(0.9).translate(0, 0.58, -0.6), 0x33271f),
  ]);
  const goat = merge([
    tint(sphere(1, 0.21, 0.24, 0.44, 0, 0.74, 0, 14, 10), 0xe2dccf),
    tint(cyl(0.075, 0.06, 0.34, 0, 0, 0, 8).rotateX(-0.65).translate(0, 0.95, 0.4), 0xe2dccf),
    tint(sphere(1, 0.085, 0.1, 0.17, 0, 1.08, 0.56, 10, 8), 0xd8d1c2),
    tint(new THREE.ConeGeometry(0.022, 0.24, 5).rotateX(-1.0).translate(0.045, 1.22, 0.46), 0x4a3e32),
    tint(new THREE.ConeGeometry(0.022, 0.24, 5).rotateX(-1.0).translate(-0.045, 1.22, 0.46), 0x4a3e32),
    tint(sphere(0.05, 0.4, 1, 1.4, 0.085, 1.12, 0.5, 6, 5), 0xcfc7b8),
    tint(sphere(0.05, 0.4, 1, 1.4, -0.085, 1.12, 0.5, 6, 5), 0xcfc7b8),
    tint(new THREE.ConeGeometry(0.03, 0.12, 5).rotateX(Math.PI).translate(0, 0.97, 0.66), 0xb8b0a0),
    tint(new THREE.ConeGeometry(0.035, 0.12, 5).rotateX(-0.5).translate(0, 0.86, -0.44), 0xd8d1c2),
  ]);
  const boarLeg = limbGeo(0.36, 0.055, 0.035, 7), goatLeg = limbGeo(0.5, 0.036, 0.024, 7);
  const seg = sphere(0.075, 1, 0.55, 1.7, 0, 0, 0, 8, 6);
  return { boar, goat, boarLeg, goatLeg, seg };
}
const LEGS = { boar: { x: 0.15, y: 0.42, z: 0.32, n: 'boarLeg' }, goat: { x: 0.12, y: 0.56, z: 0.29, n: 'goatLeg' } };

/* ---------- build ---------- */
let SH = null;           // shared geometries and materials for camps, huts, boats
export function buildActors() {
  if (R.actors) {
    const old = R.actors;
    T.scene.remove(old);
    setTimeout(() => old.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); }), 5000);
  }
  R.actors = new THREE.Group();
  T.scene.add(R.actors);
  const L = localTextures();
  const G = bodyGeos();
  const skinMat = () => new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  const clothMat = () => new THREE.MeshStandardMaterial({ map: L.cloth, roughness: 0.9, metalness: 0 });
  for (const k in cnt) delete cnt[k];
  partMesh('pelvis', G.pelvis, clothMat(), 1, true);
  partMesh('chestM', G.chestM, clothMat(), 1, true);
  partMesh('chestF', G.chestF, clothMat(), 1, true);
  partMesh('head', G.head, skinMat(), 1, true);
  partMesh('eyes', G.eyes, new THREE.MeshStandardMaterial({ roughness: 0.25 }), 1, false);
  partMesh('hairS', G.hairS, new THREE.MeshStandardMaterial({ roughness: 0.8 }), 1, true);
  partMesh('hairL', G.hairL, new THREE.MeshStandardMaterial({ roughness: 0.8 }), 1, true);
  partMesh('beard', G.beard, new THREE.MeshStandardMaterial({ roughness: 0.9 }), 1, false);
  partMesh('band', G.band, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 }), 1, false);
  partMesh('uArm', G.uArm, clothMat(), 2, true);
  partMesh('fArm', G.fArm, skinMat(), 2, true);
  partMesh('thigh', G.thigh, clothMat(), 2, true);
  partMesh('shin', G.shin, skinMat(), 2, true);
  partMesh('foot', G.foot, skinMat(), 2, true);
  partMesh('kilt', G.kilt, new THREE.MeshStandardMaterial({ map: L.hide, roughness: 0.95, side: THREE.DoubleSide }), 1, true);
  partMesh('sash', G.sash, new THREE.MeshStandardMaterial({ map: L.cloth, roughness: 0.85 }), 1, false);
  partMesh('axe', G.axe, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }), 1, true);
  partMesh('spear', G.spear, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), 1, true);
  partMesh('bundle', G.bundle, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 1, true);
  // animals
  const AG = animalGeos();
  const am = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  R.an = {};
  for (const sp of ['boar', 'goat']) {
    const body = new THREE.InstancedMesh(AG[sp], am(), 200), legs = new THREE.InstancedMesh(AG[sp + 'Leg'], new THREE.MeshStandardMaterial({ roughness: 0.9 }), 800);
    for (const m of [body, legs]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.count = 0; R.actors.add(m); }
    for (let i = 0; i < 200; i++) body.setColorAt(i, _c.setRGB(1, 1, 1));
    for (let i = 0; i < 800; i++) legs.setColorAt(i, sp === 'boar' ? srgb(_c, 0.2, 0.15, 0.12) : srgb(_c, 0.72, 0.68, 0.6));
    R.an[sp] = { body, legs };
  }
  R.snake = new THREE.InstancedMesh(AG.seg, new THREE.MeshStandardMaterial({ roughness: 0.45 }), 40 * 16);
  R.snake.instanceMatrix.setUsage(THREE.DynamicDrawUsage); R.snake.frustumCulled = false; R.snake.castShadow = true; R.snake.count = 0;
  for (let i = 0; i < 40 * 16; i++) R.snake.setColorAt(i, _c.setRGB(1, 1, 1));
  R.actors.add(R.snake);
  buildShared();
  buildFireFX();
  // selection ring
  R.selRing = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.56, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
  R.selRing.visible = false;
  R.selRing.renderOrder = 2;
  R.actors.add(R.selRing);
  R.camps = new Map(); R.boats = new Map(); R.yards = new Map();
  jetty.clear();
  groundSig = '';
  anim.clear();
}
function inst(geo, mat, n, cast) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = !!cast; m.receiveShadow = true; m.count = 0;
  for (let i = 0; i < n; i++) m.setColorAt(i, _c.setRGB(1, 1, 1));
  R.actors.add(m);
  return m;
}
function buildShared() {
  const L = localTextures();
  const thatch = TX.thatch.clone(); thatch.repeat.set(3, 1.4); thatch.needsUpdate = true;
  const bark = TX.bark.clone(); bark.repeat.set(4, 1); bark.needsUpdate = true;
  SH = {
    bark: new THREE.MeshStandardMaterial({ map: TX.bark, roughness: 0.95 }),
    plank: new THREE.MeshStandardMaterial({ map: TX.plank, roughness: 0.85, side: THREE.DoubleSide }),
    stone: new THREE.MeshStandardMaterial({ color: 0x7a756d, roughness: 0.92 }),
    char: new THREE.MeshStandardMaterial({ color: 0x1d1814, roughness: 1 }),
    ash: new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 1, transparent: true, opacity: 0.85 }),
    clay: new THREE.MeshStandardMaterial({ map: L.clay, roughness: 0.8 }),
    basket: new THREE.MeshStandardMaterial({ map: TX.thatch, color: 0xc8a870, roughness: 0.95, side: THREE.DoubleSide }),
    food: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    fish: new THREE.MeshStandardMaterial({ color: 0x9a8a70, roughness: 0.5, metalness: 0.1 }),
    sailcloth: new THREE.MeshStandardMaterial({ map: L.cloth, color: 0xa89878, roughness: 1, side: THREE.DoubleSide }),
    stoneG: new THREE.DodecahedronGeometry(0.2, 1),
    logG: new THREE.CylinderGeometry(0.13, 0.15, 1.9, 9).rotateZ(Math.PI / 2),
    charG: new THREE.CylinderGeometry(0.07, 0.08, 0.9, 6).rotateZ(Math.PI / 2),
    ashG: new THREE.CircleGeometry(0.62, 20).rotateX(-Math.PI / 2),
    poleG: new THREE.CylinderGeometry(0.05, 0.065, 4.4, 6),
    potG: lathe([[0, 0], [0.16, 0.01], [0.24, 0.12], [0.25, 0.24], [0.2, 0.36], [0.13, 0.42], [0.14, 0.47], [0.12, 0.47]], 16),
    basketG: lathe([[0.4, 0], [0.48, 0.2], [0.55, 0.42]], 16),
    foodG: merge([tint(sphere(0.5, 1, 0.55, 1, 0, 0.12, 0, 14, 8), 0x8a6a3a), tint(sphere(0.1, 1, 1, 1, 0.15, 0.36, 0.1), 0xc8401e), tint(sphere(0.1, 1, 1, 1, -0.12, 0.34, -0.08), 0xe0a020), tint(sphere(0.09, 1, 1, 1, 0.02, 0.4, -0.18), 0x6a8a2a), tint(sphere(0.1, 1.6, 0.5, 0.6, -0.2, 0.3, 0.16), 0x9a8a70)]),
    rackG: merge([cyl(0.04, 0.035, 1.9, -0.9, 0.85, 0, 6).rotateZ(0.12), cyl(0.04, 0.035, 1.9, 0.9, 0.85, 0, 6).rotateZ(-0.12), cyl(0.03, 0.03, 2.1, 0, 0, 0, 6).rotateZ(Math.PI / 2).translate(0, 1.7, 0), cyl(0.04, 0.035, 1.9, -0.9, 0.85, 0.5, 6), cyl(0.04, 0.035, 1.9, 0.9, 0.85, 0.5, 6)]),
    fishG: sphere(0.06, 0.4, 1.0, 0.16, 0, 0, 0, 8, 6),
  };
  // huts: woven walls with a doorway, a thatched roof, the frame poles while it goes up, and a door cloth in the camp's color
  const wall = new THREE.CylinderGeometry(1.55, 1.65, 1.35, 18, 1, true, 0.36, Math.PI * 2 - 0.72); wall.translate(0, 0.675, 0);
  const wuv = wall.attributes.uv; for (let i = 0; i < wuv.count; i++) wuv.setX(i, wuv.getX(i) * 6);
  const roof = new THREE.ConeGeometry(2.15, 1.85, 20, 2, true); roof.translate(0, 1.3 + 0.925, 0);
  const ruv = roof.attributes.uv; for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * 5, ruv.getY(i) * 1.6);
  const frame = [];
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + 0.31; frame.push(cyl(0.045, 0.04, 1.5, Math.sin(a) * 1.6, 0.72, Math.cos(a) * 1.6, 5)); }
  for (let i = 0; i < 6; i++) { const r = cyl(0.04, 0.035, 2.3, 0, 0, 0, 5); r.rotateZ(0.77); r.translate(0.8, 2.175, 0); r.rotateY(i / 6 * Math.PI * 2); frame.push(r); }
  const floor = new THREE.CircleGeometry(1.5, 18).rotateX(-Math.PI / 2).translate(0, 0.03, 0);
  const cloth = new THREE.PlaneGeometry(0.62, 1.0, 1, 4).translate(0, 0.62, 1.6);
  R.hutWall = inst(wall, new THREE.MeshStandardMaterial({ map: TX.bark, roughness: 0.95, side: THREE.DoubleSide }), 220, true);
  R.hutRoof = inst(roof, new THREE.MeshStandardMaterial({ map: TX.thatch, roughness: 0.95, side: THREE.DoubleSide }), 220, true);
  R.hutFrame = inst(merge(frame), new THREE.MeshStandardMaterial({ map: TX.bark, roughness: 0.95 }), 220, true);
  R.hutFloor = inst(floor, new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 1 }), 220, false);
  R.hutCloth = inst(cloth, new THREE.MeshStandardMaterial({ map: L.cloth, roughness: 0.9, side: THREE.DoubleSide }), 220, false);
  // farms: tilled soil and rows of crops
  R.farm = inst(new THREE.BoxGeometry(4.2, 0.06, 3.2), new THREE.MeshStandardMaterial({ map: L.soil, roughness: 1, normalMap: TX.detailN, normalScale: new THREE.Vector2(1.4, 1.4) }), 120, false);
  const blades = [];
  for (let i = 0; i < 5; i++) { const g = new THREE.PlaneGeometry(0.09, 0.62, 1, 3); const p = g.attributes.position; for (let k = 0; k < p.count; k++) { const y = p.getY(k) + 0.31; p.setZ(k, y * y * 0.35); } g.translate(0, 0.31, 0); g.rotateY(i / 5 * Math.PI * 2); blades.push(g); }
  blades.push(sphere(0.06, 1, 2.2, 1, 0, 0.66, 0, 6, 5));
  R.crop = inst(merge(blades), new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide }), 120 * 20, true);
  // loose salvage on the ground, bodies' stains
  R.crate = inst(new THREE.BoxGeometry(0.6, 0.45, 0.45), new THREE.MeshStandardMaterial({ map: TX.plank, roughness: 0.85 }), 40, true);
  R.stain = inst(new THREE.CircleGeometry(0.75, 18).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a1410, roughness: 0.6, transparent: true, opacity: 0.65, depthWrite: false }), 16, false);
}

/* ---------- fire and smoke particles ---------- */
const FIRE_PER = 44, SMOKE_PER = 22, SLOTS = 16;
const FX = { fire: null, smoke: null, f: [], s: [], lights: [], glows: [] };
function pointsMat(map, additive) {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uMap: { value: map }, uDay: { value: 1 } },
    vertexShader: `uniform float uScale; attribute float aLife; attribute float aSize; varying float vLife; varying float vNear;
      void main(){ vLife = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = max(0.5, -mv.z); vNear = smoothstep(0.8, 4.0, d);
        gl_PointSize = min(aSize * uScale / d, 260.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: additive
      ? `uniform sampler2D uMap; varying float vLife; varying float vNear;
        void main(){ float a = texture2D(uMap, gl_PointCoord).a; vec3 c = mix(vec3(1.0, 0.86, 0.5), vec3(1.0, 0.38, 0.08), smoothstep(0.0, 0.55, vLife)); c = mix(c, vec3(0.55, 0.1, 0.03), smoothstep(0.6, 1.0, vLife)); gl_FragColor = vec4(c * 1.35, a * (1.0 - vLife) * 0.55 * vNear); }`
      : `uniform sampler2D uMap; uniform float uDay; varying float vLife; varying float vNear;
        void main(){ float a = texture2D(uMap, gl_PointCoord).a; vec3 c = vec3(0.62, 0.6, 0.58) * (0.18 + 0.82 * uDay); gl_FragColor = vec4(c, a * smoothstep(0.0, 0.15, vLife) * (1.0 - vLife) * 0.75 * vNear); }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}
function makePoints(n, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false;
  R.actors.add(p);
  return p;
}
function buildFireFX() {
  FX.fire = makePoints(FIRE_PER * SLOTS, pointsMat(TX.glow, true));
  FX.smoke = makePoints(SMOKE_PER * SLOTS, pointsMat(TX.smoke, false));
  FX.fire.renderOrder = 3; FX.smoke.renderOrder = 4;
  FX.f = []; FX.s = [];
  for (let i = 0; i < FIRE_PER * SLOTS; i++) FX.f.push({ age: Math.random(), life: 0.6 + Math.random() * 0.6, ox: 0, oz: 0, vy: 1, s: 1 });
  for (let i = 0; i < SMOKE_PER * SLOTS; i++) FX.s.push({ age: Math.random() * 6, life: 5 + Math.random() * 4, ox: 0, oz: 0, vy: 1, s: 1 });
  FX.lights = []; FX.glows = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffa458, 0, 22, 1.8); R.actors.add(l); FX.lights.push(l);
  }
  for (let i = 0; i < SLOTS; i++) {
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow, color: 0xff8a30, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    g.scale.setScalar(3.2); g.visible = false; R.actors.add(g); FX.glows.push(g);
  }
}
const fireSlots = [];          // {x, y, z, s, smoke: [{x,z,k}], storm}
function updateFireFX(dt, time) {
  const fp = FX.fire.geometry.attributes, sp = FX.smoke.geometry.attributes;
  const wind = U.uWind.value;
  for (let k = 0; k < SLOTS; k++) {
    const F = fireSlots[k];
    for (let i = k * FIRE_PER; i < (k + 1) * FIRE_PER; i++) {
      const q = FX.f[i];
      q.age += dt;
      if (q.age > q.life) {
        q.age = 0; q.life = 0.45 + Math.random() * 0.65;
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 0.38;
        q.ox = Math.cos(a) * r; q.oz = Math.sin(a) * r; q.vy = 0.9 + Math.random() * 0.9; q.s = 0.5 + Math.random() * 0.6;
      }
      if (!F) { fp.aSize.array[i] = 0; continue; }
      const t = q.age / q.life, sc = F.s;
      fp.position.array[i * 3] = F.x + (q.ox * (1 - t * 0.7) + Math.sin(time * 9 + i) * 0.04 * t + wind * 0.1 * t) * sc;
      fp.position.array[i * 3 + 1] = F.y + 0.15 + q.age * q.vy * sc;
      fp.position.array[i * 3 + 2] = F.z + (q.oz * (1 - t * 0.7) + Math.cos(time * 7 + i) * 0.04 * t) * sc;
      fp.aLife.array[i] = t;
      fp.aSize.array[i] = q.s * sc * (1 - t * 0.6) * 0.62;
    }
    for (let i = k * SMOKE_PER; i < (k + 1) * SMOKE_PER; i++) {
      const q = FX.s[i];
      q.age += dt;
      if (q.age > q.life) {
        q.age = 0; q.life = 5 + Math.random() * 5;
        q.ox = (Math.random() - 0.5) * 0.4; q.oz = (Math.random() - 0.5) * 0.4; q.vy = 0.55 + Math.random() * 0.45; q.s = 0.8 + Math.random() * 0.8;
        q.src = F && F.smoke.length ? F.smoke[Math.floor(Math.random() * F.smoke.length)] : null;
      }
      if (!F || !q.src) { sp.aSize.array[i] = 0; continue; }
      const t = q.age / q.life, src = q.src;
      sp.position.array[i * 3] = src.x + q.ox + q.age * (0.35 + wind * 0.55) + Math.sin(time * 0.7 + i) * 0.3 * t;
      sp.position.array[i * 3 + 1] = src.y + 0.6 + q.age * q.vy * (1 - t * 0.35);
      sp.position.array[i * 3 + 2] = src.z + q.oz + Math.cos(time * 0.5 + i) * 0.3 * t;
      sp.aLife.array[i] = t;
      sp.aSize.array[i] = (0.9 + t * 3.8) * q.s * src.k;
    }
  }
  for (const a of [fp.position, fp.aLife, fp.aSize, sp.position, sp.aLife, sp.aSize]) a.needsUpdate = true;
  const scale = T.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(T.camera.fov) / 2));
  FX.fire.material.uniforms.uScale.value = scale; FX.smoke.material.uniforms.uScale.value = scale;
  FX.smoke.material.uniforms.uDay.value = env.day;
}

/* ---------- camps ---------- */
function makeCamp(g0) {
  const g = new THREE.Group();
  for (let i = 0; i < 11; i++) { const a = i / 11 * Math.PI * 2, s = new THREE.Mesh(SH.stoneG, SH.stone); s.position.set(Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75); s.scale.set(1, 0.7, 1.1); s.rotation.y = a; s.castShadow = true; g.add(s); }
  const ash = new THREE.Mesh(SH.ashG, SH.ash); ash.position.y = 0.03; g.add(ash);
  const chars = new THREE.Group();
  for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(SH.charG, SH.char); l.rotation.y = i * 0.8; l.rotation.z = 0.25; l.position.set(Math.cos(i * 0.8) * 0.1, 0.16, Math.sin(i * 0.8) * 0.1); chars.add(l); }
  g.add(chars);
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.5, l = new THREE.Mesh(SH.logG, SH.bark); l.position.set(Math.cos(a) * 2.3, 0.14, Math.sin(a) * 2.3); l.rotation.y = -a + Math.PI / 2; l.castShadow = true; l.receiveShadow = true; g.add(l); }
  const pole = new THREE.Mesh(SH.poleG, SH.bark); pole.position.set(-2.6, 2.2, -1.2); pole.castShadow = true; g.add(pole);
  const flagG = new THREE.PlaneGeometry(1.4, 0.85, 10, 4); flagG.translate(0.7, 0, 0);
  const flagMat = new THREE.MeshStandardMaterial({ map: localTextures().cloth, color: new THREE.Color(CAMP_HEX[g0.color % 8]), roughness: 0.9, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(flagG, flagMat); flag.position.set(-2.6, 3.95, -1.2); flag.castShadow = true; g.add(flag);
  const basket = new THREE.Mesh(SH.basketG, SH.basket); basket.position.set(2.7, 0, 1.2); basket.castShadow = true; g.add(basket);
  const food = new THREE.Mesh(SH.foodG, SH.food); food.position.set(2.7, 0.05, 1.2); food.castShadow = true; g.add(food);
  const pots = new THREE.Group();
  for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(SH.potG, SH.clay); p.position.set(3.4 + (i % 2) * 0.6, 0, 0.1 + Math.floor(i / 2) * 0.62 - (i % 2) * 0.1); p.scale.setScalar(0.85 + (i % 3) * 0.15); p.castShadow = true; pots.add(p); }
  g.add(pots);
  const rack = new THREE.Group();
  const frame = new THREE.Mesh(SH.rackG, SH.bark); frame.castShadow = true; rack.add(frame);
  for (let i = 0; i < 7; i++) { const f = new THREE.Mesh(SH.fishG, SH.fish); f.position.set(-0.75 + i * 0.25, 1.48, 0.02); f.rotation.y = Math.PI / 2; rack.add(f); }
  rack.position.set(-1.6, 0, 2.2); rack.rotation.y = 0.5;
  g.add(rack);
  R.actors.add(g);
  return { g, flag, flagMat, base: Float32Array.from(flagG.attributes.position.array), food, basket, pots, rack, chars, ash };
}
function updateCamps(dt, time) {
  const W = S.W, seen = new Set();
  fireSlots.length = 0;
  const lit = [];
  for (const g of W.groups) {
    if (g.dead) continue;
    seen.add(g.id);
    let o = R.camps.get(g.id);
    if (!o) { o = makeCamp(g); R.camps.set(g.id, o); }
    const gy = groundY(g.x, g.z);
    o.g.position.set(g.x, gy, g.z);
    o.flagMat.color.set(CAMP_HEX[g.color % 8]);
    const fp = o.flag.geometry.attributes.position;
    const wind = U.uWind.value;
    for (let i = 0; i < fp.count; i++) { const bx = o.base[i * 3], by = o.base[i * 3 + 1]; fp.array[i * 3 + 2] = Math.sin(time * (3 + wind) - bx * 3.2 + g.id) * 0.13 * bx * (0.6 + wind * 0.4); fp.array[i * 3 + 1] = by - bx * bx * 0.05 * Math.max(0, 1.2 - wind); }
    fp.needsUpdate = true;
    o.flag.geometry.computeVertexNormals();
    const st0 = clamp(Math.cbrt(Math.max(0, g.store)) * 0.32, 0, 1.25);
    o.food.visible = g.store > 0.5; o.food.scale.set(st0, st0, st0);
    o.pots.visible = !!(g.tk && g.tk.pot);
    o.rack.visible = !!(g.tk && g.tk.smoke);
    o.chars.visible = g.fire.ever;
    const s = 0.55 + 0.65 * clamp(g.fire.fuel / 60, 0.15, 1);
    if (g.fire.lit) {
      const d = T.camera.position.distanceTo(o.g.position);
      lit.push({ g, d, x: g.x, y: gy, z: g.z, s });
    }
  }
  for (const [id, o] of R.camps) if (!seen.has(id)) { R.actors.remove(o.g); o.flag.geometry.dispose(); o.flagMat.dispose(); R.camps.delete(id); }
  lit.sort((a, b) => a.d - b.d);
  for (let k = 0; k < SLOTS; k++) {
    const f = lit[k];
    const gl = FX.glows[k];
    if (!f) { gl.visible = false; continue; }
    const smoke = [{ x: f.x, y: f.y, z: f.z, k: 1 + env.storm * 0.4 }];
    if (f.g.tk && f.g.tk.smoke) { const o = R.camps.get(f.g.id); _v.set(0, 1.2, 0); o.rack.localToWorld(_v); smoke.push({ x: _v.x, y: f.y, z: _v.z, k: 0.8 }); }
    fireSlots[k] = { x: f.x, y: f.y, z: f.z, s: f.s, smoke };
    gl.visible = true;
    gl.position.set(f.x, f.y + 0.7, f.z);
    gl.material.opacity = (0.25 + 0.55 * env.night) * (0.85 + 0.15 * Math.sin(time * 13 + k));
    gl.scale.setScalar(2.6 + f.s * 1.6);
  }
  for (let i = 0; i < FX.lights.length; i++) {
    const l = FX.lights[i], f = lit[i];
    if (!f || f.d > 160) { l.intensity = 0; continue; }
    const flick = 0.82 + 0.1 * Math.sin(time * 11.3 + i) + 0.08 * Math.sin(time * 23.1 + i * 2);
    l.position.set(f.x, f.y + 1.1, f.z);
    l.intensity = (2.5 + 13 * env.night) * f.s * flick;
  }
}

/* ---------- huts, farms, salvage ---------- */
function hutColor(h, g, out) {
  if (!h.done) return srgb(out, 0.95, 0.9, 0.82);
  if (g && !g.dead) return out.setRGB(1, 1, 1);
  return srgb(out, 0.62, 0.6, 0.58);
}
const _m = new THREE.Matrix4();
function compose(out, x, y, z, ry, sx, sy, sz) { _q.setFromAxisAngle(UP, ry); return out.compose(_v.set(x, y, z), _q, _s.set(sx, sy == null ? sx : sy, sz == null ? sx : sz)); }
function updateStructures() {
  const W = S.W;
  // fruit and berries that are left
  let q = 0;
  W.trees.forEach((t, i) => {
    const sl = R.fruitSlots[i], vis = Math.floor(t.f);
    if (!sl) return;
    for (let k = 0; k < sl.length; k++) R.fruit.setMatrixAt(q++, k < vis ? compose(_m, sl[k][0], sl[k][1], sl[k][2], 0, 1) : ZERO);
  });
  R.fruit.instanceMatrix.needsUpdate = true;
  q = 0;
  W.bushes.forEach((b, i) => {
    const vis = Math.floor(b.f), by = groundH(b.x, b.z);
    for (let k = 0; k < 5; k++) { const a = k * 1.256 + i; R.berry.setMatrixAt(q++, k < vis ? compose(_m, b.x + Math.cos(a) * 0.5, by + 0.62 + (k % 2) * 0.2, b.z + Math.sin(a) * 0.45, 0, 1) : ZERO); }
  });
  R.berry.instanceMatrix.needsUpdate = true;
  let n = 0;
  const cap = R.hutWall.instanceMatrix.count;
  let nf = 0;
  for (const h of W.huts) {
    if (n >= cap) break;
    const g = S.groupById(h.g), y = groundY(h.x, h.z) - 0.05, prog = h.done ? 1 : clamp(h.prog, 0, 1), r = h.r || 0;
    const abandoned = h.done && (!g || g.dead);
    compose(_m, h.x, y, h.z, r, 1, Math.max(0.02, h.done ? 1 : prog * 0.95), 1);
    R.hutWall.setMatrixAt(n, _m); R.hutWall.setColorAt(n, hutColor(h, g, _c));
    const rp = h.done ? 1 : smoothstep(0.55, 1, prog);
    compose(_m, h.x, y + (abandoned ? -0.25 : 0), h.z, r, rp > 0.01 ? 1 : 0, rp * (abandoned ? 0.82 : 1), rp > 0.01 ? 1 : 0);
    R.hutRoof.setMatrixAt(n, _m); R.hutRoof.setColorAt(n, abandoned ? srgb(_c, 0.55, 0.5, 0.45) : _c.setRGB(1, 1, 1));
    R.hutFrame.setMatrixAt(n, h.done ? ZERO : compose(_m, h.x, y, h.z, r, 1));
    R.hutFloor.setMatrixAt(n, compose(_m, h.x, y, h.z, r, 1));
    if (h.done && g && !g.dead) { R.hutCloth.setMatrixAt(nf, compose(_m, h.x, y, h.z, r, 1)); R.hutCloth.setColorAt(nf, campCols[g.color % 8]); nf++; }
    n++;
  }
  for (const m of [R.hutWall, R.hutRoof, R.hutFrame, R.hutFloor]) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  R.hutCloth.count = nf; R.hutCloth.instanceMatrix.needsUpdate = true; if (R.hutCloth.instanceColor) R.hutCloth.instanceColor.needsUpdate = true;
  n = 0; let nc = 0;
  const ccap = R.crop.instanceMatrix.count;
  for (const f of W.farms) {
    if (n >= R.farm.instanceMatrix.count) break;
    const y = groundY(f.x, f.z), r = f.r || 0;
    R.farm.setMatrixAt(n, compose(_m, f.x, y + 0.01, f.z, r, 1));
    R.farm.setColorAt(n, W.wx.drought > 0 ? srgb(_c, 1.15, 1.05, 0.9) : _c.setRGB(1, 1, 1));
    n++;
    if (!f.planted) continue;
    const gr = clamp(f.grow, 0, 1), gsc = 0.15 + 0.85 * gr;
    srgb(_c, lerp(0.35, 0.86, smoothstep(0.55, 1, gr)), lerp(0.62, 0.7, gr), lerp(0.22, 0.28, gr));
    if (W.wx.drought > 0) _c.lerp(srgb(_c2, 0.7, 0.6, 0.35), 0.5);
    for (let i = 0; i < 20 && nc < ccap; i++) {
      const lx = ((i % 5) - 2) * 0.78 + (hash01(f.id * 31 + i) - 0.5) * 0.2, lz = (Math.floor(i / 5) - 1.5) * 0.72;
      const x = f.x + Math.cos(r) * lx + Math.sin(r) * lz, z = f.z - Math.sin(r) * lx + Math.cos(r) * lz;
      R.crop.setMatrixAt(nc, compose(_m, x, y + 0.04, z, i * 1.7 + f.id, gsc * (0.85 + hash01(i + f.id) * 0.3)));
      R.crop.setColorAt(nc, _c);
      nc++;
    }
  }
  R.farm.count = n; R.farm.instanceMatrix.needsUpdate = true; if (R.farm.instanceColor) R.farm.instanceColor.needsUpdate = true;
  R.crop.count = nc; R.crop.instanceMatrix.needsUpdate = true; if (R.crop.instanceColor) R.crop.instanceColor.needsUpdate = true;
  n = 0;
  for (const it of W.items) { if (it.owner || n >= R.crate.instanceMatrix.count) continue; R.crate.setMatrixAt(n++, compose(_m, it.x, groundY(it.x, it.z) + 0.2, it.z, it.id, 1)); }
  R.crate.count = n; R.crate.instanceMatrix.needsUpdate = true;
  updateYards();
  checkGround();
}
const _c2 = new THREE.Color();
// boats taking shape at the docks
function updateYards() {
  const W = S.W;
  for (const isl of [1, 2, 3]) {
    const y = W.yards && W.yards[isl], d = W.docks && W.docks[isl];
    let o = R.yards.get(isl);
    if (!y || !d || y < 0.02 || W.boats.some(b => !b.sail && b.isl === isl && Math.hypot(b.x - d.x, b.z - d.z) < 2)) { if (o) o.visible = false; continue; }
    if (!o) { o = makeBoatMesh(false, true); R.yards.set(isl, o); }
    o.visible = true;
    const p = clamp(y, 0.1, 1);
    o.position.set(d.x, groundY(d.x, d.z) + 0.25, d.z);
    o.rotation.y = 0.6 + isl;
    o.userData.hull.scale.set(1, 1, p);
    o.userData.ribs.visible = p < 0.95;
  }
}
// worn earth around camps and paths between camps that trade
let groundSig = '';
function checkGround() {
  const W = S.W;
  const camps = W.groups.filter(g => !g.dead).map(g => ({ x: g.x, z: g.z }));
  const paths = [];
  for (const k in W.routes || {}) {
    const r = W.routes[k];
    if (r.n < 5) continue;
    const a = S.groupById(r.a), b = S.groupById(r.b);
    if (!a || !b || a.dead || b.dead || a.isl !== b.isl) continue;
    paths.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
  const sig = camps.map(c => c.x.toFixed(0) + ',' + c.z.toFixed(0)).join(';') + '|' + paths.map(p => p.ax.toFixed(0) + p.bx.toFixed(0)).join(';');
  if (sig === groundSig) return;
  groundSig = sig;
  paintGround(camps, paths);
}

/* ---------- boats ---------- */
function makeBoatMesh(rig, yard) {
  const g = new THREE.Group();
  const hullG = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const hp = hullG.attributes.position;
  for (let i = 0; i < hp.count; i++) { const z = hp.getZ(i); hp.setX(i, hp.getX(i) * (1 - 0.35 * z * z)); }
  hullG.scale(0.48, 0.42, 1.75); hullG.computeVertexNormals();
  const hull = new THREE.Mesh(hullG, SH.plank); hull.position.y = 0.38; hull.castShadow = true; hull.receiveShadow = true;
  const hullWrap = new THREE.Group(); hullWrap.add(hull);
  for (const z of [-0.6, 0.4]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.16), SH.plank); t.position.set(0, 0.3, z); hullWrap.add(t); }
  g.add(hullWrap);
  g.userData.hull = hullWrap;
  if (yard) {
    const ribs = new THREE.Group();
    for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.03, 4, 10, Math.PI), SH.bark); r.rotation.z = Math.PI; r.position.set(0, 0.45, -1.3 + i * 0.52); ribs.add(r); }
    g.add(ribs); g.userData.ribs = ribs;
  }
  if (rig) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 3.1, 6), SH.bark); mast.position.set(0, 1.85, 0.45); mast.castShadow = true; g.add(mast);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.7, 5).rotateX(Math.PI / 2), SH.bark); boom.position.set(0, 0.75, -0.35); g.add(boom);
    const sailG = new THREE.PlaneGeometry(1.7, 2.5, 6, 8);
    const sp0 = sailG.attributes.position;
    for (let i = 0; i < sp0.count; i++) { const t = (sp0.getY(i) + 1.25) / 2.5, xx = sp0.getX(i); sp0.setX(i, (xx + 0.85) * (1 - 0.62 * t) - 0.85 + t * 0.2); }
    sailG.rotateY(Math.PI / 2); sailG.translate(0, 2.0, -0.4);
    const sail = new THREE.Mesh(sailG, SH.sailcloth); sail.castShadow = true; g.add(sail);
    g.userData.sail = sail; g.userData.sailBase = Float32Array.from(sailG.attributes.position.array);
  } else {
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 1.3), SH.bark); paddle.position.set(0.3, 0.4, -0.2); paddle.rotation.z = 0.2; g.add(paddle);
  }
  R.actors.add(g);
  return g;
}
const boatPos = new Map();
// a beached boat ties up alongside its island's jetty, which points at the deepest water nearby (as world.mjs builds it)
const jetty = new Map();
function mooring(isl) {
  let m = jetty.get(isl);
  const d = S.W.docks && S.W.docks[isl];
  if (!d) return null;
  if (m && m.x0 === d.x && m.z0 === d.z) return m;
  let best = 0, bd = 0;
  for (let a = 0; a < 16; a++) { const an = a / 16 * Math.PI * 2, h = groundH(d.x + Math.cos(an) * 8, d.z + Math.sin(an) * 8); if (-h > bd) { bd = -h; best = an; } }
  const ax = Math.cos(best), az = Math.sin(best);
  m = { x0: d.x, z0: d.z, x: d.x + ax * 4.5 - az * 1.75, z: d.z + az * 4.5 + ax * 1.75, dir: best };
  jetty.set(isl, m);
  return m;
}
function updateBoats(time) {
  const W = S.W, seen = new Set();
  boatPos.clear();
  for (const b of W.boats) {
    seen.add(b.id);
    let g = R.boats.get(b.id);
    if (g && g.userData.rig !== !!b.rig) { R.actors.remove(g); R.boats.delete(b.id); g = null; }
    if (!g) { g = makeBoatMesh(!!b.rig, false); g.userData.rig = !!b.rig; R.boats.set(b.id, g); }
    const pos = ip(prevB, b);
    const bob = Math.sin(time * 1.3 + b.id) * 0.06 + Math.sin(time * 2.1 + b.id * 3) * 0.03;
    let dir = pos.dir;
    if (!b.sail) {
      const m = mooring(b.isl);
      if (m && Math.hypot(b.x - m.x0, b.z - m.z0) < 3) { pos.x = m.x; pos.z = m.z; dir = m.dir; }
      else { const o = S.ISLES[S.nearestIsle(b.isl)]; dir = Math.atan2(o.z - b.z, o.x - b.x); }
    }
    const y = b.sail ? bob : Math.max(bob * 0.5 - 0.05, groundH(pos.x, pos.z) - 0.12);
    g.position.set(pos.x, y, pos.z);
    g.rotation.set(b.sail ? Math.sin(time * 1.1 + b.id) * 0.04 : 0, Math.PI / 2 - dir, b.sail ? Math.sin(time * 1.7 + b.id) * 0.06 : 0.04, 'YXZ');
    boatPos.set(b.id, { x: pos.x, y, z: pos.z, dir, sail: !!b.sail });
    if (g.userData.sail) {
      const sp = g.userData.sail.geometry.attributes.position, base = g.userData.sailBase, w = b.sail ? 0.35 + U.uWind.value * 0.15 : 0.05;
      for (let i = 0; i < sp.count; i++) { const zz = base[i * 3 + 2] + 0.4, yy = base[i * 3 + 1] - 2.0; sp.array[i * 3] = base[i * 3] + w * Math.sin((zz + 0.85) / 1.7 * Math.PI) * (1 - Math.abs(yy) / 1.6) + Math.sin(time * 3 + zz * 2 + yy) * 0.02; }
      sp.needsUpdate = true;
      g.userData.sail.geometry.computeVertexNormals();
      g.userData.sail.visible = !!b.sail;
    }
  }
  for (const [id, g] of R.boats) if (!seen.has(id)) { R.actors.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); R.boats.delete(id); }
}

/* ---------- people ---------- */
export const RL = new Map();          // id -> render record { p, x, y, z, size, hidden }
export const renderList = [];
const _base = new THREE.Matrix4();
const hutById = new Map();
function sleepHidden(p) {
  if (!p.home) return false;
  const h = hutById.get(p.home);
  return !!(h && h.done && Math.hypot(h.x - p.x, h.z - p.z) < 2.6);
}
function faceAngle(x, z, tx, tz) { return Math.PI / 2 - Math.atan2(tz - z, tx - x); }
function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
const tmpPose = new Float32Array(NCH);
const SPREAD = { farm: 1.6, eat: 1.1, stock: 1.1, salvage: 1.4, craft: 0.9, idle: 0.9, council: 1.2, mourn: 0.8, build: 0.7, shelter: 0.9 };
const ctx = { time: 0, a: 0, moving: false, dead: false, atCamp: false, day: true, hasAxe: false, hasSpear: false, paddle: false, carry: false };
function updatePeople(dt, time) {
  const W = S.W;
  for (const k of PARTS) cnt[k] = 0;
  renderList.length = 0;
  RL.clear();
  hutById.clear();
  for (const h of W.huts) hutById.set(h.id, h);
  const leaders = new Set(W.groups.filter(g => !g.dead && g.leader).map(g => g.leader));
  const camps = W.groups.filter(g => !g.dead);
  const owned = new Map();
  for (const it of W.items) if (it.owner) { const s = owned.get(it.owner) || owned.set(it.owner, new Set()).get(it.owner); s.add(it.k); }
  ctx.time = time; ctx.day = env.day > 0.4;
  const camPos = T.camera.position;
  let drawn = 0;
  const seen = new Set();
  for (const p of W.people) {
    const a = S.ageY(p);
    const A = p.act;
    const riding = A && A.k === 'ride';
    const pos = ip(prevP, p);
    let x = pos.x, z = pos.z;
    const off = smooth.get(p.id);
    if (off) { x += off[0]; z += off[1]; }
    const kid = clamp(0.32 + 0.68 * a / 16, 0.3, 1);
    const size = 1.75 * (0.9 + 0.2 * p.g.size) * (p.sex === 'F' ? 0.95 : 1) * kid;
    const sc = size / 1.75;
    let y = groundY(x, z);
    const bp = riding ? boatPos.get(A.boat) : null;
    if (bp) y = bp.y + 0.16;
    const hidden = !!(p.sleeping && sleepHidden(p));
    const rec = { p, x, y: y + size * 1.02, z, size, hidden, gy: y };
    RL.set(p.id, rec);
    seen.add(p.id);
    if (hidden) continue;
    renderList.push(rec);
    if (drawn >= CAP - 16) continue;
    // far away people still count, but skip the expensive rig when they are tiny on screen
    const dCam = Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z);
    let an = anim.get(p.id);
    if (!an) { an = { pose: new Float32Array(NCH), ph: Math.random() * 6, key: '', kt: 9, yaw: Math.PI / 2 - pos.dir, walkW: 0 }; anim.set(p.id, an); targetPose(p, A, an.pose, ctxFor(p, a, false, owned)); }
    const speed = riding ? 0 : pos.moved / STEP_SEC;
    const moving = speed > 0.12 && !p.sleeping;
    // the sim sends everyone working a field or a tree to the same point; spread them out a little while they stay put
    if (!riding && A && SPREAD[A.k]) {
      const h = hash01(p.id * 53 + 7) * Math.PI * 2, r = SPREAD[A.k] * (0.45 + 0.55 * hash01(p.id * 29)), w = 1 - an.walkW;
      x += Math.cos(h) * r * w; z += Math.sin(h) * r * w;
      y = groundY(x, z); rec.x = x; rec.z = z; rec.y = y + size * 1.02; rec.gy = y;
    }
    ctxFor(p, a, moving, owned);
    ctx.paddle = !!(riding && bp && bp.sail && W.boats.find(b => b.id === A.boat && b.sail && !b.rig));
    // which way to face
    let yaw = Math.PI / 2 - pos.dir;
    if (!moving && A) {
      const other = A.who || A.with || 0;
      const o = other && S.getP(other);
      if (o && Math.hypot(o.x - p.x, o.z - p.z) < 5) yaw = faceAngle(x, z, o.x, o.z);
      else if ((A.k === 'build' || A.k === 'farm' || A.k === 'fish') && A.tx != null && Math.hypot(A.tx - x, A.tz - z) > 0.3) yaw = A.k === 'fish' ? yaw : faceAngle(x, z, A.tx, A.tz);
      else if (ctx.atCamp && ctx.campG) yaw = faceAngle(x, z, ctx.campG.x, ctx.campG.z);
    }
    an.yaw += wrapA(yaw - an.yaw) * (1 - Math.exp(-dt * (moving ? 10 : 4)));
    // pose: blend toward the target, quickly while an action holds, slowly when it changes
    const key = (A ? A.k + (A.ph || '') : '') + (moving ? 'm' : 's') + (p.sleeping ? 'z' : '');
    if (key !== an.key) { an.key = key; an.kt = 0; }
    an.kt += dt;
    const tool = targetPose(p, A, tmpPose, ctx);
    const run = speed > 2.3;
    an.walkW += ((moving ? 1 : 0) - an.walkW) * (1 - Math.exp(-dt * 6));
    if (moving) an.ph += dt * clamp(speed / (0.62 * sc) * Math.PI * 0.5, 3.2, 13);
    if (an.walkW > 0.01) addGait(tmpPose, an.ph, an.walkW, run, ctx);
    const rate = an.kt < 0.9 ? 4.5 : 20;
    const kk = 1 - Math.exp(-dt * rate);
    for (let i = 0; i < NCH; i++) an.pose[i] += (tmpPose[i] - an.pose[i]) * kk;
    if (dCam > 260) continue;
    const of = outfit(p, a, false);
    const extra = { leader: leaders.has(p.id), preg: p.preg && W.t > p.preg.due - 96 ? clamp((W.t - (p.preg.due - 96)) / 96, 0, 1) : 0, spearPitch: A && A.k === 'fish' && !moving ? 0.5 + 0.4 * Math.max(0, Math.sin(time * 1.4 + p.id + 1.2)) ** 6 : moving && A && A.k === 'hunt' ? -0.1 : -1.15 };
    drawRig(p, x, y, z, an.yaw, sc, an.pose, a, of, tool, extra);
    drawn++;
  }
  for (const id of anim.keys()) if (!seen.has(id)) anim.delete(id);
  drawBodies();
  flush(PARTS);
  if (smooth.size) { const k = Math.exp(-dt * 2.2); for (const [id, o] of smooth) { o[0] *= k; o[1] *= k; if (Math.abs(o[0]) + Math.abs(o[1]) < 0.02) smooth.delete(id); } }
}
function ctxFor(p, a, moving, owned) {
  ctx.a = a; ctx.moving = moving; ctx.dead = false;
  const g = S.grpOf(p);
  ctx.campG = g;
  ctx.atCamp = !!(g && Math.hypot(g.x - p.x, g.z - p.z) < 7);
  const own = owned.get(p.id);
  ctx.hasAxe = !!(own && (own.has('axe') || own.has('saxe')));
  ctx.hasSpear = !!(own && own.has('spear'));
  const A = p.act;
  ctx.carry = !!(A && (A.ph === 'deliver' || A.ph === 'fetch'));
  ctx.paddle = false;
  return ctx;
}
// the dead lie where they fell until someone finds them
const deadPose = new Float32Array(NCH);
function drawBodies() {
  const W = S.W;
  let n = 0;
  for (const b of W.bodies) {
    if (n >= R.stain.instanceMatrix.count || (b.found && W.t - b.t > 12)) continue;
    const a = W.arch[b.id] || { id: b.id, sex: 'M', g: { skin: 0.5, hair: 0.3, size: 0.5, str: 0.5 }, born: W.t - 30 * S.HPY, prof: '' };
    const age = (b.t - a.born) / S.HPY;
    const y = groundY(b.x, b.z);
    ctx.dead = true; ctx.moving = false; ctx.a = age;
    targetPose(a, null, deadPose, ctx);
    const of = outfit(a, age, true);
    const sc = (0.9 + 0.2 * ((a.g && a.g.size) || 0.5)) * clamp(0.32 + 0.68 * age / 16, 0.3, 1);
    drawRig(a, b.x, y, b.z, hash01(b.id) * 6.283, sc, deadPose, age, of, '', { dead: true });
    R.stain.setMatrixAt(n, compose(_m, b.x, y + 0.03, b.z, 0, 0.9 + hash01(b.id * 3) * 0.5));
    n++;
  }
  ctx.dead = false;
  R.stain.count = n; R.stain.instanceMatrix.needsUpdate = true;
}

/* ---------- animals and snakes ---------- */
const animPh = new Map();
function updateAnimals(dt, time) {
  const W = S.W, camPos = T.camera.position;
  const nb = { boar: 0, goat: 0 }, nl = { boar: 0, goat: 0 };
  for (const a of W.animals) {
    const M = R.an[a.sp];
    if (!M || nb[a.sp] >= M.body.instanceMatrix.count) continue;
    const pos = ip(prevA, a);
    if (Math.hypot(pos.x - camPos.x, pos.z - camPos.z) > 320) continue;
    const speed = pos.moved / STEP_SEC;
    let ph = animPh.get(a.id) || hash01(a.id) * 6;
    if (speed > 0.08) { ph += dt * clamp(speed * 4, 4, 16); animPh.set(a.id, ph); }
    const young = clamp((W.t - (a.born || 0)) / (S.HPY * 0.5), 0.55, 1);
    const sc = (a.sp === 'goat' ? 0.95 : 1) * young * (0.9 + hash01(a.id * 7) * 0.2);
    const y = groundY(pos.x, pos.z);
    const yaw = Math.PI / 2 - pos.dir;
    const graze = speed < 0.08 ? Math.max(0, Math.sin(time * 0.4 + a.id)) : 0;
    _q.setFromAxisAngle(UP, yaw);
    _base.compose(_v.set(pos.x, y + (speed > 0.08 ? Math.abs(Math.sin(ph)) * 0.04 : 0), pos.z), _q, _s.set(sc, sc, sc));
    if (graze > 0.3) _base.multiply(_lm.makeRotationX(graze * 0.12));
    const i = nb[a.sp]++;
    M.body.setMatrixAt(i, _base);
    const h = hash01(a.id * 13);
    if (a.sp === 'goat') M.body.setColorAt(i, h < 0.5 ? _c.setRGB(1, 1, 1) : h < 0.8 ? srgb(_c, 0.72, 0.58, 0.42) : srgb(_c, 0.35, 0.32, 0.3));
    else M.body.setColorAt(i, h < 0.6 ? _c.setRGB(1, 1, 1) : srgb(_c, 0.7, 0.62, 0.56));
    const L = LEGS[a.sp], sw = speed > 0.08 ? Math.sin(ph) * 0.6 : 0;
    for (let k = 0; k < 4; k++) {
      const lx = k & 1 ? L.x : -L.x, lz = k & 2 ? L.z : -L.z, s = (k === 0 || k === 3) ? sw : -sw;
      child(_pm, _base, lx, L.y, lz, -s, 0, 0);
      M.legs.setMatrixAt(nl[a.sp]++, _pm);
    }
  }
  for (const k in R.an) {
    const M = R.an[k];
    M.body.count = nb[k]; M.legs.count = nl[k];
    M.body.instanceMatrix.needsUpdate = true; M.legs.instanceMatrix.needsUpdate = true;
    if (M.body.instanceColor) M.body.instanceColor.needsUpdate = true;
  }
  let n = 0;
  const c1 = srgb(new THREE.Color(), 0.42, 0.4, 0.2), c2 = srgb(new THREE.Color(), 0.24, 0.2, 0.12), c3 = srgb(new THREE.Color(), 0.6, 0.55, 0.3);
  for (const s of W.snakes) {
    if (n > R.snake.instanceMatrix.count - 16) break;
    const pos = ip(prevS, s);
    const fx = Math.cos(pos.dir), fz = Math.sin(pos.dir), mv = pos.moved > 0.02 ? 1 : 0.3;
    for (let k = 0; k < 16; k++) {
      const wig = Math.sin(time * 6 - k * 0.8) * 0.14 * mv * Math.min(1, k / 3);
      const x = pos.x - fx * k * 0.13 - fz * wig, z = pos.z - fz * k * 0.13 + fx * wig;
      const ang = Math.PI / 2 - pos.dir + Math.cos(time * 6 - k * 0.8) * 0.5 * mv;
      const taper = k === 0 ? 1.25 : 1.05 - k * 0.05;
      R.snake.setMatrixAt(n, compose(_m, x, groundY(x, z) + 0.05 * taper, z, ang, taper));
      R.snake.setColorAt(n, k % 4 === 1 ? c2 : k % 4 === 3 ? c3 : c1);
      n++;
    }
  }
  R.snake.count = n; R.snake.instanceMatrix.needsUpdate = true; if (R.snake.instanceColor) R.snake.instanceColor.needsUpdate = true;
}

/* ---------- per frame ---------- */
let slowT = 0;
export function updateActors(dt, time) {
  slowT -= dt;
  if (slowT <= 0) { slowT = 0.25; updateStructures(); }
  updateBoats(time);
  updatePeople(dt, time);
  updateAnimals(dt, time);
  updateCamps(dt, time);
  updateFireFX(dt, time);
  const r = st.sel && RL.get(st.sel);
  if (r && !r.hidden) {
    R.selRing.visible = true;
    R.selRing.position.set(r.x, r.gy + 0.06, r.z);
    R.selRing.scale.setScalar(r.size / 1.75 + 0.25 + Math.sin(time * 3) * 0.03);
    R.selRing.material.color.set(r.p.grp ? CAMP_HEX[(S.groupById(r.p.grp) || { color: 0 }).color % 8] : '#efe6d6');
  } else R.selRing.visible = false;
}

/* ---------- picking ---------- */
const _p = new THREE.Vector3();
export function project(x, y, z) {
  _p.set(x, y, z).project(T.camera);
  if (_p.z > 1 || _p.z < -1) return null;
  const c = T.renderer.domElement;
  return { x: (_p.x + 1) / 2 * c.clientWidth, y: (1 - _p.y) / 2 * c.clientHeight };
}
export function pickPerson(cx, cy) {
  let best = null, bd = 30;
  for (const r of renderList) {
    const s = project(r.x, r.y - 0.45 * r.size, r.z);
    if (!s) continue;
    const d = Math.hypot(s.x - cx, s.y - cy);
    if (d < bd) { bd = d; best = r.p; }
  }
  return best;
}
