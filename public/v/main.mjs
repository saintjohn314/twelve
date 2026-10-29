/* Boot, sync with the live world on the server (or run a private sandbox), and the main loop. */
import * as THREE from 'three';
import { S, st, R, T, $, clamp } from './state.mjs';
import { initCore, detectQuality, render } from './core.mjs';
import { buildWorld, updateWorld } from './world.mjs';
import { buildActors, updateActors, snapshot, clearSnaps, smooth, renderList } from './actors.mjs';
import { initCamera, updateCamera, frameWide, setDirector } from './camera.mjs';
import * as UI from './ui.mjs';
import { setSound, updateSound } from './sound.mjs';

const POLL_MS = 45000;
let clock = null, time = 0, polling = false;

/* ---------- server sync ---------- */
async function fetchState(wid) {
  const r = await fetch('/api/state?w=' + encodeURIComponent(wid || ''), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const o = await r.json();
  if (!o || !o.v) throw new Error('empty world');
  return o;
}
function catchUp(maxSteps) { return S.advanceTo(S.targetT(Date.now()), { maxSteps: maxSteps || 30000 }); }
// kind: 'boot' (first load), 'switch' (another world), 'poll' (a fresh save of the same world)
function applyState(o, kind) {
  const prev = S.W;
  if (kind === 'poll' && prev && o.season === prev.season && (o.ver || 0) <= st.ver) return false;
  const old = new Map();
  for (const r of renderList) old.set(r.p.id, [r.x, r.z]);
  st.aiInfo = Object.assign({}, o.ai || {});
  S.load(o);
  st.ver = o.ver || 0;
  if (o.wid) st.wid = o.wid;
  if (o.wname) st.wname = o.wname;
  S.W.ai.on = false;            // the browser never asks Claude; the server's choices arrive with the next save
  catchUp();
  clearSnaps(); snapshot();
  const newSeason = !prev || prev.seed !== S.W.seed || prev.season !== S.W.season;
  if (kind === 'poll' && !newSeason) for (const p of S.W.people) { const a = old.get(p.id); if (!a) continue; const dx = a[0] - p.x, dz = a[1] - p.z; if (Math.hypot(dx, dz) < 25) smooth.set(p.id, [dx, dz]); }
  if (kind === 'poll') UI.ingest(newSeason, false);
  else UI.ingest(true, true);
  if (kind === 'poll' && newSeason) rebuild();
  return true;
}
async function poll() {
  if (st.mode !== 'live' || polling) return;
  polling = true;
  st.lastPoll = Date.now();
  const wid = st.wid;
  try { const o = await fetchState(wid); if (st.mode === 'live' && st.wid === wid) { st.lastOk = Date.now(); applyState(o, 'poll'); } }
  catch (e) { /* keep simulating locally; the next poll will resync */ }
  polling = false;
}
function rebuild() {
  buildWorld();
  buildActors();
  UI.buildMinimap();
  st.shot = null;
  clearSnaps(); snapshot();
}
function setHash(h) { history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : '')); }

/* ---------- worlds and the sandbox ---------- */
async function switchWorld(id, force) {
  if (!force && st.mode === 'live' && id === st.wid) return;
  UI.saveSeen();
  $('#boot').classList.remove('done');
  $('#bootMsg').textContent = 'Changing channel';
  try {
    const o = await fetchState(id);
    st.mode = 'live'; st.wid = o.wid || id; st.ver = -1; st.lastOk = st.lastPoll = Date.now();
    const w = st.worlds.find(w => w.id === st.wid);
    st.wname = o.wname || (w && w.name) || '';
    applyState(o, 'switch');
    rebuild();
    UI.resetPanels();
    try { localStorage.setItem('twelve-world', st.wid); } catch (e) { /* storage blocked */ }
    setHash('w=' + st.wid);
    if (st.opts.director) setDirector(true); else frameWide(true);
    if (!UI.maybeRecap()) UI.saveSeen();
  } catch (e) { UI.toast('That world could not be reached. Try again in a moment.'); }
  setTimeout(() => $('#boot').classList.add('done'), 150);
}
function startSandbox() {
  S.newSeason(((Math.random() * 2147483646) | 0) + 1, Date.now());
  S.W.ai.on = false;
  st.mode = 'sandbox'; st.wname = 'Sandbox'; st.ver = -1;
  st.speed = st.speed || 1;
  st.sbT = S.W.t;
  st.aiInfo = { on: false };
  rebuild();
  UI.resetPanels();
  UI.ingest(true, false);
  setHash('sandbox');
  if (st.opts.director) setDirector(true); else frameWide(true);
}
function openSandbox() { UI.saveSeen(); startSandbox(); UI.toast('Sandbox: a private island in this tab. Use the speed buttons to fast-forward.'); }
function setSpeed(x) { st.speed = x; if (S.W) st.sbT = S.W.t; }

