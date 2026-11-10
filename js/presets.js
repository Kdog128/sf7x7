// Starter cities: a small built-up district at its real location, ready to expand.
// Every one draws the same staple streets (the Embarcadero, Market, Mission, Van Ness, Geary) and the Ferry Building.
import { MAP, ll, heightAt, coastDist, lockedAt } from './terrain.js';
import { GX, GZ, CELL, zone, land, road, buildings, toI, toJ, removeBuilding, refreshOverlay } from './world.js';
import { sim, stepSim, refreshCells, spawn } from './sim.js';
import { city, recompute } from './city.js';
import { place, siteOf, placeAtSite } from './place.js';
import { CAT } from './structures.js';
import { rng } from './util.js';

// [road type, name, lon/lat points]. Drawn in this order so later ones join the earlier ones.
const STAPLES = [
  ['boulevard', 'The Embarcadero', [[-122.4155, 37.8080], [-122.4100, 37.8078], [-122.4055, 37.8062], [-122.4012, 37.8030], [-122.3975, 37.7990], [-122.3952, 37.7950], [-122.3922, 37.7915], [-122.3897, 37.7880], [-122.3887, 37.7840], [-122.3897, 37.7805]]],
  ['boulevard', 'Market Street', [[-122.3952, 37.7947], [-122.4351, 37.7625]]],
  ['avenue', 'Mission Street', [[-122.3938, 37.7936], [-122.4179, 37.7741], [-122.4196, 37.7712], [-122.4197, 37.7650], [-122.4184, 37.7522], [-122.4182, 37.7481]]],
  ['boulevard', 'Van Ness Avenue', [[-122.4252, 37.8053], [-122.4193, 37.7752]]],
  ['avenue', 'Geary Boulevard', [[-122.4034, 37.7879], [-122.4212, 37.7857], [-122.4395, 37.7830], [-122.4585, 37.7813], [-122.4722, 37.7806], [-122.4850, 37.7801], [-122.5090, 37.7795]]],
];
const GEARY = [[-122.4212, 37.7857], [-122.4034, 37.7879]];   // west to east: the street grid north of Market runs this way

