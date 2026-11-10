// Placing structures, Smart-fill auto-detail, terraforming and the starting street layouts.
import { MAP, K, ll, sculpt, MAPMODE, heightAt } from './terrain.js';
import { CELL, GX, GZ, zone, road, bid, land, buildings, addBuilding, inGrid, toI, toJ, updateLand, refreshOverlay, state as W } from './world.js';
import { lotBase } from './buildings.js';
import { sim } from './sim.js';
import { CAT } from './structures.js';
import { city, priceIndex, canAfford, spend, money, nm, markDirty } from './city.js';
import { counters, olyUnlocked } from './culture.js';
import { STREETS } from './data/streets.js';
import { clamp, hash2 } from './util.js';

export const dimsOf = (key, front) => { const c = CAT[key]; return front & 1 ? [c.d, c.w] : [c.w, c.d]; };
export function siteOf(key) { // real-world position of a landmark, as a lot
  const c = CAT[key]; if (!c || !c.site) return null; const [x, z] = ll(...c.site), front = 2, [w, d] = dimsOf(key, front);
  return { i: toI(x) - (w >> 1), j: toJ(z) - (d >> 1), w, d, front, x, z };
}
export function costOf(key, w, d) { const c = CAT[key]; return (c.per ? c.cost * w * d : c.cost) * priceIndex(); }
// '' when the lot is free, otherwise the reason it is not
export function checkPlace(key, i, j, w, d, relaxed = false) {
  const c = CAT[key]; if (!c) return 'Unknown structure';
  if (c.needs === 'olympics' && !olyUnlocked()) return 'Win the Olympic bid first';
  if (c.cat === 'landmark' && counters.has(key)) return `${nm(c.name)} is already built`;
  if (c.rect && c.min && (w < c.min || d < c.min)) return `Needs at least ${c.min * CELL} m on each side`;
  let n = 0, ok = 0;
  for (let b = j; b < j + d; b++) for (let a = i; a < i + w; a++) {
    if (!inGrid(a, b)) return 'Off the map'; const o = b * GX + a; n++;
    if (bid[o]) return 'Something is already built here'; if (road[o] && !c.fixed) return 'A road is in the way';
    if (land[o]) ok++;
  }
  if (c.fixed) return ''; if (relaxed ? ok < n * 0.45 : ok < n) return relaxed ? 'Not enough land here. Fill the shore first.' : 'Needs flat, dry land';
  return '';
}
export function place(game, key, i, j, w, d, front, { relaxed = false, quiet = false, free = false, now = game.clock, seed } = {}) {
  const c = CAT[key], why = checkPlace(key, i, j, w, d, relaxed); if (why) { if (!quiet) game.ui.toast(why, 'warn'); return null; }
  const cost = free ? 0 : costOf(key, w, d); if (!canAfford(cost)) { if (!quiet) game.ui.toast(`Not enough in the treasury (${money(cost)})`, 'warn'); return null; }
  for (let b = j; b < j + d; b++) for (let a = i; a < i + w; a++) { const o = b * GX + a; if (zone[o]) { if (game.undo.current) game.undo.logZone(o, zone[o], 0); zone[o] = 0; } }
  const b = { i, j, w, d, zone: 0, level: 1, seed: seed ?? Math.floor(Math.random() * 0x7fffffff), front, born: sim.day, birth: now, sp: key, height: c.h, jobs: c.jobs || 0, res: c.res || 0, label: c.name, floors: Math.max(1, Math.round(c.h / 4.2)) };
  if (c.green) b.green = true;
  b.baseY = lotBase(b); b.topY = b.baseY + b.height * 1.3 + 8;
  addBuilding(b); refreshOverlay(i, j, i + w - 1, j + d - 1); game.undo.logAdded(b); spend(cost); markDirty();
  return b;
}

