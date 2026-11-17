// City-wide systems on a coarse grid (64 m): land value, satisfaction, noise, services, transit, traffic,
// neighbourhoods, the budget, taxes and policies, plus history for the graphs and the citizen feed store.
import * as THREE from 'three';
import { MAP, K, ll, coastDist, heightAt } from './terrain.js';
import { CELL, GX, GZ, buildings, stats, ZONES, land } from './world.js';
import { sim, yearOf, seasonOf, SEASONS } from './sim.js';
import { ROAD_TYPES, cumLen } from './roads.js';
import { CAT, styleFor, businessName } from './structures.js';
import { ext } from './buildings.js';
import { HOOD } from './data/hoods.js';
import { clamp, smoothstep, rng } from './util.js';

export const LC = 8, LW = Math.ceil(GX / LC), LH = Math.ceil(GZ / LC), LS = LC * CELL; // coarse cell = 64 m
const N = LW * LH, f32 = () => new Float32Array(N);
export const trafficFx = { grid: null, noise: null, commute: 0, ready: false };   // set by traffic.js: congestion and noise per coarse cell, average commute
export const moodFx = { list: null, wide: null };   // set by mood.js: resident reactions to new structures
export const grid = { mood: f32(), dens: f32(), act: f32(), noise: f32(), amen: f32(), edu: f32(), health: f32(), police: f32(), fire: f32(), transit: f32(), cap: f32(), traffic: f32(), lv: f32(), sat: f32(), water: f32(), isLand: new Uint8Array(N), hood: new Uint8Array(N) };
export const lidx = (x, z) => clamp(Math.floor((x - MAP.minX) / LS), 0, LW - 1) + clamp(Math.floor((z - MAP.minZ) / LS), 0, LH - 1) * LW;
export const sample = (g, x, z) => g[lidx(x, z)];
const bx = (b) => MAP.minX + (b.i + b.w / 2) * CELL, bz = (b) => MAP.minZ + (b.j + b.d / 2) * CELL;
export const bpos = (b) => [bx(b), bz(b)];

export const POLICIES = [
  { k: 'rentControl', name: 'Rent control', note: 'Happier renters, less new housing', fx: { sat: 0.05, R: -0.12, upMul: 0.7 } },
  { k: 'techBreak', name: 'Tech tax break', note: 'More office demand, less office tax', fx: { O: 0.22, incO: 0.75 } },
  { k: 'lateNight', name: 'Late-night permits', note: 'Busier venues, more noise', fx: { buzzMul: 1.3, noiseMul: 1.25, C: 0.05 } },
  { k: 'carFree', name: 'Car-free Market Street', note: 'Less traffic downtown', fx: { trafficMul: 0.85, sat: 0.02, C: -0.03 } },
  { k: 'freeMuni', name: 'Free Muni', note: 'Transit does more, costs more', fx: { transitMul: 1.4, cost: 1.5 } },
  { k: 'preservation', name: 'Historic preservation', note: 'Slower redevelopment, more visitors', fx: { upMul: 0.6, sat: 0.03, tourMul: 1.1 } },
  { k: 'upzoning', name: 'Upzoning', note: 'Taller buildings allowed', fx: { cap: 1, sat: -0.02 } },
  { k: 'noiseOrd', name: 'Noise ordinance', note: 'Quieter nights, duller venues', fx: { noiseMul: 0.7, buzzMul: 0.8 } },
  { k: 'parksFirst', name: 'Parks first', note: 'Green space counts for more', fx: { amenMul: 1.25, cost: 0.6 } },
  { k: 'slowStreets', name: 'Slow streets', note: 'Calmer residential streets', fx: { trafficMul: 0.92, sat: 0.02 } },
];
const defaults = () => ({
  cfg: { money: 'unlimited', traffic: 'sim', landValue: true, parody: false, wxAuto: true, fog: true, rain: true, sunsets: true, fogAmt: 1, rainAmt: 1, gfx: 'auto', ui: 'bottom', sound: true, tips: true, era: 'today', start: 'empty', areas: 'grow', night: 'real' },
  treasury: 3000, income: 0, expense: 0, breakdown: {},
  tax: { R: 9, C: 9, O: 9, I: 9 }, hoodTax: {}, subsidy: { R: false, C: false, O: false, I: false }, policies: {}, custom: [], taxEvents: [],
  sat: 0.6, lvAvg: 0.3, noiseAvg: 0, trafficAvg: 0, transitShare: 0, tourism: 0, rent: 0, heat: 0,
  hist: { pop: [], jobs: [], sat: [], lv: [], cash: [], traffic: [], heat: [] },
  hoodNames: HOOD.names.slice(), hoodStats: [], lines: [], nextLine: 1, feed: [], moods: [], junctions: {}, wx: { fog: 0, rain: 0, tFog: 0, tRain: 0, manual: 0 },
});
export const city = defaults();
export function resetCity2(keepCfg = true) { const cfg = city.cfg; Object.assign(city, defaults()); if (keepCfg) city.cfg = cfg; initHoods(); dirty = true; }

