// Placing structures, Smart-fill auto-detail, terraforming and the starting street layouts.
import { MAP, K, ll, sculpt, MAPMODE, heightAt } from './terrain.js';
import { CELL, GX, GZ, zone, road, bid, land, buildings, addBuilding, inGrid, toI, toJ, updateLand, refreshOverlay, footCells, turnBox, removeBuilding, state as W } from './world.js';
import { ROAD_TYPES } from './roads.js';
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
// ---- turned lots and street snapping --------------------------------------------------------------
const FRONT_ANG = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];   // direction each front faces: north, east, south, west
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
// A lot for `key` centred on (x, z), facing the street at angle `ang` (radians, atan2(z, x) of the way out the front door).
export function turnedLot(key, x, z, ang) {
  let front = 0, best = 9; for (let f = 0; f < 4; f++) { const d = Math.abs(wrap(ang - FRONT_ANG[f])); if (d < best) { best = d; front = f; } }
  let yaw = wrap(ang - FRONT_ANG[front]); if (Math.abs(yaw) < 0.035) yaw = 0;
  const [mw, md] = dimsOf(key, front);
  if (!yaw || CAT[key].fixed || CAT[key].rect) { const i = Math.round((x - MAP.minX) / CELL - mw / 2), j = Math.round((z - MAP.minZ) / CELL - md / 2); return { i, j, w: mw, d: md, front, yaw: 0 }; }
  const bb = turnBox(mw, md, x, z, yaw), L = { ...bb, front, yaw, mw, md, cx: x, cz: z };
  L.cells = footCells(L); return L;
}
// Nearest street within `range`: the lot is turned to face it and set back from the kerb. Null when no street is close.
export function snapToStreet(game, key, x, z, range = 70, extra = 0) {
  const s = game.roads.nearestSeg(x, z, range); if (!s || s.seg.type === 'highway') return null;
  const p = s.seg.pts, cu = s.seg.cum; let q = 0; while (q < cu.length - 2 && cu[q + 1] < s.s) q++;
  const tx = p[q * 2 + 2] - p[q * 2], tz = p[q * 2 + 3] - p[q * 2 + 1], tl = Math.hypot(tx, tz) || 1;
  let nx = -tz / tl, nz = tx / tl; if ((s.x - x) * nx + (s.z - z) * nz < 0) { nx = -nx; nz = -nz; }   // n: from the lot towards the street
  const ang = Math.atan2(nz, nx) + extra, first = turnedLot(key, x, z, ang), deep = ((first.front & 1 ? CAT[key].w : CAT[key].d) * CELL) / 2;
  const rt = ROAD_TYPES[s.seg.type]; let back = rt.half + rt.walk + deep + 1, L = null;
  // step back from the kerb until the footprint clears the road cells (a turned lot crosses the road raster at its corners)
  for (let k = 0; k < 8; k++, back += 3) { L = turnedLot(key, s.x - nx * back, s.z - nz * back, ang); const cells = L.cells || footCells(L); if (!cells.some((o) => road[o])) break; }
  return L;
}
export function checkPlace(key, i, j, w, d, relaxed = false, cells = null) {
  const c = CAT[key]; if (!c) return 'Unknown structure';
  if (c.needs === 'olympics' && !olyUnlocked()) return 'Win the Olympic bid first';
  if (c.cat === 'landmark' && counters.has(key)) return `${nm(c.name)} is already built`;
  if (c.rect && c.min && (w < c.min || d < c.min)) return `Needs at least ${c.min * CELL} m on each side`;
  let n = 0, ok = 0;
  if (cells) {
    if (!cells.length) return 'Off the map';
    for (const o of cells) { n++; if (bid[o]) return 'Something is already built here'; if (road[o]) return 'A road is in the way'; if (land[o]) ok++; }
    return (relaxed ? ok < n * 0.45 : ok < n) ? (relaxed ? 'Not enough land here. Fill the shore first.' : 'Needs flat, dry land') : '';
  }
  for (let b = j; b < j + d; b++) for (let a = i; a < i + w; a++) {
    if (!inGrid(a, b)) return 'Off the map'; const o = b * GX + a; n++;
    if (bid[o]) return 'Something is already built here'; if (road[o] && !c.fixed) return 'A road is in the way';
    if (land[o]) ok++;
  }
  if (c.fixed) return ''; if (relaxed ? ok < n * 0.45 : ok < n) return relaxed ? 'Not enough land here. Fill the shore first.' : 'Needs flat, dry land';
  return '';
}
export function place(game, key, i, j, w, d, front, { relaxed = false, quiet = false, free = false, now = game.clock, seed, turn = null } = {}) {
  if (turn && !turn.yaw) turn = null;
  const c = CAT[key], why = checkPlace(key, i, j, w, d, relaxed, turn ? turn.cells : null); if (why) { if (!quiet) game.ui.toast(why, 'warn'); return null; }
  const cost = free ? 0 : costOf(key, w, d); if (!canAfford(cost)) { if (!quiet) game.ui.toast(`Not enough in the treasury (${money(cost)})`, 'warn'); return null; }
  const clear = (o) => { if (zone[o]) { if (game.undo.current) game.undo.logZone(o, zone[o], 0); zone[o] = 0; } };
  if (turn) for (const o of turn.cells) clear(o); else for (let b = j; b < j + d; b++) for (let a = i; a < i + w; a++) clear(b * GX + a);
  const b = { i, j, w, d, zone: 0, level: 1, seed: seed ?? Math.floor(Math.random() * 0x7fffffff), front, born: sim.day, birth: now, sp: key, height: c.h, jobs: c.jobs || 0, res: c.res || 0, label: c.name, floors: Math.max(1, Math.round(c.h / 4.2)) };
  if (turn) Object.assign(b, { yaw: turn.yaw, mw: turn.mw, md: turn.md, cx: turn.cx, cz: turn.cz });
  if (c.green) b.green = true;
  b.baseY = lotBase(b); b.topY = b.baseY + b.height * 1.3 + 8;
  addBuilding(b); refreshOverlay(i, j, i + w - 1, j + d - 1); game.undo.logAdded(b); spend(cost); markDirty();
  return b;
}