// at: the grid origin. axis: two points, west to east, that set the grid direction. u, v: block index ranges (u east, v south).
// bu, bv: block size in metres. uMain, vMain: grid lines drawn as wider streets, which also become the shop corridors.
export const PRESETS = [
  {
    k: 'market', name: 'Market Street', note: 'A small downtown: towers at Market and Montgomery, Union Square, the Ferry Building.',
    at: [-122.4082, 37.7873], axis: GEARY, u: [-3, 5], v: [-3, 4], bu: 112, bv: 80, uMain: { 0: 'avenue', 3: 'avenue' }, vMain: { '-3': 'avenue' },
    core: [-122.4022, 37.7888], steps: 1500, towers: true,
    lots: [['plaza', -1, 0, 7, 6], ['park', 1, -3, 9, 6], ['school', -3, -2, 6, 6], ['fire', 2, 2, 4, 5], ['police', -2, 2, 4, 5], ['club', 1, 3, 3, 4], ['musicvenue', -1, 2, 5, 6], ['comedy', 0, -1, 2, 3]],
    lines: [['metro', 'F Market', '#b8892c', 'staple', 'Market Street', [0.04, 0.14, 0.24, 0.34, 0.44]], ['bus', '38 Geary', '#c2572f', 'v', 0, [-3, -1, 1, 3]], ['cable', 'Powell and Hyde', '#8a2f2a', 'u', 0, [1, -1, -3]]],
    zone(c) {
      if (c.dCore < 150) return c.h < 0.3 ? 9 : 6;
      if (c.dCore < 270) return c.h < 0.35 ? 4 : c.h < 0.6 ? 11 : c.h < 0.8 ? 6 : 2;
      if (c.shore < 150) return c.h < 0.5 ? 10 : 11;
      if (c.dMain < 44) return c.h < 0.5 ? 11 : 3;
      return c.dCore < 420 ? (c.h < 0.12 ? 5 : 2) : c.h < 0.3 ? 2 : 1;
    },
  },
  {
    k: 'mission', name: 'The Mission', note: 'Rowhouses and flats around Mission Street, with Dolores Park and a few workshops.',
    at: [-122.4197, 37.7650], axis: [[-122.4263, 37.7645], [-122.4075, 37.7658]], u: [-4, 3], v: [-2, 4], bu: 112, bv: 144, uMain: { '-2': 'avenue', 2: 'avenue' }, vMain: { 0: 'avenue', 4: 'avenue' },
    steps: 1300,
    lots: [['park', -4, 2, 11, 15], ['school', -3, 0, 6, 6], ['fire', 1, 1, 4, 5], ['police', -1, 3, 4, 5], ['musicvenue', -2, 1, 5, 6], ['club', 0, -1, 3, 4], ['plaza', 0, 3, 5, 5]],
    lines: [['bus', '14 Mission', '#c2572f', 'u', 0, [-2, 0, 2, 4]], ['bus', '22 Fillmore', '#3f7f8c', 'v', 0, [-4, -2, 0, 3]]],
    zone(c) {
      if (c.dMain < 44) return c.h < 0.45 ? 11 : 3;
      if (c.bu >= 2 && c.bv <= -1) return c.h < 0.5 ? 7 : 5;      // the old workshops in the north-east corner
      return c.dMain < 120 && c.h < 0.5 ? 2 : 1;
    },
  },
  {
    k: 'sunset', name: 'Outer Sunset', note: 'Rows of stucco houses down to Ocean Beach, with the N Judah running through.',
    at: [-122.4950, 37.7610], axis: [[-122.5090, 37.7603], [-122.4950, 37.7610]], u: [-7, 1], v: [-2, 2], bu: 96, bv: 176, uMain: { 0: 'boulevard', '-7': 'avenue' }, vMain: { 0: 'avenue', '-2': 'avenue' },
    steps: 1100,
    lots: [['park', -4, 1, 9, 9], ['school', -2, -1, 6, 6], ['fire', -5, 0, 4, 5], ['police', -1, 1, 4, 5]],
    lines: [['metro', 'N Judah', '#2f5f8a', 'v', 0, [-7, -5, -3, -1, 1]], ['bus', '29 Sunset', '#5f8f4f', 'u', 0, [-2, 0, 2]]],
    zone(c) {
      if (c.dMain < 40 && Math.abs(c.v) < 60) return c.bu <= -6 ? 10 : c.h < 0.35 ? 11 : 3;   // shops only along Judah
      return c.h < 0.06 ? 2 : 1;
    },
  },
  {
    k: 'northbeach', name: 'North Beach', note: 'Columbus Avenue, Coit Tower on the hill and the wharf along the Embarcadero.',
    at: [-122.4065, 37.7978], axis: GEARY, u: [-4, 3], v: [-6, 1], bu: 112, bv: 88, uMain: { '-2': 'avenue' }, vMain: { 0: 'avenue', '-5': 'avenue' },
    extra: [['avenue', 'Columbus Avenue', [[-122.4036, 37.7958], [-122.4188, 37.8055], [-122.4180, 37.8076], [-122.4155, 37.8080]]]], landmarks: ['coit'], steps: 1300,
    lots: [['park', -2, -2, 9, 7], ['school', -4, -1, 6, 6], ['fire', 1, 0, 4, 5], ['police', -3, -4, 4, 5], ['comedy', 0, 0, 2, 3], ['club', -1, 0, 3, 4], ['musicvenue', 1, -1, 5, 6]],
    lines: [['cable', 'Powell and Mason', '#8a2f2a', 'u', -2, [1, -1, -3, -5]], ['bus', '30 Stockton', '#c2572f', 'u', -1, [1, -2, -5]]],
    zone(c) {
      if (c.shore < 170) return c.bu >= 2 ? (c.h < 0.5 ? 12 : 7) : 10;
      if (c.dMain < 44) return c.bv >= -1 ? (c.h < 0.4 ? 4 : 11) : c.h < 0.5 ? 11 : 3;
      return c.dMain < 130 ? 2 : c.h < 0.4 ? 2 : 1;
    },
  },
];
export const PRESET_KEYS = PRESETS.map((p) => p.k);

