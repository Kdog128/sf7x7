// 7x7: boot, main loop and the glue between systems.
import * as THREE from 'three';
import { MAP, MAPMODE, K, buildTerrain, buildForests, heightAt, ll, setEdits, HAS_AREAS, AREAS, areas, areaOpen, coastDist } from './terrain.js';
import { GX, GZ, zone, land, zoneTex, initLand, flushOverlay, refreshOverlay, resetWorld, updateLand, refreshAreas, stats, state as W, ZONES, tierOf, TIERS, buildings, toI, toJ, CELL, removeBuilding } from './world.js';
import { BuildingRenderer, buildingUniforms } from './buildings.js';
import { Roads, RoadRenderer } from './roads.js';
import { Sky } from './sky.js';
import { CameraRig } from './camera.js';
import { sim, stepSim, refreshCells, resetSim, frontierSize, yearOf, seasonOf, SEASONS, spawn } from './sim.js';
import { makeUndo } from './undo.js';
import { makeTools } from './tools.js';
import { makeUI } from './ui.js';
import { slots, saveSlot, serialize, deserialize, metaOf } from './save.js';
import { hex2lin, smoothstep, rng } from './util.js';
import './structures.js';
import './blocks.js';
import { city, initCity, resetCity2, stepCity, recompute, dailyEconomy, markDirty, heatTex, heatScale, paintOverlay, priceIndex, post } from './city.js';
import { tech, initTech, resetTech, techDay, pulse } from './tech.js';
import { culture, initCulture, resetCulture, cultureDay, stepCulture, stepTips, onAdded as cultureAdded, onRemoved as cultureRemoved } from './culture.js';
import { makeLife } from './life.js';
import { makeAudio } from './audio.js';
import { place, drawStreets, southHighway, ERAS } from './place.js';
import { cloud } from './cloud.js';
import { makePost } from './post.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2), maxPR = pixelRatio;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 1, 150000);

initLand();
const sky = new Sky(scene, renderer);
const terrain = buildTerrain(scene, zoneTex, GX, GZ);
terrain.uniforms.uZoneCols.value = ZONES.map((z) => new THREE.Vector3(...(z ? hex2lin(z.color) : [0, 0, 0])));
terrain.uniforms.uHeatTex.value = heatTex; terrain.uniforms.uHeatScale.value.copy(heatScale);
const forests = buildForests(scene);
const bRender = new BuildingRenderer(scene);
const roads = new Roads();
const rRender = new RoadRenderer(scene, roads, bRender.mat);
const rig = new CameraRig(camera);
W.hooks.chunkDirty = (c) => bRender.markDirty(c);
W.hooks.cellsChanged = refreshCells;
W.hooks.clearTrees = (x0, z0, x1, z1) => forests.clearRect(x0, z0, x1, z1);

