/* Procedural textures: everything is drawn at startup, nothing is downloaded. */
import * as THREE from 'three';

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashP(ix, iy, p, s) { ix = ((ix % p) + p) % p; iy = ((iy % p) + p) % p; let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function pnoise(x, y, p, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hashP(ix, iy, p, s), b = hashP(ix + 1, iy, p, s), c = hashP(ix, iy + 1, p, s), d = hashP(ix + 1, iy + 1, p, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
// tileable fractal noise in [0,1] on a size x size grid with base period `per`
function tileField(size, per, oct, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 1, n = 0, f = 1;
    for (let o = 0; o < oct; o++) { const P = per * f; v += amp * pnoise(x / size * P, y / size * P, P, seed + o * 31); n += amp; amp *= gain; f *= 2; }
    out[y * size + x] = v / n;
  }
  return out;
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function toTex(c, srgb, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
function normalFromField(f, size, strength) {
  const c = canvas(size, size), x = c.getContext('2d'), img = x.createImageData(size, size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const l = f[j * size + ((i - 1 + size) % size)], r = f[j * size + ((i + 1) % size)];
    const u = f[((j - 1 + size) % size) * size + i], d = f[((j + 1) % size) * size + i];
    let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const k = (j * size + i) * 4;
    img.data[k] = (nx * 0.5 + 0.5) * 255; img.data[k + 1] = (ny * 0.5 + 0.5) * 255; img.data[k + 2] = (nz * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

export function makeTextures() {
  const T = {};
  // ground detail: grayscale variation and a matching normal map
  const N = 256;
  const f = tileField(N, 8, 5, 7, 0.55);
  { const c = canvas(N, N), x = c.getContext('2d'), img = x.createImageData(N, N);
    for (let k = 0; k < N * N; k++) { const v = 150 + (f[k] - 0.5) * 210; img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = Math.max(0, Math.min(255, v)); img.data[k * 4 + 3] = 255; }
    x.putImageData(img, 0, 0); T.detail = toTex(c, false, true); }
  const fine = tileField(N, 32, 3, 19, 0.5);
  for (let k = 0; k < N * N; k++) fine[k] = fine[k] * 0.6 + f[k] * 0.4;
  T.detailN = toTex(normalFromField(fine, N, 6), false, true);
  // water normals: layered tileable noise
  const W = 256, wf = tileField(W, 6, 6, 101, 0.55);
  T.waterN = toTex(normalFromField(wf, W, 9), false, true);
  // broadleaf foliage cluster
  T.leaf = leafTexture(rng(3), ['#3d6b2a', '#4f7f32', '#2f5a24', '#5c8c3a', '#6e9a45']);
  T.leafDark = leafTexture(rng(5), ['#2b5222', '#355f27', '#24461d', '#41702f']);
  T.frond = frondTexture();
  T.needles = needleTexture();
  T.bark = barkTexture('#5b4532', '#3a2a1e');
  T.palmBark = palmBarkTexture();
  T.thatch = thatchTexture();
  T.cloud = cloudTexture();
  T.glow = glowTexture();
  T.smoke = smokeTexture();
  T.plank = plankTexture();
  return T;
}
function leafTexture(r, cols) {
  const S = 256, c = canvas(S, S), x = c.getContext('2d');
  for (let i = 0; i < 230; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * S * 0.42;
    const px = S / 2 + Math.cos(a) * d, py = S / 2 + Math.sin(a) * d;
    x.save(); x.translate(px, py); x.rotate(r() * Math.PI * 2);
    const l = 14 + r() * 16, w = l * (0.38 + r() * 0.15);
    x.fillStyle = cols[Math.floor(r() * cols.length)];
    x.beginPath(); x.ellipse(0, 0, l / 2, w / 2, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(20,35,10,0.35)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-l / 2, 0); x.lineTo(l / 2, 0); x.stroke();
    x.restore();
  }
  return toTex(c, true, false);
}
function frondTexture() {
  const Wd = 512, H = 128, c = canvas(Wd, H), x = c.getContext('2d');
  x.strokeStyle = '#6b6a2e'; x.lineWidth = 5; x.beginPath(); x.moveTo(0, H / 2); x.lineTo(Wd, H / 2); x.stroke();
  for (let i = 4; i < Wd - 6; i += 7) {
    const t = i / Wd, len = (H * 0.48) * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 6;
    for (const s of [-1, 1]) {
      const g = 90 + Math.floor(Math.random() * 40);
      x.strokeStyle = `rgb(${50 + g * 0.2},${g + 20},${30})`;
      x.lineWidth = 3.2;
      x.beginPath(); x.moveTo(i, H / 2); x.quadraticCurveTo(i + len * 0.35, H / 2 + s * len * 0.5, i + len * 0.55, H / 2 + s * len); x.stroke();
    }
  }
  return toTex(c, true, false);
}
function needleTexture() {
  const S = 256, c = canvas(S, S), x = c.getContext('2d');
  x.strokeStyle = '#4a3a28'; x.lineWidth = 4; x.beginPath(); x.moveTo(S / 2, 0); x.lineTo(S / 2, S); x.stroke();
  for (let y = 6; y < S; y += 4) {
    const w = (S * 0.46) * (1 - y / S * 0.5);
    for (const s of [-1, 1]) {
      x.strokeStyle = `rgb(${30 + Math.random() * 15},${70 + Math.random() * 30},${40 + Math.random() * 12})`;
      x.lineWidth = 2;
      x.beginPath(); x.moveTo(S / 2, y); x.lineTo(S / 2 + s * w * (0.7 + Math.random() * 0.3), y + 14 + Math.random() * 8); x.stroke();
    }
  }
  return toTex(c, true, false);
}
function barkTexture(a, b) {
  const Wd = 128, H = 256, c = canvas(Wd, H), x = c.getContext('2d');
  x.fillStyle = a; x.fillRect(0, 0, Wd, H);
  for (let i = 0; i < 70; i++) {
    x.strokeStyle = Math.random() < 0.6 ? b : 'rgba(150,130,100,0.35)';
    x.lineWidth = 1 + Math.random() * 3;
    const px = Math.random() * Wd;
    x.beginPath(); x.moveTo(px, 0);
    for (let y = 0; y <= H; y += 16) x.lineTo(px + Math.sin(y * 0.05 + i) * 4, y);
    x.stroke();
  }
  return toTex(c, true, true);
}
function palmBarkTexture() {
  const Wd = 64, H = 256, c = canvas(Wd, H), x = c.getContext('2d');
  x.fillStyle = '#8a7356'; x.fillRect(0, 0, Wd, H);
  for (let y = 0; y < H; y += 12) {
    x.fillStyle = 'rgba(60,45,30,0.55)'; x.fillRect(0, y, Wd, 3);
    x.fillStyle = 'rgba(190,170,140,0.25)'; x.fillRect(0, y + 4, Wd, 2);
  }
  return toTex(c, true, true);
}
function thatchTexture() {
  const S = 256, c = canvas(S, S), x = c.getContext('2d');
  x.fillStyle = '#a88a52'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 1600; i++) {
    const px = Math.random() * S, py = Math.random() * S, l = 14 + Math.random() * 26;
    x.strokeStyle = `rgba(${120 + Math.random() * 80},${95 + Math.random() * 60},${45 + Math.random() * 30},0.8)`;
    x.lineWidth = 1 + Math.random();
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + (Math.random() - 0.5) * 4, py + l); x.stroke();
  }
  return toTex(c, true, true);
}
function cloudTexture() {
  const S = 256, c = canvas(S, S), x = c.getContext('2d');
  const r = rng(77);
  for (let i = 0; i < 60; i++) {
    const px = S * (0.2 + r() * 0.6), py = S * (0.35 + r() * 0.35), rad = S * (0.06 + r() * 0.16);
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  return toTex(c, true, false);
}
function glowTexture() {
  const S = 64, c = canvas(S, S), x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return toTex(c, false, false);
}
function smokeTexture() {
  const S = 128, c = canvas(S, S), x = c.getContext('2d');
  const r = rng(9);
  for (let i = 0; i < 18; i++) {
    const px = S * (0.3 + r() * 0.4), py = S * (0.3 + r() * 0.4), rad = S * (0.12 + r() * 0.2);
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  return toTex(c, false, false);
}
function plankTexture() {
  const S = 256, c = canvas(S, S), x = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    const y = i * S / 8, base = 80 + Math.random() * 30;
    x.fillStyle = `rgb(${base + 30},${base},${base * 0.62})`; x.fillRect(0, y, S, S / 8);
    x.fillStyle = 'rgba(30,20,10,0.6)'; x.fillRect(0, y, S, 2);
    for (let k = 0; k < 10; k++) { x.strokeStyle = 'rgba(40,25,12,0.25)'; x.beginPath(); const yy = y + 4 + Math.random() * (S / 8 - 8); x.moveTo(0, yy); x.bezierCurveTo(S / 3, yy + 3, S * 2 / 3, yy - 3, S, yy); x.stroke(); }
  }
  return toTex(c, true, true);
}
