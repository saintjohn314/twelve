/* ===== Twelve viewer: scene ===== */
import * as S from './sim.mjs';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const CAP_P = 240;
const CAMP_HEX = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const NO_CAMP = '#8a847a';
const campHex = g => (g ? CAMP_HEX[g.color % 8] : NO_CAMP);
const personHex = p => campHex(S.grpOf(p));

const st = {
  mode: 'live', ver: -1, seed: 0, season: 0, alpha: 0,
  director: true, sel: 0, follow: false, tab: 'cast',
  lastEvN: 0, seenConf: new Set(), seenEp: 0, cardQ: [], card: null, boost: new Map(),
  shot: null, cam: null, letterbox: false, flashN: 0, bolt: 0, tick: [], tickT: 0, sheetMin: false,
  hover: 0,
};

let renderer, scene, camera, controls, sun, hemi;
const R = {};

/* ---------- three setup ---------- */
function initThree() {
  const canvas = $('#view');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc9d8de, 160, 820);
  camera = new THREE.PerspectiveCamera(46, 1, 0.5, 2600);
  controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.4;
  controls.minDistance = 4;
  controls.maxDistance = 460;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.9;
  if (THREE.TOUCH) controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.addEventListener('start', () => { if (st.director) setDirector(false); st.camTween = null; });
  hemi = new THREE.HemisphereLight(0xd8e8ff, 0x4d3d22, 0.55);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff0d0, 0.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 10; sc.far = 460;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.35;
  scene.add(sun); scene.add(sun.target);
  window.addEventListener('resize', resize);
  resize();
}
function resize() {
  const c = renderer.domElement, w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
  });
}