// ---- Smart-fill: dress an area with street furniture and planting ------------------------------------
export function parsePrompt(text) {
  const t = ` ${text.toLowerCase()} `;
  // a keyword counts unless the words just before it negate it ("no benches", "without any lamps")
  const has = (...w) => w.some((q) => { for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + 1)) { if (!/(\bno|\bnot|without|skip|\bzero|\bnever|\bfewer|\bless)\s+(\w+\s+){0,2}$/.test(t.slice(Math.max(0, i - 28), i))) return true; } return false; });
  const items = { tree: has('tree', 'leaf', 'green', 'forest', 'shade', 'wood', 'park'), bench: has('bench', 'seat', 'sit', 'rest'), lamp: has('lamp', 'light', 'lit ', 'night', 'safe'), planter: has('planter', 'flower', 'garden', 'bloom', 'plant'), fountain: has('fountain', 'water', 'pond'), plaza: has('plaza', 'square', 'paved', 'piazza', 'market') };
  if (!Object.values(items).some(Boolean)) Object.assign(items, { tree: true, bench: true, lamp: true });
  const density = has('dense', 'lush', 'lots', 'heavy', 'full', 'packed', 'jungle') ? 0.9 : has('sparse', 'few', 'minimal', 'light touch', 'subtle', 'some') ? 0.25 : 0.55;
  return { items, density };
}
export function smartFill(game, a, b, items, density) {
  const i0 = clamp(toI(Math.min(a.x, b.x)), 0, GX - 1), i1 = clamp(toI(Math.max(a.x, b.x)), 0, GX - 1), j0 = clamp(toJ(Math.min(a.z, b.z)), 0, GZ - 1), j1 = clamp(toJ(Math.max(a.z, b.z)), 0, GZ - 1);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 40000) { game.ui.toast('Pick a smaller area', 'warn'); return 0; }
  const free = (i, j) => inGrid(i, j) && land[j * GX + i] && !road[j * GX + i] && !bid[j * GX + i];
  const byRoad = (i, j) => (inGrid(i - 1, j) && road[j * GX + i - 1]) || (inGrid(i + 1, j) && road[j * GX + i + 1]) || (inGrid(i, j - 1) && road[(j - 1) * GX + i]) || (inGrid(i, j + 1) && road[(j + 1) * GX + i]);
  const frontOf = (i, j) => (inGrid(i, j - 1) && road[(j - 1) * GX + i] ? 0 : inGrid(i + 1, j) && road[j * GX + i + 1] ? 1 : inGrid(i, j + 1) && road[(j + 1) * GX + i] ? 2 : 3);
  let n = 0; const seed = Math.floor(Math.random() * 9999), put = (k, i, j, w = 1, d = 1, f = 2) => { if (n < 1600 && place(game, k, i, j, w, d, f, { quiet: true })) n++; };
  game.undo.begin('smart-fill');
  if (items.plaza || items.fountain) for (let j = j0; j + 5 <= j1; j += 9) for (let i = i0; i + 5 <= i1; i += 9) {
    let clear = true; for (let b2 = 0; b2 < 6 && clear; b2++) for (let a2 = 0; a2 < 6; a2++) if (!free(i + a2, j + b2)) { clear = false; break; }
    if (!clear || hash2(i + seed, j) > 0.25 + density * 0.6) continue;
    if (items.plaza) put('plaza', i, j, 6, 6); else put('fountain', i + 2, j + 2, 2, 2);
  }
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (!free(i, j)) continue; const h = hash2(i * 3 + seed, j * 7 - seed), edge = byRoad(i, j);
    if (edge) {
      if (items.lamp && (i + j * 3) % 5 === 0) put('lamp', i, j, 1, 1, frontOf(i, j));
      else if (items.bench && h < 0.1 + density * 0.14) put('bench', i, j, 1, 1, frontOf(i, j));
      else if (items.planter && h > 0.86 - density * 0.2) put('planter', i, j, 1, 1, frontOf(i, j));
      else if (items.tree && h > 0.3 && h < 0.3 + density * 0.45) put('tree', i, j);
    } else if (items.tree && h < density * 0.55) put('tree', i, j);
    else if (items.planter && h > 0.97 - density * 0.05) put('planter', i, j);
    else if (items.bench && h > 0.6 && h < 0.6 + density * 0.03) put('bench', i, j);
  }
  game.undo.commit();
  return n;
}

