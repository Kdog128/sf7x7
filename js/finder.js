// Highlight structures by type: a light beam over every club, venue, stadium and so on, with a count and a way to jump between them.
import * as THREE from 'three';
import { MAP, heightAt } from './terrain.js';
import { CELL, buildings } from './world.js';
import { CAT } from './structures.js';

export const FIND = [
  { k: 'clubs', name: 'Nightclubs', color: '#d36be0', has: (c) => ['club', 'superclub', 'popup'].includes(c.k) },
  { k: 'music', name: 'Music venues', color: '#f0a43a', has: (c) => c.k === 'musicvenue' },
  { k: 'comedy', name: 'Comedy clubs', color: '#f2dc6a', has: (c) => c.k === 'comedy' },
  { k: 'bars', name: 'Bars and jazz', color: '#4fb8c8', has: (c) => ['bar', 'jazzbar', 'beergarden'].includes(c.k) },
  { k: 'casino', name: 'Casinos and theaters', color: '#e0b040', has: (c) => ['casino', 'cinema'].includes(c.k) },
  { k: 'sport', name: 'Sports', color: '#4fb0ea', has: (c) => c.cat === 'sport' },
  { k: 'landmark', name: 'Landmarks', color: '#f4d9a0', has: (c) => c.cat === 'landmark' },
  { k: 'service', name: 'Services', color: '#6fd396', has: (c) => c.cat === 'service' },
  { k: 'park', name: 'Parks and plazas', color: '#9fd27a', has: (c) => ['park', 'plaza', 'fountain'].includes(c.k) },
];
const MAX = 400;
const centre = (b) => b.yaw ? [b.cx, b.cz] : [MAP.minX + (b.i + b.w / 2) * CELL, MAP.minZ + (b.j + b.d / 2) * CELL];

export function makeFinder(game) {
  const on = new Set();
  const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true); geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const beams = new THREE.InstancedMesh(geo, mat, MAX); beams.count = 0; beams.frustumCulled = false; beams.renderOrder = 6;
  const ringGeo = new THREE.RingGeometry(0.82, 1, 32); ringGeo.rotateX(-Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide }), MAX); rings.count = 0; rings.frustumCulled = false; rings.renderOrder = 6;
  game.scene.add(beams, rings);
  let hits = [], acc = 9, cursor = -1, lastDist = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();

  function collect() {
    hits = [];
    if (!on.size) return;
    const groups = FIND.filter((g) => on.has(g.k));
    for (const b of buildings.values()) { if (!b.sp) continue; const c = CAT[b.sp]; if (!c) continue; const g = groups.find((gr) => gr.has(c)); if (g) hits.push({ b, g }); }
  }
  function draw() {
    const dist = game.rig.dist, w = Math.max(3, dist * 0.0045), n = Math.min(MAX, hits.length);
    for (let k = 0; k < n; k++) {
      const { b, g } = hits[k], [x, z] = centre(b), y = Math.max(heightAt(x, z), 0), top = (b.height || 10) * 1.3 + Math.max(90, dist * 0.18), foot = Math.max(((b.yaw ? Math.max(b.mw, b.md) : Math.max(b.w, b.d)) * CELL) * 0.62, w * 3.2);
      m4.compose(v.set(x, y + (b.height || 10) * 1.05, z), q, sc.set(w, top, w)); beams.setMatrixAt(k, m4); beams.setColorAt(k, col.set(g.color));
      m4.compose(v.set(x, y + 1.2, z), q, sc.set(foot, 1, foot)); rings.setMatrixAt(k, m4); rings.setColorAt(k, col.set(g.color));
    }
    beams.count = rings.count = n; beams.instanceMatrix.needsUpdate = rings.instanceMatrix.needsUpdate = true;
    if (n) { beams.instanceColor.needsUpdate = rings.instanceColor.needsUpdate = true; }
    lastDist = dist;
  }
  const api = {
    groups: FIND,
    get on() { return on; },
    toggle(k) { if (on.has(k)) on.delete(k); else on.add(k); cursor = -1; collect(); draw(); return on.has(k); },
    clear() { on.clear(); hits = []; draw(); },
    count(k) { const g = FIND.find((x) => x.k === k); let n = 0; for (const b of buildings.values()) if (b.sp && CAT[b.sp] && g.has(CAT[b.sp])) n++; return n; },
    get hits() { return hits; },
    // fly to the next highlighted structure and show its details
    next(dir = 1) {
      if (!hits.length) return null; cursor = (cursor + dir + hits.length) % hits.length; const { b } = hits[cursor], [x, z] = centre(b);
      game.rig.set(x, z, Math.max(420, (b.height || 20) * 6), game.rig.gYaw, 0.55, false);
      game.tools.state.selected = b; game.ui.showInfo(b); game.tools.touch();
      return { b, index: cursor + 1, of: hits.length };
    },
    update(dt) {
      const vis = on.size > 0 && game.mode === 'play'; beams.visible = rings.visible = vis; if (!vis) return;
      acc += dt; if (acc > 1) { acc = 0; collect(); draw(); } else if (Math.abs(game.rig.dist - lastDist) > lastDist * 0.08) draw();
      mat.opacity = 0.32 + 0.12 * Math.sin(game.clock * 2.4);
    },
  };
  return api;
}
