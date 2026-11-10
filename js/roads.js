// Road network: free-form polylines, automatic intersections, grid occupancy, bridges and meshes.
import * as THREE from 'three';
import { MAP, heightAt, coastDist } from './terrain.js';
import { CELL, GX, GZ, CH, CXN, CZN, road, bid, removeBuilding, state as W, toI, toJ } from './world.js';
import { MeshBuilder, tree, TREE_COLORS, buildingUniforms } from './buildings.js';
import { clamp, smoothstep, hash2 } from './util.js';

export const ROAD_TYPES = {
  street: { name: 'Street', half: 4.5, walk: 2.5, cells: 2, kind: 1, access: true, trees: true, hint: '2 lanes' },
  avenue: { name: 'Avenue', half: 8, walk: 3, cells: 3, kind: 2, access: true, trees: true, hint: '4 lanes' },
  boulevard: { name: 'Boulevard', half: 11.5, walk: 3.5, cells: 4, kind: 3, access: true, trees: true, hint: '6 lanes, planted median' },
  oneway: { name: 'One-way', half: 4, walk: 3, cells: 2, kind: 4, access: true, trees: true, hint: '2 lanes, one direction' },
  highway: { name: 'Highway', half: 13, walk: 1.5, cells: 4, kind: 5, access: false, hint: '6 lanes, no frontage' },
  ramp: { name: 'Ramp', half: 3, walk: 0.9, cells: 1, kind: 6, access: false, hint: '1 lane connector' },
};
const r1 = (v) => Math.round(v * 10) / 10;
const nkey = (x, z) => Math.round(x * 10) + '_' + Math.round(z * 10);

// Road surface elevation: on the ground, or a deck that climbs away from the shore over water.
export function roadY(x, z) {
  const g = heightAt(x, z), d = coastDist(x, z);
  const clear = d < 0 ? 6.5 * smoothstep(0, 70, -d) + 16 * smoothstep(120, 600, -d) : 0;
  return Math.max(g, 0.9) + 0.14 + clear;
}

// ---- polyline helpers (flat [x,z,...]) -----------------------------------------------------------
export function cumLen(p) { const n = p.length / 2, c = new Float64Array(n); for (let i = 1; i < n; i++) c[i] = c[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]); return c; }
function at(p, c, s) {
  const n = c.length; s = clamp(s, 0, c[n - 1]);
  let k = 0; while (k < n - 2 && c[k + 1] < s) k++;
  const l = c[k + 1] - c[k] || 1, t = (s - c[k]) / l;
  return [p[k * 2] + (p[k * 2 + 2] - p[k * 2]) * t, p[k * 2 + 1] + (p[k * 2 + 3] - p[k * 2 + 1]) * t, k];
}
function slice(p, c, s0, s1) {
  const out = [], a = at(p, c, s0), b = at(p, c, s1);
  out.push(a[0], a[1]);
  for (let i = 1; i < c.length - 1; i++) if (c[i] > s0 + 0.05 && c[i] < s1 - 0.05) out.push(p[i * 2], p[i * 2 + 1]);
  out.push(b[0], b[1]);
  return out;
}
export function nearestOn(p, c, x, z) {
  let best = { d: Infinity, s: 0, x: 0, z: 0, dx: 1, dz: 0 };
  for (let k = 0; k < c.length - 1; k++) {
    const ax = p[k * 2], az = p[k * 2 + 1], bx = p[k * 2 + 2], bz = p[k * 2 + 3], vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / l2, 0, 1), px = ax + vx * t, pz = az + vz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) { const l = Math.sqrt(l2); best = { d, s: c[k] + l * t, x: px, z: pz, dx: vx / l, dz: vz / l }; }
  }
  return best;
}

