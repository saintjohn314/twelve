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
/* ===== Twelve viewer: sync, story cards, panels ===== */
const POLL_MS = 45000;
const seenEv = new Set();
let clock = null, time = 0, lastPoll = 0, lastOk = 0, aiInfo = { on: false };

/* ---------- server sync ---------- */
async function fetchState(q) {
  const r = await fetch('/api/state' + (q || ''), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const o = await r.json();
  if (!o || !o.v) throw new Error('empty world');
  return o;
}
function catchUp(maxSteps) {
  return S.advanceTo(S.targetT(Date.now()), { maxSteps: maxSteps || 30000 });
}
function applyState(o, first) {
  const prev = S.W;
  if (!first && prev && o.season === prev.season && (o.ver || 0) <= st.ver) return false;
  const old = new Map();
  for (const r of renderList) old.set(r.p.id, [r.x, r.z]);
  aiInfo = Object.assign({}, o.ai || {});
  S.load(o);
  st.ver = o.ver || 0;
  S.W.ai.on = false;            // the browser never asks Claude; the server's choices arrive with the next save
  catchUp();
  clearSnaps(); snapshot();
  const newSeason = !prev || prev.seed !== S.W.seed;
  if (!newSeason && !first) for (const p of S.W.people) { const a = old.get(p.id); if (!a) continue; const dx = a[0] - p.x, dz = a[1] - p.z; if (Math.hypot(dx, dz) < 25) smooth.set(p.id, [dx, dz]); }
  ingest(first || newSeason, first);
  if (newSeason && renderer) { buildWorld(); st.shot = null; }
  return true;
}
async function poll() {
  if (st.mode !== 'live') return;
  lastPoll = Date.now();
  try { const o = await fetchState(); lastOk = Date.now(); applyState(o, false); }
  catch (e) { /* keep simulating locally; the next poll will resync */ }
}

/* ---------- new events, confessionals and episodes become ticker lines and cards ---------- */
const evKey = e => e.k + '|' + e.t.toFixed(2) + '|' + e.s;
const confKey = c => c.t.toFixed(2) + '|' + c.id + '|' + c.kind;
function ingest(reset, firstVisit) {
  const W = S.W, now = performance.now() / 1000;
  if (reset) {
    seenEv.clear();
    for (const e of W.events) seenEv.add(evKey(e));
    st.seenConf.clear();
    for (const c of W.confs) st.seenConf.add(confKey(c));
    const last = W.episodes[W.episodes.length - 1];
    st.seenEp = last ? last.n : 0;
    if (firstVisit) {
      let fresh = true;
      try { fresh = !localStorage.getItem('twelve-welcome'); localStorage.setItem('twelve-welcome', '1'); } catch (e) { /* storage blocked */ }
      if (fresh) st.cardQ.push({ type: 'welcome', dur: 24 });
      if (last) st.cardQ.push({ type: 'ep', ep: last, prev: true, dur: cardDur(last.text, 10) });
      const lc = W.confs.filter(c => c.kind === 'conf').slice(-1)[0];
      if (lc && W.t - lc.t < 30) st.cardQ.push(confCard(lc));
    } else st.cardQ.push({ type: 'season', dur: 12 });
    return;
  }
  for (const e of W.events) {
    const k = evKey(e);
    if (seenEv.has(k)) continue;
    seenEv.add(k);
    onEvent(e, now);
  }
  if (seenEv.size > 3000) { seenEv.clear(); for (const e of W.events) seenEv.add(evKey(e)); }
  for (const c of W.confs) {
    const k = confKey(c);
    if (st.seenConf.has(k)) continue;
    st.seenConf.add(k);
    if (W.t - c.t < 40 && st.cardQ.length < 6) st.cardQ.push(confCard(c));
  }
  for (const ep of W.episodes) {
    if (ep.n <= st.seenEp) continue;
    st.seenEp = ep.n;
    st.cardQ.push({ type: 'ep', ep, dur: cardDur(ep.text, 10) });
  }
}
function cardDur(text, base) { return Math.min(22, base + String(text || '').length * 0.042); }
function confCard(c) { return { type: c.kind === 'conf' ? 'conf' : 'thought', c, pid: S.getP(c.id) ? c.id : 0, dur: cardDur(c.text, 7) }; }
function onEvent(e, now) {
  if (e.w < 2 || e.k === 'culture') return;
  st.tick.push(e);
  if (st.tick.length > 4) st.tick.shift();
  for (const id of e.ids || []) {
    if (!S.getP(id)) continue;
    const b = st.boost.get(id) || { v: 0, until: 0 };
    b.v = Math.min(70, (b.until > now ? b.v : 0) + 16 * e.w);
    b.until = now + 45;
    st.boost.set(id, b);
  }
}
function localShow() {
  // with no server (opened as a local file), the browser writes simple confessionals and recaps itself
  const W = S.W;
  if (W.t - (W.lastConfT || 0) >= 30 && W.spot.length) {
    W.lastConfT = W.t;
    const p = S.getP(W.spot[Math.floor(W.t) % W.spot.length]);
    if (p) { W.confs.push({ t: W.t, id: p.id, name: p.name, text: S.templateConfessional(p), kind: 'conf', ai: false }); if (W.confs.length > 80) W.confs.shift(); }
  }
  if (W.t >= W.nextEp) {
    const evs = S.episodeEvents(W.epLastN || 0, W.evN), ep = S.templateEpisode(evs);
    W.epN++;
    W.episodes.push({ n: W.epN, t: W.t, t0: W.epFromT || 0, title: ep.title, text: ep.text, ai: false, cast: [] });
    W.epLastN = W.evN; W.epFromT = W.t; W.nextEp = W.t + 144;
  }
}
function afterSteps() {
  if (st.mode === 'local') localShow();
  ingest(false);
}

/* ---------- cards ---------- */
function showCard(now) {
  if (st.card && now < st.card.until) return;
  if (st.card) hideCard();
  const c = st.cardQ.shift();
  if (!c) return;
  if ((c.type === 'conf' || c.type === 'thought') && c.pid && !S.getP(c.pid)) c.pid = 0;
  st.card = c;
  c.until = now + c.dur;
  const W = S.W;
  let kicker = '', title = '', text = '', meta = '', dot = '';
  if (c.type === 'welcome') {
    kicker = 'Welcome';
    title = 'Twelve strangers. No script.';
    text = `Six men and six women washed ashore after a shipwreck. Nobody controls them. They find food, fall in love, steal, fight, form camps and cast each other out on their own, live, around the clock. Claude speaks for a few of them at a time: their confessionals and their hardest choices.`;
    meta = 'One day on the island is twenty minutes of real time. The director picks the shots. Drag to look around, or tap anyone to follow them.';
  } else if (c.type === 'season') {
    kicker = 'Season ' + W.season;
    title = 'A new wreck';
    text = 'Everyone from the last season is gone. A new ship broke apart on the reef, and twelve new strangers are washing up on the beach.';
  } else if (c.type === 'ep') {
    const ep = c.ep;
    kicker = c.prev ? 'Previously on Twelve' : 'Episode ' + ep.n;
    title = ep.title;
    text = ep.text;
    meta = `Episode ${ep.n} · ${S.stamp(ep.t0 || 0)} to ${S.stamp(ep.t)}${ep.ai ? ' · Narrated by Claude' : ''}`;
  } else {
    const cf = c.c, p = S.getP(cf.id) || S.W.arch[cf.id];
    const g = p && p.grp ? S.groupById(p.grp) : null;
    dot = p && S.getP(cf.id) ? personHex(p) : NO_CAMP;
    kicker = c.type === 'conf' ? 'Confessional' : 'Decision';
    title = cf.name;
    text = cf.text;
    meta = (c.type === 'thought' ? `Chose: ${cf.choice}. ` : '') + `${S.stamp(cf.t)}${g && !g.dead ? ' · ' + g.name : ''}${cf.ai ? ' · Voiced by Claude' : ''}`;
  }
  $('#cardKicker').innerHTML = (dot ? `<span class="cdot" style="background:${dot}"></span>` : '') + esc(kicker);
  $('#cardTitle').textContent = title;
  $('#cardText').textContent = text;
  $('#cardMeta').textContent = meta;
  $('#card').style.setProperty('--card-c', dot || 'var(--text-3)');
  $('#card').classList.remove('hide');
  $('#letterbox').classList.toggle('on', !!c.pid && st.director);
  if (c.pid && st.director) { st.shot = null; dirT = 0; }
}
function hideCard() {
  st.card = null;
  $('#card').classList.add('hide');
  $('#letterbox').classList.remove('on');
  if (st.director) { st.shot = null; dirT = 0; }
}

/* ---------- heads-up display ---------- */
function hudTick(now) {
  const W = S.W, tl = S.timeLabel(W.t + st.alpha * S.DT);
  setText('#hWhen', `Season ${W.season} · Day ${tl.day}${tl.year > 1 ? ' · Year ' + tl.year : ''}`);
  setText('#hClock', tl.clock);
  const camps = W.groups.filter(g => !g.dead).length;
  setText('#hSub', `${W.people.length} alive · ${camps} ${camps === 1 ? 'camp' : 'camps'} · ${tl.season}${W.wx.storm > 0 ? ' · storm' : ''}`);
  const live = st.mode === 'live' && Date.now() - lastOk < 4 * 60 * 1000;
  $('#live').classList.toggle('off', !live);
  setText('#liveTxt', st.mode === 'local' ? 'LOCAL PREVIEW' : live ? 'LIVE' : 'RECONNECTING');
  // lower third
  let name = '', role = '', act = '', hex = NO_CAMP, pid = 0;
  const sh = st.director ? st.shot : null;
  const subj = sh && (sh.kind === 'person' || sh.kind === 'pair') ? sh.id : (!st.director && st.sel ? st.sel : 0);
  const p = subj && S.getP(subj);
  if (p) { name = p.name; role = S.roleLabel(p); act = S.actLabel(p); hex = personHex(p); pid = p.id; }
  else if (sh && sh.kind === 'camp') {
    const g = W.groups.find(g => g.id === sh.gid);
    if (g) { const m = S.members(g).length; name = g.name; role = `${m} ${m === 1 ? 'person' : 'people'} · ${g.isl === 2 ? 'the far island' : 'the home island'}`; act = (g.leader ? 'Led by ' + S.nameOf(g.leader) : 'No leader') + (g.fire.lit ? ' · fire burning' : ' · no fire'); hex = campHex(g); }
  } else if (sh && sh.kind === 'boat') {
    const b = W.boats.find(b => b.id === sh.bid);
    if (b && b.sail) { name = 'At sea'; role = 'Crossing open water'; act = (b.sail.pax || []).map(S.nameOf).join(', '); }
  } else if (sh && sh.kind === 'wreck') { name = 'The wreck'; role = 'Where it started'; act = `${Math.floor(W.t / 24)} days ago, twelve strangers crawled out of the surf here.`; }
  else if (sh && sh.kind === 'wide') { name = 'The islands'; role = `${W.people.length} alive · ${camps} camps`; act = `${S.popOf(1)} on the home island, ${S.popOf(2)} on the far island.`; }
  const lower = $('#lower');
  lower.classList.toggle('hide', !name || !!st.card);
  lower.dataset.pid = pid || '';
  setText('#ltName', name); setText('#ltRole', role); setText('#ltAct', act);
  $('#ltBar').style.background = hex;
  // ticker
  if (now > st.tickT && st.tick.length) {
    const e = st.tick.shift();
    const m = $('#tkMsg');
    m.classList.add('fade');
    setTimeout(() => { setText('#tkDay', S.stamp(e.t)); m.textContent = e.s; m.classList.remove('fade'); }, 250);
    st.tickT = now + 7.5;
  }
}
function setText(sel, v) { const el = typeof sel === 'string' ? $(sel) : sel; const s = String(v); if (el && el.textContent !== s) el.textContent = s; }

/* ---------- panel: cast ---------- */
let castSig = '';
function ageOf(p) { return Math.floor(S.ageY(p)); }
function personRow(p, g) {
  const lead = g && g.leader === p.id, ai = aiInfo.on && S.W.spot.indexOf(p.id) >= 0;
  return `<button class="prow" data-pid="${p.id}"><span class="chip" style="background:${personHex(p)};border-radius:50%"></span><span class="nm">${esc(p.name)}</span><span class="ag">${ageOf(p)}</span>${lead ? '<span class="badge lead">Leads</span>' : ''}${p.exiled && !g ? '<span class="badge out">Outcast</span>' : ''}${ai ? '<span class="badge ai" title="Claude speaks for this person right now">Claude</span>' : ''}<span class="ac">${esc(S.actLabel(p))}</span></button>`;
}
function renderCast() {
  const W = S.W;
  const groups = W.groups.filter(g => !g.dead).map(g => ({ g, m: S.members(g) })).sort((a, b) => b.m.length - a.m.length);
  const order = (g, list) => list.slice().sort((a, b) => (b.id === g.leader) - (a.id === g.leader) || S.ageY(b) - S.ageY(a));
  let h = '';
  if (!groups.length) h += `<p class="note">No camps yet. The castaways are still finding their feet.</p>`;
  for (const { g, m } of groups) {
    const fed = g.store >= m.length * 2;
    h += `<div class="camp"><div class="camp-h"><span class="chip" style="background:${campHex(g)}"></span><div><div class="camp-n">${esc(g.name)}</div><div class="camp-m">${m.length} ${m.length === 1 ? 'person' : 'people'} · ${g.isl === 2 ? 'far island' : 'home island'}</div></div><div class="camp-r">${g.leader ? 'Led by ' + esc(S.nameOf(g.leader)) : 'No leader'}<br>${g.fire.lit ? 'Fire lit' : 'No fire'} · ${fed ? 'food ok' : 'food low'}</div></div>${order(g, m).map(p => personRow(p, g)).join('')}</div>`;
  }
  const loners = W.people.filter(p => !p.grp);
  if (loners.length) h += `<div class="camp"><div class="camp-h"><span class="chip" style="background:${NO_CAMP}"></span><div><div class="camp-n">No camp</div><div class="camp-m">${loners.length} on their own</div></div></div>${loners.sort((a, b) => S.ageY(b) - S.ageY(a)).map(p => personRow(p, null)).join('')}</div>`;
  if (h !== castSig) { castSig = h; $('#pane-cast').innerHTML = h; }
}

/* ---------- panel: relationship web ---------- */
const webPos = new Map();
let webSig = '';
function webEdges(nodes) {
  const E = [], ids = new Set(nodes.map(p => p.id));
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const ra = a.rel[b.id], rb = b.rel[a.id];
    if (!ra && !rb) continue;
    const aff = ((ra ? ra[0] : 0) + (rb ? rb[0] : 0)) / ((ra ? 1 : 0) + (rb ? 1 : 0));
    if (a.partner === b.id) E.push({ a, b, k: 'love' });
    else if (aff > 32) E.push({ a, b, k: 'friend' });
    else if (Math.min(ra ? ra[0] : 0, rb ? rb[0] : 0) < -40) E.push({ a, b, k: 'foe' });
  }
  return E.filter(e => ids.has(e.a.id) && ids.has(e.b.id));
}
function layoutWeb(nodes, edges, iters, Wd, Ht, temp0) {
  const cx = Wd / 2, cy = Ht / 2;
  for (const p of nodes) {
    if (webPos.has(p.id)) continue;
    const par = webPos.get(p.partner) || webPos.get(p.mom) || webPos.get(p.dad);
    webPos.set(p.id, par ? { x: par.x + (Math.random() - 0.5) * 24, y: par.y + (Math.random() - 0.5) * 24 } : { x: cx + (Math.random() - 0.5) * Wd * 0.5, y: cy + (Math.random() - 0.5) * Ht * 0.5 });
  }
  const k = Math.sqrt((Wd - 40) * (Ht - 40) / Math.max(1, nodes.length)) * 0.55;
  const Rd = Math.min(Wd, Ht) * 0.4, grav = clamp(nodes.length * k * k / (2 * Rd * Rd), 0.03, 3);
  const P = nodes.map(p => webPos.get(p.id));
  const idx = new Map(nodes.map((p, i) => [p.id, i]));
  for (let it = 0; it < iters; it++) {
    const temp = temp0 * (1 - it / iters) + 0.5;
    const dx = new Float32Array(nodes.length), dy = new Float32Array(nodes.length);
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      let ex = P[i].x - P[j].x, ey = P[i].y - P[j].y;
      const d = Math.sqrt(ex * ex + ey * ey) || 0.1;
      const f = (k * k) / d / d;
      dx[i] += ex * f; dy[i] += ey * f; dx[j] -= ex * f; dy[j] -= ey * f;
    }
    for (const e of edges) {
      const i = idx.get(e.a.id), j = idx.get(e.b.id);
      const ex = P[i].x - P[j].x, ey = P[i].y - P[j].y, d = Math.sqrt(ex * ex + ey * ey) || 0.1;
      const f = e.k === 'love' ? d / k * 3 : e.k === 'friend' ? d / k : -(k * k) / d / d * 0.6;
      dx[i] -= ex * f; dy[i] -= ey * f; dx[j] += ex * f; dy[j] += ey * f;
    }
    const camps = new Map();
    nodes.forEach((p, i) => { if (!p.grp) return; const c = camps.get(p.grp) || { x: 0, y: 0, n: 0 }; c.x += P[i].x; c.y += P[i].y; c.n++; camps.set(p.grp, c); });
    nodes.forEach((p, i) => {
      const c = p.grp && camps.get(p.grp);
      if (c && c.n > 1) { dx[i] += (c.x / c.n - P[i].x) * 0.35; dy[i] += (c.y / c.n - P[i].y) * 0.35; }
      dx[i] += (cx - P[i].x) * grav; dy[i] += (cy - P[i].y) * grav;
      const m = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1, s = Math.min(m, temp) / m;
      P[i].x = clamp(P[i].x + dx[i] * s, 16, Wd - 16); P[i].y = clamp(P[i].y + dy[i] * s, 16, Ht - 16);
    });
  }
}
function renderWeb() {
  const svg = $('#web');
  const Wd = svg.clientWidth || 356, Ht = svg.clientHeight || 440;
  const W = S.W;
  let nodes = W.people.filter(p => S.ageY(p) >= 14);
  if (nodes.length > 110) nodes = nodes.sort((a, b) => S.ageY(b) - S.ageY(a)).slice(0, 110);
  const edges = webEdges(nodes);
  const sig = nodes.map(p => p.id).join(',') + '|' + edges.map(e => e.a.id + e.k + e.b.id).join(',');
  layoutWeb(nodes, edges, sig === webSig ? 10 : 160, Wd, Ht, sig === webSig ? 3 : Wd / 8);
  webSig = sig;
  const leaders = new Set(W.groups.filter(g => !g.dead).map(g => g.leader));
  const showAll = nodes.length <= 36;
  let h = '';
  for (const e of edges) {
    const a = webPos.get(e.a.id), b = webPos.get(e.b.id);
    const st2 = e.k === 'love' ? 'stroke="var(--love)" stroke-width="2.4"' : e.k === 'friend' ? 'stroke="rgba(239,230,214,.32)" stroke-width="1.2"' : 'stroke="var(--foe)" stroke-width="1.4" stroke-dasharray="4 3" opacity=".85"';
    h += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" ${st2}/>`;
  }
  for (const p of nodes) {
    const o = webPos.get(p.id), lead = leaders.has(p.id), sel = p.id === st.sel;
    const r = lead ? 7 : 5;
    h += `<circle data-pid="${p.id}" cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${r}" fill="${personHex(p)}" stroke="${sel ? '#fff' : 'var(--panel-solid)'}" stroke-width="${sel ? 2.5 : 1.5}"><title>${esc(p.name)}${lead ? ', leader' : ''}</title></circle>`;
    if (showAll || lead || sel || W.spot.indexOf(p.id) >= 0) { const right = o.x > Wd * 0.62; h += `<text class="lbl" x="${(o.x + (right ? -r - 3 : r + 3)).toFixed(1)}" y="${(o.y + 3.5).toFixed(1)}"${right ? ' text-anchor="end"' : ''}>${esc(p.name)}</text>`; }
  }
  svg.setAttribute('viewBox', `0 0 ${Wd} ${Ht}`);
  svg.innerHTML = h;
  $('#webLegend').innerHTML = `<span><i class="ln" style="border-color:var(--love)"></i>Partners</span><span><i class="ln" style="border-color:rgba(239,230,214,.45)"></i>Close friends</span><span><i class="ln" style="border-color:var(--foe);border-top-style:dashed"></i>Enemies</span>` +
    W.groups.filter(g => !g.dead).map(g => `<span><span class="chip" style="background:${campHex(g)}"></span>${esc(g.name)}</span>`).join('');
}

