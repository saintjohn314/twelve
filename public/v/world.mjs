/* The static world: terrain, water, sky, weather, vegetation, rocks, the wreck and the docks. */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { S, st, R, T, clamp, lerp, smoothstep, hash01 } from './state.mjs';
import { makeTextures } from './tex.mjs';

export const U = { uTime: { value: 0 }, uWind: { value: 1 }, uDry: { value: 0 }, uCam: { value: new THREE.Vector3() } };
export let TX = null;
let H = null, GV = 0, B = 180, CELL = 2;

/* ---------- smooth ground height (Catmull-Rom over the sim's height grid) ---------- */
function cr(p0, p1, p2, p3, t) { return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t); }
export function groundH(x, z) {
  const fx = (x + B) / CELL, fz = (z + B) / CELL;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const g = (ii, jj) => H[clamp(jj, 0, GV - 1) * GV + clamp(ii, 0, GV - 1)];
  const r = k => cr(g(i - 1, j + k), g(i, j + k), g(i + 1, j + k), g(i + 2, j + k), u);
  return cr(r(-1), r(0), r(1), r(2), v);
}
export const groundY = (x, z) => Math.max(groundH(x, z), -0.55);

/* ---------- shader helpers ---------- */
function windify(mat, kind) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind; sh.uniforms.uCam = U.uCam;
    sh.vertexShader = 'uniform float uTime; uniform float uWind; uniform vec3 uCam;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec4 ip = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix * ip;
        #endif
        float ph = ip.x * 0.071 + ip.z * 0.053;
        float hh = max(0.0, position.y);
        ${kind === 'grass' ? `
        float s = sin(uTime * 1.9 + ph * 3.0 + ip.x * 0.3) * 0.6 + sin(uTime * 3.7 + ip.z * 0.5) * 0.25;
        transformed.x += s * uWind * 0.18 * hh * hh * 4.0;
        transformed.z += cos(uTime * 1.3 + ph * 2.0) * uWind * 0.08 * hh * hh * 4.0;
        float dc = distance(ip.xz, uCam.xz);
        transformed *= 1.0 - smoothstep(70.0, 115.0, dc);` : `
        float s = sin(uTime * 1.05 + ph) * 0.55 + sin(uTime * 2.3 + ph * 1.7) * 0.22;
        transformed.x += s * uWind * 0.0085 * hh * hh;
        transformed.z += cos(uTime * 0.83 + ph) * uWind * 0.006 * hh * hh;
        ${kind === 'leaf' ? 'transformed += normal * sin(uTime * 5.5 + position.x * 2.7 + position.z * 2.1 + ph * 4.0) * 0.035 * uWind;' : ''}`}
      }`);
  };
}

/* ---------- build ---------- */
export function buildWorld() {
  // dispose the old world a little later, after the new one has drawn: its materials keep the shader programs alive, so nothing recompiles
  if (R.world) { const old = R.world; T.scene.remove(old); setTimeout(() => old.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); }), 5000); }
  R.world = new THREE.Group();
  T.scene.add(R.world);
  if (!TX) TX = makeTextures();
  H = S.heights(); GV = S.GV; B = S.B; CELL = S.CELL;
  R.noReflect = [];
  buildLights();
  buildSky();
  buildTerrain();
  buildWater();
  buildTrees();
  buildGrass();
  buildRocks();
  buildWreck();
  buildDocks();
  buildWeather();
  st.seed = S.W.seed;
}

function buildLights() {
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(T.q.shadow, T.q.shadow);
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.04;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 900;
  R.world.add(sun); R.world.add(sun.target);
  R.sun = sun;
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0);
  R.world.add(moon); R.world.add(moon.target);
  R.moon = moon;
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a4a32, 0.35);
  R.world.add(hemi);
  R.hemi = hemi;
}

function buildSky() {
  const sky = new Sky();
  sky.scale.setScalar(2600);
  const u = sky.material.uniforms;
  u.turbidity.value = 5.5; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.84;
  R.world.add(sky);
  R.sky = sky;
  // a second sky in its own scene, used to light the world through a prefiltered environment map
  R.envScene = new THREE.Scene();
  R.envSky = new Sky();
  R.envSky.scale.setScalar(1000);
  R.envScene.add(R.envSky);
  R.pmrem = R.pmrem || new THREE.PMREMGenerator(T.renderer);
  R.envT = -1;
  // stars and moon
  const n = 2200, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const u2 = Math.random() * 0.95 + 0.05, a = Math.random() * Math.PI * 2, r = 2300, s = Math.sqrt(1 - u2 * u2); p[i * 3] = Math.cos(a) * s * r; p[i * 3 + 1] = u2 * r; p[i * 3 + 2] = Math.sin(a) * s * r; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  R.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  R.stars = new THREE.Points(g, R.starMat);
  R.world.add(R.stars);
  if ((T.q.water || 128) < 256) R.noReflect.push(R.stars);     // a coarse reflection turns each star into a block
  R.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow, color: 0xe8eeff, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  R.moonSprite.scale.setScalar(110);
  R.world.add(R.moonSprite);
}

const C = hex => new THREE.Color(hex);
const COL = { deep: C(0x2f5156), seabed: C(0xb59f74), wet: C(0xa8925f), sand: C(0xdcc89a), blackSand: C(0x4b453f), meadow: C(0x6f8d3c), lush: C(0x4f7a2d), forest: C(0x3a5424), dry: C(0x9d9656), rock: C(0x7d776c), dark: C(0x4c4741), dirt: C(0x7a6246), moss: C(0x56663a) };
const _ca = new THREE.Color(), _cb = new THREE.Color();
function biome(x, z, h, ny, out) {
  const isl = S.islandAt(x, z);
  const volcanic = isl === 3;
  const n = hash01((x * 13.1 | 0) * 7919 + (z * 7.7 | 0)) * 0.06 - 0.03;
  if (h < 0) { _ca.copy(COL.deep).lerp(COL.seabed, smoothstep(-6, -0.4, h)); if (h > -0.6) _ca.lerp(COL.wet, smoothstep(-0.6, 0, h)); }
  else if (h < 0.55) _ca.copy(volcanic ? COL.blackSand : COL.wet).lerp(volcanic ? COL.blackSand : COL.sand, smoothstep(0.05, 0.55, h));
  else if (h < 1.45) { _ca.copy(volcanic ? COL.blackSand : COL.sand); _cb.copy(COL.meadow); _ca.lerp(_cb, smoothstep(1.0, 1.45, h)); }
  else {
    const f = S.forestAt(x, z);
    _ca.copy(COL.meadow).lerp(COL.lush, smoothstep(0.4, 0.6, f));
    if (f > 0.52) _ca.lerp(COL.forest, smoothstep(0.52, 0.66, f));
    else if (f < 0.42 && h < 6.5) _ca.lerp(COL.dry, smoothstep(0.42, 0.3, f) * 0.8);
    if (h > 7.5) _ca.lerp(volcanic ? COL.dark : COL.rock, smoothstep(7.5, 12, h) * 0.8);
    if (volcanic && h > 11) _ca.lerp(COL.dark, 0.6);
  }
  if (h > 0.6 && ny < 0.86) _ca.lerp(volcanic ? COL.dark : COL.rock, smoothstep(0.86, 0.7, ny));
  out[0] = _ca.r * (1 + n); out[1] = _ca.g * (1 + n); out[2] = _ca.b * (1 + n * 0.7);
  return h > 1.45 && ny > 0.82 ? 1 : 0;
}
function buildTerrain() {
  const RES = Math.round(2 * B / (T.q.tstep || 1));
  const geo = new THREE.PlaneGeometry(2 * B, 2 * B, RES, RES);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, nv = pos.count;
  for (let i = 0; i < nv; i++) pos.setY(i, groundH(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const col = new Float32Array(nv * 3), grassA = new Float32Array(nv), uv = geo.attributes.uv, nrm = geo.attributes.normal, tmp = [0, 0, 0];
  for (let i = 0; i < nv; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    grassA[i] = biome(x, z, pos.getY(i), nrm.getY(i), tmp);
    col[i * 3] = tmp[0]; col[i * 3 + 1] = tmp[1]; col[i * 3 + 2] = tmp[2];
    uv.setXY(i, x / 7, z / 7);
  }
  R.terrainBase = col.slice();
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aGrass', new THREE.BufferAttribute(grassA, 1));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, normalMap: TX.detailN, normalScale: new THREE.Vector2(0.7, 0.7) });
  mat.onBeforeCompile = sh => {
    sh.uniforms.detailMap = { value: TX.detail };
    sh.uniforms.uDry = U.uDry;
    sh.vertexShader = 'attribute float aGrass; varying float vGrass; varying vec2 vWUv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vGrass = aGrass; vWUv = uv;');
    sh.fragmentShader = 'uniform sampler2D detailMap; uniform float uDry; varying float vGrass; varying vec2 vWUv;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float d1 = texture2D(detailMap, vWUv).r, d2 = texture2D(detailMap, vWUv * 0.17).r;
      diffuseColor.rgb *= 0.62 + 0.48 * d1 * 0.6 + 0.48 * d2 * 0.4 + 0.12;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.32, 1.08, 0.55), vGrass * uDry);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  R.world.add(mesh);
  R.terrain = mesh;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshStandardMaterial({ color: 0x1f3c45, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -9.5;
  R.world.add(floor);
}
// paint camps (worn earth) and trade paths onto the terrain colors
export function paintGround(camps, paths) {
  const geo = R.terrain.geometry, col = geo.attributes.color, pos = geo.attributes.position, base = R.terrainBase;
  col.array.set(base);
  const dirt = COL.dirt;
  const paint = (x, z, r, k) => {
    const RES = Math.round(2 * B / (T.q.tstep || 1)), step = 2 * B / RES;
    const i0 = clamp(Math.floor((x - r + B) / step), 0, RES), i1 = clamp(Math.ceil((x + r + B) / step), 0, RES);
    const j0 = clamp(Math.floor((z - r + B) / step), 0, RES), j1 = clamp(Math.ceil((z + r + B) / step), 0, RES);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const v = j * (RES + 1) + i, dx = pos.getX(v) - x, dz = pos.getZ(v) - z, d = Math.sqrt(dx * dx + dz * dz);
      if (d > r || pos.getY(v) < 0.4) continue;
      const a = k * (1 - smoothstep(r * 0.55, r, d)) * (0.75 + hash01(v) * 0.25);
      col.array[v * 3] = lerp(col.array[v * 3], dirt.r, a); col.array[v * 3 + 1] = lerp(col.array[v * 3 + 1], dirt.g, a); col.array[v * 3 + 2] = lerp(col.array[v * 3 + 2], dirt.b, a);
    }
  };
  for (const c of camps) paint(c.x, c.z, 7.5, 0.75);
  for (const p of paths) {
    const L = Math.hypot(p.bx - p.ax, p.bz - p.az), n = Math.ceil(L / 1.5);
    for (let k = 0; k <= n; k++) { const t = k / n, wob = Math.sin(t * 9 + p.ax) * 2.2 * Math.sin(Math.PI * t); const nx = -(p.bz - p.az) / L, nz = (p.bx - p.ax) / L; paint(lerp(p.ax, p.bx, t) + nx * wob, lerp(p.az, p.bz, t) + nz * wob, 1.5, 0.55); }
  }
  col.needsUpdate = true;
}

function buildWater() {
  const res = T.q.water || 128;
  const water = new Water(new THREE.PlaneGeometry(5000, 5000), {
    textureWidth: res, textureHeight: res, waterNormals: TX.waterN, sunDirection: new THREE.Vector3(0.7, 0.7, 0), sunColor: 0xffffff,
    waterColor: 0x0b4356, distortionScale: 2.4, fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  const m = water.material, u = m.uniforms;
  u.size.value = 1.6;
  // heights of the sea floor, so the shallows can glow turquoise and the surf can foam
  const N = GV, data = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) data[k] = clamp((H[k] + 10) / 30, 0, 1) * 255;
  const ht = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  ht.magFilter = ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
  u.heightTex = { value: ht };
  u.gridB = { value: B };
  u.shallowColor = { value: new THREE.Color(0x3fd3c5) };
  u.storm = { value: 0 };
  u.dayLight = { value: 1 };
  m.transparent = true;
  m.fragmentShader = m.fragmentShader
    .replace('uniform vec3 waterColor;', 'uniform vec3 waterColor; uniform sampler2D heightTex; uniform float gridB; uniform vec3 shallowColor; uniform float storm; uniform float dayLight;')
    .replace(/vec3 outgoingLight = albedo;\s*gl_FragColor = vec4\( outgoingLight, alpha \);/, `
      vec2 huv = (worldPosition.xz + gridB) / (2.0 * gridB);
      float inside = step(0.0, huv.x) * step(huv.x, 1.0) * step(0.0, huv.y) * step(huv.y, 1.0);
      float th = mix(-10.0, texture2D(heightTex, huv).r * 30.0 - 10.0, inside);
      float depth = max(0.0, -th);
      float shallow = 1.0 - smoothstep(0.0, 6.5, depth);
      vec3 lagoon = shallowColor * (0.35 + 0.65 * dayLight) * (0.55 + 0.45 * max(dot(surfaceNormal, sunDirection), 0.0));
      vec3 col = mix(albedo, mix(albedo, lagoon, 0.75) + reflectionSample * 0.12, shallow * (1.0 - storm * 0.5));
      float wave = sin(time * 1.7 - depth * 6.0 + noise.x * 2.5) * 0.5 + 0.5;
      float foam = (1.0 - smoothstep(0.0, 0.9, depth)) * (0.35 + 0.65 * wave) * step(0.02, depth + 0.02);
      foam += (1.0 - smoothstep(0.0, 0.22, depth)) * 0.6;
      foam *= smoothstep(0.35, 0.65, noise.y * 0.5 + 0.5 + wave * 0.3);
      foam += storm * 0.25 * smoothstep(0.8, 1.0, noise.z * 0.5 + 0.5);
      col = mix(col, vec3(0.92, 0.95, 0.95) * (0.3 + 0.7 * dayLight), clamp(foam, 0.0, 0.85));
      float a = mix(0.62, 1.0, smoothstep(0.2, 3.5, depth));
      vec3 outgoingLight = col;
      gl_FragColor = vec4(outgoingLight, a * alpha);`);
  const orig = water.onBeforeRender;
  let fc = 0;
  const every = T.qname === 'low' ? 3 : 1;
  water.onBeforeRender = function (r, sc, cam) {
    u.eye.value.setFromMatrixPosition(cam.matrixWorld);
    if ((fc++ % every) !== 0) return;
    const hid = [];
    for (const o of R.noReflect) if (o && o.visible) { o.visible = false; hid.push(o); }
    orig.call(this, r, sc, cam);
    for (const o of hid) o.visible = true;
  };
  R.world.add(water);
  R.water = water;
}

/* ---------- vegetation ---------- */
function nonIdx(g) { return g.index ? g.toNonIndexed() : g; }
function prep(g) { g = nonIdx(g); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }
function trunk(h, r0, r1, bendX, bendZ, rad = 7, seg = 6, vRep = 3) {
  const g = new THREE.CylinderGeometry(r1, r0, h, rad, seg, true);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const t = p.getY(i) / h; p.setX(i, p.getX(i) + bendX * t * t); p.setZ(i, p.getZ(i) + bendZ * t * t); uv.setY(i, uv.getY(i) * vRep); }
  g.computeVertexNormals();
  return prep(g);
}
function card(w, h, x, y, z, rx, ry, rz) {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz || 0); g.translate(x, y, z);
  return prep(g);
}
function palmGeos(rnd) {
  const H0 = 6.5, bend = 1.4;
  const bark = trunk(H0, 0.2, 0.13, bend, 0.3, 8, 10, 8);
  const leaves = [];
  const top = new THREE.Vector3(bend, H0, 0.3);
  const n = 12;
  for (let i = 0; i < n; i++) {
    const len = 3.2 + rnd() * 0.9, wd = 1.1, segs = 10;
    const g = new THREE.PlaneGeometry(len, wd, segs, 1);
    g.translate(len / 2, 0, 0);
    const p = g.attributes.position;
    const up = 0.55 - (i % 3) * 0.35, droop = 0.16 + rnd() * 0.06;
    for (let k = 0; k < p.count; k++) { const x = p.getX(k); p.setY(k, p.getY(k) * 0.5); p.setZ(k, p.getY(k)); p.setY(k, x * up - x * x * droop); }
    g.computeVertexNormals();
    g.rotateY(i / n * Math.PI * 2 + rnd() * 0.3);
    g.translate(top.x, top.y, top.z);
    leaves.push(prep(g));
  }
  for (let i = 0; i < 4; i++) { const s = new THREE.SphereGeometry(0.16, 7, 5); s.translate(top.x + Math.cos(i * 1.6) * 0.25, top.y - 0.25, top.z + Math.sin(i * 1.6) * 0.25); bark.__nuts = (bark.__nuts || []).concat([prep(s)]); }
  const barkAll = mergeGeometries([bark].concat(bark.__nuts));
  return { bark: barkAll, leaf: mergeGeometries(leaves) };
}
function broadGeos(rnd, size) {
  const s = size || 1;
  const parts = [trunk(3.2 * s, 0.26 * s, 0.14 * s, 0.2, -0.1, 8, 5, 2)];
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + 0.4, len = 1.8 * s;
    const b = trunk(len, 0.1 * s, 0.05 * s, 0, 0, 5, 2, 1);
    b.rotateZ(-0.9); b.rotateY(a); b.translate(0, 2.4 * s, 0);
    parts.push(b);
  }
  const leaves = [];
  const cx = 0, cy = 4.1 * s, n = 34;
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const x = Math.cos(a) * r * 2.3 * s, y = u * 1.5 * s, z = Math.sin(a) * r * 2.3 * s;
    const w = (1.7 + rnd() * 0.6) * s;
    leaves.push(card(w, w, cx + x * 0.85, cy + y * 0.85, z * 0.85, -Math.PI / 2 + u * 0.9 + (rnd() - 0.5) * 0.6, a + rnd(), (rnd() - 0.5) * 0.8));
  }
  for (let i = 0; i < 8; i++) { const w = 1.8 * s; leaves.push(card(w, w, (rnd() - 0.5) * 1.6 * s, cy + (rnd() - 0.5) * 1.2 * s, (rnd() - 0.5) * 1.6 * s, rnd() * 3, rnd() * 3, rnd() * 3)); }
  return { bark: mergeGeometries(parts), leaf: mergeGeometries(leaves) };
}
function coniferGeos(rnd) {
  const Ht = 8;
  const bark = trunk(Ht, 0.24, 0.04, 0, 0, 7, 6, 4);
  const leaves = [];
  const tiers = 8;
  for (let t = 0; t < tiers; t++) {
    const y = 1.6 + t / tiers * (Ht - 2.2), rad = (1 - t / tiers) * 2.4 + 0.35, k = 7 + Math.max(0, 3 - t);
    for (let i = 0; i < k; i++) {
      const a = i / k * Math.PI * 2 + t * 0.7 + rnd() * 0.2;
      const g = new THREE.PlaneGeometry(rad * 0.9, rad * 1.1);
      g.rotateX(-Math.PI / 2);
      g.rotateZ(0);
      g.translate(0, 0, rad * 0.5);
      g.rotateX(0.42 + rnd() * 0.12);
      g.rotateY(a);
      g.translate(0, y, 0);
      leaves.push(prep(g));
    }
  }
  const tip = new THREE.ConeGeometry(0.35, 1.2, 6); tip.translate(0, Ht - 0.2, 0); leaves.push(prep(tip));
  return { bark, leaf: mergeGeometries(leaves) };
}
function bushGeo(rnd) {
  const leaves = [];
  for (let i = 0; i < 12; i++) { const a = rnd() * Math.PI * 2, r = rnd() * 0.5; leaves.push(card(1.1 + rnd() * 0.4, 1.0 + rnd() * 0.3, Math.cos(a) * r, 0.5 + rnd() * 0.35, Math.sin(a) * r, rnd() * 3, rnd() * 3, rnd() * 3)); }
  return mergeGeometries(leaves);
}
function leafMat(map, color) {
  const m = new THREE.MeshStandardMaterial({ map, color: color || 0xffffff, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
  windify(m, 'leaf');
  return m;
}
function barkMat(map) { const m = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 }); windify(m, 'bark'); return m; }
function depthFor(map) { return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.42 }); }
function instPair(geos, bmat, lmat, list, depthMap) {
  const n = Math.max(1, list.length);
  const bm = new THREE.InstancedMesh(geos.bark, bmat, n), lm = new THREE.InstancedMesh(geos.leaf, lmat, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  list.forEach((w, i) => {
    q.setFromAxisAngle(v.set(0, 1, 0), w.r);
    m4.compose(v.set(w.x, groundH(w.x, w.z) - 0.15, w.z), q, s.set(w.s, w.s * (w.sy || 1), w.s));
    bm.setMatrixAt(i, m4); lm.setMatrixAt(i, m4);
    const t = hash01(i * 31 + 7);
    lm.setColorAt(i, c.setRGB(0.82 + t * 0.3, 0.86 + t * 0.22, 0.78 + t * 0.2));
  });
  bm.count = lm.count = list.length;
  for (const m of [bm, lm]) { m.castShadow = true; m.receiveShadow = true; }
  lm.customDepthMaterial = depthFor(depthMap);
  R.world.add(bm); R.world.add(lm);
  return { bm, lm };
}
function buildTrees() {
  const rnd = (() => { let a = 12345; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const woods = S.woods().filter((w, i) => hash01(i * 13) < T.q.trees);
  const kinds = { conifer: [], broad: [], palm: [] };
  for (const w of woods) (w.k === 0 ? kinds.conifer : w.k === 1 ? kinds.broad : kinds.palm).push({ x: w.x, z: w.z, r: w.r, s: w.s * (w.k === 2 ? 1.05 : 1) });
  const bmat = barkMat(TX.bark), pbmat = barkMat(TX.palmBark);
  R.trees = {
    conifer: instPair(coniferGeos(rnd), bmat, leafMat(TX.needles, 0xcfe0c8), kinds.conifer, TX.needles),
    broad: instPair(broadGeos(rnd), bmat, leafMat(TX.leaf), kinds.broad, TX.leaf),
    palm: instPair(palmGeos(rnd), pbmat, leafMat(TX.frond), kinds.palm, TX.frond),
  };
  // fruit trees (the sim's food sources) with fruit we can count
  const W = S.W;
  const ft = W.trees.map((t, i) => ({ x: t.x, z: t.z, r: i * 1.37, s: 0.85 + hash01(i) * 0.25 }));
  R.fruitTrees = instPair(broadGeos(rnd, 0.9), bmat, leafMat(TX.leaf, 0xe6f0d0), ft, TX.leaf);
  let nf = 0;
  R.fruitSlots = W.trees.map((t, i) => {
    const sl = [], sc = ft[i].s;
    for (let k = 0; k < t.m; k++) { const a = k / t.m * Math.PI * 2 + i, r = 1.6 + hash01(i * 7 + k) * 0.5; sl.push([t.x + Math.cos(a) * r * sc, groundH(t.x, t.z) + (3.0 + hash01(k * 3 + i) * 1.6) * sc, t.z + Math.sin(a) * r * sc]); nf++; }
    return sl;
  });
  R.fruit = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.5 }), Math.max(1, nf));
  let q = 0;
  const c = new THREE.Color();
  W.trees.forEach((t, i) => R.fruitSlots[i].forEach(() => { R.fruit.setColorAt(q++, t.isl === 2 ? c.setHex(0xf0a020) : t.isl === 3 ? c.setHex(0xd8482a) : c.setHex(0xc8301e)); }));
  R.fruit.count = nf;
  R.fruit.castShadow = true;
  R.world.add(R.fruit);
  // bushes with berries
  const bl = W.bushes.map((b, i) => ({ x: b.x, z: b.z, r: i * 0.9, s: 0.9 + hash01(i * 5) * 0.4 }));
  const bg = bushGeo(rnd);
  R.bush = new THREE.InstancedMesh(bg, leafMat(TX.leafDark), Math.max(1, bl.length));
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  bl.forEach((b, i) => { qq.setFromAxisAngle(v.set(0, 1, 0), b.r); m4.compose(v.set(b.x, groundH(b.x, b.z) - 0.05, b.z), qq, s.set(b.s, b.s, b.s)); R.bush.setMatrixAt(i, m4); });
  R.bush.count = bl.length; R.bush.castShadow = true; R.bush.receiveShadow = true;
  R.bush.customDepthMaterial = depthFor(TX.leafDark);
  R.world.add(R.bush);
  R.berry = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 6, 5), new THREE.MeshStandardMaterial({ color: 0x5b2a8a, roughness: 0.4 }), Math.max(1, W.bushes.length * 5));
  R.berry.count = W.bushes.length * 5;
  R.world.add(R.berry);
}
function buildGrass() {
  const N = T.q.grass;
  if (!N) return;
  const blades = [];
  const rnd = (() => { let a = 999; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  for (let b = 0; b < 9; b++) {
    const h = 0.28 + rnd() * 0.32, w = 0.05 + rnd() * 0.03, a = rnd() * Math.PI * 2, ox = (rnd() - 0.5) * 0.35, oz = (rnd() - 0.5) * 0.35, lean = (rnd() - 0.3) * 0.18;
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = [[-w, 0], [w, 0], [-w * 0.6, h * 0.55], [w * 0.6, h * 0.55], [0, h]];
    const v = P.map(([x, y]) => { const yy = y, lx = x, lz = lean * (y / h) * (y / h) * 2.5; return [ox + lx * ca - lz * sa, yy, oz + lx * sa + lz * ca]; });
    const tri = [0, 1, 2, 1, 3, 2, 2, 3, 4];
    for (const k of tri) blades.push(v[k]);
  }
  const pos = new Float32Array(blades.length * 3), col = new Float32Array(blades.length * 3);
  blades.forEach((p, i) => { pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; const t = p[1] / 0.6; col[i * 3] = lerp(0.08, 0.38, t); col[i * 3 + 1] = lerp(0.16, 0.48, t); col[i * 3 + 2] = lerp(0.04, 0.12, t); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const nrm = g.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, nrm.getX(i) * 0.3, 1, nrm.getZ(i) * 0.3);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.88 });
  windify(mat, 'grass');
  const m = new THREE.InstancedMesh(g, mat, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  let n = 0, tries = 0;
  while (n < N && tries < N * 8) {
    tries++;
    const x = (rnd() * 2 - 1) * B, z = (rnd() * 2 - 1) * B;
    const isl = S.islandAt(x, z);
    if (!isl || isl > 3) continue;
    const h = groundH(x, z);
    if (h < 1.35 || h > 10.5) continue;
    const sl = Math.abs(groundH(x + 1, z) - groundH(x - 1, z)) + Math.abs(groundH(x, z + 1) - groundH(x, z - 1));
    if (sl > 1.1) continue;
    const f = S.forestAt(x, z);
    if (rnd() > (f < 0.42 ? 0.55 : f > 0.6 ? 0.45 : 1)) continue;
    q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6.28);
    const sc = 0.75 + rnd() * 0.7;
    m4.compose(v.set(x, h - 0.03, z), q, s.set(sc, sc * (0.8 + rnd() * 0.5), sc));
    m.setMatrixAt(n, m4);
    const dry = f < 0.42 ? 0.5 : 0, t = rnd();
    m.setColorAt(n, c.setRGB(0.85 + dry * 0.5 + t * 0.2, 0.9 + t * 0.15, 0.7 + t * 0.1 - dry * 0.2));
    n++;
  }
  m.count = n;
  m.receiveShadow = true;
  m.frustumCulled = false;
  R.world.add(m);
  R.grass = m;
  R.noReflect.push(m);
}
function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.22 * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + seed) + 0.12 * Math.sin(y * 5.3 + x * 2 + seed * 2) + 0.06 * Math.sin(x * 11 + z * 9);
    p.setXYZ(i, x * n, y * n * 0.72, z * n);
  }
  g.computeVertexNormals();
  return g;
}
function buildRocks() {
  const rocks = S.rocks();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b857a, roughness: 0.9, normalMap: TX.detailN, normalScale: new THREE.Vector2(1.1, 1.1) });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4f4a45, roughness: 0.85, normalMap: TX.detailN, normalScale: new THREE.Vector2(1.1, 1.1) });
  R.rocks = [];
  for (let k = 0; k < 3; k++) {
    for (const vol of [false, true]) {
      const list = rocks.filter((r, i) => i % 3 === k && (S.islandAt(r.x, r.z) === 3) === vol);
      if (!list.length) continue;
      const m = new THREE.InstancedMesh(rockGeo(k * 5.3 + 1), vol ? dark : mat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
      list.forEach((r, i) => { q.setFromEuler(new THREE.Euler(0, r.r, (hash01(i) - 0.5) * 0.3)); m4.compose(v.set(r.x, groundH(r.x, r.z) - 0.25 * r.s, r.z), q, s.set(r.s, r.s * 0.85, r.s * 1.1)); m.setMatrixAt(i, m4); const t = hash01(i * 3 + k); m.setColorAt(i, c.setRGB(0.85 + t * 0.3, 0.85 + t * 0.28, 0.8 + t * 0.2)); });
      m.castShadow = true; m.receiveShadow = true;
      R.world.add(m); R.rocks.push(m);
    }
  }
}
function buildWreck() {
  const w = S.W.wreck;
  if (!w) return;
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ map: TX.plank, color: 0x8a7058, roughness: 0.9, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.9 });
  const hullG = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const hp = hullG.attributes.position;
  for (let i = 0; i < hp.count; i++) { const x = hp.getX(i); hp.setX(i, x * (1 + 0.15 * Math.abs(hp.getZ(i)))); }
  hullG.scale(7.5, 2.6, 2.3);
  hullG.computeVertexNormals();
  const hull = new THREE.Mesh(hullG, wood);
  hull.position.y = 1.2; hull.castShadow = true; hull.receiveShadow = true;
  g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 0.2, 3.2), wood);
  deck.position.set(-2.2, 1.05, 0); deck.rotation.z = 0.04; deck.castShadow = true;
  g.add(deck);
  for (let i = 0; i < 7; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.11, 5, 12, Math.PI * 0.55), dark);
    rib.rotation.set(0, Math.PI / 2, Math.PI * 1.22 + (i % 2) * 0.08);
    rib.position.set(2.2 + i * 0.75, 1.3, 0);
    rib.castShadow = true;
    g.add(rib);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 8.5, 8), dark);
  mast.position.set(-2.6, 4.2, 0.6); mast.rotation.set(0.25, 0, 0.55); mast.castShadow = true;
  g.add(mast);
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 2.2, 8), dark);
  stump.position.set(1.4, 2.0, 0); g.add(stump);
  const sailG = new THREE.PlaneGeometry(4.6, 3.2, 8, 6), sp = sailG.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin(sp.getX(i) * 0.9) * 0.4 + Math.cos(sp.getY(i) * 1.3) * 0.25);
  sailG.computeVertexNormals();
  const sail = new THREE.Mesh(sailG, new THREE.MeshStandardMaterial({ color: 0xd8ccb2, roughness: 0.95, side: THREE.DoubleSide }));
  sail.position.set(-4.6, 2.4, 1.6); sail.rotation.set(-1.0, 0.35, 0.2); sail.castShadow = true;
  g.add(sail);
  g.position.set(w.sx, -0.7, w.sz);
  g.rotation.set(0.1, -w.dir + Math.PI / 2, 0.24);
  R.world.add(g);
  const props = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const a = hash01(i * 3) * 6.283, r = 2 + hash01(i * 7) * 10;
    const x = w.x + Math.cos(a) * r, z = w.z + Math.sin(a) * r;
    if (groundH(x, z) < -0.2) continue;
    let o;
    if (i % 5 === 0) { o = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.85, 12), wood); o.rotation.z = hash01(i) > 0.5 ? Math.PI / 2 : 0; o.position.y = 0.35; }
    else { o = new THREE.Mesh(new THREE.BoxGeometry(1.4 + hash01(i) * 1.6, 0.08, 0.26), wood); o.position.y = 0.06; }
    o.position.x = x; o.position.z = z; o.position.y += groundY(x, z);
    o.rotation.y = hash01(i * 9) * 6.283; o.castShadow = true;
    props.add(o);
  }
  R.world.add(props);
}
function buildDocks() {
  const W = S.W, wood = new THREE.MeshStandardMaterial({ map: TX.plank, color: 0x9a8063, roughness: 0.9 });
  const post = new THREE.CylinderGeometry(0.12, 0.14, 2.6, 7);
  for (const k of [1, 2, 3]) {
    const d = W.docks && W.docks[k];
    if (!d) continue;
    const other = S.ISLES[S.nearestIsle(k)], c = S.ISLES[k];
    let dir = Math.atan2(other.z - c.z, other.x - c.x);
    // point the jetty toward deeper water
    let best = dir, bd = 0;
    for (let a = 0; a < 16; a++) { const an = a / 16 * Math.PI * 2, h = groundH(d.x + Math.cos(an) * 8, d.z + Math.sin(an) * 8); if (-h > bd) { bd = -h; best = an; } }
    dir = best;
    const g = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 1.7), wood);
    deck.position.set(3.5, 0.75, 0); deck.castShadow = true; deck.receiveShadow = true;
    g.add(deck);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const p = new THREE.Mesh(post, wood); p.position.set(i * 2.6, -0.4, s * 0.8); p.castShadow = true; g.add(p); }
    g.position.set(d.x, 0, d.z);
    g.rotation.y = -dir;
    R.world.add(g);
  }
}
function buildWeather() {
  const n = 2600, p = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) { const x = (Math.random() - 0.5) * 140, y = Math.random() * 70, z = (Math.random() - 0.5) * 140; p.set([x, y, z, x + 0.25, y - 1.1, z], i * 6); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  R.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaabccc, transparent: true, opacity: 0.45, depthWrite: false }));
  R.rain.visible = false; R.rain.frustumCulled = false;
  R.world.add(R.rain);
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(20 * 3), 3));
  R.bolt = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: 0xf4f0ff, transparent: true, fog: false }));
  R.bolt.visible = false; R.bolt.frustumCulled = false;
  R.world.add(R.bolt);
  R.clouds = [];
  for (let i = 0; i < 46; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.cloud, color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 700;
    m.position.set(Math.cos(a) * r, 150 + Math.random() * 90, Math.sin(a) * r);
    const sc = 140 + Math.random() * 180; m.scale.set(sc, sc * 0.45, 1);
    m.userData.v = 1.2 + Math.random();
    R.world.add(m); R.clouds.push(m);
  }
}

/* ---------- per frame ---------- */
const _sunDir = new THREE.Vector3(), _c1 = new THREE.Color(), _c2 = new THREE.Color();
const FOG_DAY = new THREE.Color(0xb9cfdc), FOG_DUSK = new THREE.Color(0xd9a986), FOG_NIGHT = new THREE.Color(0x0a1220), FOG_STORM = new THREE.Color(0x5e6a72);
export const env = { day: 1, night: 0, storm: 0, hour: 12 };
export function updateWorld(dt, time) {
  const W = S.W;
  const hour = (W.t + st.alpha * S.DT) % 24;
  env.hour = hour;
  const ang = (hour - 6) / 24 * Math.PI * 2;                  // sunrise at 6, sunset at 18
  const elev = Math.sin(ang), az = Math.cos(ang);
  _sunDir.set(-az * 0.85, elev, 0.42).normalize();
  const day = smoothstep(-0.08, 0.25, elev), dusk = smoothstep(0.35, 0.0, Math.abs(elev)) * smoothstep(-0.25, 0.0, elev);
  const storm = W.wx.storm > 0 ? smoothstep(0, 1.5, W.wx.storm) : Math.max(0, env.storm - dt * 0.3);
  env.day = day; env.night = 1 - day; env.storm = storm;
  U.uTime.value = time;
  U.uWind.value = 0.7 + storm * 2.2 + Math.sin(time * 0.13) * 0.2;
  U.uDry.value += ((W.wx.drought > 0 ? 1 : 0) - U.uDry.value) * Math.min(1, dt * 0.2);
  U.uCam.value.copy(T.camera.position);
  const su = R.sky.material.uniforms;
  su.sunPosition.value.copy(_sunDir).multiplyScalar(1000);
  su.turbidity.value = 5 + storm * 12;
  su.rayleigh.value = lerp(1.3, 0.6, storm) + dusk * 0.8;
  // environment lighting refresh
  if (Math.abs(R.envT - hour) > 0.12 || R.envStorm !== Math.round(storm * 5)) {
    R.envT = hour; R.envStorm = Math.round(storm * 5);
    const eu = R.envSky.material.uniforms;
    eu.sunPosition.value.copy(su.sunPosition.value); eu.turbidity.value = su.turbidity.value; eu.rayleigh.value = su.rayleigh.value; eu.mieCoefficient.value = su.mieCoefficient.value; eu.mieDirectionalG.value = su.mieDirectionalG.value;
    const rt = R.pmrem.fromScene(R.envScene, 0.04);
    if (R.envRT) R.envRT.dispose();
    R.envRT = rt;
    T.scene.environment = rt.texture;
  }
  T.scene.environmentIntensity = lerp(0.12, 0.85, day) * (1 - storm * 0.45);
  // sun and moon
  const tg = T.controls.target;
  const sun = R.sun, camD = T.camera.position.distanceTo(tg);
  const half = clamp(camD * 0.75, 22, 170);
  const sc = sun.shadow.camera;
  if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.updateProjectionMatrix(); }
  const snap = half * 2 / T.q.shadow;
  const sx = Math.round(tg.x / snap) * snap, sz = Math.round(tg.z / snap) * snap;
  const sd = elev > 0.02 ? _sunDir : _c1.setRGB(0, 0, 0) && new THREE.Vector3(az * 0.5, Math.max(0.3, -elev), -0.4).normalize();
  sun.position.set(sx + sd.x * 400, Math.max(0, tg.y) + sd.y * 400, sz + sd.z * 400);
  sun.target.position.set(sx, Math.max(0, tg.y), sz);
  sun.intensity = elev > 0.0 ? lerp(0.0, 2.8, smoothstep(0.0, 0.3, elev)) * (1 - storm * 0.7) : 0;
  sun.color.setRGB(1, lerp(0.62, 0.95, smoothstep(0, 0.45, elev)), lerp(0.38, 0.88, smoothstep(0, 0.45, elev)));
  sun.castShadow = sun.intensity > 0.05;
  R.moon.intensity = (1 - day) * 0.35 * (1 - storm);
  R.moon.position.set(tg.x + 200, 300, tg.z - 120); R.moon.target.position.copy(tg);
  R.hemi.intensity = lerp(0.12, 0.42, day) * (1 - storm * 0.3) + (st.bolt > 0 ? st.bolt * 6 : 0);
  R.hemi.color.setRGB(lerp(0.4, 0.8, day), lerp(0.48, 0.88, day), lerp(0.75, 1, day));
  T.renderer.toneMappingExposure = lerp(0.75, 0.62, day) + (1 - day) * 0.3 + (st.bolt > 0 ? st.bolt * 2 : 0);
  // fog and sky dome extras
  _c1.copy(FOG_NIGHT).lerp(FOG_DAY, day).lerp(FOG_DUSK, dusk * 0.6).lerp(FOG_STORM, storm * 0.85 * Math.max(0.3, day));
  T.scene.fog.color.copy(_c1);
  T.scene.fog.density = lerp(0.0011, 0.0045, storm) + (1 - day) * 0.0004;
  R.starMat.opacity = clamp((1 - day) * 1.4 - 0.2, 0, 1) * (1 - storm);
  R.stars.position.set(T.camera.position.x, 0, T.camera.position.z);
  R.moonSprite.position.set(T.camera.position.x + 900, 1100, T.camera.position.z - 1300);
  R.moonSprite.material.opacity = (1 - day) * (1 - storm) * 0.9;
  // water
  const wu = R.water.material.uniforms;
  wu.time.value = time * (0.6 + storm * 0.8);
  wu.sunDirection.value.copy(elev > 0 ? _sunDir : new THREE.Vector3(0.4, 0.6, -0.3).normalize());
  wu.sunColor.value.setRGB(1, 0.95, 0.85).multiplyScalar(elev > 0 ? 1 - storm * 0.6 : 0.25);
  wu.waterColor.value.setHex(0x0b4356).lerp(_c2.setHex(0x26333a), storm * 0.7).multiplyScalar(0.25 + 0.75 * day);
  wu.distortionScale.value = 2.4 + storm * 4;
  wu.storm.value = storm; wu.dayLight.value = day;
  // clouds
  for (const c of R.clouds) {
    c.position.x += dt * c.userData.v * (1 + storm * 4);
    if (c.position.x - tg.x > 800) c.position.x -= 1600;
    c.material.color.copy(_c2.setRGB(1, 1, 1)).lerp(FOG_DUSK, dusk * 0.6).multiplyScalar(0.25 + 0.75 * day).lerp(_c1.setHex(0x55606a), storm * 0.8);
    c.material.opacity = 0.35 + storm * 0.55;
  }
  // rain and lightning
  R.rain.visible = storm > 0.05;
  if (R.rain.visible) {
    const p = R.rain.geometry.attributes.position, a = p.array;
    for (let i = 0; i < a.length; i += 6) { let y = a[i + 1] - dt * 38; if (y < 0) { y += 70; } const dy = y - a[i + 1]; a[i + 1] = y; a[i + 4] += dy; a[i] += dt * 4; a[i + 3] += dt * 4; if (a[i] > 70) { a[i] -= 140; a[i + 3] -= 140; } }
    p.needsUpdate = true;
    R.rain.position.set(T.camera.position.x, Math.max(0, T.camera.position.y - 40), T.camera.position.z);
    R.rain.material.opacity = 0.25 + storm * 0.3;
  }
  if (W.flash && W.flash.n !== st.flashN) {
    const first = st.flashN === 0;
    st.flashN = W.flash.n;
    if (!first) strike();
  }
  if (storm > 0.5 && Math.random() < dt * 0.06) strike();
  if (st.bolt > 0) { st.bolt -= dt; R.bolt.visible = st.bolt > 0.1; R.bolt.material.opacity = clamp(st.bolt / 0.35, 0, 1); } else R.bolt.visible = false;
  return { day, night: 1 - day, storm, hour };
}
function strike() {
  st.bolt = 0.4;
  const tg = T.controls.target;
  const fx = tg.x + (Math.random() - 0.5) * 260, fz = tg.z + (Math.random() - 0.5) * 260, gy = Math.max(0, groundH(fx, fz));
  const p = R.bolt.geometry.attributes.position;
  let x = fx, z = fz;
  for (let i = 0; i < 20; i++) { const k = i / 19; p.setXYZ(i, x, lerp(220, gy, k), z); x += (Math.random() - 0.5) * 9; z += (Math.random() - 0.5) * 9; }
  p.setXYZ(19, fx, gy, fz);
  p.needsUpdate = true;
  st.thunder = (st.thunder || 0) + 1;
  st.thunderDist = Math.hypot(fx - T.camera.position.x, fz - T.camera.position.z);
}