export class Roads {
  constructor() {
    this.segs = new Map(); this.nodes = new Map(); this.nextId = 1;
    this.chunkSegs = Array.from({ length: CXN * CZN }, () => new Set());
    this.onDirty = () => {}; this.log = null; // log: array of {op, seg} while a user action is recorded
  }
  clear() { this.segs.clear(); this.nodes.clear(); this.nextId = 1; for (const s of this.chunkSegs) s.clear(); }
  chunksOf(seg, fn) {
    const b = seg.bbox, pad = 20;
    const c0 = clamp(Math.floor((b[0] - pad - MAP.minX) / (CELL * CH)), 0, CXN - 1), c1 = clamp(Math.floor((b[2] + pad - MAP.minX) / (CELL * CH)), 0, CXN - 1);
    const d0 = clamp(Math.floor((b[1] - pad - MAP.minZ) / (CELL * CH)), 0, CZN - 1), d1 = clamp(Math.floor((b[3] + pad - MAP.minZ) / (CELL * CH)), 0, CZN - 1);
    for (let d = d0; d <= d1; d++) for (let c = c0; c <= c1; c++) fn(c + d * CXN);
  }
  homeOf(x, z) { return clamp(Math.floor((x - MAP.minX) / (CELL * CH)), 0, CXN - 1) + clamp(Math.floor((z - MAP.minZ) / (CELL * CH)), 0, CZN - 1) * CXN; }
  near(x0, z0, x1, z1) {
    const out = new Set(), s = CELL * CH;
    const c0 = clamp(Math.floor((x0 - MAP.minX) / s), 0, CXN - 1), c1 = clamp(Math.floor((x1 - MAP.minX) / s), 0, CXN - 1);
    const d0 = clamp(Math.floor((z0 - MAP.minZ) / s), 0, CZN - 1), d1 = clamp(Math.floor((z1 - MAP.minZ) / s), 0, CZN - 1);
    for (let d = d0; d <= d1; d++) for (let c = c0; c <= c1; c++) for (const id of this.chunkSegs[c + d * CXN]) out.add(id);
    return out;
  }
  // ---- raw insert / remove (no intersection handling) -------------------------------------------
  addRaw(rec, raster = true) {
    const p = rec.pts, seg = { id: rec.id || this.nextId++, type: rec.type, pts: p.slice() };
    if (seg.id >= this.nextId) this.nextId = seg.id + 1;
    seg.cum = cumLen(p); seg.len = seg.cum[seg.cum.length - 1];
    const b = [1e9, 1e9, -1e9, -1e9];
    for (let i = 0; i < p.length; i += 2) { b[0] = Math.min(b[0], p[i]); b[1] = Math.min(b[1], p[i + 1]); b[2] = Math.max(b[2], p[i]); b[3] = Math.max(b[3], p[i + 1]); }
    seg.bbox = b; seg.home = this.homeOf(p[0], p[1]);
    this.segs.set(seg.id, seg);
    this.chunksOf(seg, (c) => this.chunkSegs[c].add(seg.id));
    for (const e of [0, p.length - 2]) {
      const k = nkey(p[e], p[e + 1]); let n = this.nodes.get(k);
      if (!n) this.nodes.set(k, (n = { x: p[e], z: p[e + 1], segs: new Set() }));
      for (const o of n.segs) this.onDirty(this.segs.get(o).home);
      n.segs.add(seg.id); this.onDirty(this.homeOf(n.x, n.z));
    }
    this.onDirty(seg.home);
    const rad = ROAD_TYPES[seg.type].half + ROAD_TYPES[seg.type].walk + 4;
    for (let s = 0; s <= seg.len; s += 12) { const a = at(p, seg.cum, s); W.hooks.clearTrees(a[0] - rad, a[1] - rad, a[0] + rad, a[1] + rad); }
    if (this.log) this.log.push({ op: 'add', seg: { id: seg.id, type: seg.type, pts: seg.pts.slice() } });
    if (raster) this.rasterSeg(seg);
    return seg;
  }
  removeRaw(id, raster = true) {
    const seg = this.segs.get(id); if (!seg) return;
    const p = seg.pts;
    this.segs.delete(id);
    this.chunksOf(seg, (c) => this.chunkSegs[c].delete(id));
    for (const e of [0, p.length - 2]) {
      const k = nkey(p[e], p[e + 1]), n = this.nodes.get(k); if (!n) continue;
      n.segs.delete(id); this.onDirty(this.homeOf(n.x, n.z));
      for (const o of n.segs) this.onDirty(this.segs.get(o).home);
      if (!n.segs.size) this.nodes.delete(k);
    }
    this.onDirty(seg.home);
    if (this.log) this.log.push({ op: 'rem', seg: { id, type: seg.type, pts: p.slice() } });
    if (raster) this.rasterSeg(seg);
  }
  rasterSeg(seg) {
    const pad = ROAD_TYPES[seg.type].cells * 4 + 12, b = seg.bbox;
    this.rasterRegion(toI(b[0] - pad), toJ(b[1] - pad), toI(b[2] + pad), toJ(b[3] + pad));
  }
  // Recompute road occupancy for a cell rectangle from every segment that touches it.
  rasterRegion(i0, j0, i1, j1) {
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(GX - 1, i1); j1 = Math.min(GZ - 1, j1);
    if (i1 < i0 || j1 < j0) return;
    for (let j = j0; j <= j1; j++) road.fill(0, j * GX + i0, j * GX + i1 + 1);
    const x0 = MAP.minX + i0 * CELL, z0 = MAP.minZ + j0 * CELL, x1 = MAP.minX + (i1 + 1) * CELL, z1 = MAP.minZ + (j1 + 1) * CELL;
    for (const id of this.near(x0 - 40, z0 - 40, x1 + 40, z1 + 40)) {
      const seg = this.segs.get(id), T = ROAD_TYPES[seg.type], p = seg.pts, bits = T.access ? 3 : 1;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3], vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
        const adx = Math.abs(vx), adz = Math.abs(vz), thr = T.cells * 4 + 0.5 + 4 * (Math.min(adx, adz) / (Math.max(adx, adz) || 1));
        const a0 = Math.max(i0, toI(Math.min(ax, bx) - thr)), a1 = Math.min(i1, toI(Math.max(ax, bx) + thr));
        const c0 = Math.max(j0, toJ(Math.min(az, bz) - thr)), c1 = Math.min(j1, toJ(Math.max(az, bz) + thr));
        for (let j = c0; j <= c1; j++) for (let i = a0; i <= a1; i++) {
          const cx = MAP.minX + (i + 0.5) * CELL, cz = MAP.minZ + (j + 0.5) * CELL;
          const t = clamp(((cx - ax) * vx + (cz - az) * vz) / l2, 0, 1);
          if (Math.hypot(cx - ax - vx * t, cz - az - vz * t) < thr) road[j * GX + i] |= bits;
        }
      }
    }
    const doomed = new Set();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const o = j * GX + i; if (road[o] && bid[o]) doomed.add(bid[o]); }
    for (const id of doomed) { const b = removeBuilding(id); if (b && this.onDemolish) this.onDemolish(b); }
    W.hooks.cellsChanged(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
  }

  // ---- queries -----------------------------------------------------------------------------------
  nearestNode(x, z, r) {
    let best = null, bd = r;
    for (const id of this.near(x - r, z - r, x + r, z + r)) {
      const p = this.segs.get(id).pts;
      for (const e of [0, p.length - 2]) { const d = Math.hypot(p[e] - x, p[e + 1] - z); if (d < bd) { bd = d; best = { x: p[e], z: p[e + 1], d }; } }
    }
    return best;
  }
  nearestSeg(x, z, r) {
    let best = null;
    for (const id of this.near(x - r, z - r, x + r, z + r)) {
      const seg = this.segs.get(id), n = nearestOn(seg.pts, seg.cum, x, z);
      if (n.d < r && (!best || n.d < best.d)) best = { ...n, seg };
    }
    return best;
  }

  // ---- adding a drawn road -----------------------------------------------------------------------
  validate(pts) {
    const n = pts.length / 2;
    if (n < 2) return 'Too short';
    const c = cumLen(pts); if (c[n - 1] < 6) return 'Too short';
    for (let i = 0; i < pts.length; i += 2) if (pts[i] < MAP.minX + 8 || pts[i] > MAP.maxX - 8 || pts[i + 1] < MAP.minZ + 8 || pts[i + 1] > MAP.maxZ - 8) return 'Outside the map';
    for (const e of [0, pts.length - 2]) if (heightAt(pts[e], pts[e + 1]) < 0.55 || coastDist(pts[e], pts[e + 1]) < 0) return 'Roads must start and end on land';
    return null;
  }
  // Remove the stretches of a new polyline that run along an existing road.
  trimOverlaps(pts) {
    const c = cumLen(pts), len = c[c.length - 1], step = 4, ns = Math.max(2, Math.ceil(len / step)) + 1;
    const flags = new Uint8Array(ns), hit = new Array(ns);
    let any = false;
    for (let i = 0; i < ns; i++) {
      const s = (i / (ns - 1)) * len, a = at(pts, c, s), k = a[2];
      const dx = pts[k * 2 + 2] - pts[k * 2], dz = pts[k * 2 + 3] - pts[k * 2 + 1], dl = Math.hypot(dx, dz) || 1;
      const n = this.nearestSeg(a[0], a[1], 2.6);
      if (n && Math.abs((n.dx * dx + n.dz * dz) / dl) > 0.94) { flags[i] = 1; hit[i] = n; any = true; }
    }
    if (!any) return [pts];
    const runs = [];
    let i = 0;
    while (i < ns) {
      if (flags[i]) { i++; continue; }
      let j = i; while (j + 1 < ns && !flags[j + 1]) j++;
      const a = Math.max(0, i - 1), b = Math.min(ns - 1, j + 1); // include one overlapped sample each side to land on the existing road
      const run = slice(pts, c, (a / (ns - 1)) * len, (b / (ns - 1)) * len);
      if (flags[a]) { const n = hit[a], nd = this.nearestNode(n.x, n.z, 6); run[0] = nd ? nd.x : r1(n.x); run[1] = nd ? nd.z : r1(n.z); }
      if (flags[b]) { const n = hit[b], nd = this.nearestNode(n.x, n.z, 6); run[run.length - 2] = nd ? nd.x : r1(n.x); run[run.length - 1] = nd ? nd.z : r1(n.z); }
      const rc = cumLen(run); if (rc[rc.length - 1] > 5) runs.push(run);
      i = j + 1;
    }
    return runs;
  }
  add(type, ptsIn) {
    let pts = [];
    for (let i = 0; i < ptsIn.length; i += 2) { const x = r1(ptsIn[i]), z = r1(ptsIn[i + 1]); if (!pts.length || Math.hypot(x - pts[pts.length - 2], z - pts[pts.length - 1]) > 0.5) pts.push(x, z); }
    const err = this.validate(pts); if (err) return { ok: false, reason: err };
    const runs = this.trimOverlaps(pts);
    if (!runs.length) return { ok: false, reason: 'A road is already there' };
    let added = 0;
    for (const run of runs) added += this.insertRun(type, run);
    return added ? { ok: true, added } : { ok: false, reason: 'Too short' };
  }
  insertRun(type, P) {
    let cP = cumLen(P), lenP = cP[cP.length - 1];
    const cand = [...this.near(Math.min(...P.filter((_, i) => !(i & 1))) - 2, Math.min(...P.filter((_, i) => i & 1)) - 2, Math.max(...P.filter((_, i) => !(i & 1))) + 2, Math.max(...P.filter((_, i) => i & 1)) + 2)].map((id) => this.segs.get(id));
    const splitsS = new Map(), addS = (S, s, x, z) => { if (!splitsS.has(S.id)) splitsS.set(S.id, []); splitsS.get(S.id).push({ s, x, z }); };
    // 1. ends of the new road that land on an existing road
    for (const e of [0, P.length - 2]) {
      let best = null;
      for (const S of cand) { const n = nearestOn(S.pts, S.cum, P[e], P[e + 1]); if (n.d < 0.4 && (!best || n.d < best.n.d)) best = { S, n }; }
      if (!best) continue;
      const { S, n } = best, sp = S.pts;
      if (n.s < 0.7) { P[e] = sp[0]; P[e + 1] = sp[1]; }
      else if (n.s > S.len - 0.7) { P[e] = sp[sp.length - 2]; P[e + 1] = sp[sp.length - 1]; }
      else { P[e] = r1(n.x); P[e + 1] = r1(n.z); addS(S, n.s, P[e], P[e + 1]); }
    }
    cP = cumLen(P); lenP = cP[cP.length - 1];
    const splitsP = [];
    for (const S of cand) {
      const sp = S.pts;
      // 2. existing ends that touch the new road
      for (const e of [0, sp.length - 2]) { const n = nearestOn(P, cP, sp[e], sp[e + 1]); if (n.d < 0.6 && n.s > 0.7 && n.s < lenP - 0.7) splitsP.push({ s: n.s, x: sp[e], z: sp[e + 1] }); }
      // 3. proper crossings
      for (let a = 0; a + 3 < P.length; a += 2) for (let b = 0; b + 3 < sp.length; b += 2) {
        const px = P[a], pz = P[a + 1], rx = P[a + 2] - px, rz = P[a + 3] - pz, qx = sp[b], qz = sp[b + 1], sx = sp[b + 2] - qx, sz = sp[b + 3] - qz;
        const den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) continue;
        const t = ((qx - px) * sz - (qz - pz) * sx) / den, u = ((qx - px) * rz - (qz - pz) * rx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const sP = cP[a / 2] + t * Math.hypot(rx, rz), sS = S.cum[b / 2] + u * Math.hypot(sx, sz);
        if (sS < 0.7 || sS > S.len - 0.7 || sP < 0.7 || sP > lenP - 0.7) continue;
        const x = r1(px + rx * t), z = r1(pz + rz * t);
        splitsP.push({ s: sP, x, z }); addS(S, sS, x, z);
      }
    }
    const cut = (pts, c, splits) => {
      splits.sort((a, b) => a.s - b.s);
      const len = c[c.length - 1], bounds = [{ s: 0, x: pts[0], z: pts[1] }];
      for (const sp of splits) if (sp.s - bounds[bounds.length - 1].s > 0.8 && len - sp.s > 0.8) bounds.push(sp);
      bounds.push({ s: len, x: pts[pts.length - 2], z: pts[pts.length - 1] });
      const out = [];
      for (let k = 0; k + 1 < bounds.length; k++) {
        const pc = slice(pts, c, bounds[k].s, bounds[k + 1].s);
        pc[0] = bounds[k].x; pc[1] = bounds[k].z; pc[pc.length - 2] = bounds[k + 1].x; pc[pc.length - 1] = bounds[k + 1].z;
        out.push(pc);
      }
      return out;
    };
    for (const [id, sp] of splitsS) {
      const S = this.segs.get(id); if (!S) continue;
      const pieces = cut(S.pts, S.cum, sp); if (pieces.length < 2) continue;
      this.removeRaw(id); for (const pc of pieces) this.addRaw({ type: S.type, pts: pc });
    }
    let n = 0;
    for (const pc of cut(P, cP, splitsP)) { const c = cumLen(pc); if (c[c.length - 1] > 1) { this.addRaw({ type, pts: pc }); n++; } }
    return n;
  }
  serialize() { return [...this.segs.values()].map((s) => ({ t: s.type, p: s.pts.map((v) => r1(v)) })); }
}

