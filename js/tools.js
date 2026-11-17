// Pointer, wheel, touch and keyboard input, plus the four tools: inspect, roads, zones, bulldoze.
import * as THREE from 'three';
import { MAP, heightAt, raycastGround, coastDist, lockedAt } from './terrain.js';
import { CELL, GX, GZ, zone, road, bid, land, buildings, removeBuilding, refreshOverlay, ZONES, toI, toJ, inGrid, state as W } from './world.js';
import { ROAD_TYPES, previewGeometry, cumLen, nearestOn } from './roads.js';
import { clamp } from './util.js';
import { CAT } from './structures.js';
import { dimsOf, siteOf, checkPlace, place, placeLot, placeAtSite, turnedLot, snapToStreet, smartFill, terraform, pier, costOf } from './place.js';
import { city, markDirty, paintHood, money, canAfford, spend, priceIndex, nm } from './city.js';
import { ignite, prebuiltCircuit, circuitOk, setCircuit, culture } from './culture.js';
import { LINE_TYPES } from './life.js';

const LINE_NAMES = { bus: ['1 California', '5 Fulton', '14 Mission', '22 Fillmore', '38 Geary', '49 Van Ness', '7 Haight', '24 Divisadero', '29 Sunset', '30 Stockton', '44 O\'Shaughnessy', '48 Quintara'], cable: ['Powell and Hyde', 'Powell and Mason', 'California Street'], metro: ['N Judah', 'J Church', 'K Ingleside', 'L Taraval', 'M Ocean View', 'T Third'], ferry: ['Sausalito Ferry', 'Alameda Ferry', 'Tiburon Ferry', 'Oakland Ferry', 'Vallejo Ferry'] };
const LINE_COLS = ['#c2572f', '#3f7fb8', '#3f9c8c', '#b8862c', '#8a5fc8', '#b84a6a', '#5f9c4a', '#6a7f8c'];