/* ---------- panel: story ---------- */
let storySig = '';
function quoteHTML(c) {
  const p = S.getP(c.id);
  const hex = p ? personHex(p) : NO_CAMP;
  return `<div class="quote"><span class="bar" style="background:${hex}"></span><div><div class="who">${p ? `<button data-pid="${c.id}">${esc(c.name)}</button>` : esc(c.name) + ' <span class="muted">(dead)</span>'} <span class="muted small" style="text-transform:none;letter-spacing:0;font-family:var(--f-body)">· ${c.kind === 'conf' ? 'confessional' : 'decision'} · ${S.stamp(c.t)}${c.ai ? ' · Claude' : ''}</span></div><div class="txt">${esc(c.text)}</div>${c.choice ? `<div class="ch">Chose: ${esc(c.choice)}</div>` : ''}</div></div>`;
}
function renderStory() {
  const W = S.W;
  const eps = W.episodes.slice().reverse();
  let h = '<h3>Episodes</h3>';
  if (!eps.length) h += `<p class="note">The first episode recap airs on day ${Math.floor(W.nextEp / 24) + 1}.</p>`;
  eps.forEach((ep, i) => {
    if (i === 0) h += `<div class="ep latest"><div class="ep-k">Episode ${ep.n} · ${S.stamp(ep.t0 || 0)} to ${S.stamp(ep.t)}${ep.ai ? ' · Narrated by Claude' : ''}</div><div class="ep-t">${esc(ep.title)}</div><p>${esc(ep.text)}</p></div>`;
    else if (i < 12) h += `<details class="ep"><summary><div class="ep-k">Episode ${ep.n} · ${S.stamp(ep.t)}</div><div class="ep-t">${esc(ep.title)}</div></summary><p>${esc(ep.text)}</p></details>`;
  });
  const qs = W.confs.slice(-16).reverse();
  h += '<h3>Confessionals and decisions</h3>';
  h += qs.length ? qs.map(quoteHTML).join('') : '<p class="note">Nobody has talked to the camera yet.</p>';
  const evs = W.events.filter(e => e.w >= 2 && e.k !== 'culture').slice(-50).reverse();
  h += '<h3>What happened</h3><div class="log">' + evs.map(e => `<span class="d">${S.stamp(e.t)}</span><span class="s${e.w >= 3 ? ' big' : ''}">${esc(e.s)}</span>`).join('') + '</div>';
  if (W.seasons && W.seasons.length) {
    h += '<h3>Past seasons</h3><div class="seasons">' + W.seasons.slice().reverse().map(s => `<div class="season"><b>Season ${s.season}</b> · ${s.years} years · ${s.gens} generations · ${s.born} born · ${s.murders} murders${s.notes && s.notes.length ? '<br>' + esc(s.notes.slice(-2).join(' ')) : ''}${st.mode === 'live' ? `<br><button class="lk" data-season="${s.season}" style="margin-top:6px">Read its episodes</button><div id="past-${s.season}"></div>` : ''}</div>`).join('') + '</div>';
  }
  if (h !== storySig) { storySig = h; const el = $('#pane-story'), y = el.scrollTop; el.innerHTML = h; el.scrollTop = y; }
}
async function loadSeason(n) {
  const box = $('#past-' + n);
  if (!box) return;
  box.innerHTML = '<p class="note">Loading…</p>';
  try {
    const d = await (await fetch('/api/state?season=' + n)).json();
    box.innerHTML = (d.episodes || []).slice().reverse().map(ep => `<details class="ep" style="margin-top:8px"><summary><div class="ep-k">Episode ${ep.n}</div><div class="ep-t">${esc(ep.title)}</div></summary><p>${esc(ep.text)}</p></details>`).join('') || '<p class="note">No episodes were saved for this season.</p>';
  } catch (e) { box.innerHTML = '<p class="note">That season could not be loaded.</p>'; }
}