// ---- parody names ----------------------------------------------------------------------------------
const PARODY = new Map();
export function addParody(real, fake) { if (fake) PARODY.set(real, fake); }
export const nm = (s) => (city.cfg.parody && PARODY.has(s) ? PARODY.get(s) : s);
for (const c of Object.values(CAT)) if (c.parody) addParody(c.name, c.parody);

// ---- neighbourhoods --------------------------------------------------------------------------------
const EXTRA = [['Sausalito', -122.485, 37.859], ['Marin Headlands', -122.52, 37.83], ['Tiburon', -122.456, 37.873], ['Mill Valley', -122.545, 37.906], ['Berkeley', -122.273, 37.871], ['Emeryville', -122.285, 37.836],
  ['Oakland', -122.265, 37.80], ['West Oakland', -122.295, 37.812], ['Alameda', -122.265, 37.772], ['Daly City', -122.47, 37.688], ['Brisbane', -122.40, 37.683], ['South San Francisco', -122.41, 37.655], ['Colma', -122.455, 37.675], ['Angel Island', -122.43, 37.862], ['Richmond', -122.36, 37.925]];
export function initHoods() {
  const base = new Uint8Array(HOOD.w * HOOD.h); let o = 0;
  for (let k = 0; k < HOOD.rle.length; k += 2) { base.fill(HOOD.rle[k], o, o + HOOD.rle[k + 1]); o += HOOD.rle[k + 1]; }
  const seeds = EXTRA.map(([n, lon, lat]) => [n, ...ll(lon, lat)]), n0 = HOOD.names.length;
  city.hoodNames = HOOD.names.concat(seeds.map((s) => s[0]));
  for (let j = 0; j < LH; j++) for (let i = 0; i < LW; i++) {
    const x = MAP.minX + (i + 0.5) * LS, z = MAP.minZ + (j + 0.5) * LS, c = j * LW + i, d = coastDist(x, z);
    grid.isLand[c] = heightAt(x, z) > 0.6 ? 1 : 0; grid.water[c] = grid.isLand[c] ? 0.12 * (1 - smoothstep(60, 700, d)) : 0;
    const hi = Math.floor((x / K - HOOD.x0) / HOOD.res), hj = Math.floor((z / K - HOOD.z0) / HOOD.res);
    let h = hi >= 0 && hj >= 0 && hi < HOOD.w && hj < HOOD.h ? base[hj * HOOD.w + hi] : 0;
    if (!h && grid.isLand[c]) { let best = 5200 * K; for (let s = 0; s < seeds.length; s++) { const dd = Math.hypot(x - seeds[s][1], z - seeds[s][2]); if (dd < best) { best = dd; h = n0 + s; } } }
    grid.hood[c] = h;
  }
}
export const hoodAt = (x, z) => grid.hood[lidx(x, z)];
export const hoodName = (id) => city.hoodNames[id] || '';
export function hoodCenters() { // label anchors: centroid of each neighbourhood's cells
  const acc = new Map();
  for (let c = 0; c < N; c++) { const h = grid.hood[c]; if (!h || !grid.isLand[c]) continue; let a = acc.get(h); if (!a) acc.set(h, (a = [0, 0, 0])); a[0] += c % LW; a[1] += Math.floor(c / LW); a[2]++; }
  return [...acc].map(([h, a]) => ({ id: h, name: hoodName(h), x: MAP.minX + (a[0] / a[2] + 0.5) * LS, z: MAP.minZ + (a[1] / a[2] + 0.5) * LS, n: a[2] }));
}
export function paintHood(x, z, r, id) { const i0 = Math.floor((x - r - MAP.minX) / LS), i1 = Math.floor((x + r - MAP.minX) / LS), j0 = Math.floor((z - r - MAP.minZ) / LS), j1 = Math.floor((z + r - MAP.minZ) / LS); for (let j = Math.max(0, j0); j <= Math.min(LH - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(LW - 1, i1); i++) if (Math.hypot(MAP.minX + (i + 0.5) * LS - x, MAP.minZ + (j + 0.5) * LS - z) <= r) grid.hood[j * LW + i] = id; dirty = true; }

// ---- feed ------------------------------------------------------------------------------------------
const HANDLES = ['sunset_susan', 'karl_the_fog', 'mission_mike', 'nopa_nate', 'richmond_rae', 'soma_sam', 'bernal_bea', 'tenderloin_tom', 'marina_max', 'castro_cal', 'excelsior_eve', 'dogpatch_dee', 'noe_nina', 'haight_hal', 'muni_diaries', 'bart_bard', 'fog_watch', 'burrito_index', 'sf_rent_watch', 'twin_peaks_tess'];
let feedListener = null;
export function onFeed(fn) { feedListener = fn; }
export function post(text, kind = 'life', who = null) {
  const p = { d: sim.day, y: yearOf(), who: who || HANDLES[Math.floor(Math.random() * HANDLES.length)], text, kind };
  city.feed.unshift(p); if (city.feed.length > 120) city.feed.length = 120;
  if (feedListener) feedListener(p);
  return p;
}

// ---- policy effects --------------------------------------------------------------------------------
export function fx() {
  const o = { R: 0, C: 0, O: 0, I: 0, sat: 0, noiseMul: 1, trafficMul: 1, amenMul: 1, transitMul: 1, upMul: 1, cap: 0, tourMul: 1, buzzMul: 1, cost: 0, incO: 1 };
  const add = (f) => { for (const k in f) { if (k.endsWith('Mul') || k === 'incO') o[k] *= f[k]; else o[k] += f[k]; } };
  for (const p of POLICIES) if (city.policies[p.k]) add(p.fx);
  for (const p of city.custom) if (p.on) add(p.fx);
  for (const e of city.taxEvents) if (e.fx) add(e.fx);
  return o;
}
export const priceIndex = (y = yearOf()) => Math.exp((y - 2025) * 0.034);
export const money = (k) => { const v = Math.abs(k), s = k < 0 ? '-' : ''; return v >= 1e6 ? `${s}$${(v / 1e6).toFixed(2)}B` : v >= 1000 ? `${s}$${(v / 1000).toFixed(v >= 1e4 ? 1 : 2)}M` : v > 0 && v < 10 ? `${s}$${Math.round(v * 1000).toLocaleString('en-US')}` : `${s}$${Math.round(v)}K`; };
export const canAfford = (cost) => city.cfg.money !== 'budget' || city.treasury >= cost;
export function spend(cost) { if (city.cfg.money === 'budget') city.treasury -= cost; }

// ---- grid recompute --------------------------------------------------------------------------------
let dirty = true, game = null; const tmp = f32(), tmp2 = f32();
export function initCity(g) {
  game = g; initHoods();
  sim.styleFor = (b) => styleFor(b, hoodName(hoodAt(bx(b), bz(b))), yearOf(), sim.rand);
  sim.capBonus = (b) => { const f = fx(); let c = f.cap + (city.heat > 0.45 ? 1 : 0); if (city.cfg.landValue) { const v = sample(grid.lv, bx(b), bz(b)); c += v > 0.7 ? 1 : v < 0.16 ? -1 : 0; } return c; };
  ext.business = (b, nr) => businessName(hoodName(hoodAt(bx(b), bz(b))), nr);
}
function stamp(g, x, z, r, s, add) {
  const i0 = Math.max(0, Math.floor((x - r - MAP.minX) / LS)), i1 = Math.min(LW - 1, Math.floor((x + r - MAP.minX) / LS)), j0 = Math.max(0, Math.floor((z - r - MAP.minZ) / LS)), j1 = Math.min(LH - 1, Math.floor((z + r - MAP.minZ) / LS));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(MAP.minX + (i + 0.5) * LS - x, MAP.minZ + (j + 0.5) * LS - z); if (d > r) continue;
    const v = s * (1 - (d / r) * (d / r)), c = j * LW + i; g[c] = add ? Math.min(1.5, g[c] + v) : Math.max(g[c], v);
  }
}
function stampAdd(g, x, z, r, s) { // signed, unclamped version of stamp
  const i0 = Math.max(0, Math.floor((x - r - MAP.minX) / LS)), i1 = Math.min(LW - 1, Math.floor((x + r - MAP.minX) / LS)), j0 = Math.max(0, Math.floor((z - r - MAP.minZ) / LS)), j1 = Math.min(LH - 1, Math.floor((z + r - MAP.minZ) / LS));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = Math.hypot(MAP.minX + (i + 0.5) * LS - x, MAP.minZ + (j + 0.5) * LS - z); if (d <= r) g[j * LW + i] += s * (1 - (d / r) * (d / r)); }
}
function blur(src, dst, rad) { // separable box blur
  for (let j = 0; j < LH; j++) { let s = 0; const row = j * LW; for (let i = -rad; i < LW; i++) { if (i + rad < LW) s += src[row + i + rad]; if (i - rad - 1 >= 0) s -= src[row + i - rad - 1]; if (i >= 0) tmp2[row + i] = s / (2 * rad + 1); } }
  for (let i = 0; i < LW; i++) { let s = 0; for (let j = -rad; j < LH; j++) { if (j + rad < LH) s += tmp2[(j + rad) * LW + i]; if (j - rad - 1 >= 0) s -= tmp2[(j - rad - 1) * LW + i]; if (j >= 0) dst[j * LW + i] = s / (2 * rad + 1); } }
}
export const STOP_R = { bus: 260, cable: 260, metro: 650, ferry: 520 };
export const extraNoise = []; // transient sources from events: [x, z, radius, strength]
export function recompute() {
  const g = grid, f = fx(), night = sim.time > 20 || sim.time < 3 ? 1 : 0.35;
  for (const k of ['dens', 'noise', 'amen', 'edu', 'health', 'police', 'fire', 'transit', 'cap']) g[k].fill(0);
  let tour = 0;
  for (const b of buildings.values()) {
    const x = bx(b), z = bz(b), c = lidx(x, z);
    g.dens[c] += (b.res || 0) + (b.jobs || 0) * 0.6;
    if (b.sp) {
      const cat = CAT[b.sp]; if (!cat) continue; const e = cat.fx;
      if (e.amen) stamp(g.amen, x, z, e.amen[0] * (cat.rect ? 0.5 + Math.sqrt(b.w * b.d) / 14 : 1), e.amen[1] * f.amenMul, true);
      if (e.svc) stamp(g[e.svc[0]], x, z, e.svc[1], 1, false);
      if (e.noise) stamp(g.noise, x, z, e.noise[0], e.noise[1] * (e.venue ? night : 0.5) * f.noiseMul, true);
      if (e.tour) tour += e.tour;
    } else if (b.zone === 7 || b.zone === 8 || b.zone === 12) stamp(g.noise, x, z, 200, Math.min(0.5, 0.1 + b.jobs * 0.002) * f.noiseMul, true);
    else if (b.zone === 10) tour += b.jobs * 0.004; else if (b.zone === 4 && b.level >= 3) tour += 0.3;
  }
  for (const s of game.roads.segs.values()) {
    const T = ROAD_TYPES[s.type], p = s.pts, cl = cumLen(p), L = cl[cl.length - 1], lanes = T.half / 1.7, hw = s.type === 'highway';
    for (let d = 0; d <= L; d += LS * 0.75) {
      let k = 0; while (k < cl.length - 2 && cl[k + 1] < d) k++; const t = (d - cl[k]) / (cl[k + 1] - cl[k] || 1), x = p[k * 2] + (p[k * 2 + 2] - p[k * 2]) * t, z = p[k * 2 + 1] + (p[k * 2 + 3] - p[k * 2 + 1]) * t;
      g.cap[lidx(x, z)] += lanes; if (hw) stamp(g.noise, x, z, 190, 0.3 * f.noiseMul, false);
    }
  }
  for (const l of city.lines) for (let k = 0; k < l.stops.length; k += 2) stamp(g.transit, l.stops[k], l.stops[k + 1], STOP_R[l.type] * Math.max(K, 0.6), l.type === 'metro' ? 1 : 0.75, true);
  for (const e of extraNoise) stamp(g.noise, e[0], e[1], e[2], e[3] * f.noiseMul, true);
  blur(g.dens, g.act, 4); blur(g.cap, tmp, 3);
  const simT = city.cfg.traffic === 'sim', useLv = city.cfg.landValue;
  let wSat = 0, wPop = 0, wLv = 0, wAct = 0, wTr = 0, wNoise = 0, wTransit = 0;
  const workers = stats.pop * 0.52, jobs = stats.jobsC + stats.jobsO + stats.jobsI, balance = workers > 50 ? clamp((jobs - workers) / workers, -1, 1) : 0;
  const taxPain = ((city.tax.R - 9) * 0.012), cityWide = f.sat - Math.abs(balance) * 0.06 - taxPain - Math.max(0, city.heat) * Math.max(0, sim.demand.R) * 0.1 + (city.boost || 0) + (moodFx.wide ? moodFx.wide() : 0) - (simT && trafficFx.ready ? clamp((trafficFx.commute - 18) * 0.005, 0, 0.12) : 0);
  g.mood.fill(0); if (moodFx.list) for (const [x, z, r, v] of moodFx.list()) stampAdd(g.mood, x, z, r, v);
  const stats2 = city.hoodNames.map(() => ({ pop: 0, jobs: 0, sat: 0, lv: 0, w: 0, venues: 0, monthlyResidentialRent: 0 }));
  for (let c = 0; c < N; c++) {
    if (!g.isLand[c]) { g.lv[c] = 0; g.sat[c] = 0; g.traffic[c] = 0; continue; }
    const act = Math.min(1, g.act[c] / 900), tr = Math.min(1, g.transit[c] * f.transitMul);
    const traffic = trafficFx.grid ? trafficFx.grid[c] : clamp(((g.act[c] * 0.012) / (tmp[c] + 0.35)) * (1 - 0.45 * tr) * f.trafficMul, 0, 1.2);
    if (simT && trafficFx.noise && trafficFx.noise[c]) g.noise[c] += trafficFx.noise[c] * f.noiseMul;
    const svc = (g.edu[c] + g.health[c] + g.police[c] + g.fire[c]) / 4, noise = Math.min(1, g.noise[c]), amen = Math.min(1, g.amen[c]);
    g.traffic[c] = traffic;
    g.lv[c] = useLv ? clamp(0.18 + 0.3 * act + 0.22 * amen + 0.16 * svc + 0.12 * tr + g.water[c] - 0.3 * noise - (simT ? 0.12 * Math.min(1, traffic) : 0) + city.heat * 0.14, 0, 1) : 0.5;
    const ht = city.hoodTax[g.hood[c]] || 0;
    g.sat[c] = clamp(0.52 + 0.24 * svc + 0.14 * amen + 0.1 * tr - 0.34 * noise - (simT ? 0.2 * Math.min(1, traffic) : 0) - ht * 0.015 + cityWide + g.mood[c], 0, 1);
    const w = g.dens[c]; if (w > 0) { wSat += g.sat[c] * w; wPop += w; wLv += g.lv[c] * w; wTr += traffic * w; wNoise += noise * w; wTransit += Math.min(1, tr) * w; const h = stats2[g.hood[c]]; if (h) { h.sat += g.sat[c] * w; h.lv += g.lv[c] * w; h.w += w; } }
    wAct += act;
  }
  for (const b of buildings.values()) {
    const x = bx(b), z = bz(b), h = stats2[hoodAt(x, z)]; if (!h) continue;
    h.pop += b.res || 0; h.jobs += b.jobs || 0;
    if (b.res > 0) h.monthlyResidentialRent += rentOf(sample(g.lv, x, z)) * b.res;
    if (b.sp && CAT[b.sp] && CAT[b.sp].fx.venue) h.venues++;
  }
  city.sat = wPop ? wSat / wPop : 0.6; city.lvAvg = wPop ? wLv / wPop : 0.3; city.trafficAvg = wPop ? wTr / wPop : 0; city.noiseAvg = wPop ? wNoise / wPop : 0; city.transitShare = wPop ? wTransit / wPop : 0;
  city.tourism = tour * f.tourMul * (1 + (city.eventTour || 0)); city.rent = rentOf(city.lvAvg);
  city.hoodStats = stats2.map((h, id) => ({
    id, name: hoodName(id), pop: h.pop, jobs: h.jobs, sat: h.w ? h.sat / h.w : 0, lv: h.w ? h.lv / h.w : 0,
    rent: rentOf(h.w ? h.lv / h.w : 0), monthlyResidentialRent: h.monthlyResidentialRent,
    avgRentPerResident: h.pop > 0 ? h.monthlyResidentialRent / h.pop : null,
    venues: h.venues, vibe: vibeOf(h),
  })).filter((h) => h.id && (h.pop || h.jobs));
  // feed back into growth
  const m = sim.mod; for (const k of 'RCOI') m[k] = f[k] - (city.tax[k] - 9) * 0.035 + (city.subsidy[k] ? 0.22 : 0);
  m.R += (city.sat - 0.55) * 0.5 + city.heat * 0.3 - (simT && trafficFx.ready ? clamp((trafficFx.commute - 22) * 0.012, 0, 0.25) : 0);
  city.commute = trafficFx.ready ? trafficFx.commute : 0; m.O += city.heat * 0.6; m.C += city.tourism * 0.004 + city.heat * 0.15; m.I -= Math.max(0, city.heat) * 0.1;
  sim.upMul = f.upMul * (1 + Math.max(0, city.heat) * 1.2);
  const y = yearOf(); sim.fc = (y < 1915 ? 14 : y < 1930 ? 30 : y < 1960 ? 45 : y < 1980 ? 55 : y < 2040 ? 72 : 130);
  dirty = false;
}
const rentOf = (lv) => Math.round((700 + 4600 * lv) * (1 + city.heat * 0.6) * priceIndex());
function vibeOf(h) { const s = h.w ? h.sat / h.w : 0; return h.venues >= 3 ? 'Nightlife district' : h.jobs > h.pop * 1.5 && h.jobs > 2000 ? 'Business district' : s > 0.72 ? 'Thriving' : s > 0.55 ? 'Settled' : s > 0.4 ? 'Restless' : 'Struggling'; }
export const markDirty = () => { dirty = true; };
let acc = 0;
export function stepCity(dt) { acc += dt; if (acc > (dirty ? 1.2 : 3.5)) { acc = 0; recompute(); } }

