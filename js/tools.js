// Pointer, wheel, touch and keyboard input, plus the four tools: inspect, roads, zones, bulldoze.
import * as THREE from 'three';
import { MAP, heightAt, raycastGround } from './terrain.js';
import { CELL, GX, GZ, zone, road, bid, land, buildings, removeBuilding, refreshOverlay, ZONES, toI, toJ, inGrid, state as W } from './world.js';
import { ROAD_TYPES, previewGeometry, cumLen } from './roads.js';
import { clamp } from './util.js';

export function makeTools(game) {
  const { canvas, camera, rig, roads, undo, scene, terrainU } = game;
  const T = {
    tool: 'inspect', roadType: 'street', roadMode: 'straight', zoneId: 1, zoneMode: 'brush', brush: 3,
    snapGrid: true, snapAngle: true, blockW: 96, blockH: 176, scroll: 'auto', chain: null, ctrl: null, selected: null, hover: null,
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
    const x0 = MAP.minX + b.i * CELL, z0 = MAP.minZ + b.j * CELL, w = b.w * CELL, d = b.d * CELL, y0 = b.baseY - 2, y1 = b.baseY + b.height + 2.5;
    hl.position.set(x0 + w / 2, (y0 + y1) / 2, z0 + d / 2); hl.scale.set(w, y1 - y0, d); hl.visible = true;
    boxMat.color.set(red ? 0xd2533c : 0xe9d9a8); hlEdges.material.color.set(red ? 0xf08a70 : 0xf2e6c2);
  }

  // ---- snapping ----------------------------------------------------------------------------------
  function snap(p, from) {
    const R = clamp(rig.dist * 0.014, 7, 34);
    const n = roads.nearestNode(p.x, p.z, R); if (n) return { x: n.x, z: n.z, on: 'node' };
    const s = roads.nearestSeg(p.x, p.z, R * 0.75); if (s) return { x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10, on: 'road' };
    let x = p.x, z = p.z;
    const Tt = ROAD_TYPES[T.roadType], offs = Tt.cells % 2 ? CELL / 2 : 0;
    if (T.snapGrid) { x = Math.round((x - offs) / CELL) * CELL + offs; z = Math.round((z - offs) / CELL) * CELL + offs; }
    if (from && T.snapAngle) {
      const dx = x - from.x, dz = z - from.z, len = Math.hypot(dx, dz), a = Math.atan2(dz, dx), step = Math.PI / 12, sa = Math.round(a / step) * step;
      if (len > 1 && Math.abs(a - sa) < 0.07) { const l = len * Math.cos(a - sa); x = from.x + Math.cos(sa) * l; z = from.z + Math.sin(sa) * l; }
    }
    return { x, z, on: null };
  }
  const bezier = (a, c, b) => { const len = Math.hypot(c.x - a.x, c.z - a.z) + Math.hypot(b.x - c.x, b.z - c.z), n = clamp(Math.ceil(len / 9), 6, 60), out = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.z + 2 * u * t * c.z + t * t * b.z); } return out; };
  const onLand = (x, z) => x > MAP.minX + 8 && x < MAP.maxX - 8 && z > MAP.minZ + 8 && z < MAP.maxZ - 8 && heightAt(x, z) >= 0.55;

  // Street grid between two corners. Lines are trimmed back to land at the shore.
  function gridLines(a, b) {
    const sx = b.x >= a.x ? 1 : -1, sz = b.z >= a.z ? 1 : -1;
    const nx = Math.max(1, Math.round(Math.abs(b.x - a.x) / T.blockW)), nz = Math.max(1, Math.round(Math.abs(b.z - a.z) / T.blockH));
    const lines = [], x1 = a.x + sx * nx * T.blockW, z1 = a.z + sz * nz * T.blockH;
    const trim = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 8); let i0 = 0, i1 = n;
      const P = (i) => [ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n];
      while (i0 < n && !onLand(...P(i0))) i0++; while (i1 > i0 && !onLand(...P(i1))) i1--;
      if (i1 - i0 >= 2) lines.push([...P(i0), ...P(i1)]);
    };
    for (let k = 0; k <= nx; k++) trim(a.x + sx * k * T.blockW, a.z, a.x + sx * k * T.blockW, z1);
    for (let k = 0; k <= nz; k++) trim(a.x, a.z + sz * k * T.blockH, x1, a.z + sz * k * T.blockH);
    return lines;
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
    if (T.roadMode === 'grid') {
      if (drag && drag.mode === 'grid') for (const l of gridLines(drag.a, snap(h))) addPreview(l, half);
      else { const s = snap(h); addPreview([s.x - 3, s.z, s.x + 3, s.z], 3, onLand(s.x, s.z)); }
      return;
    }
    if (!T.chain) { const s = snap(h); addPreview([s.x - 2, s.z, s.x + 2, s.z], half, onLand(s.x, s.z)); return; }
    const s = snap(h, T.roadMode === 'straight' ? T.chain : null);
    let pts;
    if (T.roadMode === 'curve' && T.ctrl) pts = bezier(T.chain, T.ctrl, s); else pts = [T.chain.x, T.chain.z, s.x, s.z];
    if (cumLen(pts).at(-1) < 2) return;
    addPreview(pts, half, !roads.validate(pts));
  }
  function roadClick(g) {
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
  function bulldozeRect(a, b) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    undo.begin('bulldoze');
    const ids = new Set();
    for (let j = clamp(toJ(z0), 0, GZ - 1); j <= clamp(toJ(z1), 0, GZ - 1); j++) for (let i = clamp(toI(x0), 0, GX - 1); i <= clamp(toI(x1), 0, GX - 1); i++) if (bid[j * GX + i]) ids.add(bid[j * GX + i]);
    for (const id of ids) undo.logBuilding(removeBuilding(id));
    for (const id of roads.near(x0, z0, x1, z1)) { const s = roads.segs.get(id), bb = s.bbox; if (bb[0] >= x0 && bb[2] <= x1 && bb[1] >= z0 && bb[3] <= z1) roads.removeRaw(id); }
    undo.commit();
  }

  // ---- hover / preview refresh (once per frame) ---------------------------------------------------
  function refreshHover() {
    if (!hoverDirty) return; hoverDirty = false;
    const h = (T.hover = groundAt(lastPtr.x, lastPtr.y));
    terrainU.uBrush.value.w = 0; terrainU.uRectOn.value = 0;
    if (T.tool === 'road') updateRoadPreview(); else clearPreview();
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
    } else highlight(T.selected && buildings.has(T.selected.id) ? T.selected : null);
  }

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
      if (T.tool === 'road') drag = T.roadMode === 'grid' ? { ...base, mode: 'grid', a: snap(g) } : { ...base, mode: 'click' };
      else if (T.tool === 'zone') {
        if (T.zoneMode === 'brush') { undo.begin('zone'); paintDisc(g.x, g.z, T.zoneId); drag = { ...base, mode: 'brush', last: g }; }
        else if (T.zoneMode === 'rect') drag = { ...base, mode: 'zrect', a: g };
        else drag = { ...base, mode: 'click' };
      } else if (T.tool === 'bulldoze') drag = { ...base, mode: 'brect', a: g };
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
    else if (d.mode === 'pan') { if (!d.moved && d.click) { T.selected = pickBuilding(e.clientX, e.clientY); game.ui.showInfo(T.selected); } }
    else if (d.mode === 'grid') { if (g) { const lines = gridLines(d.a, snap(g)); undo.begin('road grid'); let n = 0; for (const l of lines) if (roads.add(T.roadType, l).ok) n++; undo.commit(); if (!n) game.ui.toast('No room for a grid here', 'warn'); } }
    else if (d.mode === 'zrect') { if (g) { undo.begin('zone'); paintRect(d.a, g, T.zoneId); undo.commit(); } }
    else if (d.mode === 'brect') { if (d.moved && g && Math.hypot(g.x - d.a.x, g.z - d.a.z) > 6) bulldozeRect(d.a, g); else bulldozeAt(e.clientX, e.clientY, g); }
    else if (d.mode === 'click' && !d.moved && g) { if (T.tool === 'road') roadClick(g); else if (T.tool === 'zone') floodFill(g, T.zoneId); }
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
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  window.addEventListener('keydown', (e) => {
    if (typing(e) || game.modalOpen()) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.code === 'KeyZ') { e.preventDefault(); game.doUndo(e.shiftKey); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); game.doUndo(true); return; }
    if (mod) return;
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
    if (e.code === 'Escape') { if (T.chain) { T.chain = null; T.ctrl = null; } else if (T.selected) { T.selected = null; game.ui.showInfo(null); } else api.setTool('inspect'); hoverDirty = true; }
    const tool = { Digit1: 'inspect', Digit2: 'road', Digit3: 'zone', Digit4: 'bulldoze' }[e.code]; if (tool) api.setTool(tool);
    if (e.code === 'KeyP') game.setSpeed(game.speed ? 0 : game.lastSpeed || 1);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  const api = {
    state: T,
    setTool(t) { T.tool = t; T.chain = null; T.ctrl = null; drag = null; hoverDirty = true; canvas.style.cursor = t === 'inspect' ? 'grab' : 'crosshair'; game.ui.refresh(); },
    cancel() { T.chain = null; T.ctrl = null; hoverDirty = true; },
    touch() { hoverDirty = true; },
    update(dt) {
      // WASD / arrows pan, Q E rotate, R F tilt, + - zoom
      const sp = rig.dist * 1.1 * dt, cy = Math.cos(rig.gYaw), sy = Math.sin(rig.gYaw);
      let f = 0, s = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
      if (f || s) { rig.panWorld((cy * s - sy * f) * sp, (-sy * s - cy * f) * sp); hoverDirty = true; }
      if (keys.has('KeyQ')) { rig.rotate(1.6 * dt, 0); hoverDirty = true; } if (keys.has('KeyE')) { rig.rotate(-1.6 * dt, 0); hoverDirty = true; }
      if (keys.has('KeyR')) rig.rotate(0, 0.9 * dt); if (keys.has('KeyF')) rig.rotate(0, -0.9 * dt);
      if (keys.has('Equal') || keys.has('NumpadAdd')) rig.zoom(Math.exp(-1.6 * dt), null); if (keys.has('Minus') || keys.has('NumpadSubtract')) rig.zoom(Math.exp(1.6 * dt), null);
      refreshHover();
      terrainU.uGrid.value = T.tool === 'zone' || T.tool === 'road' ? 1 : 0;
      terrainU.uShowDev.value = T.tool === 'zone' ? 0.5 : 0; terrainU.uShowEmpty.value = T.tool === 'zone' ? 0.72 : 0.42;
    },
    groundAt, pickBuilding,
  };
  return api;
}