const START = { real: [-122.405, 37.787, 2600], compact: [-122.405, 37.787, 1700], region: [-122.405, 37.787, 2000] }[MAPMODE];
const NOFX = new URLSearchParams(location.search).get('fx') === '0';
const game = {
  fx: !NOFX, canvas, renderer, scene, camera, rig, roads, sky, terrainU: terrain.uniforms, speed: 1, lastSpeed: 1, cycle: true, mode: 'title', clock: 0, overlay: 'none', camMode: 'angled', readOnly: false, cloudId: null, cloudName: '', mapK: K, shake: 0,
  fixedHour: 16.2, viewHour: () => (game.cycle ? sim.time : game.fixedHour),
  setHour(h) { game.fixedHour = h % 24; if (game.cycle) sim.time = h % 24; },
  setSpeed(s) { if (s) game.lastSpeed = s; game.speed = s; game.ui.refresh(); },
  setShadows(on) { if (renderer.shadowMap.enabled === on) return; renderer.shadowMap.enabled = on; sky.sun.castShadow = on; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); },
  modalOpen: () => game.mode === 'title' || game.ui.menuOpen(),
  // nearby cities: keys = the open ones, all = everything open. Re-reads which land can be built on.
  setAreas(keys, all) { if (!HAS_AREAS) return; const was = areas.sig; areas.open = new Set(['sf', ...(keys || [])]); areas.all = !!all; areas.sig = AREAS.map((a, i) => (areaOpen(i) ? 1 : 0)).join(''); if (was === areas.sig) return; city.cfg.areas = all ? 'open' : 'grow'; terrain.uniforms.uLock.value = AREAS.map((a, i) => (areaOpen(i) ? 0 : 1)); refreshAreas(); },
  openAllAreas() { game.setAreas([...areas.open], true); game.ui.toast('Every nearby city is open for building', 'gold'); game.ui.refresh(true); markDirty(); },
  checkAreas() { // once a day: open the next city when enough people live here
    if (!HAS_AREAS || areas.all || game.readOnly) return;
    for (const a of AREAS) if (!areas.open.has(a.k) && stats.pop >= a.at) { game.setAreas([...areas.open, a.k], false); game.ui.toast(`${a.name} is open for building`, 'gold'); post(`${a.name} just opened up. Bridges, ferries and bulldozers welcome.`, 'life'); }
  },
  doUndo(redo) { if (game.readOnly) return; const l = redo ? game.undo.redo() : game.undo.undo(); if (l) game.ui.toast(`${redo ? 'Redid' : 'Undid'} ${l}`); game.tools.touch(); game.ui.refresh(true); markDirty(); },
  resetCity() {
    resetWorld(); roads.clear(); rRender.clear(); bRender.clear(); resetSim(); forests.reset(); game.undo.clear();
    const bb = setEdits([]); if (bb) { const G = MAP.G / CELL; updateLand(Math.floor(bb[0] * G) - 2, Math.floor(bb[1] * G) - 2, Math.ceil(bb[2] * G) + 2, Math.ceil(bb[3] * G) + 2); }
    game.setAreas([], false); resetCity2(true); resetTech(); resetCulture(); game.life.reset(); game.setOverlay('none');
    sim.day = 1; sim.time = 10; sim.year0 = 2025; game.tools.state.selected = null; game.tools.cancel(); game.ui.showInfo(null); game.cloudId = null; game.cloudName = '';
  },
  // o: the start-screen choices
  startNew(o) {
    game.readOnly = false; game.resetCity();
    const c = city.cfg; c.money = o.money; c.traffic = o.traffic; c.landValue = o.lv !== 'off'; c.ui = o.ui; c.fog = o.fog !== 'off'; c.rain = o.rain !== 'off'; c.sunsets = o.sunsets !== 'off'; c.era = o.era; c.start = o.start;
    if (o.areas === 'open') game.setAreas([], true); c.night = o.night === 'neon' ? 'neon' : 'real';
    sim.year0 = ERAS[o.era].year; sim.growth = +o.growth || 1; city.treasury = Math.round(4000 * priceIndex(sim.year0));
    const [x, z] = ll(START[0], START[1]); rig.set(x, z, START[2], 0.5, 0.82);
    if (o.start === 'demo') buildDemo();
    else if (o.start === 'grid') { const n = drawStreets(game); rig.set(...ll(-122.435, 37.765), 9000 * Math.max(K, 0.55), 0.3, 0.9); game.ui.toast(`${n} streets drawn. Zone beside them to begin.`); }
    else if (o.start === 'south') { southHighway(game); rig.set(...ll(-122.41, 37.745), 6000 * Math.max(K, 0.55), 0.2, 0.85); }
    game.undo.clear(); game.setGfx(o.gfx); if (o.cam !== 'angled') game.setCam(o.cam, true); else game.camMode = 'angled'; recompute(); game.ui.setHud(true); game.ui.resetTier(); game.ui.refresh(true);
    post(o.start === 'demo' ? 'New district downtown. Half the windows are lit already.' : sim.year0 < 1910 ? 'The fires are out. Time to build it again, and better.' : o.start === 'empty' ? 'Empty lots and big plans. Somebody draw a street.' : 'Streets are in. Now somebody zone something.', 'life');
  },
  startDemo() { game.ui.go('demo'); },
  begin() {
    if (game.mode === 'play') return; game.mode = 'play';
    document.getElementById('title').classList.add('out'); setTimeout(() => { if (game.mode === 'play') document.getElementById('title').hidden = true; }, 520);
    document.getElementById('hud').hidden = false; game.ui.setHud(true); game.ui.syncSound(); game.ui.refresh(true); canvas.focus();
  },
  toSetup() { game.mode = 'title'; const t = document.getElementById('title'); t.hidden = false; t.classList.remove('out'); document.getElementById('hud').hidden = true; document.getElementById('showHud').hidden = true; game.ui.titleErr(''); },
  afterLoad() { game.life.rebuildTransit(); game.life.setCircuit(culture.f1.pts); game.setGfx(city.cfg.gfx || 'auto'); recompute(); game.audio.setOn(city.cfg.sound !== false); game.ui.resetTier(); game.ui.syncPops(); game.ui.refresh(true); },
  async loadCloud(id, name) { const d = await cloud.load(id); game.readOnly = false; deserialize(game, d); game.cloudId = id; game.cloudName = name || ''; game.begin(); game.ui.toast('City loaded'); },
  setOverlay(k) { game.overlay = k; terrain.uniforms.uHeat.value = k === 'none' ? 0 : 0.86; if (k !== 'none') { recompute(); paintOverlay(k); } if (game.ui.panels) game.ui.panels.legend(); },
  setWeather(k) { const w = city.wx; city.cfg.wxAuto = false; w.manual = 1; w.tFog = k === 'fog' ? 1 : k === 'storm' ? 0.35 : 0; w.tRain = k === 'rain' ? 0.65 : k === 'storm' ? 1 : 0; if (k === 'fog') city.cfg.fog = true; if (k === 'rain' || k === 'storm') city.cfg.rain = true; game.ui.syncPops(); },
  setGfx(name) {
    city.cfg.gfx = name; const dpr = window.devicePixelRatio || 1;
    const P = { low: [1, false, 'low'], medium: [1.25, true, 'medium'], high: [1.75, true, 'high'], ultra: [2, true, 'ultra'], auto: [2, true, 'high'] }[name] || [2, true, 'high'];
    maxPR = Math.min(dpr, P[0]); pixelRatio = maxPR; game.setShadows(P[1]); game.life.setQuality(P[2]); game.fx = name !== 'low' && !NOFX; slow = 0; resize();
  },
  setCam(mode, snap = false) { game.camMode = mode; const r = rig; if (mode === 'top') r.set(r.gTarget.x, r.gTarget.z, r.gDist, r.gYaw, 1.553, snap); else if (mode === 'street') { // stand on the nearest street and look along it
      const n = roads.nearestSeg(r.gTarget.x, r.gTarget.z, 500); let x = r.gTarget.x, z = r.gTarget.z, yaw = r.gYaw;
      if (n) { const p = n.seg.pts, c = n.seg.cum; let k = 1; while (k < c.length - 1 && c[k] < n.s) k++; const t = (n.s - c[k - 1]) / Math.max(c[k] - c[k - 1], 0.01), dx = p[k * 2] - p[k * 2 - 2], dz = p[k * 2 + 1] - p[k * 2 - 1]; x = p[k * 2 - 2] + dx * t; z = p[k * 2 - 1] + dz * t; yaw = Math.atan2(dx, dz); }
      r.set(x, z, 55, yaw, 0.14, snap);
    } else r.set(r.gTarget.x, r.gTarget.z, Math.max(r.gDist, 400), r.gYaw, 0.66, snap); },
};
game.undo = makeUndo(roads);
game.ui = { toast() {}, refresh() {}, showInfo() {}, menuOpen: () => false, setHud() {}, resetTier() {}, syncPops() {}, tip() {} };
game.life = { reset() {}, onAdded() {}, rebuildTransit() {}, setCircuit() {}, setQuality() {} };
game.audio = makeAudio(game);
game.tools = makeTools(game);
initCity(game); initTech(game); initCulture(game);
game.life = makeLife(game);
W.hooks.added = (b) => { game.life.onAdded(b); cultureAdded(b); markDirty(); };
W.hooks.removed = (b) => { cultureRemoved(b); markDirty(); };
sim.onDay = () => {
  let len = 0; for (const s of roads.segs.values()) len += s.len;
  recompute(); dailyEconomy(len); techDay(); cultureDay(); pulse(); game.checkAreas();
  if (city.cfg.money === 'budget' && city.treasury < 0 && sim.day % 2 === 0) game.ui.toast('The treasury is in the red', 'warn');
};
game.ui = makeUI(game);