// ---- daily economy ---------------------------------------------------------------------------------
const TAX_EVENTS = [
  { name: 'Payroll tax holiday', days: 4, text: 'Offices get a break this year. Revenue dips.', fx: { O: 0.18, incO: 0.8 } },
  { name: 'Transfer tax windfall', days: 1, text: 'A few big towers changed hands.', cash: 600 },
  { name: 'Property reassessment', days: 4, text: 'Assessments went up. Homeowners noticed.', fx: { sat: -0.02 }, inc: 1.15 },
  { name: 'Hotel tax surge', days: 2, text: 'Convention season filled every room.', inc: 1.1, fx: { C: 0.08 } },
  { name: 'State budget cut', days: 4, text: 'Sacramento sent less this year.', inc: 0.9 },
];
export function dailyEconomy(roadsLen) {
  const f = fx(), t = city.tax, lvK = 0.6 + 0.8 * city.lvAvg, P = priceIndex();
  let incMul = 1; for (const e of city.taxEvents) if (e.inc) incMul *= e.inc;
  const inc = { Residential: stats.pop * 0.0045 * (t.R / 9), Commercial: stats.jobsC * 0.006 * (t.C / 9), Office: stats.jobsO * 0.009 * (t.O / 9) * f.incO, Industrial: stats.jobsI * 0.007 * (t.I / 9), Visitors: city.tourism * 4 };
  let income = 0; for (const k in inc) { inc[k] *= lvK * incMul * P; income += inc[k]; }
  let up = 0; for (const b of buildings.values()) if (b.sp && CAT[b.sp]) up += CAT[b.sp].per ? CAT[b.sp].up * b.w * b.d : CAT[b.sp].up;
  const exp = { Roads: roadsLen * 0.00006 * P, Services: up * P, Transit: city.lines.reduce((s, l) => s + 2 + (l.stops.length / 2) * 0.4, 0) * P, Policies: f.cost * (stats.pop / 1000) * P, Subsidies: 'RCOI'.split('').reduce((s, k) => s + (city.subsidy[k] ? 0.9 * (stats.pop / 1000) : 0), 0) * P };
  let expense = 0; for (const k in exp) expense += exp[k];
  city.income = income; city.expense = expense; city.breakdown = { inc, exp };
  if (city.cfg.money === 'budget') city.treasury += income - expense;
  for (const e of city.taxEvents) e.days--; city.taxEvents = city.taxEvents.filter((e) => e.days > 0);
  if (seasonOf() === 1 && stats.pop > 1500 && Math.random() < 0.55) { const e = { ...TAX_EVENTS[Math.floor(Math.random() * TAX_EVENTS.length)] }; city.taxEvents.push(e); if (e.cash) { if (city.cfg.money === 'budget') city.treasury += e.cash * P; } post(`${e.name}. ${e.text}`, 'tax', 'sf_budget_office'); }
  const h = city.hist; h.pop.push(stats.pop); h.jobs.push(jobsTotal()); h.sat.push(Math.round(city.sat * 100)); h.lv.push(Math.round(city.lvAvg * 100)); h.cash.push(Math.round(city.treasury)); h.traffic.push(Math.round(city.trafficAvg * 100)); h.heat.push(Math.round(city.heat * 100));
  for (const k in h) if (h[k].length > 480) h[k].shift();
}
export const jobsTotal = () => stats.jobsC + stats.jobsO + stats.jobsI;
export const dateLabel = () => `${SEASONS[seasonOf()]} ${yearOf()}`;