// A landmark at its real site, turned to its street when one is close. Falls back to the plain grid lot.
export function placeAtSite(game, key, s, opts = {}) {
  const o = { relaxed: true, ...opts }, c = CAT[key];
  if (!c.fixed) {
    const L = snapToStreet(game, key, s.x, s.z, 140);
    if (L) {
      const b = placeLot(game, key, L, { ...o, quiet: true }); if (b) return b;
      const ang = FRONT_ANG[L.front] + L.yaw, M = turnedLot(key, s.x, s.z, ang), b2 = placeLot(game, key, M, { ...o, quiet: true }); if (b2) return b2;
    }
  }
  return place(game, key, s.i, s.j, s.w, s.d, s.front, o);
}
// Turn a structure that is already built: by 15 degree steps, or to face its nearest street. Keeps its id, so venues and teams stay linked.
export function turnStructure(game, b, how) {
  const c = b && CAT[b.sp]; if (!c || c.fixed || c.rect) return 'This one stays as it is';
  const cx = b.yaw ? b.cx : MAP.minX + (b.i + b.w / 2) * CELL, cz = b.yaw ? b.cz : MAP.minZ + (b.j + b.d / 2) * CELL;
  const L = how === 'street' ? snapToStreet(game, b.sp, cx, cz, 140) : turnedLot(b.sp, cx, cz, FRONT_ANG[b.front & 3] + (b.yaw || 0) + how * (Math.PI / 12));
  if (!L) return 'No street close enough';
  const nb = { ...b, i: L.i, j: L.j, w: L.w, d: L.d, front: L.front, birth: -100 }; delete nb.yaw; delete nb.mw; delete nb.md; delete nb.cx; delete nb.cz;
  if (L.yaw) Object.assign(nb, { yaw: L.yaw, mw: L.mw, md: L.md, cx: L.cx, cz: L.cz });
  removeBuilding(b.id);
  const cells = footCells(nb); let ok = 0, why = cells.length ? '' : 'Off the map';
  for (const o of cells) { if (bid[o]) { why = 'Something is already built there'; break; } if (road[o]) { why = 'A road is in the way'; break; } if (land[o]) ok++; }
  if (!why && ok < cells.length * (c.site ? 0.45 : 1)) why = 'Needs flat, dry land';
  if (why) { addBuilding(b); return why; }
  game.undo.begin('build'); game.undo.logBuilding(b);
  for (const o of cells) if (zone[o]) { game.undo.logZone(o, zone[o], 0); zone[o] = 0; }
  nb.baseY = lotBase(nb); nb.topY = nb.baseY + nb.height * 1.3 + 8;
  addBuilding(nb); game.undo.logAdded(nb); game.undo.commit(); markDirty();
  return '';
}
export const placeLot = (game, key, L, opts = {}) => place(game, key, L.i, L.j, L.w, L.d, L.front, { ...opts, turn: L.yaw ? L : null });

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