// ---- demo district: a downtown grid on the real north-east corner of the city -------------------
function buildDemo() {
  const s = K < 1 ? 0.6 : 1, BW = 96, BH = 176, NXB = Math.round(20 * s), NZB = Math.round(10 * s), [ox, oz] = ll(-122.4127, 37.7868), X0 = Math.round((ox - (NXB * BW) / 2) / 8) * 8, Z0 = Math.round((oz - (NZB * BH) / 2) / 8) * 8, X1 = X0 + NXB * BW, Z1 = Z0 + NZB * BH;
  for (let k = 0; k <= NXB; k++) roads.add(k % 5 === 0 ? 'avenue' : 'street', [X0 + k * BW, Z0, X0 + k * BW, Z1]);
  for (let k = 0; k <= NZB; k++) roads.add(k % 5 === 0 ? 'avenue' : 'street', [X0, Z0 + k * BH, X1, Z0 + k * BH]);
  roads.add('boulevard', [X0, Z1 - BH * 1.5, X0 + BW * NXB * 0.325, Z1 - BH * NZB * 0.45, X0 + BW * NXB * 0.675, Z0 + BH * NZB * 0.25, X1, Z0 + BH * 1.5].map((v) => Math.round(v)));
  const cx = X0 + BW * NXB * 0.55, cz = Z0 + BH * NZB * 0.42, r = rng(7), q = s;
  const main = [X0, Z1 - BH * 1.5, X0 + BW * NXB * 0.325, Z1 - BH * NZB * 0.45, X0 + BW * NXB * 0.675, Z0 + BH * NZB * 0.25, X1, Z0 + BH * 1.5];
  const distToMain = (x, z) => { let b = 1e9; for (let k = 0; k + 3 < main.length; k += 2) { const ex = main[k + 2] - main[k], ez = main[k + 3] - main[k + 1], t = Math.max(0, Math.min(1, ((x - main[k]) * ex + (z - main[k + 1]) * ez) / (ex * ex + ez * ez))); b = Math.min(b, Math.hypot(x - main[k] - ex * t, z - main[k + 1] - ez * t)); } return b; };
  const nearShore = (x, z) => coastDist(x, z) < 300;
  // civic lots first, so the zoning flows around them
  const lot = (key, bx, bz, w, d, front = 2) => { const i = toI(X0 + bx * BW) + 2, j = toJ(Z0 + bz * BH) + 2; return place(game, key, i, j, w, d, front, { quiet: true, free: true, now: -100, seed: 11 + bx * 7 + bz }); };
  lot('park', Math.round(NXB * 0.3), Math.round(NZB * 0.6), 9, 19); lot('plaza', Math.round(NXB * 0.55), Math.round(NZB * 0.4), 9, 9); lot('school', Math.round(NXB * 0.2), Math.round(NZB * 0.2), 6, 6);
  lot('fire', Math.round(NXB * 0.7), Math.round(NZB * 0.7), 4, 5); lot('police', Math.round(NXB * 0.4), Math.round(NZB * 0.2), 4, 5); lot('hospital', Math.round(NXB * 0.8), Math.round(NZB * 0.3), 8, 8);
  lot('club', Math.round(NXB * 0.6), Math.round(NZB * 0.7), 3, 4); lot('musicvenue', Math.round(NXB * 0.5), Math.round(NZB * 0.6), 5, 6); lot('comedy', Math.round(NXB * 0.45), Math.round(NZB * 0.5), 2, 3); lot('park', Math.round(NXB * 0.75), Math.round(NZB * 0.1), 9, 9);
  for (let j = toJ(Z0) - 2; j <= toJ(Z1) + 2; j++) for (let i = toI(X0) - 2; i <= toI(X1) + 2; i++) {
    const o = j * GX + i; if (!land[o]) continue;
    const x = MAP.minX + (i + 0.5) * CELL, z = MAP.minZ + (j + 0.5) * CELL, d = Math.hypot(x - cx, (z - cz) * 0.8) / q, bx = Math.floor((x - X0) / BW), bz = Math.floor((z - Z0) / BH), h = ((bx * 7 + bz * 13) % 10) / 10;
    // a small downtown, flats and shops around it, then rowhouses: towers stay in one cluster, the way the real skyline does
    const ax = Math.abs(((x - X0 + BW * 2.5) % (BW * 5)) - BW * 2.5), az = Math.abs(((z - Z0 + BH * 2.5) % (BH * 5)) - BH * 2.5), corridor = Math.min(ax, az, distToMain(x, z)) < 44;
    let zid;
    if (d < 190) zid = h < 0.3 ? 9 : 6; else if (d < 320) zid = h < 0.35 ? 4 : h < 0.6 ? 11 : h < 0.8 ? 6 : 2; else if (d < 520) zid = corridor ? (h < 0.5 ? 11 : 3) : h < 0.1 ? 5 : 2;
    else if (x > X1 - BW * 3 && z > Z1 - BH * 2.5) zid = nearShore(x, z) ? 12 : h < 0.4 ? 8 : 7; else if (corridor) zid = h < 0.2 ? 10 : h < 0.45 ? 11 : 3; else zid = d < 800 && h < 0.25 ? 2 : 1;
    zone[o] = zid;
  }
  refreshOverlay(0, 0, GX - 1, GZ - 1); refreshCells(toI(X0) - 4, toJ(Z0) - 4, toI(X1) + 4, toJ(Z1) + 4);
  city.lines.push({ id: city.nextLine++, type: 'bus', name: '38 Geary', color: '#c2572f', stops: [X0, Z0 + BH * 5 * s, X0 + BW * NXB * 0.25, Z0 + BH * 5 * s, X0 + BW * NXB * 0.5, Z0 + BH * 5 * s, X0 + BW * NXB * 0.75, Z0 + BH * 5 * s, X1, Z0 + BH * 5 * s].map(Math.round) });
  city.lines.push({ id: city.nextLine++, type: 'cable', name: 'Powell and Hyde', color: '#8a2f2a', stops: [X0 + BW * 10 * s, Z0, X0 + BW * 10 * s, Z0 + BH * NZB * 0.33, X0 + BW * 10 * s, Z0 + BH * NZB * 0.66, X0 + BW * 10 * s, Z1].map(Math.round) });
  game.life.rebuildTransit();
  const keep = sim.rand, od = sim.onDay; sim.rand = r; sim.onDay = null; recompute();
  for (let k = 0; k < 2600; k++) { stepSim(1, -100); if (k % 400 === 0) recompute(); }
  // the middle few blocks get their towers now instead of waiting for the population to catch up
  for (const b of [...buildings.values()]) {
    if (b.sp || !(b.zone === 6 || b.zone === 9 || b.zone === 4 || b.zone === 11)) continue;
    const x = MAP.minX + (b.i + b.w / 2) * CELL, z = MAP.minZ + (b.j + b.d / 2) * CELL, d = Math.hypot(x - cx, (z - cz) * 0.8) / q;
    const want = Math.min(b.zone === 11 ? 4 : 5, d < 110 ? 4 + (b.seed % 3 === 0 ? 1 : 0) : d < 210 ? 3 + (b.seed % 2) : d < 330 ? 2 + (b.seed % 2) : 0);
    if (want <= b.level || (want >= 4 && b.w * b.d < 9)) continue;
    removeBuilding(b.id); spawn({ i: b.i, j: b.j, w: b.w, d: b.d, zone: b.zone, front: b.front }, want, b.seed, -100);
  }
  recompute();
  sim.rand = keep; sim.onDay = od; sim.time = 16.2; sim.day = 1; game.undo.clear();
  for (const b of buildings.values()) b.born = 1;
  rig.set(cx + 60, cz + 120, 1350 * (K < 1 ? 0.75 : 1), 0.62, 0.42);
}

