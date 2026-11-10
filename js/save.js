// Save / load. Slots live in memory for this session; export and import use a JSON file.
import { GX, GZ, zone, buildings, stats, resetWorld, refreshOverlay, addBuilding, state as W } from './world.js';
import { sim, resetSim, refreshCells, registerLoaded } from './sim.js';
import { design, lotBase } from './buildings.js';

export const slots = [{ name: 'Slot 1' }, { name: 'Slot 2' }, { name: 'Slot 3' }, { name: 'Autosave', auto: true }];

export function serialize(game) {
  const rle = []; let v = zone[0], n = 0;
  for (let o = 0; o < zone.length; o++) { if (zone[o] === v) n++; else { rle.push(v, n); v = zone[o]; n = 1; } }
  rle.push(v, n);
  const b = [];
  for (const B of buildings.values()) b.push([B.id, B.i, B.j, B.w, B.d, B.zone, B.level, B.seed, B.front, B.born, B.locked ? 1 : 0]);
  const r = game.rig;
  return {
    app: '7x7', v: 1, savedAt: new Date().toISOString(), grid: [GX, GZ], day: sim.day, time: +sim.time.toFixed(3), growth: sim.growth, speed: game.speed,
    pop: stats.pop, cam: [Math.round(r.gTarget.x), Math.round(r.gTarget.z), Math.round(r.gDist), +r.gYaw.toFixed(3), +r.gPitch.toFixed(3)],
    roads: game.roads.serialize(), zones: rle, buildings: b, nextId: W.nextId,
  };
}

export function deserialize(game, data) {
  if (!data || data.app !== '7x7' || !Array.isArray(data.roads) || !Array.isArray(data.zones)) throw new Error('This file is not a 7x7 city');
  if (!data.grid || data.grid[0] !== GX || data.grid[1] !== GZ) throw new Error('This save uses a different map size');
  game.resetCity();
  for (const s of data.roads) game.roads.addRaw({ type: s.t, pts: s.p }, false);
  game.roads.rasterRegion(0, 0, GX - 1, GZ - 1);
  let o = 0; for (let k = 0; k < data.zones.length; k += 2) { zone.fill(data.zones[k], o, o + data.zones[k + 1]); o += data.zones[k + 1]; }
  sim.day = data.day || 1; sim.time = data.time ?? 10; sim.growth = data.growth || 1;
  for (const a of data.buildings || []) {
    const b = { id: a[0], i: a[1], j: a[2], w: a[3], d: a[4], zone: a[5], level: a[6], seed: a[7], front: a[8], born: a[9], birth: -100 };
    if (a[10]) b.locked = true;
    Object.assign(b, design(b)); b.baseY = lotBase(b); b.topY = b.baseY + b.height * 1.3 + 8;
    addBuilding(b); registerLoaded(b);
  }
  if (data.nextId) W.nextId = Math.max(W.nextId, data.nextId);
  refreshOverlay(0, 0, GX - 1, GZ - 1); refreshCells(0, 0, GX - 1, GZ - 1);
  if (data.cam) game.rig.set(data.cam[0], data.cam[1], data.cam[2], data.cam[3], data.cam[4]);
  if (data.speed != null) game.setSpeed(data.speed);
}

export function saveSlot(game, k) { const d = serialize(game); slots[k].data = JSON.stringify(d); slots[k].meta = { savedAt: d.savedAt, day: d.day, pop: d.pop }; }
export function loadSlot(game, k) { if (!slots[k].data) return false; deserialize(game, JSON.parse(slots[k].data)); return true; }

export function exportFile(game) {
  const d = serialize(game), blob = new Blob([JSON.stringify(d)], { type: 'application/json' }), url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `7x7-san-francisco-day-${d.day}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function importFile(game, file) {
  return file.text().then((t) => { let d; try { d = JSON.parse(t); } catch { throw new Error('This file is not valid JSON'); } deserialize(game, d); });
}