// ---- rendering -------------------------------------------------------------------------------------
const ASPHALT = [70, 71, 74], WALK = [152, 148, 139], SHOULDER = [92, 88, 80], STEEL = [96, 104, 100], PIER = [142, 138, 129];
export function makeRoadMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  mat.onBeforeCompile = (shd) => {
    shd.uniforms.uNight = buildingUniforms.uNight;
    shd.vertexShader = shd.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aUv; attribute vec4 aWin; varying vec2 vUv2; varying vec4 vWin;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = pow(vColor.rgb, vec3(2.2));')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUv2 = aUv; vWin = aWin;');
    shd.fragmentShader = shd.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vUv2; varying vec4 vWin; uniform float uNight;
      float rh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float rn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(rh(i), rh(i+vec2(1,0)), f.x), mix(rh(i+vec2(0,1)), rh(i+vec2(1,1)), f.x), f.y); }
      float ln(float x, float c, float w, float fw){ return 1.0 - smoothstep(w * 0.5 - fw * 0.5, w * 0.5 + fw * 0.5, abs(x - c)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float kind = floor(vWin.x * 255.0 + 0.5); float u = vUv2.x, au = abs(u), v = vUv2.y;
        float fw = max(fwidth(u), 1e-4), lod = 1.0 - smoothstep(0.35, 1.3, fw);
        diffuseColor.rgb *= 0.9 + 0.2 * rn(vec2(u * 0.8, v * 0.3));
        if (kind > 0.5) {
          vec3 yel = vec3(0.62, 0.47, 0.10), wht = vec3(0.72, 0.72, 0.68);
          float dash = step(fract(v / 9.0), 0.42), y = 0.0, w = 0.0;
          if (kind < 1.5) { y = ln(au, 0.2, 0.13, fw); }
          else if (kind < 2.5) { y = ln(au, 0.2, 0.13, fw); w = ln(au, 3.9, 0.14, fw) * dash; }
          else if (kind < 3.5) {
            float med = 1.0 - smoothstep(1.6 - fw, 1.6 + fw, au);
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.16, 0.2, 0.1), vec3(0.42, 0.41, 0.38), smoothstep(1.25, 1.45, au)), med);
            w = (ln(au, 5.0, 0.14, fw) + ln(au, 8.3, 0.14, fw)) * dash; y = ln(au, 1.95, 0.13, fw);
          }
          else if (kind < 4.5) { w = ln(au, 0.0, 0.14, fw) * dash; }
          else if (kind < 5.5) {
            float bar = 1.0 - smoothstep(0.45 - fw, 0.45 + fw, au);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.44, 0.41), bar);
            w = (ln(au, 4.7, 0.15, fw) + ln(au, 8.5, 0.15, fw)) * dash + ln(au, 12.3, 0.16, fw); y = ln(au, 1.0, 0.15, fw);
          }
          else { w = ln(au, 2.55, 0.14, fw); }
          diffuseColor.rgb = mix(diffuseColor.rgb, yel, clamp(y, 0.0, 1.0) * lod * 0.9);
          diffuseColor.rgb = mix(diffuseColor.rgb, wht, clamp(w, 0.0, 1.0) * lod * 0.8);
        }
      }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      if (vWin.y > 0.0 && uNight > 0.01) {
        float half_ = vWin.y * 255.0 / 8.0, per = 34.0;
        float lv = abs(fract(vUv2.y / per + (vUv2.x < 0.0 ? 0.5 : 0.0)) - 0.5) * per, du = abs(vUv2.x) - half_;
        float pool = exp(-(lv * lv + du * du * 0.7) / 30.0);
        totalEmissiveRadiance += vec3(1.0, 0.66, 0.34) * diffuseColor.rgb * pool * uNight * 2.6;
      }`);
  };
  return mat;
}

export class RoadRenderer {
  constructor(scene, roads, propMat) {
    this.scene = scene; this.roads = roads; this.mat = makeRoadMaterial(); this.propMat = propMat;
    this.mb = new MeshBuilder(); this.pb = new MeshBuilder();
    this.meshes = new Array(CXN * CZN).fill(null); this.props = new Array(CXN * CZN).fill(null); this.dirty = new Set();
    roads.onDirty = (c) => this.dirty.add(c);
  }
  clear() { for (let c = 0; c < this.meshes.length; c++) this.drop(c); this.dirty.clear(); }
  drop(c) {
    for (const arr of [this.meshes, this.props]) if (arr[c]) { this.scene.remove(arr[c]); arr[c].geometry.dispose(); arr[c] = null; }
  }
  update(budgetMs = 6) {
    if (!this.dirty.size) return;
    const t0 = performance.now();
    for (const c of this.dirty) { this.rebuild(c); this.dirty.delete(c); if (performance.now() - t0 > budgetMs) break; }
  }
  rebuild(c) {
    this.drop(c);
    const R = this.roads, mb = this.mb, pb = this.pb; mb.reset(); pb.reset();
    const nodesDone = new Set();
    for (const id of R.chunkSegs[c]) {
      const seg = R.segs.get(id);
      if (seg.home === c) this.emitSeg(seg);
      const p = seg.pts;
      for (const e of [0, p.length - 2]) {
        const k = nkey(p[e], p[e + 1]); if (nodesDone.has(k)) continue; nodesDone.add(k);
        const n = R.nodes.get(k); if (n && R.homeOf(n.x, n.z) === c) this.emitNode(n);
      }
    }
    if (mb.n) { const m = new THREE.Mesh(mb.toGeometry(), this.mat); m.receiveShadow = true; m.matrixAutoUpdate = false; m.renderOrder = 1; this.scene.add(m); this.meshes[c] = m; }
    if (pb.n) { const m = new THREE.Mesh(pb.toGeometry(), this.propMat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; this.scene.add(m); this.props[c] = m; }
  }
  // direction of the other road at a two-way joint, pointing away from the node
  otherDir(node, seg) {
    if (node.segs.size !== 2) return null;
    for (const id of node.segs) if (id !== seg.id) {
      const o = this.roads.segs.get(id), p = o.pts, atStart = Math.abs(p[0] - node.x) < 0.06 && Math.abs(p[1] - node.z) < 0.06;
      const k = atStart ? 0 : p.length - 4, dx = atStart ? p[2] - p[0] : p[k] - p[k + 2], dz = atStart ? p[3] - p[1] : p[k + 1] - p[k + 3], l = Math.hypot(dx, dz) || 1;
      return { dx: dx / l, dz: dz / l, type: o.type };
    }
    return null;
  }
  clearance(node, seg) {
    const T = ROAD_TYPES[seg.type];
    if (node.segs.size >= 3) { let r = 0; for (const id of node.segs) if (id !== seg.id) r = Math.max(r, ROAD_TYPES[this.roads.segs.get(id).type].half); return r + 1.5; }
    if (node.segs.size === 2) { const o = this.otherDir(node, seg); return o && o.type !== seg.type ? T.half : 0; }
    return 0;
  }
  emitSeg(seg) {
    const mb = this.mb, pb = this.pb, T = ROAD_TYPES[seg.type], p = seg.pts, c = seg.cum, n = c.length, len = seg.len, R = this.roads;
    const nA = R.nodes.get(nkey(p[0], p[1])), nB = R.nodes.get(nkey(p[p.length - 2], p[p.length - 1]));
    const rA = nA ? this.clearance(nA, seg) : 0, rB = nB ? this.clearance(nB, seg) : 0;
    // stations
    const S = [];
    for (let k = 0; k < n - 1; k++) { const l = c[k + 1] - c[k], st = Math.max(1, Math.ceil(l / 8)); for (let i = 0; i < st; i++) S.push(c[k] + (l * i) / st); }
    S.push(len);
    if (rA + rB < len - 1) { if (rA > 0) S.push(rA); if (rB > 0) S.push(len - rB); }
    S.sort((a, b) => a - b);
    const dirAt = (k) => { const dx = p[k * 2 + 2] - p[k * 2], dz = p[k * 2 + 3] - p[k * 2 + 1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
    const st = [];
    let prevS = -1;
    for (const s of S) {
      if (s - prevS < 0.05) continue; prevS = s;
      const a = at(p, c, s), k = a[2];
      let din = dirAt(k), dout = din, miter = 1;
      if (s < 0.01) { const o = nA && this.otherDir(nA, seg); if (o) din = [-o.dx, -o.dz]; }
      else if (s > len - 0.01) { din = dout = dirAt(n - 2); const o = nB && this.otherDir(nB, seg); if (o) dout = [o.dx, o.dz]; }
      else if (k < n - 2 && Math.abs(s - c[k + 1]) < 0.01) dout = dirAt(k + 1);
      let tx = din[0] + dout[0], tz = din[1] + dout[1];
      const tl = Math.hypot(tx, tz);
      if (tl < 0.5) { tx = dout[0]; tz = dout[1]; } else { tx /= tl; tz /= tl; miter = Math.min(2.2, 1 / Math.max(tx * dout[0] + tz * dout[1], 0.3)); }
      const nx = -tz, nz = tx, hw = T.half, ww = T.half + T.walk;
      const y0 = roadY(a[0], a[1]), bridge = heightAt(a[0], a[1]) < 0.5;
      const o = { s, x: a[0], z: a[1], nx, nz, tx, tz, bridge, y0, pts: [] };
      for (const off of [-ww, -hw + 0.6, -hw, hw, hw - 0.6, ww]) {
        const x = a[0] + nx * off * miter, z = a[1] + nz * off * miter;
        o.pts.push(x, bridge ? y0 : roadY(x, z), z);
      }
      st.push(o);
    }
    const tint = 0.94 + 0.12 * hash2(seg.id, 7), asph = [ASPHALT[0] * tint, ASPHALT[1] * tint, ASPHALT[2] * tint], side = T.access ? WALK : SHOULDER, lamp = T.trees ? Math.round(T.half * 8) : 0;
    const hw = T.half, ww = T.half + T.walk;
    const strip = (A, B, ia, ib, ua, ub, dy, col, kind) => {
      const ax = A.pts[ia * 3], az = A.pts[ia * 3 + 2], bx = A.pts[ib * 3], bz = A.pts[ib * 3 + 2];
      // face normal from the quad itself keeps lighting consistent with the slope
      const ex = B.pts[ia * 3] - ax, ey = B.pts[ia * 3 + 1] - A.pts[ia * 3 + 1], ez = B.pts[ia * 3 + 2] - az, fx = bx - ax, fy = A.pts[ib * 3 + 1] - A.pts[ia * 3 + 1], fz = bz - az;
      let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      mb.w[0] = kind; mb.w[1] = A.bridge && B.bridge ? 0 : lamp; mb.w[2] = 0; mb.w[3] = 0;
      const v0 = mb.v(bx, A.pts[ib * 3 + 1] + dy, bz, nx, ny, nz, ub, A.s, col), v1 = mb.v(B.pts[ib * 3], B.pts[ib * 3 + 1] + dy, B.pts[ib * 3 + 2], nx, ny, nz, ub, B.s, col);
      const v2 = mb.v(B.pts[ia * 3], B.pts[ia * 3 + 1] + dy, B.pts[ia * 3 + 2], nx, ny, nz, ua, B.s, col), v3 = mb.v(ax, A.pts[ia * 3 + 1] + dy, az, nx, ny, nz, ua, A.s, col);
      mb.quad(v0, v1, v2, v3);
    };
    for (let i = 0; i + 1 < st.length; i++) {
      const A = st[i], B = st[i + 1], mid = (A.s + B.s) / 2, kind = mid > rA && mid < len - rB ? T.kind : 0;
      strip(A, B, 0, 1, -ww, -hw + 0.6, 0, side, 0); strip(A, B, 4, 5, hw - 0.6, ww, 0, side, 0);
      strip(A, B, 2, 3, -hw, hw, 0.13, asph, kind);
      if (A.bridge || B.bridge) this.emitBridge(A, B, T);
    }
    // street trees and median planting (land only)
    if (T.trees && len > 30) {
      const gap = 21, m0 = Math.max(13, rA + 8);
      for (let s = m0, k = 0; s < len - Math.max(13, rB + 8); s += gap, k++) {
        const a = at(p, c, s), [tx, tz] = dirAt(a[2]), nx = -tz, nz = tx;
        for (const sd of [-1, 1]) {
          const j = hash2(seg.id * 31 + k, sd * 17 + 3); if (j < 0.2) continue;
          const off = sd * (hw + T.walk * 0.5), jx = (j - 0.6) * 5, x = a[0] + nx * off + tx * jx, z = a[1] + nz * off + tz * jx;
          if (heightAt(x, z) < 1.2) continue;
          const h = 6 + hash2(k, seg.id + sd) * 3.6;
          tree(pb, x, z, roadY(x, z) - 0.1, h, h * (0.3 + 0.1 * j), TREE_COLORS[Math.floor(hash2(seg.id + k * 7, sd + 5) * TREE_COLORS.length)]);
        }
        if (T.kind === 3 && heightAt(a[0], a[1]) > 1.2) { const h = 7 + hash2(k, seg.id) * 3; tree(pb, a[0], a[1], roadY(a[0], a[1]), h, h * 0.36, TREE_COLORS[Math.floor(hash2(seg.id, k) * TREE_COLORS.length)]); }
      }
    }
  }
  emitBridge(A, B, T) {
    const pb = this.pb; pb.w[0] = pb.w[1] = pb.w[2] = pb.w[3] = 0; pb.birth = -100;
    for (const [i, sgn] of [[0, -1], [5, 1]]) {
      const ax = A.pts[i * 3], ay = A.pts[i * 3 + 1] + 0.13, az = A.pts[i * 3 + 2], bx = B.pts[i * 3], by = B.pts[i * 3 + 1] + 0.13, bz = B.pts[i * 3 + 2];
      const nx = A.nx * sgn, nz = A.nz * sgn;
      for (const [lo, hi, col] of [[-1.6, 0, STEEL], [0, 1.05, [118, 122, 118]]]) for (const flip of [1, -1]) {
        const v0 = pb.v(ax, ay + lo, az, nx * flip, 0, nz * flip, 0, 0, col), v1 = pb.v(bx, by + lo, bz, nx * flip, 0, nz * flip, 0, 0, col);
        const v2 = pb.v(bx, by + hi, bz, nx * flip, 0, nz * flip, 0, 0, col), v3 = pb.v(ax, ay + hi, az, nx * flip, 0, nz * flip, 0, 0, col);
        if (flip * sgn > 0) pb.quad(v0, v1, v2, v3); else pb.quad(v3, v2, v1, v0);
      }
    }
    // underside
    const u = [A.pts[0], A.pts[1] - 1.4, A.pts[2], A.pts[15], A.pts[16] - 1.4, A.pts[17], B.pts[15], B.pts[16] - 1.4, B.pts[17], B.pts[0], B.pts[1] - 1.4, B.pts[2]];
    const q = [0, 1, 2, 3].map((k) => pb.v(u[k * 3], u[k * 3 + 1], u[k * 3 + 2], 0, -1, 0, 0, 0, [70, 74, 72])); pb.quad(q[3], q[2], q[1], q[0]);
    // piers every ~40 m where the deck is over water
    if (Math.floor(A.s / 40) !== Math.floor(B.s / 40) && heightAt(A.x, A.z) < 0.2) {
      const bot = heightAt(A.x, A.z) - 2, top = A.y0 - 1.4, w = T.half * 0.62;
      for (const sgn of w > 4 ? [-1, 1] : [0]) {
        const cx = A.x + A.nx * w * sgn, cz = A.z + A.nz * w * sgn, r = 1.3;
        for (let k = 0; k < 4; k++) {
          const a0 = (k / 4) * Math.PI * 2 + Math.PI / 4, a1 = ((k + 1) / 4) * Math.PI * 2 + Math.PI / 4, mx = Math.cos((a0 + a1) / 2), mz = Math.sin((a0 + a1) / 2);
          const v0 = pb.v(cx + Math.cos(a0) * r * 1.4, bot, cz + Math.sin(a0) * r * 1.4, mx, 0, mz, 0, 0, PIER), v1 = pb.v(cx + Math.cos(a0) * r * 1.4, top, cz + Math.sin(a0) * r * 1.4, mx, 0, mz, 0, 0, PIER);
          const v2 = pb.v(cx + Math.cos(a1) * r * 1.4, top, cz + Math.sin(a1) * r * 1.4, mx, 0, mz, 0, 0, PIER), v3 = pb.v(cx + Math.cos(a1) * r * 1.4, bot, cz + Math.sin(a1) * r * 1.4, mx, 0, mz, 0, 0, PIER);
          pb.quad(v0, v1, v2, v3);
        }
      }
    }
  }
  emitNode(node) {
    const mb = this.mb, R = this.roads, deg = node.segs.size;
    let half = 0, full = 0, sharp = false, access = true;
    for (const id of node.segs) { const T = ROAD_TYPES[R.segs.get(id).type]; half = Math.max(half, T.half); full = Math.max(full, T.half + T.walk); access = access && T.access; }
    if (deg === 2) {
      const [a, b] = [...node.segs].map((id) => R.segs.get(id));
      const o = this.otherDir(node, a), p = a.pts, atStart = Math.abs(p[0] - node.x) < 0.06 && Math.abs(p[1] - node.z) < 0.06;
      const k = atStart ? 0 : p.length - 4, dx = atStart ? p[2] - p[0] : p[k] - p[k + 2], dz = atStart ? p[3] - p[1] : p[k + 1] - p[k + 3], l = Math.hypot(dx, dz) || 1;
      sharp = o && (dx / l) * o.dx + (dz / l) * o.dz > -0.75; // bend sharper than ~40 degrees
      if (!sharp && a.type === b.type) return;
      if (!sharp) half = Math.min(ROAD_TYPES[a.type].half, ROAD_TYPES[b.type].half);
    }
    const fan = (r, dy, col) => {
      mb.w[0] = 0; mb.w[1] = 0; mb.w[2] = 0; mb.w[3] = 0;
      const bridge = heightAt(node.x, node.z) < 0.5, cy = roadY(node.x, node.z);
      const c0 = mb.v(node.x, cy + dy, node.z, 0, 1, 0, 0, 0, col), b0 = mb.n, N = 16;
      for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2, x = node.x + Math.cos(a) * r, z = node.z + Math.sin(a) * r; mb.v(x, (bridge ? cy : roadY(x, z)) + dy, z, 0, 1, 0, 0, 0, col); }
      for (let i = 0; i < N; i++) mb.tri(c0, b0 + i + 1, b0 + i);
    };
    if (deg === 1 || sharp) fan(full, 0.02, access ? WALK : SHOULDER);
    fan(half, 0.15, ASPHALT);
  }
}

// Flat ribbon used for the drawing preview.
export function previewGeometry(pts, half) {
  const c = cumLen(pts), len = c[c.length - 1], n = Math.max(2, Math.ceil(len / 10) + 1), pos = new Float32Array(n * 6), idx = [];
  for (let i = 0; i < n; i++) {
    const a = at(pts, c, (i / (n - 1)) * len), k = a[2], dx = pts[k * 2 + 2] - pts[k * 2], dz = pts[k * 2 + 3] - pts[k * 2 + 1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
    const y = roadY(a[0], a[1]) + 0.6;
    pos.set([a[0] - nx * half, y, a[1] - nz * half, a[0] + nx * half, y, a[1] + nz * half], i * 6);
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
