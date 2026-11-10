// Undo / redo for player actions (roads, zoning, bulldozing). Growth by the simulation is not undone.
import { GX, zone, bid, road, buildings, addBuilding, removeBuilding, refreshOverlay, state as W } from './world.js';
import { registerLoaded } from './sim.js';

export function makeUndo(roads) {
  const stack = [], redoStack = [];
  let cur = null;
  const u = {
    get current() { return cur; },
    begin(label) { if (cur) u.commit(); cur = { label, roads: [], zones: [], blds: [], added: [], lines: null, box: [1e9, 1e9, -1e9, -1e9] }; roads.log = cur.roads; },
    logZone(o, old, val) { cur.zones.push(o, old, val); const i = o % GX, j = (o - i) / GX, b = cur.box; if (i < b[0]) b[0] = i; if (j < b[1]) b[1] = j; if (i > b[2]) b[2] = i; if (j > b[3]) b[3] = j; },
    logBuilding(b) { if (cur) cur.blds.push(b); },
    logAdded(b) { if (cur) cur.added.push(b); },
    logLines(before, after) { if (cur) cur.lines = [before, after]; },
    commit() {
      roads.log = null; const t = cur; cur = null;
      if (!t || (!t.roads.length && !t.zones.length && !t.blds.length && !t.added.length && !t.lines)) return false;
      stack.push(t); if (stack.length > 100) stack.shift(); redoStack.length = 0; return true;
    },
    cancel() { roads.log = null; cur = null; },
    canUndo: () => stack.length > 0, canRedo: () => redoStack.length > 0,
    undo() {
      if (cur) u.commit();
      const t = stack.pop(); if (!t) return null;
      for (const b of t.added) removeBuilding(b.id);
      if (t.lines && u.setLines) u.setLines(t.lines[0]);
      for (let k = t.roads.length - 1; k >= 0; k--) { const op = t.roads[k]; if (op.op === 'add') roads.removeRaw(op.seg.id); else roads.addRaw(op.seg); }
      for (let k = t.zones.length - 3; k >= 0; k -= 3) zone[t.zones[k]] = t.zones[k + 1];
      if (t.zones.length) { refreshOverlay(t.box[0], t.box[1], t.box[2], t.box[3]); W.hooks.cellsChanged(t.box[0] - 1, t.box[1] - 1, t.box[2] + 1, t.box[3] + 1); }
      for (const b of t.blds) {
        let free = !buildings.has(b.id);
        for (let j = b.j; j < b.j + b.d && free; j++) for (let i = b.i; i < b.i + b.w; i++) if (bid[j * GX + i] || road[j * GX + i]) { free = false; break; }
        if (free) { const c = { ...b, birth: -100 }; delete c.fire; addBuilding(c); if (!c.sp) registerLoaded(c); }
      }
      redoStack.push(t); return t.label;
    },
    redo() {
      if (cur) u.commit();
      const t = redoStack.pop(); if (!t) return null;
      for (const b of t.blds) removeBuilding(b.id);
      for (const b of t.added) { let free = !buildings.has(b.id); for (let j = b.j; j < b.j + b.d && free; j++) for (let i = b.i; i < b.i + b.w; i++) if (bid[j * GX + i] || road[j * GX + i]) { free = false; break; } if (free) { const c = { ...b, birth: -100 }; addBuilding(c); if (!c.sp) registerLoaded(c); } }
      if (t.lines && u.setLines) u.setLines(t.lines[1]);
      for (const op of t.roads) { if (op.op === 'add') roads.addRaw(op.seg); else roads.removeRaw(op.seg.id); }
      for (let k = 0; k < t.zones.length; k += 3) zone[t.zones[k]] = t.zones[k + 2];
      if (t.zones.length) { refreshOverlay(t.box[0], t.box[1], t.box[2], t.box[3]); W.hooks.cellsChanged(t.box[0] - 1, t.box[1] - 1, t.box[2] + 1, t.box[3] + 1); }
      stack.push(t); return t.label;
    },
    clear() { stack.length = 0; redoStack.length = 0; cur = null; roads.log = null; },
  };
  roads.onDemolish = (b) => u.logBuilding(b);
  return u;
}
