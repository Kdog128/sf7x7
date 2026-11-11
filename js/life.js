// Things that move: cars, people, transit vehicles, weather, cranes and scaffolds, particles, event staging.
import * as THREE from 'three';
import * as M from './models.js';
import { MAP, K, heightAt, coastDist } from './terrain.js';
import { CELL, buildings, stats } from './world.js';
import { ROAD_TYPES, roadY, cumLen, previewGeometry } from './roads.js';
import { constructionTime } from './buildings.js';
import { sim, yearOf, seasonOf } from './sim.js';
import { city, grid, sample, STOP_R, bpos } from './city.js';
import { culture } from './culture.js';
import { clamp, smoothstep, hash2 } from './util.js';

const nkey = (x, z) => Math.round(x * 10) + '_' + Math.round(z * 10);
const QUALITY = { low: { cars: 250, peds: 0, parts: 700, rain: 900, shadow: 1024 }, medium: { cars: 700, peds: 200, parts: 1600, rain: 1800, shadow: 2048 }, high: { cars: 1200, peds: 450, parts: 2600, rain: 2600, shadow: 2048 }, ultra: { cars: 2000, peds: 800, parts: 4000, rain: 3600, shadow: 4096 } };
export const LINE_TYPES = {
  bus: { name: 'Bus', color: '#c2572f', speed: 9, size: [2.7, 3.0, 11.5], body: 0xbdb7aa, every: 650 },
  cable: { name: 'Cable car', color: '#8a2f2a', speed: 4.6, size: [2.4, 3.1, 8.4], body: 0x6e2b26, every: 420 },
  metro: { name: 'Metro', color: '#3f7fb8', speed: 15, size: [2.7, 3.5, 23], body: 0x9aa0a3, every: 1100 },
  ferry: { name: 'Ferry', color: '#3f9c8c', speed: 8, size: [8.5, 5.5, 34], body: 0xe6e4dc, every: 1800 },
};
const CAR_COLS = [0x8c8f8a, 0x2f3438, 0xd6d2c6, 0x6f1f1c, 0x24364f, 0x4c5a4a, 0xa89f8c, 0x55585c, 0x1f2023, 0xb9b3a3, 0x7a6450, 0x394a5a].map((h) => new THREE.Color(h));
const BRIGHT = [0xd0514f, 0xe0a030, 0x4fa86a, 0x3f8fd0, 0x8a5fc8, 0xe07aa8, 0xf0d040, 0x40b8b0].map((h) => new THREE.Color(h));

