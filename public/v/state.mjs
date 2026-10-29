/* Shared viewer state: the sim, the three handles, scene objects and small helpers. */
import * as S from '../sim.mjs';
export { S };

export const T = {};            // three: THREE, renderer, scene, camera, controls, composer, q, qname
export const R = {};            // scene objects built by world.mjs and actors.mjs

const OPT_KEY = 'twelve-opts';
const DEFAULT_OPTS = { quality: '', sound: false, volume: 0.7, narrator: false, voice: '', names: true, bubbles: true, director: true, minimap: true, motion: true };
function loadOpts() {
  try { return Object.assign({}, DEFAULT_OPTS, JSON.parse(localStorage.getItem(OPT_KEY) || '{}')); } catch (e) { return Object.assign({}, DEFAULT_OPTS); }
}
export function saveOpts() { try { localStorage.setItem(OPT_KEY, JSON.stringify(st.opts)); } catch (e) { /* storage blocked */ } }

export const st = {
  mode: 'live',                 // live: a server world; sandbox: a private world run in this tab
  wid: '', wname: '', worlds: [], ver: -1, seed: 0, season: 0, alpha: 0, speed: 1,
  director: true, sel: 0, follow: false, hover: 0, tab: 'cast', sheetMin: false,
  shot: null, camTween: null, card: null, cardQ: [], boost: new Map(), tick: [], tickT: 0,
  flashN: 0, bolt: 0, thunder: 0, thunderDist: 0,
  owner: '', ownerOk: false, lastOk: 0, lastPoll: 0, aiInfo: { on: false },
  opts: loadOpts(),
};

export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
export function hash01(n) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function setText(sel, v) { const el = typeof sel === 'string' ? $(sel) : sel; const s = String(v); if (el && el.textContent !== s) el.textContent = s; }

/* camp colors */
export const CAMP_HEX = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const NO_CAMP = '#8a847a';
export const campHex = g => (g ? CAMP_HEX[g.color % 8] : NO_CAMP);
export const personHex = p => campHex(S.grpOf(p));
export const isleName = isl => (S.ISLE_NAMES[isl] || 'an islet').replace(/^the /, '');