/* ---------- geometry helpers ---------- */
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
function part(geo, color, t, r, s) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  t = t || [0, 0, 0]; r = r || [0, 0, 0]; s = s || [1, 1, 1];
  const m = new THREE.Matrix4().compose(_v.set(t[0], t[1], t[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(s[0], s[1], s[2]));
  g.applyMatrix4(m);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) { c[i * 3] = _c.r; c[i * 3 + 1] = _c.g; c[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.dispose();
  return g;
}
function merge(parts) {
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}
const VC = () => new THREE.MeshLambertMaterial({ vertexColors: true });
function inst(geo, mat, count, cast, receive) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = !!cast; m.receiveShadow = !!receive;
  m.frustumCulled = false;
  _c.setRGB(1, 1, 1);
  for (let i = 0; i < Math.max(1, count); i++) m.setColorAt(i, _c);
  m.count = 0;
  R.root.add(m);
  return m;
}
const M4 = () => new THREE.Matrix4();
const _m = M4(), _rot = M4(), _sc = M4(), _tr = M4();
function compose(out, x, y, z, ry, sx, sy, sz) {
  _q.setFromAxisAngle(_v.set(0, 1, 0), ry);
  return out.compose(_v.set(x, y, z), _q, _s.set(sx, sy == null ? sx : sy, sz == null ? sx : sz));
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function groundY(x, z) { return Math.max(S.height(x, z), -0.7); }
let waterT = 0;
function waveAt(x, z) { return Math.sin(x * 0.09 + waterT * 1.1) * 0.1 + Math.cos(z * 0.08 + waterT * 1.4) * 0.08; }
function hash(x, z) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }

/* ---------- world build ---------- */
function buildWorld() {
  if (R.root) { scene.remove(R.root); disposeTree(R.root); }
  for (const k in R) delete R[k];
  R.root = new THREE.Group();
  scene.add(R.root);
  buildTerrain();
  buildWater();
  buildSky();
  buildFlora();
  buildWreck();
  buildDynamic();
  st.seed = S.W.seed;
}
function terrainColor(x, z, h, ny, out) {
  let r, g, b;
  if (h < -0.35) {
    const d = clamp(-h / 9, 0, 1);
    r = lerp(0.66, 0.2, d); g = lerp(0.62, 0.36, d); b = lerp(0.46, 0.4, d);
  } else if (h < 0.85) { r = 0.87; g = 0.8; b = 0.6; }
  else {
    const isl = S.islandAt(x, z), f = S.forestAt(x, z);
    if (isl === 2) { r = 0.4; g = 0.62; b = 0.3; } else { r = 0.46; g = 0.6; b = 0.29; }
    if (f > 0.5) { const k = clamp((f - 0.5) * 6, 0, 1); r = lerp(r, 0.28, k); g = lerp(g, 0.44, k); b = lerp(b, 0.21, k); }
    else if (f < 0.44 && h < 6.5) { const k = clamp((0.44 - f) * 7, 0, 1); r = lerp(r, 0.66, k); g = lerp(g, 0.63, k); b = lerp(b, 0.34, k); }
    if (h < 1.4) { const k = (1.4 - h) / 0.55; r = lerp(r, 0.8, k * 0.6); g = lerp(g, 0.75, k * 0.6); b = lerp(b, 0.53, k * 0.6); }
    if (h > 7) { const k = clamp((h - 7) / 4, 0, 1); r = lerp(r, 0.5, k); g = lerp(g, 0.52, k); b = lerp(b, 0.42, k); }
    if (h > 11) { const k = clamp((h - 11) / 3, 0, 1); r = lerp(r, 0.6, k); g = lerp(g, 0.58, k); b = lerp(b, 0.55, k); }
    if (ny < 0.82) { const k = clamp((0.82 - ny) * 3, 0, 1); r = lerp(r, 0.53, k); g = lerp(g, 0.5, k); b = lerp(b, 0.45, k); }
  }
  const j = (hash(x, z) - 0.5) * 0.05;
  out[0] = r + j; out[1] = g + j; out[2] = b + j * 0.6;
}
function buildTerrain() {
  const H = S.heights(), GN = S.GN, GV = S.GV, B = S.B, C = S.CELL;
  const nTri = GN * GN * 2;
  const pos = new Float32Array(nTri * 9), col = new Float32Array(nTri * 9);
  const tc = [0, 0, 0];
  let k = 0;
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const o = k * 9;
    pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az; pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz; pos[o + 6] = cx; pos[o + 7] = cy; pos[o + 8] = cz;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    terrainColor((ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, ny / (Math.hypot(nx, ny, nz) || 1), tc);
    for (let v = 0; v < 3; v++) { col[o + v * 3] = tc[0]; col[o + v * 3 + 1] = tc[1]; col[o + v * 3 + 2] = tc[2]; }
    k++;
  };
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    const x0 = -B + i * C, z0 = -B + j * C, x1 = x0 + C, z1 = z0 + C;
    const h00 = H[j * GV + i], h10 = H[j * GV + i + 1], h01 = H[(j + 1) * GV + i], h11 = H[(j + 1) * GV + i + 1];
    tri(x0, h00, z0, x0, h01, z1, x1, h10, z0);
    tri(x1, h10, z0, x0, h01, z1, x1, h11, z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  R.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(g, R.terrainMat);
  mesh.receiveShadow = true;
  R.root.add(mesh);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshLambertMaterial({ color: 0x1d3d4a }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -9.05;
  R.root.add(floor);
}
function buildWater() {
  const g = new THREE.PlaneGeometry(1800, 1800, 96, 96);
  g.rotateX(-Math.PI / 2);
  R.waterMat = new THREE.MeshPhongMaterial({ color: 0x2b7891, transparent: true, opacity: 0.8, shininess: 80, specular: 0x8ab8cc, flatShading: true });
  R.water = new THREE.Mesh(g, R.waterMat);
  R.root.add(R.water);
  R.waterBase = Float32Array.from(g.attributes.position.array);
}
function buildSky() {
  const n = 1400, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 900, s = Math.sqrt(1 - u * u);
    p[i * 3] = Math.cos(a) * s * r; p[i * 3 + 1] = Math.abs(u) * r * 0.9 + 40; p[i * 3 + 2] = Math.sin(a) * s * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  R.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  R.stars = new THREE.Points(g, R.starMat);
  R.root.add(R.stars);
  const rn = 2600, rp = new Float32Array(rn * 3);
  for (let i = 0; i < rn; i++) { rp[i * 3] = (Math.random() - 0.5) * 170; rp[i * 3 + 1] = Math.random() * 60; rp[i * 3 + 2] = (Math.random() - 0.5) * 170; }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  R.rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0xbcd3e6, size: 0.2, transparent: true, opacity: 0.6, depthWrite: false }));
  R.rain.visible = false;
  R.root.add(R.rain);
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
  R.bolt = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: 0xf7f3ff, transparent: true, opacity: 1, fog: false }));
  R.bolt.visible = false;
  R.root.add(R.bolt);
}
function treeGeos() {
  const conifer = merge([
    part(new THREE.CylinderGeometry(0.12, 0.18, 1.1, 5), 0x5b3f28, [0, 0.55, 0]),
    part(new THREE.ConeGeometry(0.95, 2.2, 6), 0x2f5a35, [0, 1.95, 0]),
    part(new THREE.ConeGeometry(0.7, 1.7, 6), 0x34643a, [0, 2.85, 0]),
  ]);
  const broad = merge([
    part(new THREE.CylinderGeometry(0.14, 0.2, 1.4, 5), 0x6a4a2e, [0, 0.7, 0]),
    part(new THREE.IcosahedronGeometry(1.15, 0), 0x4f7d36, [0, 2.1, 0]),
    part(new THREE.IcosahedronGeometry(0.8, 0), 0x5a8a3c, [0.55, 2.6, 0.25]),
  ]);
  const palmParts = [part(new THREE.CylinderGeometry(0.1, 0.16, 3.4, 5), 0x8a6a45, [0.25, 1.7, 0], [0, 0, -0.14])];
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; palmParts.push(part(new THREE.BoxGeometry(1.7, 0.06, 0.36), 0x4f8f3a, [0.5 + Math.cos(a) * 0.75, 3.3, Math.sin(a) * 0.75], [0, -a, -0.35])); }
  const palm = merge(palmParts);
  const fruitTree = merge([
    part(new THREE.CylinderGeometry(0.15, 0.22, 1.5, 6), 0x6b4b30, [0, 0.75, 0]),
    part(new THREE.IcosahedronGeometry(1.15, 1), 0x5f9441, [0, 2.15, 0], null, [1, 0.85, 1]),
  ]);
  return { conifer, broad, palm, fruitTree };
}
function fruitSlots(t, i) {
  const out = [];
  for (let k = 0; k < t.m; k++) {
    const a = (k / t.m) * Math.PI * 2 + i * 1.7, y = 1.8 + ((k * 37 + i * 11) % 7) / 7 * 0.9;
    out.push([t.x + Math.cos(a) * 1.0, y, t.z + Math.sin(a) * 1.0]);
  }
  return out;
}
function buildFlora() {
  const W = S.W, woods = S.woods();
  const G = treeGeos();
  const kinds = [G.conifer, G.broad, G.palm];
  R.woodMesh = [];
  for (let k = 0; k < 3; k++) {
    const list = woods.filter(w => w.k === k);
    const m = inst(kinds[k], VC(), list.length, true, false);
    list.forEach((w, n) => m.setMatrixAt(n, compose(_m, w.x, S.height(w.x, w.z) - 0.1, w.z, w.r, w.s)));
    m.count = list.length;
    m.instanceMatrix.needsUpdate = true;
    R.woodMesh.push(m);
  }
  R.broadMat = R.woodMesh[1].material;
  const ft = W.trees;
  R.fruitTrees = inst(G.fruitTree, VC(), ft.length, true, false);
  ft.forEach((t, i) => R.fruitTrees.setMatrixAt(i, compose(_m, t.x, S.height(t.x, t.z) - 0.1, t.z, i * 1.3, 0.95)));
  R.fruitTrees.count = ft.length;
  let nf = 0;
  R.slots = ft.map((t, i) => { const sl = fruitSlots(t, i); nf += sl.length; return sl; });
  R.fruit = inst(new THREE.IcosahedronGeometry(0.13, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), nf, false, false);
  let q = 0;
  ft.forEach((t, i) => R.slots[i].forEach(() => { R.fruit.setColorAt(q++, t.isl === 2 ? _c.setRGB(0.95, 0.62, 0.15) : _c.setRGB(0.86, 0.24, 0.15)); }));
  R.fruit.count = nf;
  const bushG = part(new THREE.IcosahedronGeometry(0.75, 0), 0x3f7a35, [0, 0.45, 0], null, [1.1, 0.7, 1]);
  R.bush = inst(bushG, VC(), W.bushes.length, true, false);
  W.bushes.forEach((b, i) => R.bush.setMatrixAt(i, compose(_m, b.x, S.height(b.x, b.z), b.z, i * 0.7, 1)));
  R.bush.count = W.bushes.length;
  R.berry = inst(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshLambertMaterial({ color: 0x6a3d9a }), W.bushes.length * 5, false, false);
  R.berry.count = W.bushes.length * 5;
  const rocks = S.rocks();
  R.rock = inst(part(new THREE.DodecahedronGeometry(0.7, 0), 0x8a8780), VC(), rocks.length, true, true);
  rocks.forEach((r, i) => R.rock.setMatrixAt(i, compose(_m, r.x, S.height(r.x, r.z) - 0.1, r.z, r.r, r.s, r.s * 0.7, r.s)));
  R.rock.count = rocks.length;
}
function buildWreck() {
  const w = S.W.wreck;
  if (!w) return;
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x5a3f2a }), dark = new THREE.MeshLambertMaterial({ color: 0x33241a }), pale = new THREE.MeshLambertMaterial({ color: 0x8a7458 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(13, 2.6, 4.2), wood);
  hull.position.y = 0.4; hull.castShadow = true; hull.receiveShadow = true;
  g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 0.25, 3.6), pale);
  deck.position.set(-1.6, 1.75, 0); g.add(deck);
  for (let i = 0; i < 6; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), dark);
    rib.position.set(3 + i * 0.75, 2.4, 1.9 * (i % 2 ? 1 : -1)); rib.rotation.x = (i % 2 ? 1 : -1) * 0.35; rib.castShadow = true; g.add(rib);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 7.5, 6), dark);
  mast.position.set(-2.2, 4.1, 0.3); mast.rotation.z = 0.5; mast.rotation.x = 0.2; mast.castShadow = true; g.add(mast);
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 2, 6), dark);
  stump.position.set(1.2, 2.4, 0); g.add(stump);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3), new THREE.MeshLambertMaterial({ color: 0xd8cdb4, side: THREE.DoubleSide }));
  sail.position.set(-4.2, 2.2, 1.5); sail.rotation.set(-0.9, 0.4, 0.2); g.add(sail);
  g.position.set(w.sx, -0.4, w.sz);
  g.rotation.set(0.12, -w.dir + Math.PI / 2, 0.22);
  R.root.add(g);
  const planks = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const a = hash(i, 3.1) * 6.283, r = 2 + hash(i, 7.7) * 9;
    const x = w.x + Math.cos(a) * r, z = w.z + Math.sin(a) * r;
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.6 + hash(i, 1) * 1.2, 0.1, 0.3), i % 3 ? wood : pale);
    b.position.set(x, groundY(x, z) + 0.05, z); b.rotation.y = hash(i, 9) * 6.283; b.castShadow = true;
    planks.add(b);
  }
  R.root.add(planks);
}
function personGeos() {
  const legs = part(new THREE.BoxGeometry(0.085, 0.45, 0.09), 0xffffff, [0, -0.225, 0]);
  const torso = merge([
    part(new THREE.CylinderGeometry(0.115, 0.15, 0.36, 7), 0xffffff, [0, 0.63, 0]),
    part(new THREE.CylinderGeometry(0.15, 0.19, 0.16, 7), 0xd8d2c6, [0, 0.45, 0]),
  ]);
  const skin = merge([
    part(new THREE.IcosahedronGeometry(0.105, 1), 0xffffff, [0, 0.905, 0]),
    part(new THREE.CylinderGeometry(0.04, 0.045, 0.07, 6), 0xffffff, [0, 0.82, 0]),
    part(new THREE.BoxGeometry(0.055, 0.34, 0.06), 0xffffff, [0.178, 0.6, 0], [0, 0, 0.13]),
    part(new THREE.BoxGeometry(0.055, 0.34, 0.06), 0xffffff, [-0.178, 0.6, 0], [0, 0, -0.13]),
  ]);
  const hair = part(new THREE.SphereGeometry(0.113, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), 0xffffff, [0, 0.915, -0.012]);
  const longHair = part(new THREE.BoxGeometry(0.2, 0.27, 0.07), 0xffffff, [0, 0.79, -0.075]);
  return { legs, torso, skin, hair, longHair };
}
function animalGeos() {
  const leg4 = (c, w, h, dx, dz) => [[dx, dz], [dx, -dz], [-dx, dz], [-dx, -dz]].map(([x, z]) => part(new THREE.BoxGeometry(w, h, w), c, [x, h / 2, z]));
  const boar = merge([
    part(new THREE.BoxGeometry(0.8, 0.44, 0.4), 0x4a3a30, [0, 0.55, 0]),
    part(new THREE.BoxGeometry(0.3, 0.3, 0.3), 0x3e3028, [0.5, 0.5, 0]),
    part(new THREE.BoxGeometry(0.12, 0.04, 0.04), 0xeee6d6, [0.66, 0.42, 0.1], [0, 0, 0.5]),
    part(new THREE.BoxGeometry(0.12, 0.04, 0.04), 0xeee6d6, [0.66, 0.42, -0.1], [0, 0, 0.5]),
    part(new THREE.BoxGeometry(0.5, 0.08, 0.06), 0x2a201a, [-0.05, 0.8, 0]),
    ...leg4(0x2e241e, 0.08, 0.34, 0.28, 0.13),
  ]);
  const goat = merge([
    part(new THREE.BoxGeometry(0.72, 0.36, 0.3), 0xd9d2c4, [0, 0.66, 0]),
    part(new THREE.BoxGeometry(0.14, 0.32, 0.14), 0xd9d2c4, [0.36, 0.86, 0], [0, 0, -0.4]),
    part(new THREE.BoxGeometry(0.26, 0.15, 0.14), 0xcfc7b8, [0.5, 1.0, 0]),
    part(new THREE.BoxGeometry(0.04, 0.2, 0.04), 0x5a4a3a, [0.44, 1.14, 0.05], [0.2, 0, 0.6]),
    part(new THREE.BoxGeometry(0.04, 0.2, 0.04), 0x5a4a3a, [0.44, 1.14, -0.05], [-0.2, 0, 0.6]),
    part(new THREE.BoxGeometry(0.06, 0.12, 0.06), 0x8a8070, [0.6, 0.9, 0]),
    ...leg4(0xb8b0a0, 0.06, 0.5, 0.26, 0.1),
  ]);
  return { boar, goat };
}
function buildDynamic() {
  const PG = personGeos();
  R.pLegs = inst(PG.legs, VC(), CAP_P * 2, true, false);
  R.pTorso = inst(PG.torso, VC(), CAP_P, true, false);
  R.pSkin = inst(PG.skin, VC(), CAP_P, true, false);
  R.pHair = inst(PG.hair, VC(), CAP_P, false, false);
  R.pLong = inst(PG.longHair, VC(), CAP_P, false, false);
  R.lead = inst(new THREE.OctahedronGeometry(0.14, 0), new THREE.MeshBasicMaterial({ color: 0xe9c46a, fog: false }), 16, false, false);
  const AG = animalGeos();
  R.an = { boar: inst(AG.boar, VC(), 90, true, false), goat: inst(AG.goat, VC(), 90, true, false) };
  R.snake = inst(new THREE.SphereGeometry(0.1, 7, 5), new THREE.MeshLambertMaterial({ color: 0xffffff }), 30 * 12, true, false);
  const hutG = merge([
    part(new THREE.CylinderGeometry(1.45, 1.6, 1.3, 9), 0x7a5a3a, [0, 0.65, 0]),
    part(new THREE.ConeGeometry(2.05, 1.7, 9), 0xc2a160, [0, 2.1, 0]),
    part(new THREE.BoxGeometry(0.55, 0.85, 0.12), 0x2b1d12, [0, 0.43, 1.55]),
  ]);
  R.huts = inst(hutG, VC(), 200, true, true);
  R.farms = inst(part(new THREE.BoxGeometry(4.2, 0.1, 3.2), 0x6a4a2c, [0, 0.05, 0]), VC(), 90, false, true);
  R.crops = inst(part(new THREE.ConeGeometry(0.22, 0.75, 5), 0xffffff, [0, 0.38, 0]), VC(), 90 * 12, true, false);
  R.crates = inst(part(new THREE.BoxGeometry(0.55, 0.42, 0.42), 0x7a5a36), VC(), 40, true, false);
  R.bodies = inst(part(new THREE.BoxGeometry(1.5, 0.22, 0.5), 0x4a4038, [0, 0.11, 0]), VC(), 12, true, false);
  R.yard = inst(part(new THREE.BoxGeometry(2.8, 0.36, 0.72), 0x8a6a48, [0, 0.18, 0]), VC(), 2, true, false);
  R.camps = new Map();
  R.boats = new Map();
  R.flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, fog: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.06, 6, 28), new THREE.MeshBasicMaterial({ color: 0xefe6d6, fog: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  R.root.add(ring);
  R.selRing = ring;
}
function makeCamp(g0) {
  const g = new THREE.Group();
  const stoneM = new THREE.MeshLambertMaterial({ color: 0x77736c });
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), stoneM); s.position.set(Math.cos(a) * 0.85, 0.1, Math.sin(a) * 0.85); g.add(s); }
  const logM = new THREE.MeshLambertMaterial({ color: 0x4a3020 });
  for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 5), logM); l.rotation.z = Math.PI / 2; l.rotation.y = i * 1.05; l.position.y = 0.12; g.add(l); }
  const fire = new THREE.Group();
  const f1 = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 6), new THREE.MeshBasicMaterial({ color: 0xff8a2a, fog: false }));
  f1.position.y = 0.6;
  const f2 = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.8, 6), new THREE.MeshBasicMaterial({ color: 0xffd36a, fog: false }));
  f2.position.y = 0.55;
  fire.add(f1); fire.add(f2);
  g.add(fire);
  const light = new THREE.PointLight(0xff9a40, 0, 30, 2);
  light.position.y = 1.6;
  g.add(light);
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 0.5, 9, 1, true), new THREE.MeshLambertMaterial({ color: 0xa8814a, side: THREE.DoubleSide }));
  basket.position.set(2.4, 0.25, 0.6);
  g.add(basket);
  const mound = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshLambertMaterial({ color: 0xb5603a }));
  mound.position.set(2.4, 0.5, 0.6);
  g.add(mound);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 4.2, 5), logM);
  pole.position.set(-2.2, 2.1, -0.8); pole.castShadow = true;
  g.add(pole);
  const flagMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(campHex(g0)), side: THREE.DoubleSide });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8, 4, 1), flagMat);
  flag.geometry.translate(0.65, 0, 0);
  flag.position.set(-2.2, 3.75, -0.8);
  g.add(flag);
  g.position.set(g0.x, S.height(g0.x, g0.z), g0.z);
  R.root.add(g);
  return { g, fire, light, mound, flag, flagMat, base: Float32Array.from(flag.geometry.attributes.position.array) };
}
function makeBoat() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.36, 0.72), new THREE.MeshLambertMaterial({ color: 0x6a4428 }));
  hull.position.y = 0.05; hull.castShadow = true;
  const inner = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.5), new THREE.MeshLambertMaterial({ color: 0x3a2414 }));
  inner.position.y = 0.2;
  const prow = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.7, 4), new THREE.MeshLambertMaterial({ color: 0x6a4428 }));
  prow.rotation.z = -Math.PI / 2; prow.position.set(1.7, 0.05, 0);
  g.add(hull); g.add(inner); g.add(prow);
  R.root.add(g);
  return g;
}

