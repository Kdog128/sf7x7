// Tech booms and busts, the startup scene and the citizen feed.
import * as THREE from 'three';
import { buildings, stats, state as W, tierOf } from './world.js';
import { sim, yearOf, seasonOf } from './sim.js';
import { city, post, hoodName, hoodAt, bpos, nm, priceIndex, money, markDirty, grid, sample } from './city.js';
import { CAT } from './structures.js';
import { clamp } from './util.js';

// [name, first year, last boom year, bust years after, peak heat, flavour]
export const WAVES = [
  ['Rebuilding boom', 1906, 1912, 1, 0.5, 'build'], ['Exposition years', 1914, 1916, 1, 0.4, 'culture'], ['Roaring Twenties', 1922, 1929, 4, 0.65, 'finance'],
  ['War boom', 1941, 1945, 1, 0.55, 'ships'], ['Postwar boom', 1950, 1957, 1, 0.45, 'build'], ['Summer of Love', 1966, 1968, 1, 0.3, 'culture'],
  ['Semiconductor wave', 1972, 1984, 2, 0.5, 'chips'], ['Dot-com', 1995, 2000, 2, 1.0, 'web'], ['Web 2.0', 2004, 2007, 2, 0.6, 'social'], ['Mobile', 2010, 2015, 1, 0.8, 'mobile'],
  ['Crypto', 2017, 2021, 1, 0.6, 'crypto'], ['AI Wave', 2023, 2028, 2, 1.0, 'ai'], ['Robotics wave', 2032, 2036, 2, 0.75, 'robots'], ['Fusion wave', 2041, 2046, 2, 0.85, 'fusion'],
  ['Neural wave', 2051, 2056, 2, 0.9, 'neural'], ['Orbital wave', 2061, 2067, 3, 1.0, 'orbital'],
];
const SECTORS = [[1900, ['Banking', 'Shipping', 'Denim', 'Railroad', 'Canning', 'Newspapers']], [1940, ['Shipbuilding', 'Radio', 'Aerospace', 'Banking']], [1965, ['Semiconductors', 'Software', 'Biotech', 'Records']],
  [1994, ['E-commerce', 'Web portal', 'Networking', 'Search']], [2003, ['Social', 'Web video', 'Cloud']], [2009, ['Mobile apps', 'Ride share', 'Delivery', 'Home share']], [2016, ['Crypto', 'Fintech', 'SaaS', 'Scooters']],
  [2022, ['AI models', 'AI agents', 'Robotaxi', 'Chips']], [2031, ['Robotics', 'Climate', 'Longevity']], [2040, ['Fusion', 'Air taxi', 'Neural', 'Orbital']]];
const N1 = ['Fog', 'Sutro', 'Karl', 'Dolores', 'Bay', 'Twin', 'Hyde', 'Pier', 'Cable', 'Presidio', 'Noe', 'Ocean', 'Lombard', 'Marin', 'Golden', 'Alta', 'Bernal', 'Potrero', 'Tamal', 'Yerba', 'Embark', 'Mint', 'Castro', 'Filbert', 'Larkin', 'Octavia', 'Balboa', 'Clement', 'Geary', 'Vallejo'];
const N2 = { old: [' and Sons', ' Trust', ' Works', ' Steam Co.', ' Mercantile', ' Lines', ' Supply'], mid: [' Systems', ' Labs', ' Devices', ' Micro', ' Logic', ' Data', ' Instruments'], web: ['.com', 'ster', 'ly', 'ify', 'base', 'loop', 'hub', 'Net', 'zilla'], now: ['.ai', ' AI', 'stack', 'mind', ' Labs', 'flow', 'scale', 'grid', ' OS', 'sense'], far: [' Fusion', ' Orbital', ' Neural', ' Robotics', ' Dynamics', ' Aero'] };
export const STAGES = ['Garage', 'Seed', 'Series A', 'Growth', 'Unicorn', 'Public'];
const BRAND = [0x4fb8c8, 0xd05a6a, 0xd8a03c, 0x6fbf73, 0x8f7fd6, 0xe07a3c, 0x4f8fd8, 0xc8c8c8];