export function makeLife(game) {
  const { scene, camera, rig, roads } = game;
  let Q = QUALITY.high, qName = 'high';
  const m4 = new THREE.Matrix4(), col = new THREE.Color(), E = m4.elements;
  const put = (mesh, i, x, y, z, sx, sy, sz, dx = 0, dz = 1) => { E[0] = dz * sx; E[1] = 0; E[2] = -dx * sx; E[3] = 0; E[4] = 0; E[5] = sy; E[6] = 0; E[7] = 0; E[8] = dx * sz; E[9] = 0; E[10] = dz * sz; E[11] = 0; E[12] = x; E[13] = y; E[14] = z; E[15] = 1; mesh.setMatrixAt(i, m4); };
  const inst = (geo, mat, n, shadow = false) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); m.setColorAt(0, col.set(0xffffff)); return m; };
  const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0);
  const lambert = () => new THREE.MeshLambertMaterial();
  const glowMat = () => new THREE.MeshBasicMaterial({ toneMapped: false, fog: true });

  // ---- vehicles on roads ---------------------------------------------------------------------------
  const MAXC = 2000, MAXP = 800;
  // body styles: 0 saloon, 1 crossover, 2 van, 3 pickup, 4 driverless crossover with its sensor dome
  const walkU = { value: 0 }, carMat = M.tintMaterial(), CARS = [M.sedan(), M.suv(), M.van(), M.pickup(), M.suv(true)].map((g, k) => inst(g, carMat, k === 0 ? MAXC : MAXC >> 1, true));
  const carLights = inst(unit, glowMat(), MAXC * 2), HALF = [2.22, 2.3, 2.7, 2.7, 2.3];
  const pedMat = M.tintMaterial(walkU), peds = inst(M.person(), pedMat, MAXP), scoots = inst(M.person(true), M.tintMaterial(), 300);
  const C = { seg: new Int32Array(MAXC), wait: new Float32Array(MAXC), s: new Float32Array(MAXC), dir: new Int8Array(MAXC), sp: new Float32Array(MAXC), lane: new Float32Array(MAXC), kind: new Uint8Array(MAXC), col: new Uint8Array(MAXC), n: 0 };
  const P = { seg: new Int32Array(MAXP), s: new Float32Array(MAXP), dir: new Int8Array(MAXP), sp: new Float32Array(MAXP), side: new Int8Array(MAXP), kind: new Uint8Array(MAXP), hue: new Float32Array(MAXP), lum: new Float32Array(MAXP), n: 0 };
  let poolReady = false, pool = [], poolW = [], poolTot = 0, pedPool = [], pedSet = new Set(), poolAcc = 9, lastN = -1;
  const SPEED = { street: 9, avenue: 12, boulevard: 14, oneway: 10, highway: 27, ramp: 13 };
  function refreshPool() {
    const R = clamp(rig.dist * 1.25, 380, 3200), tx = rig.target.x, tz = rig.target.z; const pedR = clamp(rig.dist * 2.4, 170, 520); // people gather where the camera is looking
    pool = []; poolW = []; poolTot = 0; pedPool = [];
    for (const id of roads.near(tx - R, tz - R, tx + R, tz + R)) {
      const s = roads.segs.get(id); if (!s || s.len < 12) continue; const b = s.bbox, mx = (b[0] + b[2]) / 2, mz = (b[1] + b[3]) / 2;
      const act = sample(grid.act, mx, mz), TR = game.traffic;
      // expected cars on this segment: cars per hour each way / speed. Without the model, a guess from nearby activity.
      const w = TR && TR.ready ? s.len * ((TR.volOf(id, 1) / (SPEED[s.type] * Math.max(0.15, TR.speedOf(id, 1))) + TR.volOf(id, -1) / (SPEED[s.type] * Math.max(0.15, TR.speedOf(id, -1)))) / 3600) + 0.002 * s.len * Math.min(1, act / 400)
        : s.len * (0.05 + Math.min(1.6, act / 420)) * (s.type === 'highway' ? 2.2 : s.type === 'boulevard' ? 1.5 : s.type === 'avenue' ? 1.2 : 1);
      pool.push(id); poolW.push(w); poolTot += w; if (ROAD_TYPES[s.type].access && act > 25 && Math.hypot(mx - tx, mz - tz) < pedR) pedPool.push(id);
    }
    pedSet = new Set(pedPool); poolReady = !!(game.traffic && game.traffic.ready);
  }
  function pickSeg() { let r = Math.random() * poolTot; for (let k = 0; k < pool.length; k++) { r -= poolW[k]; if (r <= 0) return pool[k]; } return pool[pool.length - 1]; }
  function spawnCar(i) {
    const id = pickSeg(), s = roads.segs.get(id); if (!s) return false;
    C.seg[i] = id; C.s[i] = Math.random() * s.len; C.wait[i] = 0; const TR = game.traffic, vf = TR && TR.ready ? TR.volOf(id, 1) : 1, vb = TR && TR.ready ? TR.volOf(id, -1) : 1; C.dir[i] = s.type === 'oneway' || Math.random() * (vf + vb + 1e-6) < vf + 1e-7 ? 1 : -1; C.sp[i] = 0.8 + Math.random() * 0.4; C.lane[i] = Math.random();
    const y = yearOf(), robo = y >= 2020 && Math.random() < clamp(0.04 + city.heat * 0.3, 0, 0.4) + (y >= 2040 ? 0.3 : 0);
    const u = Math.random(); C.kind[i] = robo ? 4 : u < 0.5 ? 0 : u < 0.8 ? 1 : u < 0.9 ? 2 : 3; C.col[i] = Math.floor(Math.random() * CAR_COLS.length); return true;
  }
  const ptAt = (s, d, out) => { const p = s.pts, c = s.cum, n = c.length; let k = 0; while (k < n - 2 && c[k + 1] < d) k++; const l = c[k + 1] - c[k] || 1, t = (d - c[k]) / l, dx = (p[k * 2 + 2] - p[k * 2]) / l, dz = (p[k * 2 + 3] - p[k * 2 + 1]) / l; out[0] = p[k * 2] + dx * l * t; out[1] = p[k * 2 + 1] + dz * l * t; out[2] = dx; out[3] = dz; };
  const o4 = [0, 0, 0, 0];
  function nextSeg(seg, atEnd) {
    const p = seg.pts, e = atEnd ? p.length - 2 : 0, n = roads.nodes.get(nkey(p[e], p[e + 1])); if (!n || n.segs.size < 2) return null;
    // turn onto the next road in proportion to how many cars the traffic model sends that way
    const TR = game.traffic, ready = TR && TR.ready, opts = []; let W = 0;
    for (const id of n.segs) {
      if (id === seg.id) continue; const s = roads.segs.get(id); if (!s) continue;
      const startHere = Math.abs(s.pts[0] - p[e]) < 0.2 && Math.abs(s.pts[1] - p[e + 1]) < 0.2; if (s.type === 'oneway' && !startHere) continue;
      const w = ready ? TR.volOf(id, startHere ? 1 : -1) + 4 : 1; opts.push([id, startHere ? 1 : -1, s, w]); W += w;
    }
    if (!opts.length) return null;
    let r = Math.random() * W; for (const o of opts) { r -= o[3]; if (r <= 0) return o; } return opts[opts.length - 1];
  }
  let vclock = 0;
  const dbg = new Float32Array(12); // where the first few cars are, for tests
  function stepCars(dt, night, vclock) {
    const hour = sim.time, rush = 0.35 + 0.65 * Math.max(smoothstep(6, 8.5, hour) * (1 - smoothstep(9.5, 11, hour)), smoothstep(15.5, 17.5, hour) * (1 - smoothstep(19, 21, hour)), 0.55 * smoothstep(9, 11, hour) * (1 - smoothstep(20, 23.5, hour)));
    const yr = yearOf(), era = yr < 1912 ? 0.05 : yr < 1930 ? 0.3 : yr < 1950 ? 0.6 : 1; // few motor cars before the twenties
    const TR = game.traffic, ready = !!(TR && TR.ready && poolReady), simT = city.cfg.traffic === 'sim';
    // with the traffic model running, the number of cars follows the modelled volumes (cars per hour / speed = cars per metre);
    // the model counts peak-hour trips between neighborhoods; short local trips are added as background
    const want = pool.length ? Math.min(Q.cars, Math.round(ready ? poolTot * era * 2 : (poolTot / 46) * rush * era * (simT ? 1.25 : 1))) : 0;
    while (C.n < want) { if (!spawnCar(C.n)) break; C.n++; } if (C.n > want) C.n = Math.max(want, C.n - 4);
    const R2 = Math.pow(clamp(rig.dist * 1.25, 380, 3200) * 1.25, 2), tx = rig.target.x, tz = rig.target.z, neon = city.cfg.night === 'neon', cn = [0, 0, 0, 0, 0]; let nl = 0;
    const queues = new Map(), ND = ready ? TR.nodes : null;
    // 1. move, holding cars that face a red light or a stop sign
    for (let i = 0; i < C.n; i++) {
      let s = roads.segs.get(C.seg[i]); if (!s) { spawnCar(i); s = roads.segs.get(C.seg[i]); if (!s) continue; }
      let v = SPEED[s.type] * C.sp[i];
      if (ready) v *= TR.speedOf(s.id, C.dir[i]); else if (simT) { ptAt(s, C.s[i], o4); v *= 1 - 0.8 * Math.min(1, sample(grid.traffic, o4[0], o4[1])); }
      const ds = v * dt, d = C.dir[i], rem = d > 0 ? s.len - C.s[i] : C.s[i];
      if (ready && rem < 150) {
        const p = s.pts, e = d > 0 ? p.length - 2 : 0, n = TR.nodeIndex(nkey(p[e], p[e + 1])), ctrl = n >= 0 ? ND.nCtrl[n] : null;
        if (ctrl === 'signal' || ctrl === 'stop') {
          const line = ND.nHalf[n] + 2.5;
          if (rem > line - 0.5) {
            ptAt(s, d > 0 ? s.len : 0, o4); const dx = o4[2] * d, dz = o4[3] * d;
            let stop;
            if (ctrl === 'signal') { const st = TR.light(n, dx, dz, vclock); stop = st === 'r' || (st === 'y' && rem > line + 12); }
            else stop = C.wait[i] < 1.4;
            if (stop) {
              const lanes = s.type === 'oneway' ? 2 : Math.max(1, Math.round(ROAD_TYPES[s.type].half / 3.6)), key = s.id * 16 + (d > 0 ? 0 : 8) + Math.min(7, Math.floor(C.lane[i] * lanes));
              let q = queues.get(key); if (!q) queues.set(key, (q = [])); q.push([i, rem, line, ds, ctrl === 'stop']); continue;
            }
          }
        }
      }
      C.s[i] += d * ds;
      if (C.s[i] > s.len || C.s[i] < 0) { const nx = nextSeg(s, C.s[i] > s.len); C.wait[i] = 0; if (nx) { C.seg[i] = nx[0]; C.dir[i] = nx[1]; C.s[i] = nx[1] > 0 ? 0 : nx[2].len; } else if (s.type === 'oneway') { spawnCar(i); continue; } else { C.dir[i] = -C.dir[i]; C.s[i] = clamp(C.s[i], 0, s.len); } }
    }
    // 2. queues: the first car stops at the line, the rest line up behind it
    for (const q of queues.values()) {
      q.sort((a, b) => a[1] - b[1]);
      for (let k = 0; k < q.length; k++) {
        const [i, rem, line, ds, isStop] = q[k], lim = line + k * 7.4, s = roads.segs.get(C.seg[i]);
        const nr = rem <= lim ? rem : Math.max(lim, rem - ds);
        if (isStop && k === 0 && nr <= lim + 0.3) C.wait[i] += dt;
        C.s[i] = C.dir[i] > 0 ? s.len - nr : nr;
      }
    }
    // 3. draw
    for (let i = 0; i < C.n; i++) {
      const s = roads.segs.get(C.seg[i]); if (!s) continue;
      ptAt(s, C.s[i], o4);
      const d = C.dir[i], dx = o4[2] * d, dz = o4[3] * d, T2 = ROAD_TYPES[s.type], lanes = Math.max(1, Math.round(T2.half / 3.6));
      const off = s.type === 'oneway' ? (C.lane[i] - 0.5) * T2.half * 1.2 : (Math.floor(C.lane[i] * lanes) + 0.5) * (T2.half / lanes) * (s.type === 'boulevard' ? 0.82 : 0.92) + (s.type === 'boulevard' ? 1.6 : 0);
      const x = o4[0] - dz * off, z = o4[1] + dx * off;
      if ((x - tx) * (x - tx) + (z - tz) * (z - tz) > R2) { spawnCar(i); continue; }
      const y = roadY(x, z) + 0.1; if (i < 6) { dbg[i * 2] = x; dbg[i * 2 + 1] = z; }
      const kd = C.kind[i], mesh = CARS[kd], q = cn[kd]; if (q >= mesh.instanceMatrix.count) continue; cn[kd]++;
      put(mesh, q, x, y, z, 1, 1, 1, dx, dz); mesh.setColorAt(q, kd === 4 ? col.set(0xeceae4) : CAR_COLS[C.col[i]]);
      if (night > 0.25) { // headlamps and tail lamps; the stylized night stretches them into streaks
        const hl = HALF[kd], st = neon ? 2.6 : 0.3;
        put(carLights, nl, x + dx * (hl + st * 0.5), y + 0.62, z + dz * (hl + st * 0.5), 1.6, 0.2, st, dx, dz); carLights.setColorAt(nl++, col.setRGB(2.2, 1.95, 1.4));
        put(carLights, nl, x - dx * (hl + st * 0.4), y + 0.7, z - dz * (hl + st * 0.4), 1.6, 0.18, st * 0.8, dx, dz); carLights.setColorAt(nl++, col.setRGB(1.9, 0.14, 0.08));
      }
    }
    for (let k = 0; k < 5; k++) { const m = CARS[k]; m.count = cn[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } lastN = C.n;
    carLights.count = nl; carLights.instanceMatrix.needsUpdate = true; if (carLights.instanceColor) carLights.instanceColor.needsUpdate = true;
  }
  function spawnPed(i) {
    const id = pedPool[Math.floor(Math.random() * pedPool.length)], s = roads.segs.get(id); if (!s) return false;
    P.seg[i] = id; P.s[i] = Math.random() * s.len; P.dir[i] = Math.random() < 0.5 ? 1 : -1; P.side[i] = Math.random() < 0.5 ? 1 : -1;
    const scoot = yearOf() >= 2017 && Math.random() < clamp(0.04 + city.heat * 0.2, 0, 0.3); P.kind[i] = scoot ? 1 : 0; P.sp[i] = scoot ? 4.5 + Math.random() * 2 : 1.1 + Math.random() * 0.6;
    P.hue[i] = Math.random(); P.lum[i] = 0.3 + Math.random() * 0.45; return true;
  }
  function stepPeds(dt, night) {
    const show = rig.dist < 620 && Q.peds > 0 && pedPool.length > 0, want = show ? Math.round(Math.min(Q.peds, pedPool.length * 18) * (1 - night * 0.6) * (1 - city.wx.rain * 0.6)) : 0;
    while (P.n < want) { if (!spawnPed(P.n)) break; P.n++; } if (P.n > want) P.n = want; let np = 0, ns = 0;
    for (let i = 0; i < P.n; i++) {
      const s = roads.segs.get(P.seg[i]); if (!s || !pedSet.has(P.seg[i])) { spawnPed(i); continue; }
      P.s[i] += P.dir[i] * P.sp[i] * dt; if (P.s[i] > s.len || P.s[i] < 0) { if (Math.random() < 0.5) { spawnPed(i); continue; } P.dir[i] = -P.dir[i]; P.s[i] = clamp(P.s[i], 0, s.len); }
      ptAt(s, P.s[i], o4); const T = ROAD_TYPES[s.type], off = (P.kind[i] ? T.half - 0.7 : T.half + T.walk * 0.55) * P.side[i], x = o4[0] - o4[3] * off, z = o4[1] + o4[2] * off, y = roadY(x, z) + (P.kind[i] ? 0 : 0.12);
      const hgt = 0.92 + ((i * 37) % 17) * 0.011, sc = P.kind[i] === 1, mesh = sc ? scoots : peds, q = sc ? ns : np; if (sc && ns >= 300) continue;
      put(mesh, q, x, y, z, hgt, hgt, hgt, o4[2] * P.dir[i], o4[3] * P.dir[i]); mesh.setColorAt(q, col.setHSL(P.hue[i], 0.32, P.lum[i])); if (sc) ns++; else np++;
    }
    walkU.value = game.clock;
    peds.count = np; peds.instanceMatrix.needsUpdate = true; if (peds.instanceColor) peds.instanceColor.needsUpdate = true;
    scoots.count = ns; scoots.instanceMatrix.needsUpdate = true; if (scoots.instanceColor) scoots.instanceColor.needsUpdate = true;
  }

  // ---- transit ------------------------------------------------------------------------------------
  const lineGroup = new THREE.Group(); lineGroup.visible = false; scene.add(lineGroup);
  const stopMesh = inst(unit, lambert(), 1200, true), stopSign = inst(unit, glowMat(), 600), tvGlow = inst(unit, glowMat(), 320);
  const tvMat = M.tintMaterial(), TV = { bus: inst(M.bus(), tvMat, 70, true), cable: inst(M.cableCar(), tvMat, 40, true), metro: inst(M.tram(), tvMat, 40, true), ferry: inst(M.ferry(), tvMat, 20, true) }, TVGLOW = { bus: [1.5, 0.75], cable: [1.5, 0.55], metro: [1.55, 0.95], ferry: [2.95, 0.9] };
  let vehicles = [];
  function route(ax, az, bx, bz) { // shortest path along roads between two points near roads; null when there is none
    const A = roads.nearestSeg(ax, az, 70), B = roads.nearestSeg(bx, bz, 70); if (!A || !B) return null;
    const part = (seg, s0, s1) => { const out = [], p = seg.pts, c = seg.cum, lo = Math.min(s0, s1), hi = Math.max(s0, s1); const a = []; ptAt(seg, lo, o4); a.push(o4[0], o4[1]); for (let k = 1; k < c.length - 1; k++) if (c[k] > lo + 0.5 && c[k] < hi - 0.5) a.push(p[k * 2], p[k * 2 + 1]); ptAt(seg, hi, o4); a.push(o4[0], o4[1]); if (s0 > s1) for (let k = a.length - 2; k >= 0; k -= 2) out.push(a[k], a[k + 1]); else out.push(...a); return out; };
    if (A.seg.id === B.seg.id) return part(A.seg, A.s, B.s);
    const dist = new Map(), prev = new Map(), heap = [], endKey = (seg, e) => nkey(seg.pts[e ? seg.pts.length - 2 : 0], seg.pts[e ? seg.pts.length - 1 : 1]);
    const push = (k, d, from) => { if (d >= (dist.get(k) ?? Infinity)) return; dist.set(k, d); prev.set(k, from); heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = i * 2 + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
    push(endKey(A.seg, 0), A.s, null); push(endKey(A.seg, 1), A.seg.len - A.s, null);
    const g0 = endKey(B.seg, 0), g1 = endKey(B.seg, 1), limit = Math.hypot(bx - ax, bz - az) * 5 + 1500; let best = Infinity, bestKey = null, guard = 0;
    while (heap.length && guard++ < 60000) {
      const [d, k] = pop(); if (d > dist.get(k)) continue; if (d > limit || d > best) break;
      if (k === g0 && d + B.s < best) { best = d + B.s; bestKey = k; } if (k === g1 && d + B.seg.len - B.s < best) { best = d + B.seg.len - B.s; bestKey = k; }
      const n = roads.nodes.get(k); if (!n) continue;
      for (const id of n.segs) { const s = roads.segs.get(id); if (!s || s.type === 'highway') continue; const k0 = endKey(s, 0), other = k0 === k ? endKey(s, 1) : k0; push(other, d + s.len, [k, id]); }
    }
    if (!bestKey) return null;
    const chain = []; let k = bestKey; while (prev.get(k)) { const [pk, id] = prev.get(k); chain.push([id, pk]); k = pk; } chain.reverse();
    const out = part(A.seg, A.s, k === endKey(A.seg, 0) ? 0 : A.seg.len);
    for (const [id, from] of chain) { const s = roads.segs.get(id), fwd = endKey(s, 0) === from, p = s.pts; if (fwd) for (let q = 2; q < p.length; q += 2) out.push(p[q], p[q + 1]); else for (let q = p.length - 4; q >= 0; q -= 2) out.push(p[q], p[q + 1]); }
    out.push(...part(B.seg, bestKey === g0 ? 0 : B.seg.len, B.s).slice(2)); return out;
  }
  // Ferries keep to the water: the shortest course between two landings that does not cross land.
  const WG = 80, WW = Math.ceil((MAP.maxX - MAP.minX) / WG), WH = Math.ceil((MAP.maxZ - MAP.minZ) / WG);
  function waterGrid() { const wet = new Uint8Array(WW * WH); for (let j = 0; j < WH; j++) for (let i = 0; i < WW; i++) wet[j * WW + i] = coastDist(MAP.minX + (i + 0.5) * WG, MAP.minZ + (j + 0.5) * WG) < -24 ? 1 : 0; return wet; }
  function waterRoute(x0, z0, x1, z1, wet) {
    const cx = (c) => MAP.minX + ((c % WW) + 0.5) * WG, cz = (c) => MAP.minZ + (Math.floor(c / WW) + 0.5) * WG;
    const entry = (x, z) => { const i0 = Math.floor((x - MAP.minX) / WG), j0 = Math.floor((z - MAP.minZ) / WG); let best = -1, bd = 1e9; for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) { const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= WW || j >= WH || !wet[j * WW + i]) continue; const d = Math.hypot(MAP.minX + (i + 0.5) * WG - x, MAP.minZ + (j + 0.5) * WG - z); if (d < bd) { bd = d; best = j * WW + i; } } return best; };
    const a = entry(x0, z0), b = entry(x1, z1); if (a < 0 || b < 0) return null;
    const open = (ax, az, bx, bz) => { const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 30); for (let k = 1; k < n; k++) if (coastDist(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n) > -10) return false; return true; };
    let cells = [a];
    if (a !== b && !open(cx(a), cz(a), cx(b), cz(b))) {
      const g = new Float32Array(WW * WH).fill(1e9), from = new Int32Array(WW * WH).fill(-1), hf = [], hc = [], bi = b % WW, bj = Math.floor(b / WW);
      const push = (f, c) => { let k = hf.length; hf.push(f); hc.push(c); while (k > 0) { const q = (k - 1) >> 1; if (hf[q] <= f) break; hf[k] = hf[q]; hc[k] = hc[q]; k = q; } hf[k] = f; hc[k] = c; };
      const pop = () => { const c = hc[0], f = hf.pop(), cc = hc.pop(), n = hf.length; if (n) { let k = 0; for (;;) { let q = k * 2 + 1; if (q >= n) break; if (q + 1 < n && hf[q + 1] < hf[q]) q++; if (hf[q] >= f) break; hf[k] = hf[q]; hc[k] = hc[q]; k = q; } hf[k] = f; hc[k] = cc; } return c; };
      g[a] = 0; push(0, a); let found = false;
      while (hf.length) {
        const c = pop(); if (c === b) { found = true; break; }
        const i = c % WW, j = Math.floor(c / WW);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= WW || nj >= WH) continue;
          const o = nj * WW + ni; if (!wet[o] || (di && dj && (!wet[j * WW + ni] || !wet[nj * WW + i]))) continue;
          const ng2 = g[c] + (di && dj ? 1.4142 : 1); if (ng2 < g[o]) { g[o] = ng2; from[o] = c; push(ng2 + Math.hypot(ni - bi, nj - bj), o); }
        }
      }
      if (!found) return null;
      cells = []; for (let c = b; c >= 0; c = from[c]) cells.push(c); cells.reverse();
    } else if (a !== b) cells.push(b);
    // keep only the corners that are needed, then round them off
    const pts = cells.map((c) => [cx(c), cz(c)]), keep = [pts[0]];
    for (let k = 0; k < pts.length - 1;) { let q = pts.length - 1; while (q > k + 1 && !open(pts[k][0], pts[k][1], pts[q][0], pts[q][1])) q--; keep.push(pts[q]); k = q; }
    let line = [[x0, z0], ...keep, [x1, z1]];
    for (let pass = 0; pass < 2; pass++) { const out = [line[0]]; for (let k = 1; k < line.length - 1; k++) { const p = line[k - 1], c = line[k], n = line[k + 1]; out.push([c[0] + (p[0] - c[0]) * 0.25, c[1] + (p[1] - c[1]) * 0.25], [c[0] + (n[0] - c[0]) * 0.25, c[1] + (n[1] - c[1]) * 0.25]); } out.push(line[line.length - 1]); line = out; }
    return line.flat();
  }
  function rebuildTransit() {
    for (const m of [...lineGroup.children]) { m.geometry.dispose(); m.material.dispose(); lineGroup.remove(m); }
    vehicles = []; let ns = 0, ng = 0, wet = null;
    for (const l of city.lines) {
      const T = LINE_TYPES[l.type], st = l.stops; let path = [];
      for (let k = 0; k + 3 < st.length; k += 2) {
        let leg = l.type === 'ferry' ? waterRoute(st[k], st[k + 1], st[k + 2], st[k + 3], wet || (wet = waterGrid())) : route(st[k], st[k + 1], st[k + 2], st[k + 3]); if (!leg || leg.length < 4) leg = [st[k], st[k + 1], st[k + 2], st[k + 3]];
        if (path.length) leg = leg.slice(2); path.push(...leg);
      }
      const clean = []; for (let k = 0; k < path.length; k += 2) if (!clean.length || Math.hypot(path[k] - clean[clean.length - 2], path[k + 1] - clean[clean.length - 1]) > 0.5) clean.push(path[k], path[k + 1]);
      l.path = clean; if (clean.length < 4) continue;
      const cum = cumLen(clean), len = cum[cum.length - 1];
      const mat = new THREE.MeshBasicMaterial({ color: l.color || T.color, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
      const mesh = new THREE.Mesh(previewGeometry(clean, l.type === 'ferry' ? 5 : 2.2), mat); mesh.renderOrder = 4; mesh.frustumCulled = false; lineGroup.add(mesh);
      const rec = { pts: clean, cum, len }, n = clamp(Math.round(len / T.every), 1, 6);
      for (let k = 0; k < n; k++) vehicles.push({ l, T, rec, s: (len * (k + 0.5)) / n, dir: k % 2 ? -1 : 1, wait: 0, stopsAt: [] });
      for (let k = 0; k < st.length; k += 2) {
        const x = st[k], z = st[k + 1], water = l.type === 'ferry', y = water ? Math.max(heightAt(x, z), 0.4) : roadY(x, z);
        if (ns < 1198) { put(stopMesh, ns, x, y, z, water ? 9 : 3.4, water ? 1.2 : 0.3, water ? 16 : 1.6); stopMesh.setColorAt(ns++, col.set(water ? 0x7a6450 : 0x8a8f92)); put(stopMesh, ns, x, y, z, 0.22, l.type === 'metro' ? 5.2 : 3.6, 0.22); stopMesh.setColorAt(ns++, col.set(0x3a3d40)); }
        if (ng < 600) { put(stopSign, ng, x, y + (l.type === 'metro' ? 5.2 : 3.6), z, 1.5, 1.1, 0.3); stopSign.setColorAt(ng++, col.set(l.color || T.color)); }
      }
    }
    stopMesh.count = ns; stopSign.count = ng; stopMesh.instanceMatrix.needsUpdate = true; stopSign.instanceMatrix.needsUpdate = true;
    if (stopMesh.instanceColor) stopMesh.instanceColor.needsUpdate = true; if (stopSign.instanceColor) stopSign.instanceColor.needsUpdate = true;
  }
  const recAt = (rec, d, out) => { const p = rec.pts, c = rec.cum, n = c.length; d = clamp(d, 0, rec.len); let k = 0; while (k < n - 2 && c[k + 1] < d) k++; const l = c[k + 1] - c[k] || 1, t = (d - c[k]) / l; out[2] = (p[k * 2 + 2] - p[k * 2]) / l; out[3] = (p[k * 2 + 3] - p[k * 2 + 1]) / l; out[0] = p[k * 2] + out[2] * l * t; out[1] = p[k * 2 + 1] + out[3] * l * t; };
  function stepTransit(dt, night) {
    const cnt = { bus: 0, cable: 0, metro: 0, ferry: 0 }; let g = 0;
    for (const v of vehicles) {
      if (v.wait > 0) v.wait -= dt; else { v.s += v.dir * v.T.speed * dt; if (v.s >= v.rec.len) { v.s = v.rec.len; v.dir = -1; v.wait = 3; } else if (v.s <= 0) { v.s = 0; v.dir = 1; v.wait = 3; } else if (Math.random() < dt * 0.02) v.wait = 2; }
      recAt(v.rec, v.s, o4); const [sx, , sz] = v.T.size, type = v.l.type, ferry = type === 'ferry', off = ferry ? 0 : 2.4 * v.dir, x = o4[0] - o4[3] * off, z = o4[1] + o4[2] * off, y = ferry ? -0.75 : roadY(x, z) + 0.12;
      const mesh = TV[type] || TV.bus, n = cnt[type] || 0; if (n >= mesh.instanceMatrix.count) continue; cnt[type] = n + 1;
      put(mesh, n, x, y, z, 1, 1, 1, o4[2] * v.dir, o4[3] * v.dir); mesh.setColorAt(n, col.set(v.l.color || v.T.color));
      if (night > 0.25 && g < 318) { const gl = TVGLOW[type] || TVGLOW.bus; put(tvGlow, g, x, y + gl[0], z, sx * (ferry ? 0.9 : 0.99), gl[1], sz * (ferry ? 0.6 : 0.84), o4[2], o4[3]); tvGlow.setColorAt(g++, col.setRGB(1.5, 1.25, 0.8)); }
    }
    for (const k in TV) { const m = TV[k]; m.count = cnt[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    tvGlow.count = g; tvGlow.instanceMatrix.needsUpdate = true; if (tvGlow.instanceColor) tvGlow.instanceColor.needsUpdate = true;
  }

  // ---- weather --------------------------------------------------------------------------------------
  const fogU = { uTime: { value: 0 }, uAmt: { value: 0 }, uCol: { value: new THREE.Color(1, 1, 1) }, uWest: { value: MAP.minX }, uSpan: { value: MAP.maxX - MAP.minX } };
  const fogMat = new THREE.ShaderMaterial({
    uniforms: fogU, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; uniform float uTime, uAmt, uWest, uSpan; uniform vec3 uCol;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ return 0.5 * n(p) + 0.27 * n(p * 2.1 + 7.0) + 0.15 * n(p * 4.3 - 3.0) + 0.08 * n(p * 8.7); }
      void main(){
        vec2 p = vW.xz * 0.00042 + vec2(-uTime * 0.012, uTime * 0.004) + vW.y * 0.002;
        float west = 1.0 - (vW.x - uWest) / uSpan;                 // the bank comes in from the ocean
        float cover = uAmt * 1.25 - (1.0 - west) * (1.0 - uAmt) * 1.1;
        float a = smoothstep(0.62 - cover * 0.42, 1.02 - cover * 0.3, fbm(p) + cover * 0.16);
        float edge = smoothstep(0.0, 4000.0, 30000.0 - length(vW.xz - cameraPosition.xz));
        edge *= smoothstep(160.0, 1500.0, length(vW - cameraPosition));       // thin out next to the camera so close views stay readable
        gl_FragColor = vec4(uCol * (0.9 + 0.2 * fbm(p * 3.0 + 4.0)), a * 0.25 * edge * smoothstep(0.0, 0.08, uAmt));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const fogLayers = [70, 115, 160, 205].map((y, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), fogMat); m.rotation.x = -Math.PI / 2; m.position.y = y * Math.max(K, 0.6) + k; m.renderOrder = 20 + k; m.visible = false; scene.add(m); return m; });
  const RN = 3600, rainGeo = new THREE.BufferGeometry(), rp = new Float32Array(RN * 6), rs = new Float32Array(RN * 2);
  for (let i = 0; i < RN; i++) { const x = Math.random(), y = Math.random(), z = Math.random(); rp.set([x, y, z, x, y, z], i * 6); rs[i * 2] = 0; rs[i * 2 + 1] = 1; }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3)); rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(rs, 1));
  const rainU = { uTime: { value: 0 }, uAmt: { value: 0 }, uSize: { value: 300 }, uCam: { value: new THREE.Vector3() }, uCol: { value: new THREE.Color(0.8, 0.85, 0.9) } };
  const rain = new THREE.LineSegments(rainGeo, new THREE.ShaderMaterial({
    uniforms: rainU, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute float aEnd; uniform float uTime, uSize; uniform vec3 uCam; varying float vA;
      void main(){ vec3 p = position; float sp = 0.9 + fract(p.x * 17.0) * 0.5;
        p.y = fract(p.y - uTime * sp * (95.0 / uSize)); p.x = fract(p.x + p.y * 0.06);
        vec3 w = (p - 0.5) * uSize; w.y = (p.y - 0.35) * uSize; w += uCam;
        w.xz = uCam.xz + mod(w.xz - uCam.xz + uSize * 0.5, uSize) - uSize * 0.5;
        w.y += aEnd * uSize * 0.035; w.x += aEnd * uSize * 0.003;   // after the wrap, so both ends of a streak stay together
        vA = 1.0 - aEnd * 0.7; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
    fragmentShader: 'uniform float uAmt; uniform vec3 uCol; varying float vA; void main(){ gl_FragColor = vec4(uCol, 0.42 * uAmt * vA); }',
  }));
  rain.frustumCulled = false; rain.visible = false; rain.renderOrder = 30; scene.add(rain);
  let wxAcc = 30, sunsetDay = -1;
  function stepWeather(dt, simDt) {
    const w = city.wx, cfg = city.cfg; wxAcc += simDt;
    if (wxAcc > 36) {
      wxAcc = 0;
      if (cfg.wxAuto && !w.manual) {
        const s = seasonOf(), h = sim.time, karl = (s === 2 ? 0.5 : s === 1 || s === 3 ? 0.22 : 0.12) * (h < 10 || h > 16.5 ? 1.5 : 0.5), wet = s === 0 ? 0.3 : s === 1 || s === 3 ? 0.1 : 0.02;
        w.tFog = Math.random() < karl ? 0.45 + Math.random() * 0.55 : Math.random() < 0.5 ? 0 : w.tFog * 0.5;
        w.tRain = Math.random() < wet ? 0.4 + Math.random() * 0.6 : Math.random() < 0.6 ? 0 : w.tRain;
      }
    }
    const tf = cfg.fog ? w.tFog * cfg.fogAmt : 0, tr = cfg.rain ? w.tRain * cfg.rainAmt : 0, k = 1 - Math.exp(-dt * 0.25);
    w.fog += (tf - w.fog) * k; w.rain += (tr - w.rain) * k; if (tf === 0 && w.fog < 0.003) w.fog = 0; if (tr === 0 && w.rain < 0.003) w.rain = 0;
    if (sim.day !== sunsetDay) { sunsetDay = sim.day; game.sky.wx.sunset = cfg.sunsets ? 0.25 + hash2(sim.day, 77) * 0.75 : 0; }
    game.sky.wx.fog = w.fog; game.sky.wx.rain = w.rain;
    const on = w.fog > 0.01; for (const m of fogLayers) m.visible = on;
    if (on) { fogU.uAmt.value = w.fog; fogU.uTime.value = game.clock; fogU.uCol.value.copy(game.sky.hor).lerp(col.set(0xffffff), 0.35).multiplyScalar(0.55 + 0.45 * (1 - game.sky.night)); }
    rain.visible = w.rain > 0.02;
    if (rain.visible) { rainU.uAmt.value = w.rain; rainU.uTime.value = game.clock; rainU.uSize.value = clamp(rig.dist * 0.9, 120, 5000); rainU.uCam.value.copy(camera.position).lerp(rig.target, 0.5); rainGeo.setDrawRange(0, Math.min(RN, Q.rain) * 2); rainU.uCol.value.copy(game.sky.hor).lerp(col.set(0xffffff), 0.5); }
  }

  // ---- construction: cranes and scaffolds --------------------------------------------------------------
  const sites = []; const craneMesh = inst(unit, lambert(), 120, true);
  const scafU = { uTime: { value: 0 } };
  const scafMat = new THREE.ShaderMaterial({
    uniforms: scafU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; varying vec3 vN;
      void main(){ if (abs(vN.y) > 0.5) discard; float u = abs(vN.x) > 0.5 ? vW.z : vW.x;
        vec2 g = abs(fract(vec2(u, vW.y) / vec2(2.4, 2.0)) - 0.5); vec2 fw = fwidth(vec2(u, vW.y) / vec2(2.4, 2.0));
        float line = max(1.0 - smoothstep(0.0, fw.x * 1.5 + 0.03, 0.5 - g.x), 1.0 - smoothstep(0.0, fw.y * 1.5 + 0.03, 0.5 - g.y));
        vec3 c = mix(vec3(0.20, 0.33, 0.27), vec3(0.62, 0.60, 0.55), line); gl_FragColor = vec4(c, mix(0.34, 0.9, line));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const scaf = new THREE.InstancedMesh(unit, scafMat, 80); scaf.count = 0; scaf.frustumCulled = false; scaf.renderOrder = 6; scene.add(scaf);
  function onAdded(b) {
    if (!(b.birth > 0) || b.sp || b.height < 10 || sites.length >= 80) return;
    const [x, z] = bpos(b); sites.push({ id: b.id, x, z, w: b.w * CELL, d: b.d * CELL, h: b.height, y: b.baseY, t0: b.birth, dur: constructionTime(b.height), crane: b.height >= 26, a: hash2(b.id, 3) * 6.28 });
  }
  function stepSites() {
    let ns = 0, nc = 0; const now = game.clock;
    for (let k = sites.length - 1; k >= 0; k--) {
      const s = sites[k], t = (now - s.t0) / s.dur; if (t > 1.12 || !buildings.has(s.id)) { sites.splice(k, 1); continue; }
      let g = clamp(t, 0, 1); g = 1 - (1 - g) * (1 - g); const h = s.h * g + 2.2, fade = t > 1 ? 1 - (t - 1) / 0.12 : 1;
      if (ns < 80) put(scaf, ns++, s.x, s.y - 1, s.z, s.w - 0.6, (h + 1) * fade, s.d - 0.6);
      if (s.crane && nc < 117) {
        const mh = (h + 9) * fade, cx = s.x + s.w * 0.5 - 1.2, cz = s.z + s.d * 0.5 - 1.2, a = s.a + now * 0.12, dx = Math.sin(a), dz = Math.cos(a), jl = Math.max(s.w, s.d) * 0.6 + 12;
        put(craneMesh, nc, cx, s.y, cz, 1.5, mh, 1.5); craneMesh.setColorAt(nc++, col.set(0xb89a2c));
        put(craneMesh, nc, cx + dx * jl * 0.36, s.y + mh, cz + dz * jl * 0.36, 1.1, 1.1, jl, dx, dz); craneMesh.setColorAt(nc++, col.set(0xc2a531));
        put(craneMesh, nc, cx - dx * jl * 0.2, s.y + mh - 1.4, cz - dz * jl * 0.2, 2, 2.4, 3.4, dx, dz); craneMesh.setColorAt(nc++, col.set(0x6a6a66));
      }
    }
    scaf.count = ns; scaf.instanceMatrix.needsUpdate = true; craneMesh.count = nc; craneMesh.instanceMatrix.needsUpdate = true; if (craneMesh.instanceColor) craneMesh.instanceColor.needsUpdate = true;
  }

  // ---- particles ---------------------------------------------------------------------------------------
  const PN = 4000, pg = new THREE.BufferGeometry(), pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 4), pSize = new Float32Array(PN);
  const pv = new Float32Array(PN * 3), pl = new Float32Array(PN), pm = new Float32Array(PN), pk = new Uint8Array(PN); let pHead = 0;
  pg.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage)); pg.setAttribute('aCol', new THREE.BufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage)); pg.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(pg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } },
    vertexShader: 'attribute vec4 aCol; attribute float aSize; uniform float uScale; varying vec4 vC; void main(){ vC = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 90.0); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.2, length(d)); if (vC.a * a < 0.01) discard; gl_FragColor = vec4(vC.rgb, vC.a * a); }',
  }));
  points.frustumCulled = false; points.renderOrder = 25; scene.add(points);
  // kinds: 0 smoke, 1 fire, 2 confetti, 3 spark, 4 trail
  function emit(kind, x, y, z, vx, vy, vz, life, size, r, g, b) {
    const i = pHead; pHead = (pHead + 1) % Math.min(PN, Q.parts);
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z; pv[i * 3] = vx; pv[i * 3 + 1] = vy; pv[i * 3 + 2] = vz; pl[i] = life; pm[i] = life; pk[i] = kind; pSize[i] = size; pCol[i * 4] = r; pCol[i * 4 + 1] = g; pCol[i * 4 + 2] = b; pCol[i * 4 + 3] = 1;
  }
  function stepParticles(dt) {
    let live = 0;
    for (let i = 0; i < PN; i++) {
      if (pl[i] <= 0) { if (pCol[i * 4 + 3] !== 0) pCol[i * 4 + 3] = 0; continue; } live++;
      pl[i] -= dt; const k = pk[i], t = Math.max(0, pl[i] / pm[i]), o = i * 3;
      if (k === 0 || k === 4) { pv[o] += dt * 1.2; pv[o + 1] *= 1 - dt * 0.25; pSize[i] += dt * (k === 0 ? 5 : 2.2); pCol[i * 4 + 3] = t * (k === 0 ? 0.42 : 0.5); }
      else if (k === 1) { pSize[i] *= 1 - dt * 0.9; pCol[i * 4 + 1] = 0.25 + 0.5 * t; pCol[i * 4 + 3] = Math.min(1, t * 2); }
      else if (k === 2) { pv[o + 1] = Math.max(pv[o + 1] - dt * 5, -3.2); pv[o] += Math.sin(pl[i] * 9 + i) * dt * 5; pv[o + 2] += Math.cos(pl[i] * 7 + i) * dt * 5; pCol[i * 4 + 3] = Math.min(1, t * 4); }
      else { pv[o + 1] -= dt * 16; pv[o] *= 1 - dt * 0.7; pv[o + 2] *= 1 - dt * 0.7; pCol[i * 4 + 3] = t * t; }
      pPos[o] += pv[o] * dt; pPos[o + 1] += pv[o + 1] * dt; pPos[o + 2] += pv[o + 2] * dt;
    }
    points.visible = live > 0;
    if (live) { pg.attributes.position.needsUpdate = true; pg.attributes.aCol.needsUpdate = true; pg.attributes.aSize.needsUpdate = true; points.material.uniforms.uScale.value = game.renderer.domElement.height * 0.9; }
  }
  function firework(x, y, z) { const c = BRIGHT[Math.floor(Math.random() * BRIGHT.length)], n = 70, sp = 26 + Math.random() * 22; for (let k = 0; k < n; k++) { const a = Math.random() * 6.283, e = Math.acos(2 * Math.random() - 1), v = sp * (0.75 + Math.random() * 0.3); emit(3, x, y, z, Math.sin(e) * Math.cos(a) * v, Math.cos(e) * v + 8, Math.sin(e) * Math.sin(a) * v, 1.5 + Math.random() * 0.8, 5, c.r * 2.4, c.g * 2.4, c.b * 2.4); } if (game.audio) game.audio.boom(x, z); }
  function confetti(x, y, z, n, spread) { for (let k = 0; k < n; k++) { const c = BRIGHT[Math.floor(Math.random() * BRIGHT.length)]; emit(2, x + (Math.random() - 0.5) * spread, y + Math.random() * 14, z + (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 5, 4 + Math.random() * 7, (Math.random() - 0.5) * 5, 4 + Math.random() * 3, 1.6, c.r, c.g, c.b); } }
  function stepFires(dt) {
    for (const f of culture.fires) {
      const b = buildings.get(f.id); if (!b) continue; const [x, z] = bpos(b), w = b.w * CELL, d = b.d * CELL, top = b.baseY + b.height, n = Math.random() < dt * 26 ? 1 + Math.floor(Math.random() * 2) : 0;
      for (let k = 0; k < n; k++) { const px = x + (Math.random() - 0.5) * w * 0.8, pz = z + (Math.random() - 0.5) * d * 0.8, py = b.baseY + b.height * (0.35 + Math.random() * 0.65); emit(1, px, py, pz, (Math.random() - 0.5) * 2, 5 + Math.random() * 6, (Math.random() - 0.5) * 2, 0.7 + Math.random() * 0.6, 9 + Math.min(w, d) * 0.3, 2.2, 0.8, 0.15); }
      if (Math.random() < dt * 10) emit(0, x + (Math.random() - 0.5) * w * 0.5, top + 2, z + (Math.random() - 0.5) * d * 0.5, 2 + Math.random() * 2, 9 + Math.random() * 6, (Math.random() - 0.5) * 2, 5 + Math.random() * 4, 14 + Math.min(w, d) * 0.4, 0.13, 0.12, 0.12);
    }
  }

  // ---- events: staging, parades, jets, racing, air taxis -----------------------------------------------
  const props = inst(unit, lambert(), 900, true), lights = inst(unit, glowMat(), 400), crowd = inst(unit, lambert(), 2400);
  let circuit = null, circuitMesh = null, airN = 0; const air = [];
  function setCircuit(pts) {
    if (circuitMesh) { scene.remove(circuitMesh); circuitMesh.geometry.dispose(); circuitMesh = null; } circuit = null; if (!pts || pts.length < 8) return;
    const closed = pts.concat([pts[0], pts[1]]), cum = cumLen(closed); circuit = { pts: closed, cum, len: cum[cum.length - 1] };
    circuitMesh = new THREE.Mesh(previewGeometry(closed, 7), new THREE.MeshBasicMaterial({ color: 0x2a2c2f, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 }));
    const kerb = new THREE.Mesh(previewGeometry(closed, 8.2), new THREE.MeshBasicMaterial({ color: 0xb8433a, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    kerb.renderOrder = 2; circuitMesh.renderOrder = 3; circuitMesh.add(kerb); circuitMesh.frustumCulled = false; kerb.frustumCulled = false; scene.add(circuitMesh);
  }
  const gy = (x, z) => Math.max(heightAt(x, z), 0.3);
  function stepEvents(dt, night) {
    let np = 0, nl = 0, nc = 0; const abs = sim.day * 24 + sim.time, now = game.clock;
    const P2 = (x, y, z, sx, sy, sz, c, dx, dz) => { if (np < 898) { put(props, np, x, y, z, sx, sy, sz, dx, dz); props.setColorAt(np++, c); } };
    const L2 = (x, y, z, sx, sy, sz, c) => { if (nl < 398) { put(lights, nl, x, y, z, sx, sy, sz); lights.setColorAt(nl++, c); } };
    const CR = (x, z, seed) => { if (nc < 2398) { put(crowd, nc, x, gy(x, z), z, 0.5, 1.65, 0.4); crowd.setColorAt(nc++, col.setHSL(hash2(seed, nc), 0.3, 0.3 + hash2(nc, seed) * 0.4)); } };
    for (const e of culture.live) {
      if (!e.on) continue; const t = (abs - e.t0) / (e.t1 - e.t0), y = gy(e.x, e.z), sc = Math.max(K, 0.6);
      if (e.kind === 'stage' || e.kind === 'games' || e.kind === 'expo') {
        const big = e.kind === 'games' ? 0 : 1;
        if (big) {
          P2(e.x, y, e.z, 34 * sc, 2, 16 * sc, col.set(0x2c2c2e)); P2(e.x, y + 2, e.z - 6 * sc, 34 * sc, 15, 2.5, col.set(0x1e1e21)); P2(e.x - 15 * sc, y + 2, e.z, 2, 17, 2, col.set(0x4a4a4e)); P2(e.x + 15 * sc, y + 2, e.z, 2, 17, 2, col.set(0x4a4a4e)); P2(e.x, y + 18, e.z - 1, 36 * sc, 1.6, 14 * sc, col.set(0x3a3a3e));
          const pulse = 0.6 + 0.4 * Math.sin(now * 5.2); L2(e.x, y + 5, e.z - 4.6 * sc, 22 * sc, 9, 0.4, col.setHSL((now * 0.07) % 1, 0.75, 0.32 + 0.18 * pulse));
          for (let k = 0; k < 6; k++) L2(e.x - 13 * sc + k * 5.2 * sc, y + 17, e.z + 2, 1.1, 1.1, 1.1, col.setHSL((k * 0.17 + now * 0.2) % 1, 0.8, 0.5 * (0.5 + 0.5 * Math.sin(now * 6 + k * 2))));
          for (let k = 0; k < 16; k++) { const a = hash2(k, 5) * 6.28, r = (60 + hash2(k, 9) * 110) * sc, px = e.x + Math.cos(a) * r, pz = e.z + 40 * sc + Math.abs(Math.sin(a)) * r; P2(px, gy(px, pz), pz, 6, 3.4, 6, e.kind === 'expo' ? col.set(0x2f7fc0) : k % 3 ? col.set(0xe8e4da) : BRIGHT[k % BRIGHT.length]); }
        }
        const nCrowd = e.kind === 'expo' ? 300 : 900; for (let k = 0; k < nCrowd; k++) { const r = Math.pow(hash2(k, 21), 0.6) * 95 * sc, a = (hash2(k, 31) - 0.5) * 2.2; CR(e.x + Math.sin(a) * r, e.z + 12 * sc + Math.cos(a) * r, k); }
        if (night > 0.5 && (e.kind === 'games' || e.k === 'portola' || e.k === 'outsidelands') && Math.random() < dt * (e.kind === 'games' ? 1.6 : 0.5)) firework(e.x + (Math.random() - 0.5) * 300, y + 90 + Math.random() * 90, e.z + (Math.random() - 0.5) * 300);
      } else if (e.kind === 'fireworks') { if (Math.random() < dt * 2.2) firework(e.x + (Math.random() - 0.5) * 700 * sc, 110 + Math.random() * 120, e.z + (Math.random() - 0.5) * 500 * sc); }
      else if (e.kind === 'parade' || e.kind === 'run') {
        const dx = e.x2 - e.x, dz = e.z2 - e.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, run = e.kind === 'run', n = run ? 700 : 300, train = run ? L * 0.5 : Math.min(L * 0.7, 700 * sc);
        for (let k = 0; k < n; k++) { const d = clamp(t * (L + train) - hash2(k, 3) * train, 0, L), lat = (hash2(k, 8) - 0.5) * (run ? 12 : 9); if (d <= 0 || d >= L) continue; CR(e.x + ux * d - uz * lat, e.z + uz * d + ux * lat, k + 50); }
        if (!run) for (let k = 0; k < 9; k++) { const d = t * (L + train) - (k + 0.5) * (train / 9); if (d <= 0 || d >= L) continue; const px = e.x + ux * d, pz = e.z + uz * d, py = gy(px, pz); P2(px, py, pz, 4, 3.2, 9, BRIGHT[k % BRIGHT.length], ux, uz); P2(px, py + 3.2, pz, 2.4, 2.4 + (k % 3), 3, BRIGHT[(k + 3) % BRIGHT.length], ux, uz); if (e.confetti && Math.random() < dt * 5) confetti(px, py + 6, pz, 6, 16); }
        for (let k = 0; k < 260; k++) { const d = hash2(k, 41) * L, side = k % 2 ? 1 : -1, lat = side * (9 + hash2(k, 43) * 5); CR(e.x + ux * d - uz * lat, e.z + uz * d + ux * lat, k + 900); }
      } else if (e.kind === 'jets') {
        for (let k = 0; k < 5; k++) { const a = now * 0.32 + 0.0, R = 1500 * sc, row = [[0, 0], [-1, 1], [1, 1], [-2, 2], [2, 2]][k], cx = e.x + Math.cos(a) * R, cz = e.z - 500 * sc + Math.sin(a) * R * 0.55, hx = -Math.sin(a), hz = Math.cos(a) * 0.55, hl = Math.hypot(hx, hz), ux = hx / hl, uz = hz / hl;
          const px = cx - uz * row[0] * 26 - ux * row[1] * 30, pz = cz + ux * row[0] * 26 - uz * row[1] * 30, py = 260 + Math.sin(a * 2) * 60;
          P2(px, py, pz, 2.2, 2, 17, col.set(0x26324f), ux, uz); P2(px, py + 0.4, pz - 0, 11, 0.5, 5, col.set(0x2c3a5c), ux, uz); if (Math.random() < dt * 30) emit(4, px - ux * 9, py + 1, pz - uz * 9, 0, 0.5, 0, 4.5, 9, 0.92, 0.92, 0.95); }
        if (game.audio) game.audio.jet();
      } else if (e.kind === 'race' && circuit) {
        for (let k = 0; k < 14; k++) { const s = (now * (62 + (k % 5) * 1.3) + k * 38) % circuit.len; recAt(circuit, s, o4); const lat = ((k % 3) - 1) * 2.4, px = o4[0] - o4[3] * lat, pz = o4[1] + o4[2] * lat, py = roadY(px, pz) + 0.7; P2(px, py, pz, 1.8, 0.8, 5.2, BRIGHT[k % BRIGHT.length], o4[2], o4[3]); P2(px - o4[2] * 2.4, py + 0.7, pz - o4[3] * 2.4, 1.9, 0.5, 0.5, col.set(0x1a1a1c), o4[2], o4[3]); }
        recAt(circuit, 0, o4); P2(o4[0], roadY(o4[0], o4[1]) + 0.72, o4[1], 14, 0.1, 1.4, col.set(0xf2f2f2), o4[2], o4[3]);
        for (let k = 0; k < 500; k++) { const s = hash2(k, 61) * circuit.len; recAt(circuit, s, o4); const lat = (k % 2 ? 1 : -1) * (12 + hash2(k, 63) * 6); CR(o4[0] - o4[3] * lat, o4[1] + o4[2] * lat, k + 300); }
      } else if (e.kind === 'game') { if (e.confetti && Math.random() < dt * 4) confetti(e.x, y + 30, e.z, 10, 60); }
    }
    // air taxis of the future
    const want = yearOf() >= 2040 && stats.pop > 3000 ? Math.min(36, 8 + Math.floor(stats.pop / 6000)) : 0;
    while (air.length < want) air.push({ x: rig.target.x + (Math.random() - 0.5) * 3000, z: rig.target.z + (Math.random() - 0.5) * 3000, y: 140 + Math.random() * 160, a: Math.random() * 6.28, v: 28 + Math.random() * 18, turn: (Math.random() - 0.5) * 0.12 }); air.length = Math.min(air.length, want);
    for (const a of air) { a.a += a.turn * dt; a.x += Math.sin(a.a) * a.v * dt; a.z += Math.cos(a.a) * a.v * dt; if (Math.hypot(a.x - rig.target.x, a.z - rig.target.z) > 3200) { a.a += Math.PI * 0.9; a.x += Math.sin(a.a) * 60; a.z += Math.cos(a.a) * 60; }
      P2(a.x, a.y, a.z, 2.4, 1.3, 4.6, col.set(0xdad8d0), Math.sin(a.a), Math.cos(a.a)); P2(a.x, a.y + 1.3, a.z, 7.5, 0.18, 1.2, col.set(0x4a4d52), Math.sin(a.a), Math.cos(a.a)); if (night > 0.2) L2(a.x, a.y - 0.4, a.z, 0.9, 0.4, 0.9, (now * 2 + a.v) % 1 < 0.5 ? col.setRGB(1.6, 0.2, 0.2) : col.setRGB(0.3, 1.4, 0.4)); }
    airN = air.length;
    props.count = np; props.instanceMatrix.needsUpdate = true; if (props.instanceColor) props.instanceColor.needsUpdate = true;
    lights.count = nl; lights.instanceMatrix.needsUpdate = true; if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
    crowd.count = nc; crowd.instanceMatrix.needsUpdate = true; if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  }

  const api = {
    update(dt, simDt) {
      const night = game.sky.night; poolAcc += dt;
      if (poolAcc > 0.8) { poolAcc = 0; refreshPool(); }
      const mv = game.mode === 'play' ? dt * Math.min(game.speed, 2) : dt * 0.6;
      vclock += mv; stepCars(mv, night, vclock); if (game.traffic) { game.traffic.frame(dt, night, vclock); game.traffic.overlay(dt); } stepPeds(mv, night); stepTransit(mv, night); stepWeather(dt, simDt); stepSites(); stepFires(mv); stepEvents(mv, night); stepParticles(dt);
      lineGroup.visible = game.tools.state.tool === 'transit' || game.overlay === 'transit';
    },
    onAdded, setCircuit, rebuildTransit, firework, confetti, route,
    // a closed loop through the given corners that follows streets; null when a corner is not near a street or no loop exists
    snapLoop(corners, tol = 150) {
      const n = corners.length / 2, out = []; if (n < 3) return null;
      for (let k = 0; k < n; k++) { if (!roads.nearestSeg(corners[k * 2], corners[k * 2 + 1], tol)) return null; }
      for (let k = 0; k < n; k++) { const a = roads.nearestSeg(corners[k * 2], corners[k * 2 + 1], tol), q = (k + 1) % n, b = roads.nearestSeg(corners[q * 2], corners[q * 2 + 1], tol); ptAt(a.seg, a.s, o4); const ax = o4[0], az = o4[1]; ptAt(b.seg, b.s, o4); const r = route(ax, az, o4[0], o4[1]); if (!r || r.length < 4) return null; for (let i = 0; i < r.length - 2; i += 2) out.push(Math.round(r[i]), Math.round(r[i + 1])); }
      // drop out-and-back spurs (A B A becomes A) and repeated points
      for (let pass = 0; pass < 40; pass++) { let cut = false; for (let i = 0; i < out.length && out.length >= 8; i += 2) { const m = out.length, p = (i - 2 + m) % m, q = (i + 2) % m; if ((out[p] === out[q] && out[p + 1] === out[q + 1]) || (out[i] === out[q] && out[i + 1] === out[q + 1])) { if (out[i] === out[q] && out[i + 1] === out[q + 1]) out.splice(i, 2); else if (q > i) out.splice(i, 4); else { out.splice(i, 2); out.splice(0, 2); } cut = true; break; } } if (!cut) break; }
      return out.length >= 8 ? out : null;
    },
    setQuality(name) { qName = QUALITY[name] ? name : 'high'; Q = QUALITY[qName]; C.n = Math.min(C.n, Q.cars); P.n = Math.min(P.n, Q.peds); game.sky.sun.shadow.mapSize.set(Q.shadow, Q.shadow); if (game.sky.sun.shadow.map) { game.sky.sun.shadow.map.dispose(); game.sky.sun.shadow.map = null; } },
    quality: () => qName,
    reset() { C.n = 0; P.n = 0; sites.length = 0; pl.fill(0); air.length = 0; setCircuit(null); rebuildTransit(); },
    locate: () => ({ cars: Array.from(dbg), kinds: Array.from(C.kind.slice(0, 6)), transit: vehicles.map((v) => { recAt(v.rec, v.s, o4); return [v.l.type, Math.round(o4[0]), Math.round(o4[1])]; }) }),
    counts: () => ({ cars: C.n, peds: P.n, vehicles: vehicles.length, sites: sites.length, air: airN, props: props.count, crowd: crowd.count }),
  };
  return api;
}
void coastDist; void STOP_R;
