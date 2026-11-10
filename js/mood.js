// How residents react to what the player builds. Each reaction is a feed post, a line in the building's
// details and a local change in satisfaction that fades over two years (8 game days).
import { MAP } from './terrain.js';
import { CELL, GX, GZ, zone, buildings } from './world.js';
import { CAT } from './structures.js';
import { city, post, nm, hoodName, hoodAt, markDirty, moodFx } from './city.js';
import { sim } from './sim.js';

const DAYS = 8;
const pick = (a, seed) => a[Math.abs(seed) % a.length];
const centre = (b) => b.yaw ? [b.cx, b.cz] : [MAP.minX + (b.i + b.w / 2) * CELL, MAP.minZ + (b.j + b.d / 2) * CELL];

// what is around a point: shares of homes, shops, offices and industry among zoned cells within r metres
function around(x, z, r) {
  const i0 = Math.max(0, Math.floor((x - r - MAP.minX) / CELL)), i1 = Math.min(GX - 1, Math.floor((x + r - MAP.minX) / CELL));
  const j0 = Math.max(0, Math.floor((z - r - MAP.minZ) / CELL)), j1 = Math.min(GZ - 1, Math.floor((z + r - MAP.minZ) / CELL));
  let res = 0, com = 0, off = 0, ind = 0, n = 0;
  for (let j = j0; j <= j1; j += 2) for (let i = i0; i <= i1; i += 2) {
    const z0 = zone[j * GX + i]; if (!z0) continue;
    if (Math.hypot(MAP.minX + (i + 0.5) * CELL - x, MAP.minZ + (j + 0.5) * CELL - z) > r) continue;
    n++; if (z0 <= 2) res++; else if (z0 === 11) { res += 0.5; com += 0.5; } else if (z0 === 3 || z0 === 4 || z0 === 10) com++; else if (z0 <= 6 || z0 === 9) off++; else ind++;
  }
  return n ? { res: res / n, com: com / n, off: off / n, ind: ind / n, n } : { res: 0, com: 0, off: 0, ind: 0, n: 0 };
}
function nearbyOf(keys, x, z, r, skip) {
  let n = 0; for (const b of buildings.values()) if (b.id !== skip && b.sp && keys.includes(b.sp)) { const [bx, bz] = centre(b); if (Math.hypot(bx - x, bz - z) < r) n++; }
  return n;
}

const CLUBS = ['club', 'superclub', 'popup'], VENUES = ['musicvenue', ...CLUBS], BIG = ['stadium', 'ballpark', 'arena', 'soccer', 'olympic'];
// { v: local effect, wide: city-wide effect, r: reach in metres, text } or null for small things nobody notices
function judge(b) {
  const c = CAT[b.sp]; if (!c) return null;
  const [x, z] = centre(b), a = around(x, z, 220), name = nm(c.name), s = b.seed | 0, homey = a.n > 6 && a.res > 0.55, busy = a.n > 6 && a.com + a.off + a.ind > 0.55;
  if (c.cat === 'landmark') return { v: 0.06, wide: 0.02, r: 900, text: pick([`People are proud of ${name}.`, `${name} is open and everyone wants a photo.`, `${name} already feels like it was always there.`], s) };
  if (CLUBS.includes(b.sp)) {
    const strip = nearbyOf(VENUES, x, z, 450, b.id);
    if (homey) return { v: -0.06, wide: 0, r: 320, text: pick(['Neighbors are worried about noise and late crowds.', 'Residents on the block are not happy about a club next door.', 'Neighbors are already asking about closing time.'], s) };
    if (strip >= 2) return { v: 0.04, wide: 0.004, r: 400, text: 'The nightlife strip is growing. Regulars approve.' };
    if (busy) return { v: 0.03, wide: 0.002, r: 320, text: 'Good spot for a club. Nobody is trying to sleep here.' };
    return { v: -0.01, wide: 0, r: 280, text: 'Mixed feelings. Some like it, some want earplugs.' };
  }
  if (b.sp === 'musicvenue') return homey ? { v: -0.03, wide: 0.002, r: 300, text: 'Music fans are excited, neighbors less so.' } : { v: 0.04, wide: 0.004, r: 360, text: 'A new room for live music. Fans are buying tickets.' };
  if (b.sp === 'comedy') return { v: 0.02, wide: 0, r: 220, text: homey ? 'A small room. Neighbors do not mind.' : 'A new comedy room. Open mic sign-ups are full.' };
  if (BIG.includes(b.sp)) return homey ? { v: -0.03, wide: 0.03, r: 700, text: 'The city is excited. Nearby residents dread game-day traffic.' } : { v: 0.04, wide: 0.03, r: 700, text: pick(['The city is excited for opening day.', 'Season tickets are selling fast.'], s) };
  if (c.cat === 'sport') return { v: 0.02, wide: 0.004, r: 400, text: 'Locals have somewhere new to play.' };
  if (b.sp === 'school' || b.sp === 'university') return { v: 0.04, wide: 0.003, r: 500, text: 'Parents nearby are relieved.' };
  if (b.sp === 'hospital') return { v: 0.04, wide: 0.004, r: 700, text: 'Good to have care close by.' };
  if (b.sp === 'police') return { v: busy && nearbyOf(VENUES, x, z, 500, b.id) ? 0.02 : 0.03, wide: 0.002, r: 500, text: 'The neighborhood feels a little safer.' };
  if (b.sp === 'fire') return { v: 0.03, wide: 0.002, r: 500, text: 'Faster response times. Residents are glad.' };
  if (b.sp === 'park' || b.sp === 'plaza') return { v: 0.04, wide: 0.002, r: 360, text: pick(['New green space. Dog owners approve.', 'Somewhere to sit in the sun, when there is sun.'], s) };
  if (b.sp === 'fountain') return { v: 0.01, wide: 0, r: 160, text: 'A nice touch.' };
  return null;   // trees, benches, lamps and planters: nobody posts about those
}

export function makeMood(game) {
  const m = {
    // called when the player builds something
    react(b) {
      if (!b || !b.sp || game.readOnly) return null;
      const j = judge(b); if (!j) return null;
      const [x, z] = centre(b);
      b.mood = { v: j.v, text: j.text };
      if (!city.moods) city.moods = [];
      city.moods.push({ x: Math.round(x), z: Math.round(z), r: j.r, v: j.v, wide: j.wide, d0: sim.day, id: b.id });
      if (city.moods.length > 80) city.moods.shift();
      const hood = hoodName(hoodAt(x, z));
      post(hood ? `${hood}: ${j.text}` : j.text, j.v < 0 ? 'tax' : 'life');
      if (j.v < 0) game.ui.toast(j.text, 'warn'); else if (j.v >= 0.04 && CAT[b.sp].cat !== 'landmark') game.ui.toast(j.text);
      markDirty();
      return j;
    },
    // active reactions as [x, z, reach, strength], fading over DAYS; the city grid adds them to satisfaction
    list() { const out = []; for (const q of city.moods || []) { const f = 1 - (sim.day - q.d0) / DAYS; if (f > 0 && buildings.has(q.id)) out.push([q.x, q.z, q.r, q.v * f]); } return out; },
    wide() { let s = 0; for (const q of city.moods || []) { const f = 1 - (sim.day - q.d0) / DAYS; if (f > 0) s += (q.wide || 0) * f; } return Math.min(0.08, s); },
    prune() { if (city.moods) city.moods = city.moods.filter((q) => sim.day - q.d0 < DAYS && buildings.has(q.id)); },
  };
  moodFx.list = () => m.list(); moodFx.wide = () => m.wide();
  return m;
}