/* ---------- colors ---------- */
const SKIN_STOPS = [[0.3, 0.18, 0.11], [0.52, 0.34, 0.2], [0.76, 0.55, 0.38], [0.95, 0.8, 0.67]];
const HAIR_STOPS = [[0.06, 0.05, 0.04], [0.24, 0.15, 0.08], [0.5, 0.3, 0.14], [0.86, 0.7, 0.42]];
function stop3(stops, t, out) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  out.setRGB(lerp(stops[i][0], stops[i + 1][0], f), lerp(stops[i][1], stops[i + 1][1], f), lerp(stops[i][2], stops[i + 1][2], f));
  return out;
}
const cSkin = new THREE.Color(), cHair = new THREE.Color(), cCloth = new THREE.Color(), cFabric = new THREE.Color(0.62, 0.56, 0.46);
const campCols = CAMP_HEX.map(h => new THREE.Color(h));
function personColors(p, a) {
  stop3(SKIN_STOPS, p.g.skin, cSkin);
  stop3(HAIR_STOPS, p.g.hair, cHair);
  if (a > 46) { const k = clamp((a - 46) / 22, 0, 0.85); cHair.lerp(_c.setRGB(0.82, 0.8, 0.76), k); }
  const g = S.grpOf(p);
  if (g) cCloth.copy(campCols[g.color % 8]).lerp(cFabric, 0.25);
  else cCloth.copy(cFabric).multiplyScalar(p.exiled ? 0.6 : 0.85);
}