// ---- frame ---------------------------------------------------------------------------------------
function litFractions(h) {
  const t = h < 12 ? h + 24 : h;
  const home = 0.05 + 0.36 * smoothstep(16.5, 19.5, t) * (1 - smoothstep(22, 26.5, t)) + 0.22 * smoothstep(29.3, 30.3, t) * (1 - smoothstep(31, 32, t));
  const office = 0.04 + 0.5 * smoothstep(15.5, 17.5, t) * (1 - smoothstep(19, 24.5, t));
  const shop = 0.1 + 0.75 * smoothstep(16, 18, t) * (1 - smoothstep(21.5, 24, t));
  return [home, office, shop, 0.22];
}
let simAcc = 0, uiAcc = 0, autoAcc = 0, cloudAcc = 0, ovAcc = 0, fpsT = 0, fpsN = 0, fps = 60, slow = 0;
function tick(dt) {
  game.clock += dt;
  game.tools.update(dt);
  if (game.mode === 'title') rig.gYaw += dt * 0.02;
  rig.update(dt);
  if (game.shake > 0.02) { const a = game.shake * rig.dist * 0.0035; camera.position.x += (Math.random() - 0.5) * a; camera.position.y += (Math.random() - 0.5) * a * 0.6; camera.position.z += (Math.random() - 0.5) * a; camera.updateMatrixWorld(); game.shake *= Math.exp(-dt * 1.1); } else game.shake = 0;
  let simDt = 0;
  if (game.mode === 'play' && game.speed > 0) {
    simDt = dt * game.speed; simAcc += simDt; let n = 0;
    while (simAcc >= 0.25 && n++ < 8) { if (!game.readOnly) stepSim(0.25, game.clock); else { sim.time += 0.25 * (24 / 180); if (sim.time >= 24) sim.time -= 24; } simAcc -= 0.25; }
    if (!game.readOnly) { stepCity(dt); stepCulture(dt * Math.min(game.speed, 2)); stepTips(dt); }
  }
  const hour = game.viewHour();
  sky.setTime(hour);
  buildingUniforms.uTime.value = game.clock; buildingUniforms.uNight.value = sky.night;
  buildingUniforms.uLit.value.set(...litFractions(hour));
  buildingUniforms.uSkyRefl.value.copy(sky.zen).lerp(sky.hor, 0.5);
  { const neon = city.cfg.night === 'neon'; buildingUniforms.uGlow.value.set(neon ? 0.8 : 0.5, neon ? 3.0 : 1.5, neon ? 1.25 : 1.0); sky.neon = neon; }
  rRender.update(6); bRender.update(rig.target.x, rig.target.z, 7); flushOverlay();
  game.life.update(dt, simDt); game.audio.update(dt);
  sky.update(camera, rig.target, rig.dist, game.clock); terrain.updateLOD(camera.position);
  if (game.overlay !== 'none') { ovAcc += dt; if (ovAcc > 1.5) { ovAcc = 0; paintOverlay(game.overlay); } }
  uiAcc += dt; if (uiAcc > 0.2) { uiAcc = 0; if (game.mode === 'play') game.ui.update(); }
  game.ui.frame();
  if (game.mode === 'play' && !game.readOnly) {
    autoAcc += dt; if (autoAcc > 180) { autoAcc = 0; if (stats.count || roads.segs.size) { saveSlot(game, 3); if (!game.cloudId) game.ui.toast('Autosaved'); } }
    cloudAcc += dt; if (cloudAcc > 300) { cloudAcc = 0; if (game.cloudId) { const d = serialize(game); cloud.save(game.cloudName || 'San Francisco', metaOf(d), d, game.cloudId).then(() => game.ui.toast('Saved to the cloud')).catch(() => {}); } }
  }
}
let post3 = null; // bloom and colour grade; built on first use so a failure leaves the plain renderer working
function render() {
  renderer.info.reset();
  if (game.fx && !post3) { try { post3 = makePost(renderer, scene, camera); post3.setSize(window.innerWidth, window.innerHeight, pixelRatio); } catch (e) { console.warn('post-processing off:', e.message); game.fx = false; } }
  if (game.fx && post3) { const s = sky.sunH, golden = smoothstep(-0.05, 0.08, s) * (1 - smoothstep(0.18, 0.42, s)); post3.update(sky.night, golden, city.cfg.night === 'neon'); post3.render(); }
  else renderer.render(scene, camera);
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (post3) post3.setSize(w, h, pixelRatio);
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
    if (city.cfg.gfx !== 'auto') return;
    // auto: drop resolution a step when the frame rate stays low, then detail; restore when there is headroom
    if (fps < 27) { if (++slow >= 3) { if (pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); resize(); } else if (game.life.quality() === 'high') game.life.setQuality('medium'); else if (game.fx && fps < 20) game.fx = false; else if (game.life.quality() === 'medium') game.life.setQuality('low'); slow = 0; } }
    else { slow = Math.min(slow, 0) - (fps > 57 ? 1 : 0); if (slow <= -6 && pixelRatio < maxPR) { pixelRatio = Math.min(maxPR, pixelRatio + 0.25); resize(); slow = 0; } }
  }
}
const fmt2 = (n) => n.toLocaleString('en-US');
function showDebug() {
  const i = renderer.info.render, c = game.life.counts();
  game.ui.setDebug(`${fps.toFixed(0)} fps  ${i.calls} draws  ${(i.triangles / 1000).toFixed(0)}k tris  ${fmt2(stats.count)} buildings  ${roads.segs.size} road segments  ${c.cars} cars  ${c.peds} people`);
}

