/* Sound: procedural ambience (surf, wind, rain, fire, birds, crickets, thunder) and a narrator that reads the story aloud. Nothing is downloaded. */
import { S, st, T, clamp } from './state.mjs';
import { groundH, env } from './world.mjs';

let ctx = null, master = null, duck = null;
const L = {};               // looping layers: { gain, filter }
let lastThunder = 0, crackleT = 0, birdT = 2, cricketT = 0;

function noiseBuffer(sec, pink) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (!pink) { d[i] = w; continue; }
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  return b;
}
function loop(buf, type, freq, q) {
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f); f.connect(g); g.connect(duck);
  src.start(0, Math.random() * buf.duration);
  return { src, filter: f, gain: g };
}
function start() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0;
  duck = ctx.createGain(); duck.gain.value = 1;
  const comp = ctx.createDynamicsCompressor();
  duck.connect(master); master.connect(comp); comp.connect(ctx.destination);
  const pink = noiseBuffer(4, true), white = noiseBuffer(2, false);
  L.surf = loop(pink, 'lowpass', 520, 0.5);
  L.surf2 = loop(pink, 'bandpass', 1400, 0.4);
  L.wind = loop(pink, 'bandpass', 420, 1.6);
  L.rain = loop(white, 'highpass', 1800, 0.5);
  L.white = white;
}
export function setSound(on) {
  st.opts.sound = !!on;
  if (on) { start(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
  if (ctx) master.gain.setTargetAtTime(on ? st.opts.volume : 0, ctx.currentTime, 0.4);
  if (!on) stopNarration();
}
export function setVolume(v) { st.opts.volume = v; if (ctx && st.opts.sound) master.gain.setTargetAtTime(v, ctx.currentTime, 0.2); }
export const soundReady = () => !!ctx && ctx.state === 'running';

/* ---------- one-shots ---------- */
function burst(dur, type, freq, q, vol, attack, delay) {
  const t0 = ctx.currentTime + (delay || 0);
  const src = ctx.createBufferSource(); src.buffer = L.white; src.playbackRate.value = 0.6 + Math.random() * 0.8;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + (attack || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(duck);
  src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
}
function chirp(f0, f1, dur, vol, delay) {
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(duck); o.start(t0); o.stop(t0 + dur + 0.02);
}
function bird() {
  const base = 2200 + Math.random() * 2200, n = 2 + Math.floor(Math.random() * 5), kind = Math.random();
  for (let i = 0; i < n; i++) {
    const d = i * (0.09 + Math.random() * 0.08);
    if (kind < 0.5) chirp(base * (1 + Math.random() * 0.2), base * (1.3 + Math.random() * 0.4), 0.07 + Math.random() * 0.05, 0.035, d);
    else chirp(base * 1.4, base * 0.8, 0.12, 0.03, d);
  }
}
function crickets() {
  const f = 4300 + Math.random() * 600, n = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) chirp(f, f * 1.02, 0.035, 0.012, i * 0.055);
}
function thunder(dist) {
  const delay = clamp(dist / 340, 0.2, 4);
  const near = clamp(1 - dist / 260, 0.15, 1);
  burst(2.5 + near * 2.5, 'lowpass', 140 + near * 260, 0.6, 0.55 * near + 0.12, 0.05, delay);
  burst(0.6, 'lowpass', 900, 0.4, 0.25 * near, 0.005, delay);
  burst(3.5, 'lowpass', 80, 0.7, 0.35, 0.3, delay + 0.2);
}

/* ---------- per frame ---------- */
export function updateSound(dt, nearFire) {
  if (!ctx || !st.opts.sound || ctx.state !== 'running') return;
  const cam = T.camera.position, now = ctx.currentTime;
  const ground = Math.max(0, groundH(cam.x, cam.z));
  const alt = Math.max(0, cam.y - ground);
  const low = clamp(1 - alt / 140, 0.08, 1);
  const shoreNear = clamp(1 - Math.max(0, ground - 1) / 8, 0.2, 1);
  const storm = env.storm, day = env.day;
  const swell = 0.6 + 0.4 * Math.sin(now * 0.85) * Math.sin(now * 0.31 + 1);
  L.surf.gain.gain.setTargetAtTime((0.28 + storm * 0.35) * low * shoreNear * swell, now, 0.3);
  L.surf.filter.frequency.setTargetAtTime(380 + swell * 420 + storm * 300, now, 0.3);
  L.surf2.gain.gain.setTargetAtTime(0.06 * low * shoreNear * swell * swell, now, 0.3);
  const wind = 0.05 + storm * 0.4 + clamp(alt / 200, 0, 0.25);
  L.wind.gain.gain.setTargetAtTime(wind, now, 0.6);
  L.wind.filter.frequency.setTargetAtTime(320 + 260 * Math.sin(now * 0.23) + storm * 300, now, 0.8);
  L.rain.gain.gain.setTargetAtTime(storm > 0.05 ? 0.06 + storm * 0.14 : 0, now, 0.8);
  if (st.thunder !== lastThunder) { lastThunder = st.thunder; thunder(st.thunderDist || 120); }
  // a crackling fire when the camera is close to one
  if (nearFire < 30) {
    crackleT -= dt;
    if (crackleT <= 0) { crackleT = 0.03 + Math.random() * 0.22; const v = clamp(1 - nearFire / 30, 0, 1); burst(0.02 + Math.random() * 0.05, 'bandpass', 1800 + Math.random() * 2800, 1.5, 0.12 * v * (0.4 + Math.random() * 0.6)); }
  }
  // birds by day near the ground, crickets at night
  birdT -= dt;
  if (birdT <= 0) { birdT = 1.5 + Math.random() * 6; if (day > 0.5 && storm < 0.3 && low > 0.4) bird(); }
  cricketT -= dt;
  if (cricketT <= 0) { cricketT = 0.25 + Math.random() * 0.9; if (day < 0.3 && storm < 0.3 && low > 0.4 && ground > 0.5) crickets(); }
  duck.gain.setTargetAtTime(speaking() ? 0.45 : 1, now, 0.4);
}

/* ---------- the narrator ---------- */
const synth = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
export const canSpeak = () => !!synth;
export function voices() { return synth ? synth.getVoices().filter(v => /^en/i.test(v.lang)) : []; }
export function speaking() { return !!(synth && (synth.speaking || synth.pending)); }
export function stopNarration() { if (synth) synth.cancel(); }
function pickVoice(pref, female) {
  const vs = voices();
  if (!vs.length) return null;
  if (pref) { const v = vs.find(v => v.name === pref); if (v) return v; }
  if (female != null) {
    const re = female ? /female|samantha|victoria|karen|moira|tessa|zira|susan|serena|fiona|aria|jenny/i : /\bmale|daniel|alex|fred|david|george|mark|guy|ryan|arthur/i;
    const v = vs.find(v => re.test(v.name));
    if (v) return v;
  }
  return vs[0];
}
// read a story card aloud: episode recaps in the narrator's voice, confessionals in the castaway's
export function narrate(card) {
  if (!synth || !st.opts.narrator || !st.opts.sound) return;
  let text = '', female = null, pitch = 1, rate = 0.98;
  if (card.type === 'ep') text = `${card.ep.title}. ${card.ep.text}`;
  else if (card.type === 'conf' || card.type === 'thought') {
    const c = card.c, p = S.getP(c.id) || S.W.arch[c.id];
    female = p ? p.sex === 'F' : null;
    pitch = female ? 1.1 : 0.88; rate = 1.0;
    text = `${c.name}. ${c.text}`;
  } else if (card.type === 'recap') text = card.speech || '';
  else if (card.type === 'season') text = 'A new season. A new wreck.';
  if (!text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\s+/g, ' ').slice(0, 1400));
  const v = card.type === 'ep' || card.type === 'recap' ? pickVoice(st.opts.voice, null) : pickVoice('', female);
  if (v) u.voice = v;
  u.pitch = pitch; u.rate = rate; u.volume = clamp(st.opts.volume * 1.2, 0, 1);
  synth.speak(u);
}