const dist2seg = (x, z, ax, az, bx, bz) => { const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1))); return Math.hypot(x - ax - ex * t, z - az - ez * t); };
const distPoly = (x, z, p) => { let b = 1e9; for (let k = 0; k + 3 < p.length; k += 2) b = Math.min(b, dist2seg(x, z, p[k], p[k + 1], p[k + 2], p[k + 3])); return b; };
const dry = (x, z, m = 18) => x > MAP.minX + 16 && x < MAP.maxX - 16 && z > MAP.minZ + 16 && z < MAP.maxZ - 16 && coastDist(x, z) >= m && heightAt(x, z) > 1 && !lockedAt(x, z);
// nearest dry point, for staple corners that the simplified coastline leaves in the water
function inland(x, z, m = 24) { if (dry(x, z, m)) return [x, z]; for (let r = 10; r <= 400; r += 10) for (let a = 0; a < 24; a++) { const px = x + Math.cos((a * Math.PI) / 12) * r, pz = z + Math.sin((a * Math.PI) / 12) * r; if (dry(px, pz, m)) return [px, pz]; } return null; }

export function buildPreset(game, key) {
  const P = PRESETS.find((p) => p.k === key) || PRESETS[0], roads = game.roads, mains = [], named = {};
  // a polyline of lon/lat points: each end joins a road it reaches, and it is added piece by piece so one bad piece does not lose the rest
  const draw = (type, name, lls) => {
    const pts = []; for (const q of lls) { const w = inland(...ll(q[0], q[1])); if (w) pts.push(w); }
    for (const e of [0, pts.length - 1]) { const n = pts[e] && roads.nearestSeg(pts[e][0], pts[e][1], 90); if (n) pts[e] = [n.x, n.z]; }
    const flat = []; for (const q of pts) flat.push(Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10);
    if (flat.length < 4) return;
    if (!roads.add(type, flat).ok) for (let k = 0; k + 3 < flat.length; k += 2) roads.add(type, flat.slice(k, k + 4));
    mains.push(flat); named[name] = flat;
  };
  for (const [type, name, lls] of STAPLES) draw(type, name, lls);
  const stapleEnds = [...roads.nodes.values()].filter((n) => n.segs.size === 1).map((n) => [n.x, n.z]);
  for (const [type, name, lls] of P.extra || []) draw(type, name, lls);
  const extras = (P.extra || []).map((e) => named[e[1]]).filter(Boolean);

  // the district grid, turned to the real street direction
  const [ox, oz] = ll(...P.at), [ax, az] = ll(...P.axis[0]), [bx, bz] = ll(...P.axis[1]), al = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / al, uz = (bz - az) / al, vx = -uz, vz = ux;
  const W = (u, v) => [ox + ux * u + vx * v, oz + uz * u + vz * v], UV = (x, z) => [(x - ox) * ux + (z - oz) * uz, (x - ox) * vx + (z - oz) * vz];
  const { bu, bv } = P, [u0, u1] = P.u, [v0, v1] = P.v, gridMain = [];
  // one grid line: keep the dry stretches, and drop it where a staple already runs along the same course
  const gline = (type, a, b, main) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.round(len / 8)), dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len; let run = null, runs = [];
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n; let ok = dry(x, z);
      if (ok) { const near = roads.nearestSeg(x, z, 30); if (near) { const p = near.seg.pts, c = near.seg.cum; let q = 0; while (q < c.length - 2 && c[q + 1] < near.s) q++; const sx = p[q * 2 + 2] - p[q * 2], sz = p[q * 2 + 3] - p[q * 2 + 1], sl = Math.hypot(sx, sz) || 1; if (Math.abs((sx * dx + sz * dz) / sl) > 0.9) ok = false; } }
      if (ok) { if (!run) run = [x, z, x, z]; else { run[2] = x; run[3] = z; } } else if (run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    for (const r of runs) if (Math.hypot(r[2] - r[0], r[3] - r[1]) > 40) { const f = r.map((q) => Math.round(q * 10) / 10); roads.add(type, f); if (main) { mains.push(f); gridMain.push(f); } }
  };
  for (let k = u0; k <= u1; k++) gline((P.uMain || {})[k] || 'street', W(k * bu, v0 * bv), W(k * bu, v1 * bv), !!(P.uMain || {})[k]);
  for (let k = v0; k <= v1; k++) gline((P.vMain || {})[k] || 'street', W(u0 * bu, k * bv), W(u1 * bu, k * bv), !!(P.vMain || {})[k]);

  // tidy the loose ends: a street that stops just short of another one is carried through to it, and short stubs are removed.
  // The far ends of the staples stay as they are, so there is something to build out from.
  const isStaple = (n) => stapleEnds.some((e) => Math.hypot(e[0] - n.x, e[1] - n.z) < 1);
  for (let pass = 0; pass < 3; pass++) for (const n of [...roads.nodes.values()]) {
    if (n.segs.size !== 1 || isStaple(n)) continue;
    const seg = roads.segs.get([...n.segs][0]); if (!seg) continue;
    const p = seg.pts, m = p.length, head = Math.hypot(p[0] - n.x, p[1] - n.z) < 0.5;
    const [qx, qz] = head ? [p[2], p[3]] : [p[m - 4], p[m - 3]], dl = Math.hypot(n.x - qx, n.z - qz) || 1, dx = (n.x - qx) / dl, dz = (n.z - qz) / dl;
    let hit = null;
    for (let t = 8; t <= 64 && !hit; t += 4) { const x = n.x + dx * t, z = n.z + dz * t; if (!dry(x, z, 8)) break; const o = roads.nearestSeg(x, z, 5); if (o && o.seg.id !== seg.id) hit = o; }
    if (hit && roads.add(seg.type, [n.x, n.z, Math.round(hit.x * 10) / 10, Math.round(hit.z * 10) / 10]).ok) continue;
    const mx = (p[0] + p[m - 2]) / 2, mz = (p[1] + p[m - 1]) / 2;
    if (seg.len < 100 || extras.some((e) => distPoly(mx, mz, e) < 3)) roads.removeRaw(seg.id);
  }

  // landmarks at their real sites, then civic lots inside chosen blocks
  const real = (k) => { const s = siteOf(k); if (!s) return; if (placeAtSite(game, k, s, { quiet: true, free: true, now: -100 })) return; for (const [di, dj] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [4, 0], [-4, 0], [0, 4], [0, -4], [6, 0], [-6, 0]]) if (place(game, k, s.i + di, s.j + dj, s.w, s.d, s.front, { relaxed: true, quiet: true, free: true, now: -100 })) return; };
  real('ferry'); for (const k of P.landmarks || []) real(k);
  for (const [k, a, b, w, d] of P.lots || []) {
    // the chosen block first, then its neighbours; parks and plazas also shrink and move off a diagonal street
    const flex = !!CAT[k].per; let done = false;
    for (const [sa, sb] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const cu = a + sa, cv = b + sb; if (done) break; if (cu < u0 || cu >= u1 || cv < v0 || cv >= v1) continue;
      for (let t = 0; t < (flex ? 4 : 1) && !done; t++) {
        const ww = flex ? Math.max(4, w - t * 2) : w, dd = flex ? Math.max(4, d - t * 2) : d;
        const spots = flex ? [[0.5, 0.5], [0.3, 0.3], [0.7, 0.7], [0.3, 0.7], [0.7, 0.3]] : [[0.5, 0.5 + Math.max(0, bv / 2 - 14 - (dd * CELL) / 2) / bv], [0.5, 0.5], [0.35, 0.5], [0.65, 0.5], [0.5, 0.42], [0.5, 0.58]];
        for (const [fu, fv] of spots) {
          const [cx, cz] = W((cu + fu) * bu, (cv + fv) * bv);
          if (place(game, k, toI(cx) - (ww >> 1), toJ(cz) - (dd >> 1), ww, dd, 2, { quiet: true, free: true, now: -100, seed: 11 + a * 7 + b })) { done = true; break; }
        }
      }
    }
  }

  // zoning: every dry cell inside the grid, by distance to the core, the main streets and the shore
  const core = P.core ? ll(...P.core) : null, corners = [W(u0 * bu, v0 * bv), W(u1 * bu, v0 * bv), W(u1 * bu, v1 * bv), W(u0 * bu, v1 * bv)];
  const i0 = toI(Math.min(...corners.map((c) => c[0]))) - 3, i1 = toI(Math.max(...corners.map((c) => c[0]))) + 3, j0 = toJ(Math.min(...corners.map((c) => c[1]))) - 3, j1 = toJ(Math.max(...corners.map((c) => c[1]))) + 3, pad = 20;
  for (let j = Math.max(0, j0); j <= Math.min(GZ - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(GX - 1, i1); i++) {
    const o = j * GX + i; if (!land[o] || road[o]) continue;
    const x = MAP.minX + (i + 0.5) * CELL, z = MAP.minZ + (j + 0.5) * CELL, [u, v] = UV(x, z);
    if (u < u0 * bu - pad || u > u1 * bu + pad || v < v0 * bv - pad || v > v1 * bv + pad || lockedAt(x, z)) continue;
    const cu = Math.floor(u / bu), cv = Math.floor(v / bv); let dMain = 1e9; for (const m of mains) dMain = Math.min(dMain, distPoly(x, z, m));
    zone[o] = P.zone({ u, v, bu: cu, bv: cv, h: (((cu * 7 + cv * 13) % 10) + 10) % 10 / 10, dMain, dCore: core ? Math.hypot(x - core[0], z - core[1]) : 1e9, shore: coastDist(x, z) });
  }
  refreshOverlay(0, 0, GX - 1, GZ - 1); refreshCells(Math.max(0, i0 - 4), Math.max(0, j0 - 4), Math.min(GX - 1, i1 + 4), Math.min(GZ - 1, j1 + 4));

  // transit: along a staple by fraction of its length, or along a grid line by block index
  const along = (flat, t) => { let L = 0; const c = [0]; for (let k = 0; k + 3 < flat.length; k += 2) { L += Math.hypot(flat[k + 2] - flat[k], flat[k + 3] - flat[k + 1]); c.push(L); } const d = t * L; let k = 0; while (k < c.length - 2 && c[k + 1] < d) k++; const f = (d - c[k]) / (c[k + 1] - c[k] || 1); return [flat[k * 2] + (flat[k * 2 + 2] - flat[k * 2]) * f, flat[k * 2 + 1] + (flat[k * 2 + 3] - flat[k * 2 + 1]) * f]; };
  for (const [type, name, color, how, idx, at] of P.lines || []) {
    const stops = [];
    for (const t of at) { const q = how === 'staple' ? along(named[idx] || mains[0], t) : how === 'u' ? W(idx * bu, t * bv) : W(t * bu, idx * bv), n = roads.nearestSeg(q[0], q[1], 60); if (n) stops.push(Math.round(n.x), Math.round(n.z)); }
    if (stops.length >= 4) city.lines.push({ id: city.nextLine++, type, name, color, stops });
  }
  game.life.rebuildTransit();

  // let it grow for a while with a fixed seed, so each starter city is the same every time
  const keep = sim.rand, od = sim.onDay; sim.rand = rng(7 + PRESET_KEYS.indexOf(P.k)); sim.onDay = null; recompute();
  for (let k = 0; k < P.steps; k++) { stepSim(1, -100); if (k % 400 === 0) recompute(); }
  if (P.towers && core) for (const b of [...buildings.values()]) {   // the middle few blocks get their towers now instead of waiting for the population to catch up
    if (b.sp || !(b.zone === 6 || b.zone === 9 || b.zone === 4 || b.zone === 11)) continue;
    const d = Math.hypot(MAP.minX + (b.i + b.w / 2) * CELL - core[0], MAP.minZ + (b.j + b.d / 2) * CELL - core[1]);
    const want = Math.min(b.zone === 11 ? 4 : 5, d < 100 ? 4 + (b.seed % 3 === 0 ? 1 : 0) : d < 180 ? 3 + (b.seed % 2) : d < 280 ? 2 + (b.seed % 2) : 0);
    if (want <= b.level || (want >= 4 && b.w * b.d < 9)) continue;
    removeBuilding(b.id); spawn({ i: b.i, j: b.j, w: b.w, d: b.d, zone: b.zone, front: b.front }, want, b.seed, -100);
  }
  recompute();
  sim.rand = keep; sim.onDay = od; sim.time = 16.2; sim.day = 1; game.undo.clear();
  for (const b of buildings.values()) b.born = 1;
  const [mx, mz] = W(((u0 + u1) / 2) * bu, ((v0 + v1) / 2) * bv);
  game.rig.set(mx + 40, mz + 90, Math.max(900, Math.hypot((u1 - u0) * bu, (v1 - v0) * bv) * 1.05), 0.62, 0.42);
  return P;
}