export const tech = { wave: null, phase: 'calm', left: 0, random: true, startups: [], nextId: 1, done: [], ipos: 0, peak: 0, lastPulse: 0 };
let game = null, sprites = null; const spriteOf = new Map();
export function initTech(g) { game = g; sprites = new THREE.Group(); g.scene.add(sprites); }
export function resetTech() { Object.assign(tech, { wave: null, phase: 'calm', left: 0, random: true, startups: [], nextId: 1, done: [], ipos: 0, peak: 0 }); city.heat = 0; for (const s of spriteOf.values()) { sprites.remove(s); s.material.map.dispose(); s.material.dispose(); } spriteOf.clear(); }

const rp = (a) => a[Math.floor(Math.random() * a.length)];
export function startWave(name, peak = 0.8, years = 4, bust = 2, flavour = 'ai') {
  tech.wave = { name, peak, flavour, bust }; tech.phase = 'boom'; tech.left = years * 4;
  game.ui.toast(`${name} begins`, 'gold'); post(`${name} is here. Everyone I know just quit their job to start a company.`, 'tech');
}
export function startBust(years = 1.5) {
  const n = tech.wave ? tech.wave.name : 'The market'; tech.phase = 'bust'; tech.left = Math.round(years * 4);
  if (!tech.wave) tech.wave = { name: 'Downturn', peak: 0.4, flavour: 'none', bust: years };
  game.ui.toast(`${n} goes bust`, 'warn'); post(`${n} just popped. Moving trucks on every block.`, 'tech');
}
function scheduleByYear() {
  const y = yearOf();
  // waves only reach a place that has an economy to heat up
  if (stats.pop >= 4000) for (const w of WAVES) if (y >= w[1] && y <= w[2] && !tech.done.includes(w[0]) && tech.phase === 'calm') { tech.done.push(w[0]); startWave(w[0], w[4], Math.max(1, w[2] - y + 1), w[3], w[5]); return; }
  const last = WAVES[WAVES.length - 1];
  if (tech.random && tech.phase === 'calm' && seasonOf() === 0 && stats.pop > 4000 && Math.random() < (y > last[2] + 3 ? 0.22 : 0.07)) {
    const names = y > 2068 ? ['Quantum wave', 'Biotech wave', 'Ocean wave', 'Longevity wave', 'Climate wave', 'Lunar wave'] : ['Biotech wave', 'Clean energy wave', 'Gaming wave', 'Hardware wave', 'Finance wave'];
    startWave(rp(names), 0.45 + Math.random() * 0.5, 2 + Math.floor(Math.random() * 4), 1 + Math.floor(Math.random() * 2), 'random');
  }
}
const sectorsNow = () => { const y = yearOf(); let s = SECTORS[0][1]; for (const e of SECTORS) if (y >= e[0]) s = e[1]; return s; };
function newName() {
  const y = yearOf(), suf = y < 1960 ? N2.old : y < 1994 ? N2.mid : y < 2012 ? N2.web : y < 2040 ? N2.now : N2.far;
  for (let k = 0; k < 20; k++) { const n = rp(N1) + rp(suf); if (!tech.startups.some((s) => s.name === n)) return n; }
  return rp(N1) + ' ' + tech.nextId;
}
function pickOffice(minJobs, taken) {
  let best = null, n = 0;
  for (const b of buildings.values()) { if (b.sp || b.fire || taken.has(b.id)) continue; const z = b.zone; if (z !== 5 && z !== 6 && z !== 9) continue; if ((b.jobs || 0) < minJobs) continue; n++; if (Math.random() < 1 / n) best = b; }
  return best;
}
function pickGarage() { let best = null, n = 0; for (const b of buildings.values()) { if (b.zone !== 1 && b.zone !== 9 && b.zone !== 11) continue; n++; if (Math.random() < 1 / n) best = b; } return best; }
function mark(b, s, on) {
  if (!b) return;
  if (on) { b.sign = s.color; b.name = `${s.name} HQ`; b.vac = 0; } else { delete b.sign; if (b.name && b.name.endsWith(' HQ')) delete b.name; }
  W.hooks.chunkDirty(b.chunk); setSprite(s, on ? b : null);
}
function setSprite(s, b) {
  const old = spriteOf.get(s.id); if (old) { sprites.remove(old); old.material.map.dispose(); old.material.dispose(); spriteOf.delete(s.id); }
  if (!b || spriteOf.size >= 16) return;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#' + s.color.toString(16).padStart(6, '0'); x.beginPath(); x.roundRect(8, 8, 112, 112, 26); x.fill();
  x.fillStyle = '#14161a'; x.font = '700 76px Switzer, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s.name[0], 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, fog: false })); const size = clamp(b.height * 0.16, 9, 30);
  const [bx, bz] = bpos(b); sp.position.set(bx, b.baseY + b.height + size * 0.9 + 6, bz); sp.scale.set(size, size, 1); sprites.add(sp); spriteOf.set(s.id, sp);
}
export const active = () => tech.startups.filter((s) => s.status === 'active' || s.status === 'public');
function found() {
  const g = pickGarage(); if (!g) return;
  const s = { id: tech.nextId++, name: newName(), sector: rp(sectorsNow()), stage: 0, staff: 2 + Math.floor(Math.random() * 3), val: 0.5, b: g.id, born: yearOf(), status: 'active', color: rp(BRAND), hood: hoodName(hoodAt(...bpos(g))) };
  tech.startups.push(s); if (tech.startups.length > 160) { const k = tech.startups.findIndex((q) => q.status === 'closed' || q.status === 'acquired'); if (k >= 0) tech.startups.splice(k, 1); }
  if (Math.random() < 0.3) post(`Two people in a garage in ${s.hood || 'the city'} just started ${s.name}. ${s.sector}, apparently.`, 'tech');
}
function promote(s, taken) {
  s.stage++; s.staff = Math.round(s.staff * (2.2 + Math.random() * 1.6)); s.val = +(s.val * (3 + Math.random() * 4)).toFixed(1);
  const old = buildings.get(s.b);
  if (s.stage >= 1) { const o = pickOffice(Math.min(s.staff, 2500) * 0.6, taken); if (o) { if (old && old.sign) mark(old, s, false); s.b = o.id; taken.add(o.id); s.hood = hoodName(hoodAt(...bpos(o))); } }
  const b = buildings.get(s.b);
  if (s.stage >= 3 && b && !b.sp && (b.zone === 5 || b.zone === 6 || b.zone === 9)) mark(b, s, true);
  if (s.stage === 4) { s.val = Math.max(s.val, 1000 + Math.round(Math.random() * 900)); game.ui.toast(`${s.name} is now a unicorn`, 'gold'); post(`${s.name} just hit a $${(s.val / 1000).toFixed(1)}B valuation. My landlord heard.`, 'tech'); }
  if (s.stage === 5) {
    s.status = 'public'; tech.ipos++; const cash = Math.round(s.val * 0.002 * 1000) / 1; if (city.cfg.money === 'budget') city.treasury += cash * priceIndex() * 0.2;
    game.ui.toast(`${s.name} goes public`, 'gold'); post(`${s.name} rang the bell this morning. ${s.staff.toLocaleString('en-US')} employees, a lot of new homebuyers.`, 'tech', 'sf_biz_times'); city.boost = (city.boost || 0) + 0.01;
  }
}
function close(s, why) {
  const b = buildings.get(s.b); if (b) { if (b.sign) mark(b, s, false); if (s.stage >= 2 && !b.sp) { b.vac = 1; b.vacDay = sim.day; W.hooks.chunkDirty(b.chunk); } }
  setSprite(s, null); s.status = why; s.ended = yearOf();
}
export function techDay() {
  scheduleByYear();
  // phase clock
  if (tech.phase !== 'calm') { tech.left--; if (tech.left <= 0) { if (tech.phase === 'boom' && tech.wave.bust > 0) startBust(tech.wave.bust); else { tech.phase = 'calm'; tech.wave = null; post('Things feel normal again. Rents did not get the memo.', 'tech'); } } }
  const target = tech.phase === 'boom' ? tech.wave.peak : tech.phase === 'bust' ? -0.45 * (tech.wave ? tech.wave.peak + 0.3 : 1) : 0;
  city.heat += (target - city.heat) * (tech.phase === 'bust' ? 0.45 : 0.3); if (Math.abs(city.heat) < 0.01) city.heat = 0; tech.peak = Math.max(tech.peak, city.heat);
  // startups
  const act = tech.startups.filter((s) => s.status === 'active'), heat = city.heat, uni = [...buildings.values()].some((b) => b.sp === 'university') ? 1.5 : 1;
  const want = Math.min(48, Math.floor((stats.jobsO / 900 + stats.pop / 9000) * (0.6 + Math.max(0, heat) * 2.5) * uni));
  for (let k = 0; k < 3 && act.length + k < want; k++) if (Math.random() < 0.5 + heat * 0.4) found();
  const taken = new Set(tech.startups.filter((s) => s.status !== 'closed' && s.status !== 'acquired').map((s) => s.b));
  for (const s of act) {
    if (!buildings.has(s.b)) { const o = s.stage ? pickOffice(0, taken) : pickGarage(); if (o) { s.b = o.id; if (s.stage >= 3) mark(o, s, true); } else { close(s, 'closed'); continue; } }
    const r = Math.random(), up = 0.13 + heat * 0.16 - s.stage * 0.015, down = 0.05 - heat * 0.05 + (tech.phase === 'bust' ? 0.16 : 0) + (s.stage === 0 ? 0.04 : 0);
    if (r < up) promote(s, taken);
    else if (r < up + down) {
      if (s.stage >= 2 && Math.random() < 0.4) { const big = tech.startups.filter((q) => q.status === 'public' || (q.status === 'active' && q.stage > s.stage)); if (big.length) { const by = rp(big); close(s, 'acquired'); s.by = by.name; post(`${by.name} is buying ${s.name}. The ${s.name} sign is already coming down.`, 'tech', 'sf_biz_times'); continue; } }
      if (s.stage >= 2 && tech.phase === 'bust' && Math.random() < 0.6) { const cut = Math.round(s.staff * 0.3); s.staff -= cut; s.val = +(s.val * 0.5).toFixed(1); post(`${s.name} laid off ${cut.toLocaleString('en-US')} people today. Free standing desks on the sidewalk.`, 'tech'); continue; }
      close(s, 'closed'); if (s.stage >= 2) post(`${s.name} is shutting down. ${s.hood ? s.hood + ' has' : 'There is'} one more empty floor.`, 'tech');
    }
  }
  for (const s of tech.startups) if (s.status === 'public') { s.staff = Math.round(s.staff * (1 + heat * 0.06)); s.val = +(s.val * (1 + heat * 0.08 + (Math.random() - 0.5) * 0.06)).toFixed(1); if (!buildings.has(s.b)) { const o = pickOffice(200, taken); if (o) { s.b = o.id; mark(o, s, true); } } }
  // vacancies fill again when things recover
  if (heat > -0.05) for (const b of buildings.values()) if (b.vac && sim.day - (b.vacDay || 0) > 6) { b.vac = 0; W.hooks.chunkDirty(b.chunk); }
  if (tech.phase === 'bust') { let n = 0; for (const b of buildings.values()) { if (n > 6) break; if ((b.zone === 6 || b.zone === 9 || b.zone === 5) && !b.vac && !b.sign && Math.random() < 0.02) { b.vac = 1; b.vacDay = sim.day; W.hooks.chunkDirty(b.chunk); n++; } } }
  markDirty();
}
export function relinkTech() { for (const s of tech.startups) { const b = buildings.get(s.b); if (b && s.stage >= 3 && (s.status === 'active' || s.status === 'public') && b.sign) setSprite(s, b); } }
export const serializeTech = () => ({ wave: tech.wave, phase: tech.phase, left: tech.left, random: tech.random, startups: tech.startups, nextId: tech.nextId, done: tech.done, ipos: tech.ipos, peak: tech.peak });
export function loadTech(d) { resetTech(); if (d) Object.assign(tech, d); }
export const waveLabel = () => (tech.phase === 'boom' ? `${tech.wave.name}: boom` : tech.phase === 'bust' ? `${tech.wave.name}: bust` : 'Calm');