/* ---------- panel: stats ---------- */
let statsSig = '';
const SERIES = ['#3987e5', '#d95926'];
function niceMax(v) { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); const f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; }
function lineChart(series, o) {
  const Wd = 352, Ht = o.h || 132, L = 30, Rr = 64, T = 8, Bt = 18;
  const xs = series[0].pts.map(p => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(x0 + 1, ...xs);
  let y0 = o.min != null ? o.min : 0, y1 = o.max != null ? o.max : niceMax(Math.max(...series.flatMap(s => s.pts.map(p => p[1]))) * 1.05);
  if (o.min == null && Math.min(...series.flatMap(s => s.pts.map(p => p[1]))) < 0) { const m = niceMax(Math.max(...series.flatMap(s => s.pts.map(p => Math.abs(p[1]))))); y0 = -m; y1 = m; }
  const X = x => L + (x - x0) / (x1 - x0) * (Wd - L - Rr), Y = y => T + (1 - (y - y0) / (y1 - y0 || 1)) * (Ht - T - Bt);
  let h = `<svg viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${esc(o.label)}">`;
  for (let i = 0; i <= 2; i++) { const v = y0 + (y1 - y0) * i / 2; h += `<line class="grid" x1="${L}" x2="${Wd - Rr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${L - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${o.fmt ? o.fmt(v) : Math.round(v)}</text>`; }
  h += `<text class="ax" x="${L}" y="${Ht - 4}">Day ${x0 + 1}</text><text class="ax" x="${Wd - Rr}" y="${Ht - 4}" text-anchor="end">Day ${x1 + 1}</text>`;
  series.forEach((s, i) => {
    const d = s.pts.map((p, j) => (j ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
    h += `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = s.pts[s.pts.length - 1];
    h += `<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3" fill="${s.c}"/><text class="dl" x="${(X(last[0]) + 7).toFixed(1)}" y="${(Y(last[1]) + 4 + (i && series.length > 1 && Math.abs(Y(last[1]) - Y(series[0].pts[series[0].pts.length - 1][1])) < 12 ? 12 : 0)).toFixed(1)}" fill="${s.c}">${esc(s.name)} ${o.fmt ? o.fmt(last[1]) : last[1]}</text>`;
  });
  return h + '</svg>';
}
function renderStats() {
  const W = S.W, s = W.stats;
  const gen = W.people.reduce((m, p) => Math.max(m, p.gen), 1);
  const tiles = [['Alive', W.people.length], ['Generations', gen], ['Camps', W.groups.filter(g => !g.dead).length], ['Born', s.births], ['Died', s.deaths], ['Murders', s.murders], ['Fights', s.fights], ['Thefts', s.thefts], ['Exiles', s.exiles], ['Splits', s.splits], ['Crossings', s.voyages], ['Affairs', s.affairs]];
  let h = '<div class="tiles">' + tiles.map(t => `<div class="tile"><div class="v">${t[1]}</div><div class="k">${t[0]}</div></div>`).join('') + '</div>';
  const D = (W.daily || []).slice();
  if (D.length >= 2) {
    h += '<h3>Population</h3><div class="chart">' + lineChart([{ name: 'All', c: SERIES[0], pts: D.map(d => [d.d, d.pop]) }, { name: 'Far isl.', c: SERIES[1], pts: D.map(d => [d.d, d.far]) }], { label: 'Population by day' }) + '</div>';
    h += '<h3>Trust</h3><div class="chart">' + lineChart([{ name: 'Avg', c: SERIES[0], pts: D.map(d => [d.d, d.trust]) }], { label: 'Average trust between adults', h: 110, fmt: v => (v > 0 ? '+' : '') + Math.round(v) }) + '</div><div class="chart-cap">How much the adults trust each other on average, from -100 to +100.</div>';
    h += '<h3>Inequality</h3><div class="chart">' + lineChart([{ name: 'Gini', c: SERIES[0], pts: D.map(d => [d.d, d.gini]) }], { label: 'Inequality of food and belongings', h: 110, min: 0, max: 1, fmt: v => v.toFixed(2) }) + '</div><div class="chart-cap">0 means everyone has the same food and belongings; 1 means one person has everything.</div>';
  } else h += '<p class="note" style="margin-top:14px">Charts fill in as the days go by.</p>';
  const camps = W.groups.filter(g => !g.dead).map(g => ({ g, n: S.members(g).length })).sort((a, b) => b.n - a.n);
  if (camps.length) {
    const mx = Math.max(...camps.map(c => c.n));
    h += '<h3>Camp sizes</h3><div class="bars">' + camps.map(c => `<div class="brow"><span class="bn">${esc(c.g.name)}</span><span class="bt" style="width:${Math.max(3, c.n / mx * 100)}%;background:${campHex(c.g)}"></span><span class="bv">${c.n}</span></div>`).join('') + '</div>';
  }
  const ms = Object.values(W.milestones).sort((a, b) => a.t - b.t);
  if (ms.length) h += '<h3>Firsts</h3><div class="ms">' + ms.map(m => `<span class="d">${S.stamp(m.t)}</span><span>${esc(m.s)}</span>`).join('') + '</div>';
  h += `<p class="note" style="margin-top:16px">One day on the island is twenty minutes of real time; a year is sixteen days. ${aiInfo.on ? 'Claude is voicing the spotlight cast right now.' : 'Claude is not connected right now, so built-in rules make every choice and write the recaps.'}</p>`;
  if (h !== statsSig) { statsSig = h; $('#pane-stats').innerHTML = h; }
}

/* ---------- inspector ---------- */
let inspSig = '';
function meter(k, v, invert) { const f = clamp(v, 0, 100); return `<div class="meter${f < 25 ? ' low' : ''}"><div class="k"><span>${k}</span><span>${Math.round(f)}</span></div><div class="t"><div class="f" style="width:${f}%"></div></div></div>`; }
function linkBtn(id, label) { const p = S.getP(id); const a = !p && S.W.arch[id]; if (!p && !a) return ''; return `<button class="lk${p ? '' : ' dead'}" ${p ? `data-pid="${id}"` : ''}>${esc(label || (p || a).name)}</button>`; }
function renderInspector() {
  const box = $('#inspector');
  const p = st.sel && S.getP(st.sel);
  if (!p) {
    const a = st.sel && S.W.arch[st.sel];
    if (a) { const h = `<div class="insp-h"><button class="back" data-act="close" aria-label="Back">&larr;</button><div><div class="insp-name">${esc(a.name)}</div><div class="insp-sub">Died: ${esc(a.cause || 'unknown')}</div></div></div><div class="pane"><p class="note">${esc((a.life || []).slice(-6).map(m => m.s || m).join(' '))}</p></div>`; if (h !== inspSig) { inspSig = h; box.innerHTML = h; } }
    else closeInspector();
    return;
  }
  const W = S.W, g = S.grpOf(p), a = S.ageY(p);
  const origin = p.prof ? `Before the wreck: ${S.PROFS[p.prof].n}` : `Born on the island, generation ${p.gen}`;
  const ai = aiInfo.on && W.spot.indexOf(p.id) >= 0;
  let h = `<div class="insp-h"><button class="back" data-act="close" aria-label="Back">&larr;</button><div style="min-width:0"><div class="insp-name">${esc(p.name)}</div><div class="insp-sub"><span class="chip" style="display:inline-block;background:${personHex(p)};border-radius:50%;width:8px;height:8px;margin-right:5px"></span>${p.sex === 'M' ? 'Man' : 'Woman'}, ${Math.floor(a)} · ${esc(S.roleLabel(p))}</div><div class="insp-sub">${esc(origin)}${ai ? ' <span class="badge ai">Claude</span>' : ''}</div><div class="insp-act">${esc(S.actLabel(p))}</div></div><button class="follow" data-act="follow" aria-pressed="${st.follow ? 'true' : 'false'}">Follow</button></div><div class="pane">`;
  h += `<div class="meters">${meter('Fed', p.hun)}${meter('Rested', p.en)}${meter('Company', p.soc)}${meter('Health', p.hp)}</div>`;
  h += '<h3>Personality</h3><div class="traits">' + S.TRAITS.map(([k, n]) => `<div class="trait"><span>${n}</span><span class="t"><i style="left:${(p.p[k] * 100).toFixed(0)}%"></i></span></div>`).join('') + `</div><p class="note small" style="margin:6px 0 0">${esc(S.traitWords(p.p))}</p>`;
  const fam = [];
  if (p.partner) fam.push(['Partner', [p.partner]]);
  if (p.mom || p.dad) fam.push(['Parents', [p.mom, p.dad].filter(Boolean)]);
  if (p.kids.length) fam.push(['Children', p.kids]);
  if (fam.length) h += '<h3>Family</h3>' + fam.map(([k, ids]) => `<div style="display:flex;gap:10px;align-items:baseline;margin-bottom:6px"><span class="muted small" style="width:64px;flex:none">${k}</span><div class="links">${ids.map(id => linkBtn(id)).join('')}</div></div>`).join('');
  const rels = S.topRelations(p, 9);
  if (rels.length) h += '<h3>People</h3><div class="rels">' + rels.map(x => { const v = x.r[0]; const w = Math.abs(v) / 2; return `<button class="rel" data-pid="${x.o.id}"><span class="chip" style="background:${personHex(x.o)};border-radius:50%"></span><span class="rn">${esc(x.o.name)}</span><span class="sw"><i style="left:${v < 0 ? 50 - w : 50}%;width:${w}%;background:${v < 0 ? 'var(--foe)' : 'var(--love)'}"></i></span><span class="rw">${esc(S.relWords(x.r))}</span></button>`; }).join('') + '</div>';
  if (p.secrets.length) h += '<h3>Secrets</h3>' + p.secrets.slice(-4).map(s => `<div class="secret">${esc(s.s)}</div>`).join('');
  const items = S.itemsOf(p);
  if (items.length) h += `<h3>Owns</h3><p class="note" style="margin:0">${items.map(i => esc(S.ITEMS[i.k].n)).join(', ')}</p>`;
  const cf = W.confs.filter(c => c.id === p.id).slice(-3).reverse();
  if (cf.length) h += '<h3>In their words</h3>' + cf.map(quoteHTML).join('');
  if (p.mem.length) h += '<h3>Lately</h3>' + p.mem.slice(-8).reverse().map(m => `<div class="mem">${esc(m.s)}</div>`).join('');
  if (p.life.length) h += '<h3>Life so far</h3>' + p.life.slice(-10).map(m => `<div class="mem">${esc(m.s)}</div>`).join('');
  h += '</div>';
  if (h !== inspSig) { const pane = box.querySelector('.pane'), y = pane ? pane.scrollTop : 0; inspSig = h; box.innerHTML = h; const np = box.querySelector('.pane'); if (np && box.dataset.pid === String(p.id)) np.scrollTop = y; box.dataset.pid = p.id; }
}
function select(id, fly) {
  st.sel = id;
  inspSig = '';
  $('#inspector').hidden = !id;
  if (!id) return;
  setDirector(false);
  st.follow = true;
  renderInspector();
  const r = RL.get(id);
  if (fly !== false && r) flyTo(r.x, r.z, 14);
  if (window.innerWidth < 760 && st.sheetMin) toggleSheet(false);
}
function closeInspector() { st.sel = 0; st.follow = false; $('#inspector').hidden = true; inspSig = ''; }

/* ---------- interface wiring ---------- */
function showTab(t) {
  st.tab = t;
  $$('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
  ['cast', 'web', 'story', 'stats'].forEach(k => { $('#pane-' + k).hidden = k !== t; });
  castSig = storySig = statsSig = ''; webSig = '';
  panelTick(true);
}
function toggleSheet(min) {
  st.sheetMin = min == null ? !st.sheetMin : min;
  document.body.classList.toggle('sheet-min', st.sheetMin);
}
let webT = 0;
function panelTick(force) {
  if (!$('#inspector').hidden) { renderInspector(); return; }
  if (st.tab === 'cast') renderCast();
  else if (st.tab === 'story') renderStory();
  else if (st.tab === 'stats') renderStats();
  else if (st.tab === 'web') { const now = performance.now(); if (force || now - webT > 2000) { webT = now; renderWeb(); } }
}
function initUI() {
  $$('.tab').forEach(b => b.addEventListener('click', () => { if (!$('#inspector').hidden) closeInspector(); showTab(b.dataset.tab); }));
  $('#panel').addEventListener('click', e => {
    const s = e.target.closest('[data-season]');
    if (s) { loadSeason(+s.dataset.season); s.remove(); return; }
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'close') { closeInspector(); panelTick(true); return; }
    if (act && act.dataset.act === 'follow') { st.follow = !st.follow; if (st.follow) setDirector(false); act.setAttribute('aria-pressed', st.follow ? 'true' : 'false'); return; }
    const b = e.target.closest('[data-pid]');
    if (b) select(+b.dataset.pid);
  });
  $('#web').addEventListener('click', e => { const c = e.target.closest('[data-pid]'); if (c) select(+c.dataset.pid); });
  $('#btnDirector').addEventListener('click', () => { setDirector(!st.director); if (st.director) closeInspector(); });
  $('#btnWide').addEventListener('click', () => { setDirector(false); st.follow = false; frameWide(false); });
  $('#cardX').addEventListener('click', () => { if (st.card) st.card.until = 0; });
  const openLower = () => { const id = +$('#lower').dataset.pid; if (id) select(id); };
  $('#lower').addEventListener('click', openLower);
  $('#lower').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLower(); } });
  $('#grab').addEventListener('click', () => toggleSheet());
  const cv = renderer.domElement;
  let down = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    const rect = cv.getBoundingClientRect();
    const p = pickPerson(e.clientX - rect.left, e.clientY - rect.top);
    if (p) select(p.id);
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || down) return;
    const rect = cv.getBoundingClientRect();
    const p = pickPerson(e.clientX - rect.left, e.clientY - rect.top);
    st.hover = p ? p.id : 0;
    cv.style.cursor = p ? 'pointer' : '';
  });
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea')) return;
    if (e.key === 'Escape') { if (st.card) st.card.until = 0; else if (st.sel) { closeInspector(); panelTick(true); } }
    if (e.key === 'd' || e.key === 'D') setDirector(!st.director);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastPoll > 20000) poll(); });
  if (window.innerWidth < 760) toggleSheet(true);
  showTab('cast');
}