/* ---------- main loop ---------- */
function stepSim(dt) {
  let target, n = 0;
  if (st.mode === 'sandbox') {
    st.sbT += dt * 1000 * S.RATE * st.speed;
    if (st.sbT - S.W.t > S.DT * 60) st.sbT = S.W.t + S.DT * 60;
    target = st.sbT;
    while (S.W.t + S.DT <= target && n < 60) { snapshot(); S.step(S.DT); n++; }
  } else {
    target = S.targetT(Date.now());
    while (S.W.t + S.DT <= target && n < 30) { snapshot(); S.step(S.DT); n++; }
    if (n >= 30 && S.W.t + S.DT <= target) {
      if (target - S.W.t > 6 && Date.now() - st.lastPoll > 5000) poll();
      catchUp(3000); clearSnaps(); snapshot();
    }
  }
  if (n) { if (st.mode === 'sandbox') UI.localShow(); UI.ingest(false); }
  if (S.W.seed !== st.seed) { rebuild(); UI.resetPanels(); UI.ingest(true, false); }
  st.alpha = clamp((target - S.W.t) / S.DT, 0, 1);
}
function nearestFire() {
  const c = T.camera.position;
  let best = 1e9;
  for (const g of S.W.groups) if (!g.dead && g.fire.lit) best = Math.min(best, Math.hypot(g.x - c.x, g.z - c.z, Math.max(0, c.y - 2)));
  return best;
}
let uiT = 0, panelT = 0, mapT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, clock.getDelta());
  time += dt;
  const now = performance.now() / 1000;
  stepSim(dt);
  updateWorld(dt, time);
  updateActors(dt, time);
  UI.showCard(now);
  updateCamera(dt, now);
  render(time);
  UI.updateLabels();
  updateSound(dt, nearestFire());
  uiT -= dt; if (uiT <= 0) { uiT = 0.25; UI.hudTick(now); }
  mapT -= dt; if (mapT <= 0) { mapT = 0.2; UI.minimapTick(); }
  panelT -= dt; if (panelT <= 0) { panelT = 1; UI.panelTick(false); }
}

/* ---------- boot ---------- */
function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}
async function boot() {
  if (!webglOK()) {
    $('#bootMsg').innerHTML = '<div class="err">This browser cannot draw 3D graphics. Try a recent Chrome, Edge, Firefox or Safari, or open the <a href="/classic.html">classic viewer</a>.</div>';
    return;
  }
  const hp = new URLSearchParams(location.hash.slice(1));
  const ownerP = UI.checkOwner();
  let wid = hp.get('w') || '';
  if (!wid) { try { wid = localStorage.getItem('twelve-world') || ''; } catch (e) { wid = ''; } }
  const worldsP = UI.fetchWorlds();
  let o = null;
  if (!hp.has('sandbox')) {
    try { o = await fetchState(wid); }
    catch (e) { if (wid) { try { o = await fetchState(''); } catch (e2) { o = null; } } }
  }
  try { initCore(detectQuality()); }
  catch (e) { $('#bootMsg').innerHTML = '<div class="err">The 3D view could not start on this device. Open the <a href="/classic.html">classic viewer</a> instead.</div>'; return; }
  initCamera();
  UI.initUI({ switchWorld, openSandbox, newSandbox: startSandbox, setSpeed, reload: () => location.reload() });
  if (o) {
    st.mode = 'live'; st.lastOk = st.lastPoll = Date.now();
    applyState(o, 'boot');
    await Promise.race([worldsP, new Promise(r => setTimeout(r, 1500))]);
    const w = st.worlds.find(w => w.id === st.wid);
    if (!st.wname && w) st.wname = w.name;
    try { localStorage.setItem('twelve-world', st.wid); } catch (e) { /* storage blocked */ }
    if (st.wid) setHash('w=' + st.wid);
    rebuild();
  } else {
    startSandbox();
    if (!hp.has('sandbox')) setTimeout(() => UI.toast('The live islands could not be reached, so this is a private sandbox. The world menu has the live worlds.'), 1200);
  }
  frameWide(true);
  setDirector(!!st.opts.director);
  if (st.mode === 'live' && !UI.maybeRecap()) UI.saveSeen();
  if (st.opts.sound) {
    // browsers only allow sound after a click or key press
    const arm = () => { setSound(true); window.removeEventListener('pointerdown', arm); window.removeEventListener('keydown', arm); };
    window.addEventListener('pointerdown', arm); window.addEventListener('keydown', arm);
  }
  clock = new THREE.Clock();
  requestAnimationFrame(frame);
  setInterval(poll, POLL_MS);
  setInterval(() => UI.saveSeen(), 20000);
  window.addEventListener('pagehide', () => UI.saveSeen());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') UI.saveSeen();
    else if (st.mode === 'live' && Date.now() - st.lastPoll > 20000) poll();
  });
  ownerP.then(() => {});
  setTimeout(() => $('#boot').classList.add('done'), 200);
  window.__twelve = { S, st, R, T, switchWorld, openSandbox, setSpeed };
}
boot();
