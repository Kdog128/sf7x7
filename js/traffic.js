// Traffic: peak-hour car trips from homes to jobs, routed over the real road network.
//
// Each road type has lanes, a speed limit and a lane capacity. Junctions get traffic lights, stop signs or a free merge,
// which cut the capacity of the roads that approach them. Trips are assigned to the quickest routes in small batches
// every frame, and travel times are updated from the volumes (the BPR curve), so traffic spreads onto parallel streets as
// the main ones fill up. The result drives the car animation, the traffic lights, the Traffic overlay, satisfaction,
// land value and housing demand.
import * as THREE from 'three';
import { MAP } from './terrain.js';
import { CELL, buildings } from './world.js';
import { ROAD_TYPES, roadY } from './roads.js';
import { city, grid, sample, LW, LH, LS, fx, trafficFx, hoodName, hoodAt, post } from './city.js';
import { sim } from './sim.js';
import { clamp, hash2 } from './util.js';

// lanes each way, cars per lane per hour between junctions, speed limit (m/s; mph for display), class for junction rules
export const ROAD_FLOW = {
  street: { lanes: 1, cap: 700, sp: 11.2, mph: 25, cls: 1 },
  oneway: { lanes: 2, cap: 750, sp: 13.4, mph: 30, cls: 1.5, oneway: true },
  avenue: { lanes: 2, cap: 800, sp: 13.4, mph: 30, cls: 2 },
  boulevard: { lanes: 3, cap: 850, sp: 15.6, mph: 35, cls: 3 },
  highway: { lanes: 3, cap: 1900, sp: 26.8, mph: 60, cls: 5, free: true },
  ramp: { lanes: 1, cap: 1500, sp: 17.9, mph: 40, cls: 4, free: true },
};
export const CONTROL_NAMES = { signal: 'Traffic lights', stop: 'Stop signs', free: 'No control', merge: 'Merge' };
const SAT = 1650;        // cars per lane per hour of green at a light
const STOP_CAP = 420;    // cars per lane per hour through an all-way stop
const CYCLE = 34;        // seconds per light cycle on screen
const nkey = (x, z) => Math.round(x * 10) + '_' + Math.round(z * 10);