/* ---------- main loop ---------- */
let uiT = 0, slowT = 0, panelT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, clock.getDelta());
  time += dt;
  const now = performance.now() / 1000;
  const target = S.targetT(Date.now());
  let n = 0;
  while (S.W.t + S.DT <= target && n < 30) { snapshot(); S.step(S.DT); n++; }
  if (n >= 30 && S.W.t + S.DT <= target) {
    if (target - S.W.t > 6 && st.mode === 'live' && Date.now() - lastPoll > 5000) poll();
    catchUp(3000); clearSnaps(); snapshot();
  }
  if (n) afterSteps();
  if (S.W.seed !== st.seed) { buildWorld(); st.shot = null; clearSnaps(); snapshot(); ingest(true, false); }
  st.alpha = clamp((target - S.W.t) / S.DT, 0, 1);
  updatePeople(dt);
  updateAnimals(time);
  updateSnakes(time);
  const night = updateEnv(dt, time);
  slowT -= dt;
  if (slowT <= 0) { slowT = 0.25; updateStructures(); }
  updateCamps(time, night);
  showCard(now);
  updateCamera(dt, now);
  renderer.render(scene, camera);
  updateLabels();
  uiT -= dt;
  if (uiT <= 0) { uiT = 0.25; hudTick(now); }
  panelT -= dt;
  if (panelT <= 0) { panelT = 1; panelTick(false); }
}

/* ---------- boot ---------- */
async function boot() {
  if (typeof THREE === 'undefined' || !THREE.OrbitControls) {
    $('#bootMsg').innerHTML = '<div class="err">The 3D engine did not download. Check your connection and reload the page.</div>';
    return;
  }
  let o = null;
  try { o = await fetchState(); st.mode = 'live'; lastOk = lastPoll = Date.now(); } catch (e) { st.mode = 'local'; }
  if (o) applyState(o, true);
  else { S.newSeason(((Math.random() * 2147483646) | 0) + 1, Date.now()); S.W.ai.on = false; ingest(true, true); }
  initThree();
  buildWorld();
  clearSnaps(); snapshot();
  initUI();
  frameWide(true);
  clock = new THREE.Clock();
  requestAnimationFrame(frame);
  setInterval(poll, POLL_MS);
  setTimeout(() => $('#boot').classList.add('done'), 150);
  window.__twelve = { S, st, R, get camera() { return camera; } };
}
boot();
