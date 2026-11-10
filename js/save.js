// Save / load. Quick slots live in memory for this tab; cloud saves and files are the durable paths.
import { MAP, MAPMODE, terra, setEdits } from './terrain.js';
import { GX, GZ, CELL, zone, buildings, stats, refreshOverlay, addBuilding, updateLand, state as W } from './world.js';
import { sim, refreshCells, registerLoaded } from './sim.js';
import { design, lotBase } from './buildings.js';
import { CAT } from './structures.js';
import { serializeCity, loadCity, city } from './city.js';
import { serializeTech, loadTech, relinkTech } from './tech.js';
import { serializeCulture, loadCulture } from './culture.js';

export const slots = [{ name: 'Slot 1' }, { name: 'Slot 2' }, { name: 'Slot 3' }, { name: 'Autosave', auto: true }];
export const MAP_NAMES = { real: 'Real-scale SF', compact: 'Compressed SF', bay: 'Bay Area' };

export function serialize(game) {
  const rle = []; let v = zone[0], n = 0;
  for (let o = 0; o < zone.length; o++) { if (zone[o] === v) n++; else { rle.push(v, n); v = zone[o]; n = 1; } }
  rle.push(v, n);
  const b = [];
  for (const B of buildings.values()) {
    const row = [B.id, B.i, B.j, B.w, B.d, B.zone, B.level, B.seed, B.front, B.born, B.locked ? 1 : 0, B.fc || 0, B.st || 0, B.sp || 0];
    const x = {}; if (B.vac) { x.vac = 1; x.vacDay = B.vacDay; } if (B.sign) { x.sign = B.sign; x.name = B.name; } if (B.vname) x.vname = B.vname; if (Object.keys(x).length) row.push(x);
    b.push(row);
  }
  const r = game.rig, t = []; for (const [o, h] of terra.edits) t.push(o, Math.round(h * 100) / 100);
  return {
    app: '7x7', v: 2, map: MAPMODE, savedAt: new Date().toISOString(), grid: [GX, GZ], day: sim.day, time: +sim.time.toFixed(3), growth: sim.growth, speed: game.speed, year0: sim.year0,
    pop: stats.pop, cam: [Math.round(r.gTarget.x), Math.round(r.gTarget.z), Math.round(r.gDist), +r.gYaw.toFixed(3), +r.gPitch.toFixed(3)],
    roads: game.roads.serialize(), zones: rle, buildings: b, nextId: W.nextId, terra: t, city: serializeCity(), tech: serializeTech(), culture: serializeCulture(),
  };
}
export const metaOf = (d) => ({ day: d.day, year: d.year0 + Math.floor((d.day - 1) / 4), pop: d.pop, map: d.map, v: d.v });

export function deserialize(game, data) {
  if (!data || data.app !== '7x7' || !Array.isArray(data.roads) || !Array.isArray(data.zones)) throw new Error('This file is not a 7x7 city');
  const map = data.map || 'real';
  if (map !== MAPMODE) { const e = new Error(`This city was built on the ${MAP_NAMES[map] || map} map. Start a new city on that map size, then load it.`); e.map = map; throw e; }
  if (!data.grid || data.grid[0] !== GX || data.grid[1] !== GZ) throw new Error('This save uses a different map size');
  game.resetCity();
  if (data.terra && data.terra.length) { const bb = setEdits(data.terra); if (bb) { const G = MAP.G / CELL; updateLand(Math.floor(bb[0] * G) - 2, Math.floor(bb[1] * G) - 2, Math.ceil(bb[2] * G) + 2, Math.ceil(bb[3] * G) + 2); } }
  for (const s of data.roads) game.roads.addRaw({ type: s.t, pts: s.p }, false);
  game.roads.rasterRegion(0, 0, GX - 1, GZ - 1);
  let o = 0; for (let k = 0; k < data.zones.length; k += 2) { zone.fill(data.zones[k], o, o + data.zones[k + 1]); o += data.zones[k + 1]; }
  sim.day = data.day || 1; sim.time = data.time ?? 10; sim.growth = data.growth || 1; sim.year0 = data.year0 || 2025;
  loadCity(data.city); loadTech(data.tech);
  for (const a of data.buildings || []) {
    const b = { id: a[0], i: a[1], j: a[2], w: a[3], d: a[4], zone: a[5], level: a[6], seed: a[7], front: a[8], born: a[9], birth: -100 };
    if (a[10]) b.locked = true; if (a[11]) b.fc = a[11]; if (a[12]) b.st = a[12];
    const x = a[14] || (typeof a[13] === 'object' && a[13]) || null; if (x) Object.assign(b, x);
    if (a[13] && typeof a[13] === 'string') {
      const c = CAT[a[13]]; if (!c) continue;
      Object.assign(b, { sp: c.k, zone: 0, height: c.h, jobs: c.jobs || 0, res: c.res || 0, label: c.name, floors: Math.max(1, Math.round(c.h / 4.2)) }); if (c.green) b.green = true;
    } else { const nm = b.name; Object.assign(b, design(b)); if (b.sign && nm) b.name = nm; }
    b.baseY = lotBase(b); b.topY = b.baseY + b.height * 1.3 + 8;
    addBuilding(b); if (!b.sp) registerLoaded(b);
  }
  if (data.nextId) W.nextId = Math.max(W.nextId, data.nextId);
  loadCulture(data.culture); relinkTech();
  refreshOverlay(0, 0, GX - 1, GZ - 1); refreshCells(0, 0, GX - 1, GZ - 1);
  if (data.cam) game.rig.set(data.cam[0], data.cam[1], data.cam[2], data.cam[3], data.cam[4]);
  if (data.speed != null) game.setSpeed(data.speed);
  game.afterLoad();
}

export function saveSlot(game, k) { const d = serialize(game); slots[k].data = JSON.stringify(d); slots[k].meta = { savedAt: d.savedAt, day: d.day, pop: d.pop }; }
export function loadSlot(game, k) { if (!slots[k].data) return false; deserialize(game, JSON.parse(slots[k].data)); return true; }

export function exportFile(game) {
  const d = serialize(game), blob = new Blob([JSON.stringify(d)], { type: 'application/json' }), url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `7x7-san-francisco-${d.year0 + Math.floor((d.day - 1) / 4)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function importFile(game, file) {
  return file.text().then((t) => { let d; try { d = JSON.parse(t); } catch { throw new Error('This file is not valid JSON'); } deserialize(game, d); });
}
void city;
