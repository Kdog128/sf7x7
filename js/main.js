// 7x7 Phase 1: boot, main loop and the glue between systems.
import * as THREE from 'three';
import { MAP, buildTerrain, buildForests, heightAt, ll } from './terrain.js';
import { GX, GZ, zone, land, zoneTex, initLand, flushOverlay, refreshOverlay, resetWorld, stats, state as W, ZONES, tierOf, TIERS, buildings, toI, toJ, CELL } from './world.js';
import { BuildingRenderer, buildingUniforms } from './buildings.js';
import { Roads, RoadRenderer } from './roads.js';
import { Sky } from './sky.js';
import { CameraRig } from './camera.js';
import { sim, stepSim, refreshCells, resetSim, frontierSize } from './sim.js';
import { makeUndo } from './undo.js';
import { makeTools } from './tools.js';
import { makeUI } from './ui.js';
import { slots, saveSlot } from './save.js';
import { hex2lin, smoothstep, rng, clamp } from './util.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 1, 150000);

initLand();
const sky = new Sky(scene, renderer);
const terrain = buildTerrain(scene, zoneTex, GX, GZ);
terrain.uniforms.uZoneCols.value = ZONES.map((z) => new THREE.Vector3(...(z ? hex2lin(z.color) : [0, 0, 0])));
const forests = buildForests(scene);
const bRender = new BuildingRenderer(scene);
const roads = new Roads();
const rRender = new RoadRenderer(scene, roads, bRender.mat);
const rig = new CameraRig(camera);
W.hooks.chunkDirty = (c) => bRender.markDirty(c);
W.hooks.cellsChanged = refreshCells;
W.hooks.clearTrees = (x0, z0, x1, z1) => forests.clearRect(x0, z0, x1, z1);

const game = {
  canvas, renderer, scene, camera, rig, roads, terrainU: terrain.uniforms, speed: 1, lastSpeed: 1, cycle: true, mode: 'title', clock: 0,
  fixedHour: 16.2, viewHour: () => (game.cycle ? sim.time : game.fixedHour),
  setHour(h) { game.fixedHour = h % 24; if (game.cycle) sim.time = h % 24; },
  setSpeed(s) { if (s) game.lastSpeed = s; game.speed = s; game.ui.refresh(); },
  setShadows(on) { renderer.shadowMap.enabled = on; sky.sun.castShadow = on; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); },
  modalOpen: () => game.mode === 'title' || game.ui.menuOpen(),
  doUndo(redo) { const l = redo ? game.undo.redo() : game.undo.undo(); if (l) game.ui.toast(`${redo ? 'Redid' : 'Undid'} ${l}`); game.tools.touch(); game.ui.refresh(); },
  resetCity() {
    resetWorld(); roads.clear(); rRender.clear(); bRender.clear(); resetSim(); forests.reset(); game.undo.clear();
    sim.day = 1; sim.time = 10; game.tools.state.selected = null; game.tools.cancel(); game.ui.showInfo(null);
  },
  startEmpty() { game.resetCity(); const [x, z] = ll(-122.405, 37.787); rig.set(x, z, 2600, 0.5, 0.82); game.ui.resetTier(); game.ui.refresh(); },
  startDemo() { buildDemo(); game.ui.resetTier(); game.ui.refresh(); },
  begin() {
    if (game.mode === 'play') return; game.mode = 'play';
    document.getElementById('title').classList.add('out'); setTimeout(() => (document.getElementById('title').hidden = true), 520);
    document.getElementById('hud').hidden = false; game.ui.refresh(); canvas.focus();
  },
};
game.undo = makeUndo(roads);
game.ui = { toast() {}, refresh() {}, showInfo() {}, menuOpen: () => false };
game.tools = makeTools(game);
game.ui = makeUI(game);