// ---- test hooks ----------------------------------------------------------------------------------
window.advanceTime = (ms) => { manual = true; const n = Math.max(1, Math.round(ms / (1000 / 60))); for (let i = 0; i < n; i++) tick(1 / 60); render(); showDebug(); };
window.resumeRealtime = () => { manual = false; last = performance.now(); };
window.advanceDays = (n) => { manual = true; const sp = game.speed, end = sim.day + n; game.speed = 4; let g = 0; while (sim.day < end && g++ < n * 200) tick(0.5); game.speed = sp; render(); showDebug(); };
window.render_game_to_text = () => {
  const T = game.tools.state, tier = tierOf(stats.pop);
  return JSON.stringify({
    note: 'world metres: x east, z south, origin 37.77N 122.44W scaled by map K; cells are 8 m',
    mode: game.mode, map: MAPMODE, readOnly: game.readOnly, tool: T.tool, roadType: T.roadType, roadMode: T.roadMode, zone: T.zoneId ? ZONES[T.zoneId].key : 'none', zoneMode: T.zoneMode, buildKey: T.buildKey, lineType: T.lineType, lineDraft: T.lineDraft ? T.lineDraft.length / 2 : 0, terraMode: T.terraMode,
    day: sim.day, year: yearOf(), season: SEASONS[seasonOf()], time: +sim.time.toFixed(2), speed: game.speed, pop: stats.pop, jobs: stats.jobsC + stats.jobsO + stats.jobsI, tier: TIERS[tier][0],
    demand: Object.fromEntries(Object.entries(sim.demand).map(([k, v]) => [k, +v.toFixed(2)])),
    buildings: stats.count, roadSegments: roads.segs.size, roadNodes: roads.nodes.size, frontier: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(frontierSize),
    city: { sat: +city.sat.toFixed(2), landValue: +city.lvAvg.toFixed(2), traffic: +city.trafficAvg.toFixed(2), noise: +city.noiseAvg.toFixed(2), transitShare: +city.transitShare.toFixed(2), rent: city.rent, money: city.cfg.money, treasury: Math.round(city.treasury), income: Math.round(city.income), expense: Math.round(city.expense), tourism: +city.tourism.toFixed(1), lines: city.lines.map((l) => `${l.type}:${l.stops.length / 2}`), feed: city.feed.length, hoods: city.hoodStats.length },
    tech: { phase: tech.phase, wave: tech.wave ? tech.wave.name : null, heat: +city.heat.toFixed(2), startups: tech.startups.filter((s) => s.status === 'active').length, ipos: tech.ipos },
    culture: { venues: culture.venues.length, artists: culture.artists.length, teams: Object.keys(culture.teams), live: culture.live.filter((e) => e.on).map((e) => e.name), fires: culture.fires.length, circuit: !!culture.f1.pts, olympics: culture.oly.stage, achievements: Object.keys(culture.ach).length },
    weather: { fog: +city.wx.fog.toFixed(2), rain: +city.wx.rain.toFixed(2) }, overlay: game.overlay, life: game.life.counts(), gfx: city.cfg.gfx, ui: city.cfg.ui, cam: game.camMode,
    camera: { x: Math.round(rig.target.x), z: Math.round(rig.target.z), dist: Math.round(rig.dist), yaw: +rig.yaw.toFixed(2), pitch: +rig.pitch.toFixed(2) },
    selected: T.selected ? { id: T.selected.id, label: T.selected.label, floors: T.selected.floors, sp: T.selected.sp || null } : null,
    chain: T.chain ? [T.chain.x, T.chain.z] : null, canUndo: game.undo.canUndo(), canRedo: game.undo.canRedo(), cloudId: game.cloudId,
    slots: slots.map((s) => (s.meta ? s.meta.pop : null)), fps: Math.round(fps), draws: renderer.info.render.calls, tris: renderer.info.render.triangles,
  });
};
const _v = new THREE.Vector3();
window.game = Object.assign(game, { sim, stats, buildings, spawn, heightAt, bRender, rRender, city, tech, culture, zone, land, cloud, ll,
  worldToScreen(x, z, y) { _v.set(x, y ?? Math.max(heightAt(x, z), 0), z).project(camera); return [(_v.x + 1) / 2 * window.innerWidth, (1 - _v.y) / 2 * window.innerHeight, _v.z < 1 && _v.z > -1]; } });