// ---- citizen feed: posts that react to the state of the city ----------------------------------------
const PULSE = [
  [(c) => c.rent > 3400 * priceIndex(), () => `Average rent is ${money(city.rent / 1000).replace('K', '')} a month now. I live in a closet with a view of a closet.`],
  [(c) => c.rent < 1500 * priceIndex() && stats.pop > 3000, () => 'Found a one bedroom I can afford. Not telling anyone where.'],
  [(c) => c.trafficAvg > 0.55, () => 'Forty minutes to cross Van Ness. I could have walked. I should have walked.'],
  [(c) => c.trafficAvg < 0.15 && stats.pop > 5000, () => 'Green lights the whole way down Geary. Buying a lottery ticket.'],
  [(c) => c.noiseAvg > 0.35, () => 'The bass from down the block is rattling my sourdough starter.'],
  [(c) => c.sat > 0.75, () => 'Honestly? The city is working right now. Parks are clean, trains show up.'],
  [(c) => c.sat < 0.4, () => 'Everything costs more and works less. Someone tell City Hall.'],
  [(c) => c.transitShare > 0.5, () => 'Sold the car. Between the bus and the metro I have not missed it once.'],
  [(c) => c.transitShare < 0.05 && stats.pop > 8000, () => 'A city this size and still no real transit. We need lines.'],
  [(c) => c.wx.fog > 0.5, () => 'Karl rolled in at four. Could not see the end of my own street.', 'karl_the_fog'],
  [(c) => c.wx.rain > 0.4, () => 'Raining sideways on Market. Every umbrella in the city is already inside out.'],
  [(c) => c.heat > 0.6, () => 'Three robotaxis and a guy pitching his startup at the taqueria. It is a boom.'],
  [(c) => c.heat > 0.6, () => 'Line out the door at the open house. Forty applications before noon.', 'sf_rent_watch'],
  [(c) => c.heat < -0.2, () => 'For lease signs on every other office window downtown.'],
  [(c) => c.heat < -0.2, () => 'Rent dropped for the first time in years. Small mercies.', 'sf_rent_watch'],
  [(c) => c.lvAvg > 0.7, () => 'They are asking two million for a house with no garage. And they will get it.'],
  [(c) => c.tourism > 25, () => 'Tourists in shorts at the wharf again. Nobody warned them about the summer.'],
  [() => tierOf(stats.pop) >= 6, () => 'Remember when this was a few houses and a dirt road? The skyline now.'],
  [() => stats.pop > 200 && stats.pop < 3000, () => 'New neighbors moved in. That makes nine of us on the block.'],
  [() => stats.jobsI > stats.pop * 0.2, () => 'The port never sleeps. Neither do I, I live next to it.'],
  [() => true, () => 'Burrito index holding steady.', 'burrito_index'], [() => true, () => 'The N is stuck in the tunnel again.', 'muni_diaries'],
  [() => true, () => 'Sunset from Twin Peaks tonight. Worth the climb.'], [() => true, () => 'Parrots on Telegraph Hill are loud this morning.'],
  [() => seasonOf() === 2, () => 'Coldest winter I ever spent was this summer. Layers, people.'], [() => seasonOf() === 3, () => 'October heat. Dolores Park is a beach today.'],
];
export function pulse(force = false) {
  if (!force && (stats.pop < 150 || Math.random() > 0.75)) return;
  const ok = PULSE.filter((p) => p[0](city)); if (!ok.length) return;
  const specific = ok.filter((p) => p[0].toString() !== '() => true'), p = specific.length && Math.random() < 0.7 ? rp(specific) : rp(ok);
  post(p[1](), 'life', p[2] || null);
}
void CAT; void nm; void grid; void sample;