// ---- demo district: a downtown grid on the real north-east corner of the city -------------------
function buildDemo() {
  game.resetCity();
  const X0 = 1440, Z0 = -3072, BW = 96, BH = 176, NXB = 20, NZB = 10, X1 = X0 + NXB * BW, Z1 = Z0 + NZB * BH;
  for (let k = 0; k <= NXB; k++) roads.add(k % 5 === 0 ? 'avenue' : 'street', [X0 + k * BW, Z0, X0 + k * BW, Z1]);
  for (let k = 0; k <= NZB; k++) roads.add(k % 5 === 0 ? 'avenue' : 'street', [X0, Z0 + k * BH, X1, Z0 + k * BH]);
  roads.add('boulevard', [X0, Z1 - BH * 1.5, X0 + BW * 6.5, Z1 - BH * 4.5, X0 + BW * 13.5, Z0 + BH * 2.5, X1, Z0 + BH * 1.5].map((v) => Math.round(v)));
  const cx = X0 + BW * 11, cz = Z0 + BH * 4.2, r = rng(7);
  for (let j = toJ(Z0) - 2; j <= toJ(Z1) + 2; j++) for (let i = toI(X0) - 2; i <= toI(X1) + 2; i++) {
    const o = j * GX + i; if (!land[o]) continue;
    const x = MAP.minX + (i + 0.5) * CELL, z = MAP.minZ + (j + 0.5) * CELL, d = Math.hypot(x - cx, (z - cz) * 0.8), bx = Math.floor((x - X0) / BW), bz = Math.floor((z - Z0) / BH), h = ((bx * 7 + bz * 13) % 10) / 10;
    let zid;
    if (d < 230) zid = 6; else if (d < 380) zid = h < 0.5 ? 4 : 6; else if (d < 760) zid = h < 0.12 ? 4 : h < 0.22 ? 5 : 2;
    else if (x > X1 - BW * 4 && z > Z1 - BH * 3) zid = h < 0.5 ? 8 : 7; else if (d < 1000) zid = h < 0.15 ? 3 : 2; else zid = h < 0.12 ? 3 : 1;
    zone[o] = zid;
  }
  refreshOverlay(0, 0, GX - 1, GZ - 1); refreshCells(toI(X0) - 4, toJ(Z0) - 4, toI(X1) + 4, toJ(Z1) + 4);
  const keep = sim.rand; sim.rand = r;
  for (let k = 0; k < 2600; k++) stepSim(1, -100);
  sim.rand = keep; sim.time = 13.5; game.undo.clear();
  rig.set(cx + 60, cz + 120, 1350, 0.62, 0.42);
}

// ---- frame ---------------------------------------------------------------------------------------
function litFractions(h) {
  const t = h < 12 ? h + 24 : h;
  const home = 0.05 + 0.36 * smoothstep(16.5, 19.5, t) * (1 - smoothstep(22, 26.5, t)) + 0.22 * smoothstep(29.3, 30.3, t) * (1 - smoothstep(31, 32, t));
  const office = 0.04 + 0.5 * smoothstep(15.5, 17.5, t) * (1 - smoothstep(19, 24.5, t));
  const shop = 0.1 + 0.75 * smoothstep(16, 18, t) * (1 - smoothstep(21.5, 24, t));
  return [home, office, shop, 0.22];
}
let simAcc = 0, uiAcc = 0, autoAcc = 0, fpsT = 0, fpsN = 0, fps = 60, slow = 0;
function tick(dt) {
  game.clock += dt;
  game.tools.update(dt);
  if (game.mode === 'title') rig.gYaw += dt * 0.02;
  rig.update(dt);
  if (game.mode === 'play' && game.speed > 0) {
    simAcc += dt * game.speed; let n = 0;
    while (simAcc >= 0.25 && n++ < 8) { stepSim(0.25, game.clock); simAcc -= 0.25; }
  }
  const hour = game.viewHour();
  sky.setTime(hour);
  buildingUniforms.uTime.value = game.clock; buildingUniforms.uNight.value = sky.night;
  buildingUniforms.uLit.value.set(...litFractions(hour));
  buildingUniforms.uSkyRefl.value.copy(sky.zen).lerp(sky.hor, 0.5);
  rRender.update(6); bRender.update(rig.target.x, rig.target.z, 7); flushOverlay();
  sky.update(camera, rig.target, rig.dist, game.clock); terrain.updateLOD(camera.position);
  uiAcc += dt; if (uiAcc > 0.2) { uiAcc = 0; if (game.mode === 'play') game.ui.update(); }
  if (game.mode === 'play') { autoAcc += dt; if (autoAcc > 180) { autoAcc = 0; if (stats.count || roads.segs.size) { saveSlot(game, 3); game.ui.toast('Autosaved'); } } }
}
function render() { renderer.info.reset(); renderer.render(scene, camera); }
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