// ---- boot ----------------------------------------------------------------------------------------
{ const [x, z] = ll(-122.41, 37.775); rig.set(x, z, 13500 * Math.max(K, 0.6), 0.55, 0.62); }
sim.time = 16.2;
const params = new URLSearchParams(location.search), loading = document.getElementById('loading');
const reveal = () => { loading.classList.add('out'); setTimeout(() => loading.remove(), 600); };
const withMap = (map, key, val) => { const u = new URL(location.href); u.search = ''; if (map !== 'region') u.searchParams.set('map', map); u.searchParams.set(key, val); location.href = u.toString(); };
async function boot() {
  tick(0.016); render();
  const shared = params.get('city'), load = params.get('load');
  if (shared || load) {
    document.getElementById('loadMsg').textContent = shared ? 'Opening the shared city' : 'Loading your city';
    try {
      if (shared) {
        const s = await cloud.shared(shared); const map = s.data.map || 'real'; if (map !== MAPMODE) return withMap(map, 'city', shared);
        deserialize(game, s.data); city.cfg.parody = true; game.readOnly = true; game.cloudId = null; document.getElementById('roText').textContent = `${s.name}: a shared city, read-only. Drag to move, scroll to zoom, click a building for details.`; document.getElementById('cityName').textContent = s.name;
        game.begin(); game.tools.setTool('inspect');
      } else await game.loadCloud(load);
      reveal(); requestAnimationFrame(frame); return;
    } catch (x) { if (x.map) return withMap(x.map, shared ? 'city' : 'load', shared || load); document.getElementById('title').hidden = false; game.ui.titleErr(x.message); }
  } else document.getElementById('title').hidden = false;
  if (params.get('go') === '1') { game.ui.go(); history.replaceState(null, '', location.pathname + (MAPMODE !== 'region' ? `?map=${MAPMODE}` : '')); }
  reveal(); requestAnimationFrame(frame);
}
boot();