// ---- overlay texture -------------------------------------------------------------------------------
const heat = new Uint8Array(N * 4);
export const heatTex = new THREE.DataTexture(heat, LW, LH, THREE.RGBAFormat, THREE.UnsignedByteType);
heatTex.magFilter = heatTex.minFilter = THREE.LinearFilter; heatTex.generateMipmaps = false;
export const heatScale = new THREE.Vector2(GX / (LW * LC), GZ / (LH * LC));
const ramp = (stops) => (v) => { v = clamp(v, 0, 1) * (stops.length - 1); const k = Math.min(stops.length - 2, Math.floor(v)), t = v - k, a = stops[k], b = stops[k + 1]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
const R = { good: ramp([[150, 60, 50], [205, 170, 80], [90, 150, 95]]), bad: ramp([[90, 150, 95], [205, 170, 80], [170, 60, 50]]), purple: ramp([[70, 70, 90], [120, 90, 170], [215, 160, 215]]), blue: ramp([[60, 70, 80], [60, 120, 190], [150, 205, 235]]), teal: ramp([[70, 70, 70], [50, 140, 140], [150, 220, 205]]) };
export const OVERLAYS = [['none', 'None'], ['lv', 'Land value'], ['dens', 'Density'], ['traffic', 'Traffic'], ['transit', 'Transit'], ['noise', 'Noise'], ['svc', 'Service coverage'], ['sat', 'Satisfaction'], ['hood', 'Neighborhoods']];
export const OVERLAY_NOTE = { lv: 'Low to high', dens: 'Residents and jobs', traffic: 'How full each road is, free to jammed', transit: 'Reach of stops', noise: 'Quiet to loud', svc: 'Schools, health, police, fire', sat: 'Unhappy to happy', hood: 'One color per neighborhood' };
export function paintOverlay(kind) {
  const g = grid;
  for (let c = 0; c < N; c++) {
    let col = null, a = 0;
    if (g.isLand[c]) {
      if (kind === 'lv') { col = R.good(g.lv[c]); a = 190; } else if (kind === 'dens') { const v = Math.min(1, g.act[c] / 700); col = R.purple(v); a = 60 + 150 * Math.min(1, v * 3); }
      else if (kind === 'traffic') { const v = Math.min(1, g.traffic[c]); col = R.bad(v); a = trafficFx.ready && city.cfg.traffic === 'sim' ? 55 : g.cap[c] > 0 || g.act[c] > 5 ? 200 : 50; } else if (kind === 'transit') { const v = Math.min(1, g.transit[c]); col = R.blue(v); a = 70 + 140 * v; }
      else if (kind === 'noise') { const v = Math.min(1, g.noise[c]); col = R.bad(v); a = 60 + 160 * v; } else if (kind === 'svc') { const v = (g.edu[c] + g.health[c] + g.police[c] + g.fire[c]) / 4; col = R.teal(v); a = 70 + 140 * v; }
      else if (kind === 'sat') { col = R.good(g.sat[c]); a = g.dens[c] > 0 || g.act[c] > 3 ? 200 : 60; }
      else if (kind === 'hood') { const h = g.hood[c]; if (h) { const hue = (h * 0.381966) % 1, q = (n) => { const k = (n + hue * 6) % 6; return 0.5 - 0.15 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; col = [q(1) * 255, q(3) * 255, q(5) * 255]; a = 150; } }
    }
    const o = c * 4; if (col) { heat[o] = col[0]; heat[o + 1] = col[1]; heat[o + 2] = col[2]; } heat[o + 3] = a;
  }
  heatTex.needsUpdate = true;
}

// ---- save ------------------------------------------------------------------------------------------
export function serializeCity() {
  const rle = []; let v = grid.hood[0], n = 0; for (let c = 0; c < N; c++) { if (grid.hood[c] === v) n++; else { rle.push(v, n); v = grid.hood[c]; n = 1; } } rle.push(v, n);
  const { cfg, treasury, tax, hoodTax, subsidy, policies, custom, taxEvents, hist, hoodNames, lines, nextLine, feed, heat: h, moods, junctions } = city;
  return { cfg, treasury: Math.round(treasury), tax, hoodTax, subsidy, policies, custom, taxEvents, hist, hoodNames, hoods: rle, lines, nextLine, feed: feed.slice(0, 40), heat: h, moods: moods || [], junctions: junctions || {} };
}
export function loadCity(d) {
  resetCity2(false); if (!d) return;
  for (const k of ['treasury', 'tax', 'hoodTax', 'subsidy', 'policies', 'custom', 'taxEvents', 'lines', 'nextLine', 'feed', 'heat', 'moods', 'junctions']) if (d[k] != null) city[k] = d[k];
  if (d.cfg) Object.assign(city.cfg, d.cfg); if (d.hist) Object.assign(city.hist, d.hist);
  if (d.hoodNames) city.hoodNames = d.hoodNames;
  if (d.hoods) { let o = 0; for (let k = 0; k < d.hoods.length && o < N; k += 2) { grid.hood.fill(d.hoods[k], o, Math.min(N, o + d.hoods[k + 1])); o += d.hoods[k + 1]; } }
  dirty = true;
}
void land; void ZONES; void rng;