// ---- terraforming -------------------------------------------------------------------------------------
// Vertices under roads and buildings are left alone, so nothing ends up floating or buried.
const guard = (vi, vj) => {
  const x = MAP.minX + vi * MAP.G, z = MAP.minZ + vj * MAP.G, r = Math.ceil(MAP.G / CELL);
  for (let j = toJ(z) - r; j <= toJ(z) + r; j++) for (let i = toI(x) - r; i <= toI(x) + r; i++) { if (!inGrid(i, j)) continue; const o = j * GX + i; if (bid[o] || road[o]) return false; }
  return true;
};
export function terraform(game, x, z, radius, mode, amt) {
  const before = mode === 'fill' ? countLand(x, z, radius) : 0, box = sculpt(x, z, radius, mode, amt, guard); if (!box) return false;
  const G = MAP.G / CELL; updateLand(Math.floor(box[0] * G) - 1, Math.floor(box[1] * G) - 1, Math.ceil(box[2] * G) + 1, Math.ceil(box[3] * G) + 1);
  if (mode === 'fill') counters.fillArea += Math.max(0, countLand(x, z, radius) - before) * CELL * CELL;
  markDirty(); return true;
}
function countLand(x, z, r) { let n = 0; for (let j = toJ(z - r); j <= toJ(z + r); j++) for (let i = toI(x - r); i <= toI(x + r); i++) if (inGrid(i, j) && land[j * GX + i]) n++; return n; }
export function pier(game, a, b, width) { // a straight strip of new land from the shore
  const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / (width * 0.5))); let any = false;
  for (let k = 0; k <= n; k++) if (terraform(game, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n, width, 'fill', 1)) any = true;
  return any;
}

// ---- starting layouts ---------------------------------------------------------------------------------
const TYPE = { 1: 'highway', 2: 'boulevard', 3: 'avenue', 4: 'street' };
export function drawStreets(game, classes = [1, 2, 3, 4], south = false) {
  let n = 0;
  for (const [cls, , pts] of STREETS) {
    if (!classes.includes(cls)) continue;
    if (south) { let minZ = 1e9; for (let k = 1; k < pts.length; k += 2) minZ = Math.min(minZ, pts[k]); if (minZ < 600) continue; } // only what comes up the peninsula
    const p = pts.map((v) => Math.round(v * K * 10) / 10); if (K < 1 && cls === 4 && hash2(p[0], p[1]) < 0.35) continue;
    // split where a street leaves the map or the land, and add each dry run on its own
    let run = []; const flush = () => { if (run.length >= 4) { const r = game.roads.add(TYPE[cls], run); if (r.ok) n++; } run = []; };
    for (let k = 0; k < p.length; k += 2) { const x = p[k], z = p[k + 1]; if (x < MAP.minX + 12 || x > MAP.maxX - 12 || z < MAP.minZ + 12 || z > MAP.maxZ - 12) { flush(); continue; } run.push(x, z); }
    flush();
  }
  return n;
}
// One highway up the peninsula from the south edge of the map to the middle of the city (roughly I-280 then US-101).
export function southHighway(game) {
  const LL = [[-122.4700, 37.7075], [-122.4520, 37.7130], [-122.4420, 37.7230], [-122.4330, 37.7300], [-122.4170, 37.7340], [-122.4050, 37.7345], [-122.4060, 37.7400], [-122.4045, 37.7480], [-122.4040, 37.7560], [-122.4055, 37.7640], [-122.4085, 37.7695]];
  const pts = []; for (const [lon, lat] of LL) { const [x, z] = ll(lon, lat); if (z < MAP.maxZ - 16 && heightAt(x, z) > 1) pts.push(Math.round(x), Math.round(z)); }
  if (pts.length < 4) return false;
  if (heightAt(pts[0], MAP.maxZ - 16) > 1) pts.unshift(pts[0], MAP.maxZ - 16);
  let n = 0; for (let k = 0; k + 3 < pts.length; k += 2) { const r = game.roads.add('highway', pts.slice(k, k + 4)); if (r && r.ok) n++; }
  return n > 0;
}
export const ERAS = { 1906: { year: 1906, label: '1906', note: 'After the earthquake. Low brick and timber, no towers.' }, 1960: { year: 1962, label: '1960s', note: 'Postwar city. Modernist slabs begin downtown.' }, 1999: { year: 1999, label: '1999', note: 'Dot-com peak. The bust is a year away.' }, today: { year: 2025, label: 'Today', note: 'Glass towers and the AI wave.' } };
void MAPMODE; void buildings; void W; void city;