let last = performance.now(), manual = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (manual) return;
  tick(dt); render();
  fpsN++; fpsT += dt;
  if (fpsT >= 1) {
    fps = fpsN / fpsT; fpsN = 0; fpsT = 0;
    showDebug();
    // drop resolution a step when the frame rate stays low, and restore it when there is headroom
    const maxPR = Math.min(window.devicePixelRatio || 1, 2);
    if (fps < 27) { if (++slow >= 3 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); resize(); slow = 0; } }
    else { slow = Math.min(slow, 0) - (fps > 57 ? 1 : 0); if (slow <= -6 && pixelRatio < maxPR) { pixelRatio = Math.min(maxPR, pixelRatio + 0.25); resize(); slow = 0; } }
  }
}
const fmt2 = (n) => n.toLocaleString('en-US');
function showDebug() {
  const i = renderer.info.render;
  game.ui.setDebug(`${fps.toFixed(0)} fps  ${i.calls} draws  ${(i.triangles / 1000).toFixed(0)}k tris  ${fmt2(stats.count)} buildings  ${roads.segs.size} road segments`);
}

// ---- test hooks ----------------------------------------------------------------------------------
window.advanceTime = (ms) => { manual = true; const n = Math.max(1, Math.round(ms / (1000 / 60))); for (let i = 0; i < n; i++) tick(1 / 60); render(); showDebug(); };
window.resumeRealtime = () => { manual = false; last = performance.now(); };
window.render_game_to_text = () => {
  const T = game.tools.state, tier = tierOf(stats.pop);
  return JSON.stringify({
    note: 'world metres: x east, z south, origin 37.77N 122.44W; cells are 8 m',
    mode: game.mode, tool: T.tool, roadType: T.roadType, roadMode: T.roadMode, zone: T.zoneId ? ZONES[T.zoneId].key : 'none', zoneMode: T.zoneMode,
    day: sim.day, time: +sim.time.toFixed(2), speed: game.speed, pop: stats.pop, jobs: stats.jobsC + stats.jobsO + stats.jobsI, tier: TIERS[tier][0],
    demand: Object.fromEntries(Object.entries(sim.demand).map(([k, v]) => [k, +v.toFixed(2)])),
    buildings: stats.count, roadSegments: roads.segs.size, roadNodes: roads.nodes.size, frontier: [1, 2, 3, 4, 5, 6, 7, 8].map(frontierSize),
    camera: { x: Math.round(rig.target.x), z: Math.round(rig.target.z), dist: Math.round(rig.dist), yaw: +rig.yaw.toFixed(2), pitch: +rig.pitch.toFixed(2) },
    selected: T.selected ? { id: T.selected.id, label: T.selected.label, floors: T.selected.floors } : null,
    chain: T.chain ? [T.chain.x, T.chain.z] : null, canUndo: game.undo.canUndo(), canRedo: game.undo.canRedo(),
    slots: slots.map((s) => (s.meta ? s.meta.pop : null)), fps: Math.round(fps), draws: renderer.info.render.calls, tris: renderer.info.render.triangles,
  });
};
window.game = Object.assign(game, { sim, stats, buildings, heightAt, bRender, rRender, sky, zone, land, worldToScreen(x, z, y) { const v = new THREE.Vector3(x, y ?? Math.max(heightAt(x, z), 0), z).project(camera); return [(v.x + 1) / 2 * window.innerWidth, (1 - v.y) / 2 * window.innerHeight]; } });

// ---- boot ----------------------------------------------------------------------------------------
{ const [x, z] = ll(-122.41, 37.775); rig.set(x, z, 13500, 0.55, 0.62); }
sim.time = 16.2;
document.getElementById('title').hidden = false;
tick(0.016); render();
document.getElementById('loading').classList.add('out'); setTimeout(() => document.getElementById('loading').remove(), 600);
requestAnimationFrame(frame);