export function makeTraffic(game) {
  const roads = game.roads;
  let ver = -1, N = 0, E = 0;
  // nodes
  let nx, nz, nKey = [], nCtrl = [], nOut = [], nHalf, nAxis;      // nAxis: direction of the main road through the node
  // directed edges
  let eSeg, eDir, eFrom, eTo, eLen, eT0, eCap, eVol, eNew, eTime, eMajor;
  const segEdges = new Map();      // seg id -> [edge forward, edge backward or -1]
  // zones
  let zones = [], zoneAt = new Map(), origins = [], cursor = 0, sweepStats = null, sweeps = 0, lastJamPost = -9;
  // dijkstra scratch
  let dist, pred, order, heapI, heapD;

  const nodeIdx = new Map();
  const stats = { commute: 0, congestion: 0, trips: 0, lost: 0, signals: 0, stops: 0, jams: [], ready: false, worst: null };

  // ---- graph -------------------------------------------------------------------------------------------
  function build() {
    const keys = new Map(); N = 0; nKey = []; const xs = [], zs = [];
    for (const [k, n] of roads.nodes) { keys.set(k, N); nKey.push(k); xs.push(n.x); zs.push(n.z); N++; }
    nx = Float64Array.from(xs); nz = Float64Array.from(zs); nOut = Array.from({ length: N }, () => []);
    const ed = []; segEdges.clear();
    for (const s of roads.segs.values()) {
      const p = s.pts, a = keys.get(nkey(p[0], p[1])), b = keys.get(nkey(p[p.length - 2], p[p.length - 1])); if (a == null || b == null || a === b) continue;
      const F = ROAD_FLOW[s.type] || ROAD_FLOW.street, f = ed.length; ed.push([s.id, 1, a, b, s.len, F]);
      let r = -1; if (!F.oneway) { r = ed.length; ed.push([s.id, -1, b, a, s.len, F]); }
      segEdges.set(s.id, [f, r]);
    }
    E = ed.length;
    eSeg = new Int32Array(E); eDir = new Int8Array(E); eFrom = new Int32Array(E); eTo = new Int32Array(E); eLen = new Float32Array(E); eT0 = new Float32Array(E); eCap = new Float32Array(E);
    const oldVol = eVol;
    eVol = new Float32Array(E); eNew = new Float32Array(E); eTime = new Float32Array(E); eMajor = new Uint8Array(E);
    for (let k = 0; k < E; k++) { const [sid, d, a, b, L, F] = ed[k]; eSeg[k] = sid; eDir[k] = d; eFrom[k] = a; eTo[k] = b; eLen[k] = L; eT0[k] = L / F.sp; nOut[a].push(k); }
    // carry volumes over from the last network so the picture does not reset on every road edit
    if (oldVol && prevSegVol) for (let k = 0; k < E; k++) { const v = prevSegVol.get(eSeg[k] * 2 + (eDir[k] > 0 ? 0 : 1)); if (v) eVol[k] = v; }
    // junction control
    nCtrl = new Array(N); nHalf = new Float32Array(N); nAxis = new Float32Array(N * 2); stats.signals = 0; stats.stops = 0;
    const inc = Array.from({ length: N }, () => []);
    for (let k = 0; k < E; k++) inc[eTo[k]].push(k);
    for (let n = 0; n < N; n++) {
      const segs = [...roads.nodes.get(nKey[n]).segs].map((id) => roads.segs.get(id)).filter(Boolean);
      let maxC = 0, minC = 9, half = 0, ax = 0, az = 0, best = -1;
      for (const s of segs) {
        const F = ROAD_FLOW[s.type] || ROAD_FLOW.street; maxC = Math.max(maxC, F.cls); minC = Math.min(minC, F.cls); half = Math.max(half, ROAD_TYPES[s.type].half);
        if (F.cls > best) { best = F.cls; const p = s.pts, atStart = nkey(p[0], p[1]) === nKey[n], q = atStart ? 2 : p.length - 4; ax = p[q] - (atStart ? p[0] : p[p.length - 2]); az = p[q + 1] - (atStart ? p[1] : p[p.length - 1]); }
      }
      const l = Math.hypot(ax, az) || 1; nAxis[n * 2] = ax / l; nAxis[n * 2 + 1] = az / l; nHalf[n] = half;
      let c = 'free';
      if (segs.length >= 3) {
        const surface = segs.filter((s) => !(ROAD_FLOW[s.type] || {}).free);
        if (surface.length === 0) c = 'merge';
        else if (surface.length < segs.length) c = surface.some((s) => ROAD_FLOW[s.type].cls >= 2) ? 'signal' : 'stop';    // ramp meets the street grid
        else c = maxC >= 2 ? 'signal' : 'stop';
      } else if (segs.length === 2 && segs.some((s) => (ROAD_FLOW[s.type] || {}).free) && segs.some((s) => !(ROAD_FLOW[s.type] || {}).free)) c = 'signal';   // ramp ends at a street
      const o = city.junctions && city.junctions[nKey[n]]; if (o && segs.length >= 2) c = o;
      nCtrl[n] = c; if (c === 'signal') stats.signals++; else if (c === 'stop') stats.stops++;
      // approach capacity: lanes x (midblock, or what the junction lets through)
      for (const k of inc[n]) {
        const s = roads.segs.get(eSeg[k]), F = ROAD_FLOW[s.type] || ROAD_FLOW.street, major = F.cls >= maxC - 0.01; eMajor[k] = major ? 1 : 0;
        const g = maxC === minC ? 0.5 : major ? 0.6 : 0.4, mid = F.lanes * F.cap;
        eCap[k] = c === 'signal' ? Math.min(mid, F.lanes * SAT * g) : c === 'stop' ? Math.min(mid, F.lanes * STOP_CAP) : mid;
      }
    }
    for (let k = 0; k < E; k++) if (!eCap[k]) { const s = roads.segs.get(eSeg[k]), F = ROAD_FLOW[s.type] || ROAD_FLOW.street; eCap[k] = F.lanes * F.cap; }
    dist = new Float64Array(N); pred = new Int32Array(N); order = new Int32Array(N); heapI = new Int32Array(E + N + 8); heapD = new Float64Array(E + N + 8);
    for (let k = 0; k < E; k++) eTime[k] = edgeTime(k);
    cursor = 0; eNew.fill(0); sweepStats = { t: 0, trips: 0, lost: 0 };
    zonesDirty = true;
    nodeIdx.clear(); for (let n = 0; n < N; n++) nodeIdx.set(nKey[n], n);
  }
  let prevSegVol = null;
  function remember() { if (!eVol) return; prevSegVol = new Map(); for (let k = 0; k < E; k++) if (eVol[k] > 0) prevSegVol.set(eSeg[k] * 2 + (eDir[k] > 0 ? 0 : 1), eVol[k]); }

  // travel time on an edge, junction delay included
  function edgeTime(k) {
    const x = eVol[k] / eCap[k], c = nCtrl[eTo[k]];
    let t = eT0[k] * (1 + 0.15 * x * x * x * x);
    if (c === 'signal') t += (eMajor[k] ? 8 : 14) * (1 + 1.5 * Math.min(x, 1.6) * Math.min(x, 1.6));
    else if (c === 'stop') t += 5 * (1 + 3 * Math.min(x, 1.6) * Math.min(x, 1.6));
    return t;
  }

  // ---- demand ------------------------------------------------------------------------------------------
  let zonesDirty = true, zoneAcc = 0, sweepAcc = 9;
  function buildZones() {
    zonesDirty = false; zoneAcc = 0;
    let size = 128; const cells = new Map();
    const collect = (sz) => { cells.clear(); for (const b of buildings.values()) { const x = MAP.minX + (b.i + b.w / 2) * CELL, z = MAP.minZ + (b.j + b.d / 2) * CELL, k = Math.floor((x - MAP.minX) / sz) + Math.floor((z - MAP.minZ) / sz) * 10000; let c = cells.get(k); if (!c) cells.set(k, (c = { x: 0, z: 0, w: 0, P: 0, A: 0 })); const w = (b.res || 0) + (b.jobs || 0) + 1; c.x += x * w; c.z += z * w; c.w += w; c.P += (b.res || 0) * 0.5; c.A += (b.jobs || 0) + (b.zone === 3 || b.zone === 4 || b.zone === 10 || b.zone === 11 ? (b.jobs || 0) * 0.6 : 0); } };
    collect(size); while (cells.size > 420 && size < 1024) { size *= 2; collect(size); }
    const keys = new Map(); for (let n = 0; n < N; n++) keys.set(nKey[n], n);
    zones = []; zoneAt.clear();
    for (const c of cells.values()) {
      if (c.P < 1 && c.A < 1) continue; const x = c.x / c.w, z = c.z / c.w;
      let s = roads.nearestSeg(x, z, Math.max(220, size * 1.2)); if (s && !ROAD_TYPES[s.seg.type].access) s = null;
      let node = -1, acc = 0;
      if (s) { const p = s.seg.pts, a = keys.get(nkey(p[0], p[1])), b = keys.get(nkey(p[p.length - 2], p[p.length - 1])); node = s.s < s.seg.len / 2 ? a : b; if (node == null) node = a ?? b ?? -1; acc = (s.d + Math.min(s.s, s.seg.len - s.s)) / 8; }
      zones.push({ x, z, P: c.P, A: c.A, node, acc, car: 0 });
    }
    origins = []; for (let i = 0; i < zones.length; i++) if (zones[i].P > 0.5 && zones[i].node >= 0) origins.push(i);
    for (let i = 0; i < zones.length; i++) if (zones[i].node >= 0) { const n = zones[i].node; if (!zoneAt.has(n)) zoneAt.set(n, []); zoneAt.get(n).push(i); }
    stats.isolated = zones.filter((zn) => zn.P > 5 && zn.node < 0).length;
  }
  // share of peak-hour trips by car from a zone: transit coverage and walkable density take cars off the road
  function carShare(zn) { const tr = Math.min(1, sample(grid.transit, zn.x, zn.z)), dens = Math.min(1, sample(grid.act, zn.x, zn.z) / 1200); return clamp(0.78 - 0.42 * tr - 0.14 * dens, 0.2, 0.85); }
  // how busy this hour is compared with the morning peak
  function hourFactor(h = sim.time) {
    const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    return 0.12 + 0.88 * Math.max(sm(5.5, 8, h) * (1 - sm(9.5, 11, h)), 0.9 * sm(15, 17.3, h) * (1 - sm(18.8, 21, h)), 0.5 * sm(9, 11, h) * (1 - sm(19, 23, h)));
  }

  // ---- assignment --------------------------------------------------------------------------------------
  function dijkstra(src) {
    dist.fill(Infinity); pred.fill(-1); let hn = 0, no = 0;
    const push = (i, d) => { let k = hn++; while (k > 0) { const q = (k - 1) >> 1; if (heapD[q] <= d) break; heapD[k] = heapD[q]; heapI[k] = heapI[q]; k = q; } heapD[k] = d; heapI[k] = i; };
    const pop = () => { const i = heapI[0]; hn--; if (hn > 0) { const d = heapD[hn], ii = heapI[hn]; let k = 0; for (;;) { let q = k * 2 + 1; if (q >= hn) break; if (q + 1 < hn && heapD[q + 1] < heapD[q]) q++; if (heapD[q] >= d) break; heapD[k] = heapD[q]; heapI[k] = heapI[q]; k = q; } heapD[k] = d; heapI[k] = ii; } return i; };
    dist[src] = 0; push(src, 0);
    while (hn) {
      const d0 = heapD[0], u = pop(); if (d0 > dist[u]) continue; order[no++] = u;
      const out = nOut[u]; for (let q = 0; q < out.length; q++) { const k = out[q], v = eTo[k], d = d0 + eTime[k]; if (d < dist[v]) { dist[v] = d; pred[v] = k; push(v, d); } }
    }
    return no;
  }
  const flow = new Map();
  function assignFrom(zi, scale) {
    const zn = zones[zi], src = zn.node, trips = zn.P * 0.92 * scale * carShare(zn);   // all peak-hour car trips: commutes, errands and deliveries if (trips <= 0) return;
    const no = dijkstra(src);
    // destinations: jobs, weighted by how quick they are to reach
    let W = 0; const dests = [];
    for (let q = 0; q < no; q++) { const n = order[q], zs = zoneAt.get(n); if (!zs) continue; for (const j of zs) { if (j === zi || zones[j].A <= 0) continue; const t = dist[n] + zn.acc + zones[j].acc, w = zones[j].A * Math.exp(-t / 780); if (w > 0) { dests.push(j, t, w); W += w; } } }
    if (W <= 0) { sweepStats.lost += trips; return; }
    flow.clear();
    for (let q = 0; q < dests.length; q += 3) { const j = dests[q], f = trips * (dests[q + 2] / W), n = zones[j].node; flow.set(n, (flow.get(n) || 0) + f); sweepStats.t += f * dests[q + 1]; sweepStats.trips += f; }
    // push the flows back up the tree of quickest routes
    for (let q = no - 1; q > 0; q--) { const n = order[q], f = flow.get(n); if (!f) continue; const k = pred[n]; if (k < 0) continue; eNew[k] += f; const u = eFrom[k]; flow.set(u, (flow.get(u) || 0) + f); }
  }
  function finishSweep() {
    sweeps++; const a = sweeps < 3 ? 1 : 0.45;
    for (let k = 0; k < E; k++) { eVol[k] = eVol[k] * (1 - a) + eNew[k] * a; eTime[k] = edgeTime(k); }
    eNew.fill(0);
    // city figures
    let vk = 0, vkc = 0; const jams = [];
    for (const [sid, [f, r]] of segEdges) {
      let worst = 0, vol = 0; for (const k of [f, r]) if (k >= 0) { worst = Math.max(worst, eVol[k] / eCap[k]); vol += eVol[k]; }
      const s = roads.segs.get(sid); if (!s) continue; vk += vol * s.len; vkc += vol * s.len * Math.min(1.5, worst);
      if (worst > 0.9 && vol > 120) jams.push({ sid, x: worst, vol });
    }
    stats.congestion = vk ? vkc / vk : 0; stats.trips = sweepStats.trips; stats.lost = sweepStats.lost;
    stats.commute = sweepStats.trips ? 4 + sweepStats.t / sweepStats.trips / 60 : 0; stats.ready = sweepStats.trips > 0 || stats.ready;
    jams.sort((p, q) => q.x * q.vol - p.x * p.vol); stats.jams = jams.slice(0, 8);
    sweepStats = { t: 0, trips: 0, lost: 0 };
    raster(); remember(); talk();
  }
  // per coarse cell: how jammed the busiest road through it is, and traffic noise
  const tGrid = new Float32Array(LW * LH), nGrid = new Float32Array(LW * LH);
  function raster() {
    tGrid.fill(0); nGrid.fill(0);
    for (const [sid, [f, r]] of segEdges) {
      const s = roads.segs.get(sid); if (!s) continue; let x = 0, vol = 0; for (const k of [f, r]) if (k >= 0) { x = Math.max(x, eVol[k] / eCap[k]); vol += eVol[k]; }
      if (vol < 1) continue; const p = s.pts;
      for (let k = 0; k + 3 < p.length; k += 2) { const l = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]), n = Math.max(1, Math.ceil(l / (LS * 0.5))); for (let q = 0; q <= n; q++) { const px = p[k] + ((p[k + 2] - p[k]) * q) / n, pz = p[k + 1] + ((p[k + 3] - p[k + 1]) * q) / n, i = clamp(Math.floor((px - MAP.minX) / LS), 0, LW - 1), j = clamp(Math.floor((pz - MAP.minZ) / LS), 0, LH - 1), c = j * LW + i; tGrid[c] = Math.max(tGrid[c], Math.min(1.2, x)); nGrid[c] = Math.max(nGrid[c], Math.min(0.45, vol / 5000)); } }
    }
    // spread a little so the blocks beside a jammed road feel it too
    const tmp = Float32Array.from(tGrid); for (let j = 1; j < LH - 1; j++) for (let i = 1; i < LW - 1; i++) { const c = j * LW + i; let m = tmp[c]; for (const o of [-1, 1, -LW, LW]) m = Math.max(m, tmp[c + o] * 0.7); tGrid[c] = m; }
    trafficFx.grid = tGrid; trafficFx.noise = nGrid; trafficFx.commute = stats.commute; trafficFx.ready = stats.ready;
  }
  function segLabel(sid, lower = false) { const s = roads.segs.get(sid); if (!s) return ''; const p = s.pts, h = hoodName(hoodAt((p[0] + p[2]) / 2, (p[1] + p[3]) / 2)), dx = Math.abs(p[p.length - 2] - p[0]), dz = Math.abs(p[p.length - 1] - p[1]);
    const o = dx > dz * 2.4 ? 'East-west' : dz > dx * 2.4 ? 'North-south' : 'Diagonal', n = `${o} ${ROAD_TYPES[s.type].name.toLowerCase()}`; return `${lower ? n.toLowerCase() : n}${h ? ` in ${h}` : ''}`; }
  function talk() {
    if (game.readOnly || !stats.ready || sim.day - lastJamPost < 2) return;
    const j = stats.jams[0]; if (!j || j.x < 1.05 || stats.trips < 200) return;
    lastJamPost = sim.day; const where = segLabel(j.sid, true);
    post(j.x > 1.4 ? `Gridlock on the ${where}. Forty minutes to go six blocks.` : `The ${where} is jammed again at rush hour.`, 'life');
  }

  // ---- per frame -----------------------------------------------------------------------------------------
  function verOf() { return roads.nextId * 131071 + roads.segs.size; }
  const api = {
    stats, ROAD_FLOW, CONTROL_NAMES,
    update(dt) {
      if (game.mode !== 'play') return;
      const v = verOf(); if (v !== ver) { remember(); ver = v; build(); }
      zoneAcc += dt; if (zonesDirty || zoneAcc > 6) { buildZones(); if (cursor > origins.length) cursor = 0; }
      if (!origins.length) { if (sweepStats && cursor === 0 && E) { eVol.fill(0); finishSweep(); } return; }
      const scale = hourFactor() * (fx().trafficMul || 1), t0 = performance.now();
      sweepAcc += dt; if (cursor === 0 && sweepAcc < 0.25) return; if (cursor === 0) sweepAcc = 0;
      while (performance.now() - t0 < 3.5) { if (cursor >= origins.length) { finishSweep(); cursor = 0; break; } assignFrom(origins[cursor++], scale); }
    },
    // how fast cars go on a segment right now (fraction of the speed limit), and in which direction
    speedOf(sid, dir) { const e = segEdges.get(sid); if (!e) return 1; const k = dir > 0 ? e[0] : e[1] >= 0 ? e[1] : e[0]; if (k < 0) return 1; const x = eVol[k] / eCap[k]; return clamp(1 / (1 + 0.15 * x * x * x * x) - (x > 1 ? 0.35 * Math.min(1, x - 1) : 0), 0.08, 1); },
    volOf(sid, dir) { const e = segEdges.get(sid); if (!e) return 0; const k = dir > 0 ? e[0] : e[1]; return k >= 0 ? eVol[k] : 0; },
    segInfo(sid) {
      const s = roads.segs.get(sid), e = segEdges.get(sid); if (!s || !e) return null; const F = ROAD_FLOW[s.type] || ROAD_FLOW.street;
      const dirs = e.filter((k) => k >= 0).map((k) => ({ vol: eVol[k], cap: eCap[k], x: eVol[k] / eCap[k], to: eTo[k], ctrl: nCtrl[eTo[k]] }));
      const worst = dirs.reduce((m, d) => Math.max(m, d.x), 0), sp = Math.min(...e.filter((k) => k >= 0).map((k) => eT0[k] / Math.max(eT0[k], edgeTime(k) - (nCtrl[eTo[k]] === 'signal' ? (eMajor[k] ? 8 : 14) : nCtrl[eTo[k]] === 'stop' ? 5 : 0))));
      const ends = [nKey[eFrom[e[0]]], nKey[eTo[e[0]]]].map((k, q) => ({ key: k, ctrl: nCtrl[q ? eTo[e[0]] : eFrom[e[0]]], deg: (roads.nodes.get(k) || { segs: new Set() }).segs.size }));
      return { type: s.type, F, len: s.len, dirs, worst, vol: dirs.reduce((m, d) => m + d.vol, 0), mph: Math.round(F.mph * sp), ends, label: segLabel(sid) };
    },
    nodeCtrl(key) { const n = nKey.indexOf(key); return n >= 0 ? nCtrl[n] : null; },
    setControl(key, c) { if (!city.junctions) city.junctions = {}; if (c) city.junctions[key] = c; else delete city.junctions[key]; ver = -1; },
    // ---- traffic lights on screen ----
    // phase at a node for cars arriving along a direction (dx, dz towards the node): 'g', 'y' or 'r'. Offsets along the main road give green waves.
    light(n, dx, dz, clock) {
      const ax = nAxis[n * 2], az = nAxis[n * 2 + 1], along = Math.abs(dx * ax + dz * az) > 0.7;
      const off = ((nx[n] * ax + nz[n] * az) / 12 + hash2(n, 7) * 3) % CYCLE, t = (((clock + off) % CYCLE) + CYCLE) % CYCLE, g1 = CYCLE * 0.55;
      if (along) return t < g1 - 3 ? 'g' : t < g1 ? 'y' : 'r';
      return t < g1 + 1 ? 'r' : t < CYCLE - 3 ? 'g' : t < CYCLE - 0.5 ? 'y' : 'r';
    },
    nodeIndex(key) { return nodeIdx.get(key) ?? -1; },
    get nodes() { return { N, nx, nz, nCtrl, nHalf, nKey }; },
    get debug() { return { cursor, origins: origins.length, zones: zones.length, sweeps, E, N }; },
    get ready() { return stats.ready; },
    hourFactor,
    reset() { ver = -1; sweeps = 0; prevSegVol = null; eVol = null; stats.ready = false; stats.jams = []; trafficFx.grid = null; trafficFx.noise = null; trafficFx.ready = false; },
  };

  // ---- signal and stop sign models near the camera ----------------------------------------------------------
  const MAXS = 1600, dark = new THREE.MeshLambertMaterial({ color: 0x2b2d2f }), lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const poles = new THREE.InstancedMesh(box, dark, MAXS), heads = new THREE.InstancedMesh(box, dark, MAXS), lamps = new THREE.InstancedMesh(box, lampMat, MAXS), arms = new THREE.InstancedMesh(box, dark, MAXS);
  const signGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 8); signGeo.rotateX(Math.PI / 2); signGeo.rotateZ(Math.PI / 8);
  const signs = new THREE.InstancedMesh(signGeo, new THREE.MeshLambertMaterial({ color: 0xb3261e }), MAXS);
  for (const m of [poles, heads, lamps, signs, arms]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); game.scene.add(m); }
  lamps.setColorAt(0, new THREE.Color(1, 1, 1));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  let props = [], propAcc = 9;   // [node, dx, dz (approach towards node), px, pz (pole), y, kind]
  const LAMP = { g: [0.2, 2.6, 0.9], y: [2.6, 1.7, 0.2], r: [2.8, 0.15, 0.1] };
  function gatherProps() {
    props = []; const r = game.rig, R = Math.min(900, Math.max(300, r.dist * 1.6)), tx = r.target.x, tz = r.target.z;
    if (r.dist > 1400 || !nCtrl) return;
    for (let n = 0; n < N && props.length < MAXS; n++) {
      const c = nCtrl[n]; if (c !== 'signal' && c !== 'stop') continue; if (Math.abs(nx[n] - tx) > R || Math.abs(nz[n] - tz) > R) continue;
      const node = roads.nodes.get(nKey[n]); if (!node) continue;
      for (const id of node.segs) {
        const s = roads.segs.get(id); if (!s || (ROAD_FLOW[s.type] || {}).free) continue; const p = s.pts, atStart = nkey(p[0], p[1]) === nKey[n], o = atStart ? 2 : p.length - 4, ex = atStart ? p[0] : p[p.length - 2], ez = atStart ? p[1] : p[p.length - 1];
        let dx = ex - p[o], dz = ez - p[o + 1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;     // towards the node
        const T = ROAD_TYPES[s.type], back = nHalf[n] + 2.2, side = T.half + T.walk * 0.45;
        const px = ex - dx * back - dz * side * -1, pz = ez - dz * back + dx * side * -1;   // kerb on the driver's right
        props.push([n, dx, dz, px, pz, roadY(px, pz), c === 'signal' ? 1 : 0, Math.min(6, T.half * 0.55 + T.walk * 0.45)]);
      }
    }
  }
  function drawProps(clock, night) {
    let np = 0, nl = 0, ns = 0, na = 0; const glow = 0.55 + night * 1.2;
    for (const [n, dx, dz, px, pz, y, kind, reach] of props) {
      q.setFromAxisAngle(up, Math.atan2(-dx, -dz));   // face oncoming traffic
      if (kind) {
        m4.compose(v3.set(px, y, pz), q, s3.set(0.3, 6.6, 0.3)); poles.setMatrixAt(np, m4);
        const hx = px + dz * reach, hz = pz - dx * reach;   // mast arm out over the lanes, head hanging from it
        m4.compose(v3.set((px + hx) / 2, y + 6.2, (pz + hz) / 2), q, s3.set(reach + 0.2, 0.2, 0.2)); arms.setMatrixAt(na++, m4);
        m4.compose(v3.set(hx, y + 4.3, hz), q, s3.set(0.75, 1.95, 0.5)); heads.setMatrixAt(np++, m4);
        const st = api.light(n, dx, dz, clock), lv = st === 'r' ? 1.42 : st === 'y' ? 0.8 : 0.18, c = LAMP[st];
        m4.compose(v3.set(hx - dx * 0.27, y + 4.3 + lv, hz - dz * 0.27), q, s3.set(0.52, 0.48, 0.08)); lamps.setMatrixAt(nl, m4); lamps.setColorAt(nl++, col.setRGB(c[0] * glow, c[1] * glow, c[2] * glow));
      } else {
        m4.compose(v3.set(px, y, pz), q, s3.set(0.1, 2.3, 0.1)); poles.setMatrixAt(np, m4); heads.setMatrixAt(np++, m4.makeScale(0, 0, 0));
        m4.compose(v3.set(px - dx * 0.08, y + 2.1, pz - dz * 0.08), q, s3.set(1, 1, 1)); signs.setMatrixAt(ns++, m4);
      }
    }
    poles.count = heads.count = np; lamps.count = nl; signs.count = ns; arms.count = na;
    for (const m of [poles, heads, lamps, signs, arms]) m.instanceMatrix.needsUpdate = true; if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  }
  api.frame = (dt, night, vclock = game.clock) => {
    const vis = game.mode === 'play'; for (const m of [poles, heads, lamps, signs, arms]) m.visible = vis; if (!vis) return;
    propAcc += dt; if (propAcc > 0.6) { propAcc = 0; gatherProps(); }
    drawProps(vclock, night);
  };

  // ---- Traffic overlay: roads colored by how full they are ----------------------------------------------------
  const ovMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.96, depthWrite: false, toneMapped: false, fog: false });
  let ovMesh = null, ovAcc = 9;
  const RAMP = [[0.16, 0.6, 0.3], [0.9, 0.72, 0.14], [0.9, 0.36, 0.1], [0.75, 0.08, 0.08]];
  const rampCol = (x) => { const t = clamp(x, 0, 1.3) / 1.3 * 3, i = Math.min(2, Math.floor(t)), f = t - i, a = RAMP[i], b = RAMP[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  function buildOverlay() {
    const pos = [], cols = [];
    for (const [sid, e] of segEdges) {
      const s = roads.segs.get(sid); if (!s) continue; const p = s.pts, T = ROAD_TYPES[s.type];
      for (const [k, side] of [[e[0], 1], [e[1], -1]]) {
        if (k < 0) continue; const x = eVol[k] / eCap[k], c = rampCol(x), w = Math.max(1.6, T.half * (e[1] < 0 ? 0.9 : 0.45)), off = e[1] < 0 ? 0 : side * T.half * 0.5;
        for (let q2 = 0; q2 + 3 < p.length; q2 += 2) {
          const ax = p[q2], az = p[q2 + 1], bx = p[q2 + 2], bz = p[q2 + 3], l = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / l, uz = (bz - az) / l, rx = -uz, rz = ux;
          const o1 = off - w / 2, o2 = off + w / 2, ya = roadY(ax, az) + 0.5, yb = roadY(bx, bz) + 0.5;
          const A = [ax + rx * o1, ya, az + rz * o1], B = [ax + rx * o2, ya, az + rz * o2], C = [bx + rx * o2, yb, bz + rz * o2], D = [bx + rx * o1, yb, bz + rz * o1];
          pos.push(...A, ...B, ...C, ...A, ...C, ...D); for (let t = 0; t < 6; t++) cols.push(...c);
        }
      }
    }
    if (ovMesh) { ovMesh.geometry.dispose(); game.scene.remove(ovMesh); ovMesh = null; }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    ovMesh = new THREE.Mesh(g, ovMat); ovMesh.renderOrder = 5; ovMesh.frustumCulled = false; game.scene.add(ovMesh);
  }
  api.overlay = (dt) => {
    const on = game.overlay === 'traffic' && game.mode === 'play';
    if (!on) { if (ovMesh) ovMesh.visible = false; return; }
    ovAcc += dt; if (ovAcc > 1.5 || !ovMesh) { ovAcc = 0; buildOverlay(); } if (ovMesh) ovMesh.visible = true;
  };
  return api;
}