export function makeTools(game) {
  const { canvas, camera, rig, roads, undo, scene, terrainU } = game;
  const T = {
    tool: 'inspect', roadType: 'street', roadMode: 'straight', zoneId: 1, zoneMode: 'brush', brush: 3,
    snapGrid: true, snapAngle: true, blockW: 96, blockH: 176, blocksX: 3, blocksZ: 3, stampRot: 0, clip: null, scroll: 'auto', chain: null, ctrl: null, selected: null, hover: null,
    buildCat: 'park', buildKey: 'park', buildRot: 2, buildTurn: 0, buildSnap: true, fill: { items: { tree: true, bench: true, lamp: true, planter: false, fountain: false, plaza: false }, density: 0.5, prompt: '' },
    lineType: 'bus', lineDraft: null, terraMode: 'raise', terraSize: 90, lockMode: 'lock', disaster: 'fire', quakeMag: 6.5, circuitMode: 'prebuilt', circuitDraft: null, hoodId: 0, hoodSize: 160,
  };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), keys = new Set();
  let drag = null, lastPtr = { x: 0, y: 0 }, hoverDirty = false;
  const touches = new Map(); let gesture = null;

  // ---- picking ----------------------------------------------------------------------------------
  function setRay(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.ray;
  }
  function groundAt(cx, cy) { const r = setRay(cx, cy), o = r.origin, d = r.direction; return raycastGround(o.x, o.y, o.z, d.x, d.y, d.z); }
  function planeAt(cx, cy, y) { const r = setRay(cx, cy), d = r.direction; if (d.y > -0.015) return null; const t = (y - r.origin.y) / d.y; return { x: r.origin.x + d.x * t, z: r.origin.z + d.z * t }; }
  function pickBuilding(cx, cy) {
    const r = setRay(cx, cy), o = r.origin, d = r.direction;
    let t = d.y < 0 && o.y > 450 ? (450 - o.y) / d.y : 0;
    for (let n = 0; n < 6000; n++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, i = toI(x), j = toJ(z);
      if (!inGrid(i, j)) { if (t > 1000) return null; } else {
        const id = bid[j * GX + i];
        if (id) { const b = buildings.get(id); if (b && y <= b.baseY + b.height * 1.15 + 3) return b; }
        if (y < Math.max(heightAt(x, z), 0)) return null;
      }
      t += clamp(t * 0.003, 1.2, 5);
      if (t > 60000) return null;
    }
    return null;
  }

  // ---- preview objects --------------------------------------------------------------------------
  const prevMat = new THREE.MeshBasicMaterial({ color: 0xe9d9a8, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  const badMat = prevMat.clone(); badMat.color.set(0xd2533c);
  const prevGroup = new THREE.Group(); scene.add(prevGroup);
  function clearPreview() { for (const m of [...prevGroup.children]) { m.geometry.dispose(); prevGroup.remove(m); } }
  function addPreview(pts, half, ok = true) { const m = new THREE.Mesh(previewGeometry(pts, half), ok ? prevMat : badMat); m.renderOrder = 3; m.frustumCulled = false; prevGroup.add(m); }
  const boxMat = new THREE.MeshBasicMaterial({ color: 0xe9d9a8, transparent: true, opacity: 0.16, depthWrite: false });
  const hl = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), boxMat); hl.visible = false; hl.renderOrder = 4;
  const hlEdges = new THREE.LineSegments(new THREE.EdgesGeometry(hl.geometry), new THREE.LineBasicMaterial({ color: 0xf2e6c2 })); hl.add(hlEdges); scene.add(hl);
  function highlight(b, red = false) {
    if (!b) { hl.visible = false; return; }
    const x0 = MAP.minX + b.i * CELL, z0 = MAP.minZ + b.j * CELL, w = (b.yaw ? b.mw : b.w) * CELL, d = (b.yaw ? b.md : b.d) * CELL, y0 = b.baseY - 2, y1 = b.baseY + b.height + 2.5;
    hl.position.set(b.yaw ? b.cx : x0 + w / 2, (y0 + y1) / 2, b.yaw ? b.cz : z0 + d / 2); hl.scale.set(w, y1 - y0, d); hl.rotation.y = -(b.yaw || 0); hl.visible = true;
    boxMat.color.set(red ? 0xd2533c : 0xe9d9a8); hlEdges.material.color.set(red ? 0xf08a70 : 0xf2e6c2);
  }

  // ---- snapping ----------------------------------------------------------------------------------
  const _pv = new THREE.Vector3(), r1 = (v) => Math.round(v * 10) / 10;
  function scr(x, z) { _pv.set(x, Math.max(heightAt(x, z), 0), z).project(camera); return [((_pv.x + 1) / 2) * canvas.clientWidth, ((1 - _pv.y) / 2) * canvas.clientHeight]; }
  // Nearest road end or road under the cursor, measured in screen pixels so that it works the same in every
  // direction however the camera is tilted.
  function snapRoad(p) {
    const RW = clamp(rig.dist * 0.07, 24, 220), [px, py] = scr(p.x, p.z); let best = null;
    for (const id of roads.near(p.x - RW, p.z - RW, p.x + RW, p.z + RW)) {
      const seg = roads.segs.get(id), q = seg.pts, Tt = ROAD_TYPES[seg.type];
      for (const e of [0, q.length - 2]) {
        const [sx, sy] = scr(q[e], q[e + 1]), d = Math.hypot(sx - px, sy - py), wd = Math.hypot(q[e] - p.x, q[e + 1] - p.z);
        if ((d < 20 || wd < 7) && (!best || d - 12 < best.d)) best = { x: q[e], z: q[e + 1], d: d - 12, on: 'node', seg };
      }
      const n = nearestOn(q, seg.cum, p.x, p.z), [sx, sy] = scr(n.x, n.z), d = Math.hypot(sx - px, sy - py);
      if ((d < 15 || n.d < Tt.half + Tt.walk + 2) && (!best || d < best.d)) best = { x: r1(n.x), z: r1(n.z), d, on: 'road', seg, dx: n.dx, dz: n.dz };
    }
    return best;
  }
  // where the ray from a point in a direction first meets a given road, as a distance along the ray
  function rayHit(fx, fz, dx, dz, q) {
    let bt = Infinity;
    for (let k = 0; k + 3 < q.length; k += 2) {
      const ax = q[k], az = q[k + 1], sx = q[k + 2] - ax, sz = q[k + 3] - az, den = dx * sz - dz * sx; if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - fx) * sz - (az - fz) * sx) / den, u = ((ax - fx) * dz - (az - fz) * dx) / den;
      if (t > 0 && u >= -0.001 && u <= 1.001 && t < bt) bt = t;
    }
    return bt;
  }
  // a road that stops just short of another one, or runs just past it, ends on it instead
  function extendTo(from, to) {
    const L = Math.hypot(to.x - from.x, to.z - from.z); if (L < 8) return null;
    const dx = (to.x - from.x) / L, dz = (to.z - from.z) / L, E = Math.min(clamp(rig.dist * 0.035, 12, 60), L * 0.5), ex = to.x + dx * E, ez = to.z + dz * E; let bt = Infinity;
    for (const id of roads.near(Math.min(from.x, ex) - 2, Math.min(from.z, ez) - 2, Math.max(from.x, ex) + 2, Math.max(from.z, ez) + 2)) {
      const q = roads.segs.get(id).pts;
      for (let k = 0; k + 3 < q.length; k += 2) {
        const ax = q[k], az = q[k + 1], sx = q[k + 2] - ax, sz = q[k + 3] - az, den = dx * sz - dz * sx; if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - from.x) * sz - (az - from.z) * sx) / den, u = ((ax - from.x) * dz - (az - from.z) * dx) / den;
        if (u >= 0 && u <= 1 && t > Math.max(6, L - E) && t < L + E && Math.abs(t - L) < Math.abs(bt - L)) bt = t;
      }
    }
    return bt < Infinity ? { x: r1(from.x + dx * bt), z: r1(from.z + dz * bt), on: 'road' } : null;
  }
  function snap(p, from) {
    const hit = snapRoad(p);
    if (hit) {
      // landing on a road: slide along it to keep a clean angle when one is close
      if (hit.on === 'road' && from && T.snapAngle) {
        const a = Math.atan2(hit.z - from.z, hit.x - from.x), step = Math.PI / 12, sa = Math.round(a / step) * step, len = Math.hypot(hit.x - from.x, hit.z - from.z);
        if (Math.abs(a - sa) < 0.12 && len > 10) { const t = rayHit(from.x, from.z, Math.cos(sa), Math.sin(sa), hit.seg.pts); if (t < Infinity) { const qx = from.x + Math.cos(sa) * t, qz = from.z + Math.sin(sa) * t; if (Math.hypot(qx - hit.x, qz - hit.z) < Math.max(10, len * 0.08)) return { ...hit, x: r1(qx), z: r1(qz) }; } }
      }
      return hit;
    }
    let x = p.x, z = p.z;
    const Tt = ROAD_TYPES[T.roadType], offs = Tt.cells % 2 ? CELL / 2 : 0;
    if (T.snapGrid) { x = Math.round((x - offs) / CELL) * CELL + offs; z = Math.round((z - offs) / CELL) * CELL + offs; }
    if (from && T.snapAngle) {
      const dx = x - from.x, dz = z - from.z, len = Math.hypot(dx, dz), a = Math.atan2(dz, dx), step = Math.PI / 12, sa = Math.round(a / step) * step;
      if (len > 1 && Math.abs(a - sa) < 0.07) { const l = len * Math.cos(a - sa); x = from.x + Math.cos(sa) * l; z = from.z + Math.sin(sa) * l; }
    }
    // grid snapping can leave the point a few metres off a road: weld it on
    const w = roads.nearestSeg(x, z, 9); if (w) { const nd = roads.nearestNode(w.x, w.z, 7); return nd ? { x: nd.x, z: nd.z, on: 'node', seg: w.seg } : { x: r1(w.x), z: r1(w.z), on: 'road', seg: w.seg, dx: w.dx, dz: w.dz }; }
    if (from) { const e = extendTo(from, { x, z }); if (e) return e; }
    return { x, z, on: null };
  }
  const bezier = (a, c, b) => { const len = Math.hypot(c.x - a.x, c.z - a.z) + Math.hypot(b.x - c.x, b.z - c.z), n = clamp(Math.ceil(len / 9), 6, 60), out = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.z + 2 * u * t * c.z + t * t * b.z); } return out; };
  const onLand = (x, z) => x > MAP.minX + 8 && x < MAP.maxX - 8 && z > MAP.minZ + 8 && z < MAP.maxZ - 8 && heightAt(x, z) >= 0.55 && !lockedAt(x, z);

  // ---- block stamps and copy / paste -------------------------------------------------------------------
  const trimToLand = (ax, az, bx, bz, out) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.ceil(len / 8)); let i0 = 0, i1 = n;
    const P = (i) => [ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n];
    while (i0 < n && !onLand(...P(i0))) i0++; while (i1 > i0 && !onLand(...P(i1))) i1--;
    if (i1 - i0 >= 2) out.push([...P(i0), ...P(i1)].map(r1));
  };
  // A grid of blocksX by blocksZ city blocks with its corner at the cursor. It lines up with the road under the
  // cursor when there is one; T turns it a quarter each press.
  function blockLines(h) {
    const s = snap(h); let ang = 0;
    if (s.seg) { const n = nearestOn(s.seg.pts, s.seg.cum, s.x, s.z); ang = Math.atan2(n.dz, n.dx); }
    ang += (T.stampRot * Math.PI) / 2;
    const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux, W2 = T.blocksX * T.blockW, H2 = T.blocksZ * T.blockH, lines = [];
    for (let k = 0; k <= T.blocksX; k++) { const ox = s.x + ux * k * T.blockW, oz = s.z + uz * k * T.blockW; trimToLand(ox, oz, ox + vx * H2, oz + vz * H2, lines); }
    for (let k = 0; k <= T.blocksZ; k++) { const ox = s.x + vx * k * T.blockH, oz = s.z + vz * k * T.blockH; trimToLand(ox, oz, ox + ux * W2, oz + uz * W2, lines); }
    return lines;
  }
  function copyRect(a, b) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, segs = [];
    for (const id of roads.near(x0, z0, x1, z1)) {
      const sg = roads.segs.get(id), bb = sg.bbox, mx = (bb[0] + bb[2]) / 2, mz = (bb[1] + bb[3]) / 2;
      if (mx < x0 || mx > x1 || mz < z0 || mz > z1 || segs.length >= 500) continue;
      segs.push({ type: sg.type, pts: Array.from(sg.pts, (v, k) => r1(v - (k & 1 ? cz : cx))) });
    }
    if (!segs.length) return game.ui.toast('No roads in that area to copy', 'warn');
    T.clip = { segs }; T.stampRot = 0; game.ui.toast(`${segs.length} road piece${segs.length === 1 ? '' : 's'} copied. Click to paste, T turns it.`);
  }
  function clipLines(h) {
    const off = CELL / 2, x = T.snapGrid ? Math.round((h.x - off) / CELL) * CELL + off : h.x, z = T.snapGrid ? Math.round((h.z - off) / CELL) * CELL + off : h.z, c = [1, 0, -1, 0][T.stampRot & 3], sn = [0, 1, 0, -1][T.stampRot & 3];
    return T.clip.segs.map((sg) => ({ type: sg.type, pts: sg.pts.map((v, k, p) => (k & 1 ? r1(z + p[k - 1] * sn + v * c) : r1(x + v * c - p[k + 1] * sn))) }));
  }
  function stampRoads(list, label) { // list: [{type, pts}]
    undo.begin(label); let n = 0; for (const l of list) if (roads.add(l.type, l.pts).ok) n++; undo.commit();
    if (!n) game.ui.toast('No room for that here', 'warn'); return n;
  }

  function commitRoad(pts) {
    undo.begin('road');
    const res = roads.add(T.roadType, pts);
    undo.commit();
    if (!res.ok) game.ui.toast(res.reason, 'warn');
    return res.ok;
  }
  function updateRoadPreview() {
    clearPreview();
    const h = T.hover; if (T.tool !== 'road' || !h) return;
    const Tt = ROAD_TYPES[T.roadType], half = Tt.half + Tt.walk;
    if (T.roadMode === 'blocks') { for (const l of blockLines(h)) addPreview(l, half); return; }
    if (T.roadMode === 'upgrade') { const n = roads.nearestSeg(h.x, h.z, clamp(rig.dist * 0.02, 10, 40)); if (n) addPreview(n.seg.pts, half, true); return; }
    if (T.roadMode === 'copy') {
      if (T.clip) for (const l of clipLines(h)) { const t2 = ROAD_TYPES[l.type]; addPreview(l.pts, t2.half + t2.walk, onLand(l.pts[0], l.pts[1]) && onLand(l.pts[l.pts.length - 2], l.pts[l.pts.length - 1])); }
      else if (drag && drag.mode === 'crect' && drag.moved) { terrainU.uPrevCol.value.set('#e9d9a8'); terrainU.uRect.value.set(Math.min(drag.a.x, h.x), Math.min(drag.a.z, h.z), Math.max(drag.a.x, h.x), Math.max(drag.a.z, h.z)); terrainU.uRectOn.value = 1; }
      return;
    }
    if (!T.chain) { const s = snap(h); addPreview([s.x - 2, s.z, s.x + 2, s.z], half, onLand(s.x, s.z)); return; }
    const s = snap(h, T.roadMode === 'straight' ? T.chain : null);
    let pts;
    if (T.roadMode === 'curve' && T.ctrl) pts = bezier(T.chain, T.ctrl, s); else pts = [T.chain.x, T.chain.z, s.x, s.z];
    if (cumLen(pts).at(-1) < 2) return;
    addPreview(pts, half, !roads.validate(pts));
  }
  // change a road to another type in place, keeping its course. A one-way clicked again with One-way flips its direction.
  function retype(id, type) {
    const s = roads.segs.get(id); if (!s) return false;
    let pts = s.pts.slice();
    if (s.type === type) { if (type !== 'oneway') { game.ui.toast(`Already a ${ROAD_TYPES[type].name.toLowerCase()}`); return false; } const r = []; for (let k = pts.length - 2; k >= 0; k -= 2) r.push(pts[k], pts[k + 1]); pts = r; }
    undo.begin('road'); roads.removeRaw(id); roads.addRaw({ type, pts }); undo.commit(); markDirty(); game.ui.refresh();
    game.ui.toast(s.type === type ? 'One-way direction flipped' : `Changed to ${ROAD_TYPES[type].name.toLowerCase()}`);
    return true;
  }
  function roadClick(g) {
    if (T.roadMode === 'upgrade') { const n = roads.nearestSeg(g.x, g.z, clamp(rig.dist * 0.02, 10, 40)); if (n) retype(n.seg.id, T.roadType); else game.ui.toast('Click on a road', 'warn'); return; }
    if (T.roadMode === 'blocks') { stampRoads(blockLines(g).map((pts) => ({ type: T.roadType, pts })), 'road blocks'); return; }
    if (T.roadMode === 'copy') { if (T.clip) stampRoads(clipLines(g), 'paste roads'); return; }
    if (T.roadMode === 'straight') {
      if (!T.chain) { const s = snap(g); if (!onLand(s.x, s.z)) return game.ui.toast('Roads must start and end on land', 'warn'); T.chain = s; return; }
      const s = snap(g, T.chain);
      if (Math.hypot(s.x - T.chain.x, s.z - T.chain.z) < 6) { T.chain = null; return; }
      if (commitRoad([T.chain.x, T.chain.z, s.x, s.z])) T.chain = s.on ? null : s;
    } else if (T.roadMode === 'curve') {
      if (!T.chain) { const s = snap(g); if (!onLand(s.x, s.z)) return game.ui.toast('Roads must start and end on land', 'warn'); T.chain = s; T.ctrl = null; }
      else if (!T.ctrl) T.ctrl = { x: g.x, z: g.z };
      else { const s = snap(g); if (commitRoad(bezier(T.chain, T.ctrl, s))) { T.chain = s.on ? null : s; T.ctrl = null; } }
    }
  }

  // ---- zoning ------------------------------------------------------------------------------------
  let zbox = null;
  function paintCell(i, j, z) {
    const o = j * GX + i; if (!land[o] || road[o] || zone[o] === z) return;
    if (bid[o]) { const b = buildings.get(bid[o]); if (b && (b.sp || b.locked)) return; }
    undo.logZone(o, zone[o], z); zone[o] = z;
    if (bid[o]) { const b = buildings.get(bid[o]); if (b && b.zone !== z) undo.logBuilding(removeBuilding(b.id)); }
    if (i < zbox[0]) zbox[0] = i; if (j < zbox[1]) zbox[1] = j; if (i > zbox[2]) zbox[2] = i; if (j > zbox[3]) zbox[3] = j;
  }
  const paintStart = () => { zbox = [1e9, 1e9, -1e9, -1e9]; };
  function paintEnd() { if (zbox[2] >= zbox[0]) { refreshOverlay(zbox[0], zbox[1], zbox[2], zbox[3]); W.hooks.cellsChanged(zbox[0] - 1, zbox[1] - 1, zbox[2] + 1, zbox[3] + 1); } }
  function paintDisc(x, z, zid) {
    const r = T.brush * CELL * 0.5, i0 = Math.max(0, toI(x - r)), i1 = Math.min(GX - 1, toI(x + r)), j0 = Math.max(0, toJ(z - r)), j1 = Math.min(GZ - 1, toJ(z + r));
    paintStart();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(MAP.minX + (i + 0.5) * CELL - x, MAP.minZ + (j + 0.5) * CELL - z) <= r + 0.01 || T.brush === 1) paintCell(i, j, zid);
    paintEnd();
  }
  function paintRect(a, b, zid) {
    const i0 = clamp(toI(Math.min(a.x, b.x)), 0, GX - 1), i1 = clamp(toI(Math.max(a.x, b.x)), 0, GX - 1), j0 = clamp(toJ(Math.min(a.z, b.z)), 0, GZ - 1), j1 = clamp(toJ(Math.max(a.z, b.z)), 0, GZ - 1);
    paintStart(); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) paintCell(i, j, zid); paintEnd();
  }
  function floodFill(g, zid) {
    const si = toI(g.x), sj = toJ(g.z); if (!inGrid(si, sj)) return;
    const s0 = sj * GX + si; if (!land[s0] || road[s0]) return game.ui.toast('Click inside a block, not on a road', 'warn');
    const seen = new Set([s0]), q = [s0], LIMIT = 9000;
    for (let h = 0; h < q.length; h++) {
      const o = q[h], i = o % GX, j = (o - i) / GX;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj; if (!inGrid(ni, nj)) continue; const no = nj * GX + ni;
        if (seen.has(no) || !land[no] || road[no]) continue; seen.add(no); q.push(no);
        if (q.length > LIMIT) return game.ui.toast('This area is not enclosed by roads', 'warn');
      }
    }
    undo.begin('zone'); paintStart(); for (const o of q) paintCell(o % GX, Math.floor(o / GX), zid); paintEnd(); undo.commit();
  }

  // ---- bulldoze ----------------------------------------------------------------------------------
  function bulldozeAt(cx, cy, g) {
    const b = pickBuilding(cx, cy);
    undo.begin('bulldoze');
    if (b) undo.logBuilding(removeBuilding(b.id));
    else if (g) { const s = roads.nearestSeg(g.x, g.z, clamp(rig.dist * 0.012, 8, 30)); if (s) roads.removeRaw(s.seg.id); }
    undo.commit();
  }
  // prebuilt circuit laid along existing streets when the click is inside a street grid
  let loopKey = '', loopVal = null;
  function streetLoop(x0, z0) { const cx = Math.round(x0 / 48) * 48, cz = Math.round(z0 / 48) * 48, key = cx + ',' + cz + ',' + roads.segs.size; if (key === loopKey) return loopVal; loopKey = key; return (loopVal = streetLoopRaw(cx, cz)); }
  function streetLoopRaw(cx, cz) { const k = Math.max(game.mapK || 1, 0.6), a = 560 * k, b = 300 * k; return game.life.snapLoop([cx - a, cz - b, cx, cz - b, cx + a, cz - b, cx + a, cz + b, cx, cz + b, cx - a, cz + b], 170); }
  function bulldozeRect(a, b) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    undo.begin('bulldoze');
    const ids = new Set();
    for (let j = clamp(toJ(z0), 0, GZ - 1); j <= clamp(toJ(z1), 0, GZ - 1); j++) for (let i = clamp(toI(x0), 0, GX - 1); i <= clamp(toI(x1), 0, GX - 1); i++) if (bid[j * GX + i]) ids.add(bid[j * GX + i]);
    let kept = 0; for (const id of ids) { if (buildings.get(id)?.locked) { kept++; continue; } undo.logBuilding(removeBuilding(id)); }
    if (kept) game.ui.toast(`${kept} historic building${kept === 1 ? '' : 's'} kept. Unlock or click to remove.`);
    for (const id of roads.near(x0, z0, x1, z1)) { const s = roads.segs.get(id), bb = s.bbox; if (bb[0] >= x0 && bb[2] <= x1 && bb[1] >= z0 && bb[3] <= z1) roads.removeRaw(id); }
    undo.commit();
  }

  // ---- hover / preview refresh (once per frame) ---------------------------------------------------
  function refreshHover() {
    if (!hoverDirty) return; hoverDirty = false;
    const h = (T.hover = groundAt(lastPtr.x, lastPtr.y));
    terrainU.uBrush.value.w = 0; terrainU.uRectOn.value = 0;
    if (T.tool === 'road') updateRoadPreview(); else { clearPreview(); const rs = T.tool === 'inspect' && T.roadSel && roads.segs.get(T.roadSel); if (rs) addPreview(rs.pts, ROAD_TYPES[rs.type].half, true); }
    if (T.tool === 'zone' && h) {
      terrainU.uPrevCol.value.set(T.zoneId ? ZONES[T.zoneId].color : '#d2533c');
      if (drag && drag.mode === 'zrect') { terrainU.uRect.value.set(Math.min(drag.a.x, h.x), Math.min(drag.a.z, h.z), Math.max(drag.a.x, h.x), Math.max(drag.a.z, h.z)); terrainU.uRectOn.value = 1; }
      else if (T.zoneMode === 'brush') terrainU.uBrush.value.set(h.x, h.z, T.brush * CELL * 0.5, 1);
      else if (T.zoneMode === 'fill') terrainU.uBrush.value.set(h.x, h.z, 6, 1);
    }
    if (T.tool === 'bulldoze') {
      if (drag && drag.mode === 'brect' && drag.moved && h) { terrainU.uPrevCol.value.set('#d2533c'); terrainU.uRect.value.set(Math.min(drag.a.x, h.x), Math.min(drag.a.z, h.z), Math.max(drag.a.x, h.x), Math.max(drag.a.z, h.z)); terrainU.uRectOn.value = 1; highlight(null); }
      else {
        const b = pickBuilding(lastPtr.x, lastPtr.y); highlight(b, true);
        if (!b && h) { const s = roads.nearestSeg(h.x, h.z, clamp(rig.dist * 0.012, 8, 30)); if (s) { const Tt = ROAD_TYPES[s.seg.type]; addPreview(s.seg.pts, Tt.half + Tt.walk, false); } }
      }
    } else if (T.tool === 'build') buildHover(h);
    else if (T.tool === 'lock' || T.tool === 'disaster') {
      if (drag && drag.mode === 'lrect' && drag.moved && h) { terrainU.uPrevCol.value.set('#dcb466'); terrainU.uRect.value.set(Math.min(drag.a.x, h.x), Math.min(drag.a.z, h.z), Math.max(drag.a.x, h.x), Math.max(drag.a.z, h.z)); terrainU.uRectOn.value = 1; highlight(null); }
      else highlight(pickBuilding(lastPtr.x, lastPtr.y), T.tool === 'disaster');
    } else highlight(T.selected && buildings.has(T.selected.id) ? T.selected : null);
    if (T.tool === 'terrain' && h) {
      terrainU.uPrevCol.value.set(T.terraMode === 'dig' ? '#5b8fa8' : '#dcb466');
      if (T.terraMode === 'pier') { if (drag && drag.mode === 'pier') addPreview([drag.a.x, drag.a.z, h.x, h.z], Math.max(12, T.terraSize * 0.35)); else terrainU.uBrush.value.set(h.x, h.z, Math.max(12, T.terraSize * 0.35), 1); }
      else terrainU.uBrush.value.set(h.x, h.z, T.terraSize, 1);
    }
    if (T.tool === 'transit' && h) {
      const s = snapStop(h); if (T.lineDraft && T.lineDraft.length >= 2) { const d = T.lineDraft.slice(); if (s) d.push(s.x, s.z); if (d.length >= 4) addPreview(d, 3, true); }
      if (s) addPreview([s.x - 5, s.z, s.x + 5, s.z], 5, true); else addPreview([h.x - 4, h.z, h.x + 4, h.z], 4, false);
    }
    if (T.tool === 'hood' && h) { terrainU.uPrevCol.value.set('#dcb466'); terrainU.uBrush.value.set(h.x, h.z, T.hoodSize, 1); }
  }
  // ---- structures ---------------------------------------------------------------------------------
  // A structure snaps to face the nearest street, set back from the kerb. Q and E turn it 15 degrees from there, T a quarter turn.
  // Hold Shift to place it freely at the angle set with T, Q and E.
  const FRONT_ANG = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  function lotAt(h) {
    const k = T.buildKey, c = CAT[k]; if (!c || c.rect) return null;
    if (!c.fixed && T.buildSnap && !keys.has('ShiftLeft') && !keys.has('ShiftRight')) { const L = snapToStreet(game, k, h.x, h.z, 70, T.buildTurn + (T.buildRot !== 2 ? (T.buildRot - 2) * Math.PI / 2 : 0)); if (L) { L.snapped = true; return L; } }
    if (c.fixed) { const [w, d] = dimsOf(k, T.buildRot); return { i: toI(h.x) - (w >> 1), j: toJ(h.z) - (d >> 1), w, d, front: T.buildRot, yaw: 0 }; }
    return turnedLot(k, h.x, h.z, FRONT_ANG[T.buildRot] + T.buildTurn);
  }
  const lotBad = (k, l) => checkPlace(k, l.i, l.j, l.w, l.d, false, l.yaw ? l.cells : null);
  function buildHover(h) {
    highlight(null); if (!h) return; const k = T.buildKey;
    if (k === 'smartfill' || (CAT[k] && CAT[k].rect)) {
      terrainU.uPrevCol.value.set(k === 'smartfill' ? '#dcb466' : '#8fc27a');
      if (drag && (drag.mode === 'srect' || drag.mode === 'fillrect')) { terrainU.uRect.value.set(Math.min(drag.a.x, h.x), Math.min(drag.a.z, h.z), Math.max(drag.a.x, h.x), Math.max(drag.a.z, h.z)); terrainU.uRectOn.value = 1; }
      else terrainU.uBrush.value.set(h.x, h.z, 6, 1); return;
    }
    if (k === 'circuit') { const pts = T.circuitMode === 'prebuilt' ? (streetLoop(h.x, h.z) || prebuiltCircuit(h.x, h.z)) : T.circuitDraft ? T.circuitDraft.concat([h.x, h.z]) : null; if (pts && pts.length >= 4) addPreview(T.circuitMode === 'prebuilt' ? pts.concat([pts[0], pts[1]]) : pts, 7, circuitOk(pts)); else terrainU.uBrush.value.set(h.x, h.z, 8, 1); return; }
    const l = lotAt(h); if (!l) return; const c = CAT[k], bad = !!lotBad(k, l), yaw = l.yaw || 0;
    const w = (yaw ? l.mw : l.w) * CELL, d = (yaw ? l.md : l.d) * CELL, mx = yaw ? l.cx : MAP.minX + l.i * CELL + w / 2, mz = yaw ? l.cz : MAP.minZ + l.j * CELL + d / 2, y0 = Math.max(heightAt(mx, mz), 0) - 1, y1 = y0 + Math.min(c.h, 60) + 2;
    hl.position.set(mx, (y0 + y1) / 2, mz); hl.scale.set(w, y1 - y0, d); hl.rotation.y = -yaw; hl.visible = true; boxMat.color.set(bad ? 0xd2533c : 0x8fc27a); hlEdges.material.color.set(bad ? 0xf08a70 : 0xc8e6b8);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), f0x = [0, 1, 0, -1][l.front], f0z = [-1, 0, 1, 0][l.front], fx = cy * f0x - sy * f0z, fz = sy * f0x + cy * f0z, reach = ((l.front & 1 ? w : d) / 2) + 3, cx = mx + fx * reach, cz = mz + fz * reach; addPreview([cx - fz * 4 - fx * 2, cz + fx * 4 - fz * 2, cx - fz * -4 - fx * 2, cz + fx * -4 - fz * 2], 1.5, !bad); // entrance side
  }
  function buildClick(g) {
    const k = T.buildKey;
    if (k === 'circuit') {
      if (T.circuitMode === 'prebuilt') { const pts = streetLoop(g.x, g.z) || prebuiltCircuit(g.x, g.z); if (!circuitOk(pts)) return game.ui.toast('The circuit needs dry land all the way round', 'warn'); setCircuit(pts); }
      else { const d = T.circuitDraft || (T.circuitDraft = []); if (d.length >= 8 && Math.hypot(g.x - d[0], g.z - d[1]) < 60) return api.finish(); d.push(Math.round(g.x), Math.round(g.z)); }
      return;
    }
    const l = lotAt(g); if (!l) return; undo.begin('build'); const b = placeLot(game, k, l); undo.commit(); if (b) { if (CAT[k].cat === 'landmark') game.ui.toast(`${nm(CAT[k].name)} built`, 'gold'); if (game.react) game.react(b); }
  }
  function buildRect(a, g) {
    const i0 = clamp(toI(Math.min(a.x, g.x)), 0, GX - 1), i1 = clamp(toI(Math.max(a.x, g.x)), 0, GX - 1), j0 = clamp(toJ(Math.min(a.z, g.z)), 0, GZ - 1), j1 = clamp(toJ(Math.max(a.z, g.z)), 0, GZ - 1);
    undo.begin('build'); place(game, T.buildKey, i0, j0, i1 - i0 + 1, j1 - j0 + 1, 2); undo.commit();
  }
  // ---- transit ------------------------------------------------------------------------------------
  function snapStop(h) {
    if (T.lineType === 'ferry') { const d = coastDist(h.x, h.z); return Math.abs(d) < 110 ? { x: Math.round(h.x), z: Math.round(h.z) } : null; }
    const s = roads.nearestSeg(h.x, h.z, 70); return s && s.seg.type !== 'highway' ? { x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10 } : null;
  }
  function transitClick(g) {
    const s = snapStop(g); if (!s) return game.ui.toast(T.lineType === 'ferry' ? 'Ferry stops go on the shore' : 'Stops go on a street', 'warn');
    const d = T.lineDraft || (T.lineDraft = []); if (d.length >= 2 && Math.hypot(s.x - d[d.length - 2], s.z - d[d.length - 1]) < 30) return api.finish();
    if (d.length >= 60) return game.ui.toast('A line can have 30 stops', 'warn'); d.push(s.x, s.z);
  }
  const copyLines = () => city.lines.map((l) => ({ id: l.id, type: l.type, name: l.name, color: l.color, stops: l.stops.slice() }));
  undo.setLines = (ls) => { city.lines = ls.map((l) => ({ ...l, stops: l.stops.slice() })); game.life.rebuildTransit(); markDirty(); game.ui.refresh(true); };
  function finishLine() {
    const d = T.lineDraft; T.lineDraft = null; if (!d || d.length < 4) return;
    let len = 0; for (let k = 2; k < d.length; k += 2) len += Math.hypot(d[k] - d[k - 2], d[k + 1] - d[k - 1]);
    const cost = ({ bus: 4, cable: 30, metro: 120, ferry: 40 }[T.lineType] * (len / 1000) + (d.length / 2) * 3) * priceIndex(); if (!canAfford(cost)) return game.ui.toast(`Not enough in the treasury (${money(cost)})`, 'warn');
    const before = copyLines(), same = city.lines.filter((l) => l.type === T.lineType).length, names = LINE_NAMES[T.lineType];
    city.lines.push({ id: city.nextLine++, type: T.lineType, name: names[same] || `${LINE_TYPES[T.lineType].name} ${same + 1}`, color: T.lineType === 'cable' ? '#8a2f2a' : LINE_COLS[(city.nextLine + 6) % LINE_COLS.length], stops: d });
    spend(cost); undo.begin('transit line'); undo.logLines(before, copyLines()); undo.commit(); game.life.rebuildTransit(); markDirty(); game.ui.toast(`${city.lines[city.lines.length - 1].name} is running`);
  }
  function removeLine(id) { const before = copyLines(); city.lines = city.lines.filter((l) => l.id !== id); undo.begin('remove line'); undo.logLines(before, copyLines()); undo.commit(); game.life.rebuildTransit(); markDirty(); }
  // ---- historic locks and disasters ----------------------------------------------------------------
  function lockRect(a, g) {
    const on = T.lockMode === 'lock', ids = new Set(); let n = 0;
    for (let j = clamp(toJ(Math.min(a.z, g.z)), 0, GZ - 1); j <= clamp(toJ(Math.max(a.z, g.z)), 0, GZ - 1); j++) for (let i = clamp(toI(Math.min(a.x, g.x)), 0, GX - 1); i <= clamp(toI(Math.max(a.x, g.x)), 0, GX - 1); i++) if (bid[j * GX + i]) ids.add(bid[j * GX + i]);
    for (const id of ids) { const b = buildings.get(id); if (b && !b.sp && !!b.locked !== on) { if (on) b.locked = true; else delete b.locked; n++; } }
    game.ui.toast(n ? `${n} building${n === 1 ? '' : 's'} ${on ? 'locked as historic' : 'unlocked'}` : 'Nothing to change here');
  }
  void [refreshHover];

  // ---- pointer events ----------------------------------------------------------------------------
  function gestureStart() {
    const [a, b] = [...touches.values()];
    gesture = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    if (drag && drag.mode === 'brush') undo.commit(); drag = null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); lastPtr = { x: e.clientX, y: e.clientY }; hoverDirty = true;
    if (e.pointerType === 'touch') { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (touches.size === 2) return gestureStart(); if (touches.size > 2) return; }
    const g = groundAt(e.clientX, e.clientY), base = { sx: e.clientX, sy: e.clientY, moved: false, btn: e.button };
    if (e.button === 2) drag = { ...base, mode: 'rotate' };
    else if (e.button === 1 || (e.button === 0 && (keys.has('Space') || T.tool === 'inspect'))) drag = { ...base, mode: 'pan', p: planeAt(e.clientX, e.clientY, rig.target.y), click: e.button === 0 && !keys.has('Space') };
    else if (e.button === 0 && g) {
      const shut = !g.water && ['road', 'zone', 'build', 'transit', 'terrain'].includes(T.tool) && lockedAt(g.x, g.z);
      if (shut) { game.ui.toast(`${shut.name} opens at ${shut.at.toLocaleString('en-US')} residents`, 'warn'); return; }
      if (T.tool === 'road') drag = T.roadMode === 'copy' && !T.clip ? { ...base, mode: 'crect', a: g } : { ...base, mode: 'click' };
      else if (T.tool === 'zone') {
        if (T.zoneMode === 'brush') { undo.begin('zone'); paintDisc(g.x, g.z, T.zoneId); drag = { ...base, mode: 'brush', last: g }; }
        else if (T.zoneMode === 'rect') drag = { ...base, mode: 'zrect', a: g };
        else drag = { ...base, mode: 'click' };
      } else if (T.tool === 'bulldoze') drag = { ...base, mode: 'brect', a: g };
      else if (T.tool === 'build') { const c = CAT[T.buildKey]; drag = T.buildKey === 'smartfill' ? { ...base, mode: 'fillrect', a: g } : c && c.rect ? { ...base, mode: 'srect', a: g } : { ...base, mode: 'click' }; }
      else if (T.tool === 'transit' || T.tool === 'disaster') drag = { ...base, mode: 'click' };
      else if (T.tool === 'lock') drag = { ...base, mode: 'lrect', a: g };
      else if (T.tool === 'terrain') drag = T.terraMode === 'pier' ? { ...base, mode: 'pier', a: g } : { ...base, mode: 'sculpt', acc: 1 };
      else if (T.tool === 'hood') { paintHood(g.x, g.z, T.hoodSize, T.hoodId); drag = { ...base, mode: 'hpaint' }; }
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const dx = e.clientX - lastPtr.x, dy = e.clientY - lastPtr.y; lastPtr = { x: e.clientX, y: e.clientY }; hoverDirty = true;
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && gesture) {
        const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const p0 = planeAt(gesture.mx, gesture.my, rig.target.y), p1 = planeAt(mx, my, rig.target.y);
        if (p0 && p1) { rig.panImmediate(p0.x - p1.x, p0.z - p1.z); rig.apply(); }
        if (d > 10 && gesture.d > 10) rig.zoom(gesture.d / d, null);
        let da = ang - gesture.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; rig.rotate(-da, 0);
        gesture = { d, ang, mx, my }; return;
      }
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
    if (drag.mode === 'rotate') rig.rotate(-dx * 0.006, dy * 0.005);
    else if (drag.mode === 'pan' && drag.moved && drag.p) { const p = planeAt(e.clientX, e.clientY, rig.target.y); if (p) { rig.panImmediate(drag.p.x - p.x, drag.p.z - p.z); rig.apply(); } }
    else if (drag.mode === 'hpaint') { const g = groundAt(e.clientX, e.clientY); if (g) { paintHood(g.x, g.z, T.hoodSize, T.hoodId); game.ui.refresh(true); } }
    else if (drag.mode === 'brush') {
      const g = groundAt(e.clientX, e.clientY); if (!g) return;
      const l = drag.last, n = Math.max(1, Math.ceil(Math.hypot(g.x - l.x, g.z - l.z) / (CELL * 0.75)));
      for (let k = 1; k <= n; k++) paintDisc(l.x + ((g.x - l.x) * k) / n, l.z + ((g.z - l.z) * k) / n, T.zoneId);
      drag.last = g;
    }
  });
  function end(e) {
    if (e.pointerType === 'touch') { touches.delete(e.pointerId); if (touches.size < 2) gesture = null; }
    const d = drag; drag = null; hoverDirty = true; if (!d) return;
    const g = groundAt(e.clientX, e.clientY);
    if (d.mode === 'brush') undo.commit();
    else if (d.mode === 'rotate') { if (!d.moved && T.tool === 'road') { T.chain = null; T.ctrl = null; } }
    else if (d.mode === 'pan') { if (!d.moved && d.click) { T.selected = pickBuilding(e.clientX, e.clientY); if (T.selected || !g) game.ui.showInfo(T.selected); else { const n = roads.nearestSeg(g.x, g.z, clamp(rig.dist * 0.02, 8, 30)); if (n && game.ui.showRoad) { T.roadSel = n.seg.id; game.ui.showRoad(n.seg.id); } else game.ui.showInfo(null); } } }
    else if (d.mode === 'crect') { if (g && d.moved) copyRect(d.a, g); }
    else if (d.mode === 'zrect') { if (g) { undo.begin('zone'); paintRect(d.a, g, T.zoneId); undo.commit(); } }
    else if (d.mode === 'brect') { if (d.moved && g && Math.hypot(g.x - d.a.x, g.z - d.a.z) > 6) bulldozeRect(d.a, g); else bulldozeAt(e.clientX, e.clientY, g); }
    else if (d.mode === 'srect') { if (g && d.moved) buildRect(d.a, g); }
    else if (d.mode === 'fillrect') { if (g && d.moved) { const n = smartFill(game, d.a, g, T.fill.items, T.fill.density); game.ui.toast(n ? `Smart-fill placed ${n} item${n === 1 ? '' : 's'}` : 'No empty land in that area', n ? '' : 'warn'); } }
    else if (d.mode === 'pier') { if (g && Math.hypot(g.x - d.a.x, g.z - d.a.z) > 20) { if (!pier(game, d.a, g, Math.max(12, T.terraSize * 0.35))) game.ui.toast('Nothing to fill there', 'warn'); } }
    else if (d.mode === 'lrect') {
      if (d.moved && g && Math.hypot(g.x - d.a.x, g.z - d.a.z) > 6) lockRect(d.a, g);
      else { const b = pickBuilding(e.clientX, e.clientY); if (b && !b.sp) { if (b.locked) delete b.locked; else b.locked = true; game.ui.toast(b.locked ? 'Locked as historic. It will not be redeveloped.' : 'Unlocked'); } }
    }
    else if (d.mode === 'click' && !d.moved && g) {
      if (T.tool === 'road') roadClick(g); else if (T.tool === 'zone') floodFill(g, T.zoneId); else if (T.tool === 'build') buildClick(g); else if (T.tool === 'transit') transitClick(g);
      else if (T.tool === 'disaster') { const b = pickBuilding(e.clientX, e.clientY); if (b && ignite(b)) game.ui.toast('Fire started'); else game.ui.toast('Click a building to set it alight', 'warn'); }
    }
    game.ui.refresh();
  }
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = setRay(e.clientX, e.clientY).direction;
    const trackpad = e.wheelDeltaY ? e.wheelDeltaY === -3 * e.deltaY : e.deltaMode === 0;
    const k = e.deltaMode === 1 ? 33 : 1;
    if (e.ctrlKey || e.metaKey) rig.zoom(Math.exp(clamp(e.deltaY * k, -60, 60) * 0.011), r);
    else if (T.scroll === 'zoom' || (T.scroll === 'auto' && !trackpad)) rig.zoom(Math.exp(clamp(e.deltaY * k, -240, 240) * 0.0014), r);
    else {
      const s = (rig.dist * 2 * Math.tan((camera.fov * Math.PI) / 360)) / canvas.clientHeight, fy = 1 / Math.max(Math.sin(rig.pitch), 0.35);
      const cy = Math.cos(rig.yaw), sy = Math.sin(rig.yaw), ax = e.deltaX * k * s, ay = e.deltaY * k * s * fy;
      rig.panWorld(cy * ax + sy * ay, -sy * ax + cy * ay);
    }
    hoverDirty = true;
  }, { passive: false });

  // ---- keyboard ----------------------------------------------------------------------------------
  // While a single building is being placed, Q/E turn that building instead of the camera.
  const turnsBuilding = () => { if (T.tool !== 'build') return false; const c = CAT[T.buildKey]; return !!c && !c.rect && T.buildKey !== 'smartfill' && T.buildKey !== 'circuit'; };
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  window.addEventListener('keydown', (e) => {
    if (typing(e) || game.modalOpen()) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.code === 'KeyZ') { e.preventDefault(); game.doUndo(e.shiftKey); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); game.doUndo(true); return; }
    if (mod) return;
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
    if (e.code === 'Escape') { if (T.chain) { T.chain = null; T.ctrl = null; } else if (T.tool === 'road' && T.roadMode === 'copy' && T.clip) { T.clip = null; game.ui.refresh(true); } else if (T.lineDraft || T.circuitDraft) { T.lineDraft = null; T.circuitDraft = null; } else if (T.selected) { T.selected = null; game.ui.showInfo(null); } else api.setTool('inspect'); hoverDirty = true; }
    const tool = { Digit1: 'inspect', Digit2: 'road', Digit3: 'zone', Digit4: 'bulldoze', Digit5: 'build', Digit6: 'transit', Digit7: 'terrain' }[e.code]; if (tool) api.setTool(tool);
    if (e.code === 'KeyT' && T.tool === 'build') { T.buildRot = (T.buildRot + 1) & 3; hoverDirty = true; game.ui.refresh(true); }
    if ((e.code === 'KeyQ' || e.code === 'KeyE') && turnsBuilding()) { const st = Math.PI / 12; T.buildTurn = Math.round((T.buildTurn + (e.code === 'KeyE' ? st : -st)) / st) * st; if (Math.abs(T.buildTurn) > Math.PI - 0.01) T.buildTurn = 0; hoverDirty = true; game.ui.refresh(true); }
    if (e.code.startsWith('Shift') && T.tool === 'build') hoverDirty = true;
    if (e.code === 'KeyT' && T.tool === 'road' && (T.roadMode === 'blocks' || T.roadMode === 'copy')) { T.stampRot = (T.stampRot + 1) & 3; hoverDirty = true; }
    if (e.code === 'Enter') api.finish();
    if (e.code === 'KeyH') game.ui.toggleHud && game.ui.toggleHud();
    if (e.code === 'KeyP') game.setSpeed(game.speed ? 0 : game.lastSpeed || 1);
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code.startsWith('Shift') && T.tool === 'build') hoverDirty = true; });
  window.addEventListener('blur', () => keys.clear());

  const api = {
    state: T,
    setTool(t) { if (game.readOnly) t = 'inspect'; if (T.lineDraft && T.lineDraft.length >= 4 && t !== 'transit') finishLine(); T.tool = t; T.chain = null; T.ctrl = null; T.lineDraft = null; T.circuitDraft = null; drag = null; hoverDirty = true; canvas.style.cursor = t === 'inspect' ? 'grab' : 'crosshair'; game.ui.refresh(); },
    finish() { if (T.tool === 'transit') finishLine(); else if (T.tool === 'build' && T.buildKey === 'circuit' && T.circuitDraft) { const d = T.circuitDraft; T.circuitDraft = null; if (d.length < 8) game.ui.toast('A circuit needs at least 4 corners', 'warn'); else if (!circuitOk(d)) game.ui.toast('The circuit needs dry land all the way round', 'warn'); else setCircuit(game.life.snapLoop(d, 60) || d); } hoverDirty = true; game.ui.refresh(true); },
    removeLine, siteBuild(key) { const s = siteOf(key); if (!s) return null; undo.begin('build'); const b = placeAtSite(game, key, s); undo.commit(); if (b && game.react) game.react(b); if (b) { game.ui.toast(`${nm(CAT[key].name)} built at its real site`, 'gold'); rig.set(s.x, s.z, Math.max(700, CAT[key].h * 5), rig.gYaw, 0.5, false); } return b; },
    cancel() { T.chain = null; T.ctrl = null; hoverDirty = true; },
    touch() { hoverDirty = true; }, retype,
    update(dt) {
      // WASD / arrows pan, Q E rotate, R F tilt, + - zoom
      const sp = rig.dist * 1.1 * dt, cy = Math.cos(rig.gYaw), sy = Math.sin(rig.gYaw);
      let f = 0, s = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
      if (f || s) { rig.panWorld((cy * s - sy * f) * sp, (-sy * s - cy * f) * sp); hoverDirty = true; }
      if (!turnsBuilding()) { if (keys.has('KeyQ')) { rig.rotate(1.6 * dt, 0); hoverDirty = true; } if (keys.has('KeyE')) { rig.rotate(-1.6 * dt, 0); hoverDirty = true; } }
      if (keys.has('KeyR')) rig.rotate(0, 0.9 * dt); if (keys.has('KeyF')) rig.rotate(0, -0.9 * dt);
      if (keys.has('Equal') || keys.has('NumpadAdd')) rig.zoom(Math.exp(-1.6 * dt), null); if (keys.has('Minus') || keys.has('NumpadSubtract')) rig.zoom(Math.exp(1.6 * dt), null);
      if (drag && drag.mode === 'sculpt') { drag.acc += dt; if (drag.acc > 0.07) { const h = groundAt(lastPtr.x, lastPtr.y); if (h) terraform(game, h.x, h.z, T.terraSize, T.terraMode, T.terraMode === 'flatten' ? 1 : 1.5 * (drag.acc / 0.07) * 0.5); drag.acc = 0; hoverDirty = true; } }
      refreshHover();
      terrainU.uGrid.value = T.tool === 'zone' || T.tool === 'road' || T.tool === 'build' ? 1 : 0;
      terrainU.uShowDev.value = T.tool === 'zone' ? 0.5 : 0; terrainU.uShowEmpty.value = T.tool === 'zone' ? 0.72 : 0.17;
    },
    groundAt, pickBuilding,
  };
  return api;
}
