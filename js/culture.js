// Culture: nightlife venues and talent, sports teams and seasons, festivals, the street circuit,
// the Olympic bid, manual disasters, achievements and quick tips.
import { buildings, stats, removeBuilding, tierOf, bid, GX, inGrid, state as W, land, road, toI, toJ } from './world.js';
import { sim, yearOf, seasonOf } from './sim.js';
import { ll, K, heightAt } from './terrain.js';
import { city, post, nm, addParody, fx, extraNoise, markDirty, grid, sample, bpos, hoodName, hoodAt, priceIndex } from './city.js';
import { CAT, VENUE_NAMES, CATALOG } from './structures.js';
import { tech } from './tech.js';
import { clamp } from './util.js';

const rp = (a) => a[Math.floor(Math.random() * a.length)];
export const FAME = ['Unknown', 'Local favorite', 'SF staple', 'Headliner'];
export const fameTier = (f) => (f >= 75 ? 3 : f >= 45 ? 2 : f >= 20 ? 1 : 0);
export const ROOM = ['Open mic room', 'Showcase room', 'Headliner room'];
export const roomTier = (s) => (s >= 60 ? 2 : s >= 30 ? 1 : 0);
const KIND_OF = { club: 'dj', superclub: 'dj', popup: 'dj', music: 'band', comedy: 'comic' };
export const KIND_LABEL = { dj: 'DJ', band: 'Band', comic: 'Comedian' };
const NAMES = {
  dj: [['DJ', 'Miss', 'Kid', 'Lady', 'Sir', 'Uncle', 'Baby', 'Saint', 'Doctor', 'Young'], ['Fog', 'Sutro', 'Karl', 'Muni', 'Tamale', 'Dolores', 'Sourdough', 'Bart', 'Twin Peaks', 'Lombard', 'Ocean Beach', 'Parrot', 'Cable', 'Divis', 'Outer Sunset', 'Low Tide']],
  band: [['The', 'Thee', 'Los', 'Tiny', 'Great', 'Electric', 'Midnight', 'Foggy'], ['Parklets', 'Sea Lions', 'Fernets', 'Burritos', 'Cable Cars', 'Mission Bells', 'Presidios', 'Haight Mail', 'Bison', 'Painted Ladies', 'Night Owls', 'Tule Elks', 'Tenderloins']],
  comic: [['Dana', 'Marcus', 'Priya', 'Leo', 'Imani', 'Wes', 'Rosa', 'Theo', 'Mei', 'Omar', 'Gwen', 'Tito', 'June', 'Rafa', 'Nell', 'Sasha'], ['Okafor', 'Lindqvist', 'Tran', 'Delgado', 'Abernathy', 'Kowalski', 'Nakamura', 'Fitzroy', 'Castellanos', 'Wu', 'Baptiste', 'Greenberg', 'Oyelaran', 'Park']],
};
export const LEAGUES = {
  MLB: { from: 1958, team: 'Giants', parody: 'Giantz', sport: 'Baseball', seasons: [1, 2, 3], games: 54, rivals: ['Dodgers', 'Padres', 'Diamondbacks', 'Rockies'] },
  NBA: { from: 1962, team: 'Warriors', parody: 'Worriers', sport: 'Basketball', seasons: [3, 0, 1], games: 27, rivals: ['Lakers', 'Kings', 'Suns', 'Clippers'] },
  WNBA: { from: 2025, team: 'Valkyries', parody: 'Valkyrees', sport: 'Basketball', seasons: [2], games: 44, rivals: ['Aces', 'Storm', 'Sparks', 'Mercury'] },
  NFL: { from: 1946, team: '49ers', parody: '69ers', sport: 'Football', seasons: [3, 0], games: 9, rivals: ['Seahawks', 'Rams', 'Cardinals'] },
  NHL: { from: 1991, team: 'Sharks', parody: 'Shorks', sport: 'Hockey', seasons: [3, 0, 1], games: 27, rivals: ['Kings', 'Ducks', 'Golden Knights', 'Kraken'] },
  MLS: { from: 1996, team: 'Earthquakes', parody: 'Aftershocks', sport: 'Soccer', seasons: [1, 2, 3], games: 11, rivals: ['Galaxy', 'LAFC', 'Timbers', 'Sounders'] },
  Tennis: { team: 'San Francisco Open', parody: 'Fog City Open', sport: 'Tennis', seasons: [2], tournament: true },
  Golf: { team: 'Presidio Invitational', parody: 'Sand Trap Invitational', sport: 'Golf', seasons: [1], tournament: true },
};
for (const l of Object.values(LEAGUES)) addParody(l.team, l.parody);
[['Dodgers', 'Codgers'], ['Lakers', 'Fakers'], ['Seahawks', 'Seasquawks'], ['Rams', 'Lambs'], ['Kings', 'Dukes'], ['Padres', 'Madres'], ['Galaxy', 'Nebula']].forEach(([a, b]) => addParody(a, b));

// festivals: season index (0 winter .. 3 fall), hours, site, kind of staging
export const FESTS = [
  { k: 'sketchfest', from: 2002, name: 'SF Sketchfest', parody: 'SF Skitfest', season: 0, h: [18, 23], at: [-122.4105, 37.7880], kind: 'stage', pop: 3000, need: 'comedy', tour: 5, note: 'Needs a comedy club' },
  { k: 'b2b', from: 1912, name: 'Bay to Breakers', parody: 'Bay to Shakers', season: 1, h: [8, 12], at: [-122.3937, 37.7936], to: [-122.5090, 37.7694], kind: 'run', pop: 5000, tour: 6 },
  { k: 'carnaval', from: 1979, name: 'Carnaval', parody: 'Carnivale', season: 1, h: [11, 17], at: [-122.4186, 37.7650], to: [-122.4148, 37.7520], kind: 'parade', pop: 4000, tour: 5 },
  { k: 'pride', from: 1970, name: 'Pride', parody: 'Pride', season: 2, h: [10, 17], at: [-122.3960, 37.7935], to: [-122.4180, 37.7790], kind: 'parade', pop: 4000, tour: 9 },
  { k: 'outsidelands', from: 2008, name: 'Outside Lands', parody: 'Inside Lands', season: 2, h: [12, 22], at: [-122.4927, 37.7683], kind: 'stage', pop: 10000, tour: 10 },
  { k: 'hsb', from: 2001, name: 'Hardly Strictly Bluegrass', parody: 'Barely Strictly Bluegrass', season: 3, h: [11, 19], at: [-122.4830, 37.7700], kind: 'stage', pop: 6000, tour: 6 },
  { k: 'fleetweek', from: 1981, name: 'Fleet Week', parody: 'Float Week', season: 3, h: [12, 16], at: [-122.4370, 37.8062], kind: 'jets', pop: 8000, tour: 8 },
  { k: 'portola', from: 2022, name: 'Portola', parody: 'Portolah', season: 3, h: [13, 23], at: [-122.3830, 37.7500], kind: 'stage', pop: 12000, tour: 8 },
  { k: 'dreamforce', from: 2003, name: 'Dreamforce', parody: 'Dreamfarce', season: 3, h: [9, 18], at: [-122.4010, 37.7840], kind: 'expo', pop: 15000, need: 'office', tour: 9, note: 'Needs 5,000 office jobs' },
];
for (const f of FESTS) addParody(f.name, f.parody);
[['San Francisco Grand Prix', 'Fog City Grand Prix'], ['Olympic Games', 'Olympish Games'], ['Olympic park', 'Olympish park']].forEach(([a, b]) => addParody(a, b));

export const ACH = [
  ['first', 'First residents', 'Someone moved in', () => stats.pop > 0], ['town', 'Town', 'Reach 5,000 residents', () => stats.pop >= 5000], ['city', 'City', 'Reach 40,000 residents', () => stats.pop >= 40000],
  ['metro', 'Metropolis', 'Reach 100,000 residents', () => stats.pop >= 100000], ['tall', 'Skyline', 'A building over 150 m', () => C.maxH >= 150], ['supertall', 'Supertall', 'A building over 300 m', () => C.maxH >= 300],
  ['gate', 'The Gate', 'Build the Golden Gate Bridge', () => C.has('goldengate')], ['spans', 'Both spans', 'Build both bridges', () => C.has('goldengate') && C.has('baybridge')],
  ['postcard', 'Postcard row', 'Build the Painted Ladies', () => C.has('paintedladies')], ['landmarks', 'Tour guide', 'Build all 12 landmarks', () => CATALOG.filter((c) => c.cat === 'landmark').every((c) => C.has(c.k))],
  ['lines', 'Network', 'Run 5 transit lines', () => city.lines.length >= 5], ['modes', 'Every way to ride', 'Run bus, cable car, metro and ferry', () => ['bus', 'cable', 'metro', 'ferry'].every((t) => city.lines.some((l) => l.type === t))],
  ['green', 'Green city', 'Place 20 parks', () => C.count('park') >= 20], ['happy', 'City that works', 'Reach 80% satisfaction with 10,000 residents', () => city.sat >= 0.8 && stats.pop >= 10000],
  ['served', 'Covered', 'Build every city service', () => ['school', 'university', 'hospital', 'police', 'fire'].every((k) => C.has(k))],
  ['boom', 'Top of the wave', 'Ride a boom to its peak', () => city.heat >= 0.85], ['bust', 'Still standing', 'Come out of a bust', () => C.bustOver], ['unicorn', 'Unicorn', 'A local startup reaches unicorn', () => tech.startups.some((s) => s.stage >= 4)],
  ['ipo', 'Bell ringers', 'Three local IPOs', () => tech.ipos >= 3], ['night', 'Nightlife district', 'Run 5 venues', () => culture.venues.length >= 5], ['soldout', 'Sold out', 'Sell out a superclub', () => C.soldOut],
  ['headliner', 'From the open mic', 'An artist reaches Headliner', () => culture.artists.some((a) => a.fame >= 75)], ['own', 'Hometown act', 'One of your own artists becomes an SF staple', () => culture.artists.some((a) => a.own && a.fame >= 45)],
  ['title', 'Champions', 'Win a title', () => Object.values(culture.teams).some((t) => t.titles > 0)], ['dynasty', 'Dynasty', 'Win 3 titles', () => Object.values(culture.teams).reduce((s, t) => s + t.titles, 0) >= 3],
  ['fest', 'Festival season', 'Hold 5 festivals', () => Object.values(culture.fests).reduce((s, f) => s + (f.held || 0), 0) >= 5], ['allfest', 'Full calendar', 'Hold all 9 festivals', () => FESTS.every((f) => culture.fests[f.k] && culture.fests[f.k].held)],
  ['gp', 'Lights out', 'Hold a Grand Prix', () => culture.f1.races > 0], ['games', 'Host city', 'Host the Olympic Games', () => culture.oly.stage === 4],
  ['quake', 'Shaken', 'Come through a magnitude 7 earthquake', () => C.bigQuake], ['fill', 'New ground', 'Make 5 hectares of new land', () => C.fillArea >= 50000], ['historic', 'Preservationist', 'Lock 10 buildings as historic', () => C.locked >= 10],
  ['century', 'A century on', 'Play 100 years', () => sim.day >= 400], ['future', 'The future', 'Reach 2040', () => yearOf() >= 2040], ['surplus', 'In the black', 'Hold $1B in budget mode', () => city.cfg.money === 'budget' && city.treasury >= 1e6],
];
const C = { maxH: 0, bustOver: false, soldOut: false, bigQuake: false, fillArea: 0, locked: 0, has: (k) => (C.sp[k] || 0) > 0, count: (k) => C.sp[k] || 0, sp: {} };
export const counters = C;

export const TIPS = [
  ['road', 'Start with a road. Pick Roads, then click two points on land.', (g) => g.roads.segs.size === 0 && g.clock > 6],
  ['zone', 'Zone land next to a road. Buildings only appear on lots that touch a street.', (g) => g.roads.segs.size > 0 && stats.count === 0 && g.clock > 20],
  ['demand', 'The R C O I bars show demand. Zone more of whatever is highest.', () => stats.pop > 60],
  ['pan', 'Hold Space and drag to move the map while a tool is active.', (g) => g.tools.state.tool !== 'inspect' && stats.pop > 200],
  ['jam', 'Some roads are jammed. Click one to see how full it is, then upgrade it, add a parallel route or a transit line.', (g) => g.traffic && g.traffic.stats.ready && g.traffic.stats.jams.some((j) => j.x > 1.1)],
  ['dark', 'Dark zones grow tall in the middle of dense districts.', () => stats.pop > 4000],
  ['parks', 'Parks and services raise land value. Overlays show how far they reach.', () => stats.pop > 1500 && C.count('park') === 0],
  ['transit', 'Traffic is building up. A bus or metro line takes cars off the road.', () => city.trafficAvg > 0.4 && city.lines.length === 0],
  ['noise', 'Venues are loud at night. Keep them away from homes, or pass a noise ordinance.', () => culture.venues.length > 0 && city.noiseAvg > 0.2],
  ['budget', 'Spending is above income. Raise a tax, or cut services you do not need yet.', () => city.cfg.money === 'budget' && city.income < city.expense && stats.pop > 500],
  ['lock', 'Lock a building you like and it will never be redeveloped.', () => C.maxH > 60],
  ['fill', 'Smart-fill adds trees, benches and lamps to an area in one drag.', () => stats.pop > 6000 && C.count('tree') === 0],
  ['boom', 'A boom raises office demand and rents. A bust follows most of them.', () => city.heat > 0.4],
];

export const culture = { venues: [], artists: [], nextArtist: 1, teams: {}, fests: {}, live: [], f1: { pts: null, races: 0, pit: 0 }, oly: { stage: 0, day: 0, score: 0, tries: 0 }, ach: {}, tips: {}, fires: [], champs: [], rising: [], held: 0 };
let game = null;
export function initCulture(g) { game = g; seedArtists(); }
export function resetCulture() {
  Object.assign(culture, { venues: [], artists: [], nextArtist: 1, teams: {}, fests: {}, live: [], f1: { pts: null, races: 0, pit: 0 }, oly: { stage: 0, day: 0, score: 0, tries: 0 }, ach: {}, tips: culture.tips, fires: [], champs: [], rising: [], held: 0 });
  Object.assign(C, { maxH: 0, bustOver: false, soldOut: false, bigQuake: false, fillArea: 0, locked: 0, sp: {} }); extraNoise.length = 0; city.eventTour = 0; seedArtists();
}
function artistName(kind) { const n = NAMES[kind]; for (let k = 0; k < 30; k++) { const s = `${rp(n[0])} ${rp(n[1])}`; if (!culture.artists.some((a) => a.name === s)) return s; } return `${rp(n[0])} ${rp(n[1])} ${culture.nextArtist}`; }
export function addArtist(name, kind, own = false, fame = 0) { const a = { id: culture.nextArtist++, name: name.trim().slice(0, 40), kind, fame, gain: 0, plays: 0, follow: own, own, first: null, last: 0 }; culture.artists.push(a); return a; }
function seedArtists() { if (culture.artists.length) return; for (const k of ['dj', 'dj', 'dj', 'band', 'band', 'comic', 'comic']) for (let n = 0; n < 4; n++) addArtist(artistName(k), k, false, Math.random() < 0.15 ? 30 + Math.random() * 30 : Math.random() * 18); }

// ---- structures appearing and leaving ---------------------------------------------------------------
export function onAdded(b) {
  if (!b.sp) { if (b.height > C.maxH) C.maxH = b.height; return; }
  C.sp[b.sp] = (C.sp[b.sp] || 0) + 1; const cat = CAT[b.sp]; if (!cat) return;
  if (cat.fx.venue && !culture.venues.some((v) => v.id === b.id)) {
    const pool = VENUE_NAMES[b.sp === 'superclub' ? 'superclub' : b.sp === 'popup' ? 'popup' : cat.fx.venue] || VENUE_NAMES.club, used = new Set(culture.venues.map((v) => v.name));
    const name = b.vname || pool.find((n) => !used.has(n)) || `${rp(pool)} ${culture.venues.length + 1}`;
    b.name = name; b.vname = name;
    culture.venues.push({ id: b.id, name, kind: cat.fx.venue, sp: b.sp, cap: cat.fx.cap, score: b.sp === 'superclub' ? 42 : b.sp === 'musicvenue' ? 30 : 12, born: sim.day, tonight: null, best: 0, temp: cat.fx.temp ? sim.day + cat.fx.temp : 0 });
  }
  if (cat.fx.league) for (const lg of cat.fx.league.split(',')) ensureTeam(lg, b);
}
export function onRemoved(b) {
  if (!b.sp) return; C.sp[b.sp] = Math.max(0, (C.sp[b.sp] || 0) - 1);
  const k = culture.venues.findIndex((v) => v.id === b.id); if (k >= 0) culture.venues.splice(k, 1);
  for (const t of Object.values(culture.teams)) if (t.venue === b.id) { const alt = [...buildings.values()].find((q) => q.sp && q.id !== b.id && CAT[q.sp] && (CAT[q.sp].fx.league || '').split(',').includes(t.lg)); t.venue = alt ? alt.id : 0; }
  if (culture.f1.pit === b.id) culture.f1.pit = 0;
}
function ensureTeam(lg, b) {
  const L = LEAGUES[lg]; if (!L || yearOf() < (L.from || 0)) return; let t = culture.teams[lg];   // no team before its first season in the Bay Area
  if (!t) { t = culture.teams[lg] = { lg, name: L.team, w: 0, l: 0, str: 0.42 + Math.random() * 0.14, titles: 0, venue: b.id, table: (L.rivals || []).map((n) => ({ n, w: 0, l: 0, s: 0.4 + Math.random() * 0.2 })), last: '', champs: [] }; if (game && game.mode === 'play' && b.birth > 0) { game.ui.toast(L.tournament ? `The ${nm(L.team)} comes to town` : `The ${nm(L.team)} have a home`, 'gold'); post(L.tournament ? `The ${nm(L.team)} is on the calendar.` : `The ${nm(L.team)} are playing at ${nm(CAT[b.sp].name)} this season. Finally.`, 'sport'); } }
  else if (!t.venue || !buildings.has(t.venue)) t.venue = b.id;
}

// ---- nightlife ---------------------------------------------------------------------------------------
function nightly() {
  const f = fx(), pool = culture.artists; for (const a of pool) a.gain *= 0.72;
  const booked = new Set(); let top = null;
  const vs = culture.venues.slice().sort((a, b) => b.score - a.score);
  for (const v of vs) {
    const b = buildings.get(v.id); if (!b) continue;
    if (v.temp && sim.day >= v.temp) { post(`${v.name} packed up overnight. It was never there.`, 'night'); removeBuilding(v.id); continue; }
    const kind = KIND_OF[v.sp] || KIND_OF[v.kind] || 'dj', tier = roomTier(v.score), want = tier === 2 ? 70 : tier === 1 ? 38 : 8;
    const cands = pool.filter((a) => a.kind === kind && !booked.has(a.id)).sort((a, q) => Math.abs(a.fame - want) + Math.random() * 14 - (a.follow ? 6 : 0) - (Math.abs(q.fame - want) + Math.random() * 14 - (q.follow ? 6 : 0)));
    const acts = cands.slice(0, tier === 0 ? 3 : 2); if (!acts.length) { v.tonight = null; continue; }
    for (const a of acts) booked.add(a.id);
    const head = acts.reduce((m, a) => (a.fame > m.fame ? a : m), acts[0]), [x, z] = bpos(b), sat = sample(grid.sat, x, z), homes = sample(grid.dens, x, z);
    const draw = Math.min(v.cap, Math.round(v.cap * clamp((0.22 + head.fame / 100 * 0.75 + v.score / 260) * f.buzzMul * (0.7 + sat * 0.5) * (0.85 + Math.random() * 0.3) * Math.min(1, 0.25 + stats.pop / (v.cap * 14)), 0.03, 1)));
    const fill = draw / v.cap; v.tonight = { acts: acts.map((a) => a.id), draw, fill, head: head.id }; v.best = Math.max(v.best, draw);
    const complaint = homes > 500 && !city.policies.lateNight && Math.random() < 0.25; if (complaint) post(`Noise complaint number ${3 + Math.floor(Math.random() * 40)} against ${v.name}. Some of us work mornings.`, 'night', rp(['noe_nina', 'marina_max', 'sunset_susan']));
    v.score = clamp(v.score + (fill - 0.45) * 7 - (complaint ? 1.5 : 0), 0, 100);
    if (fill >= 0.995 && v.sp === 'superclub') C.soldOut = true;
    for (const a of acts) {
      const before = fameTier(a.fame), g = (0.8 + fill * 3.2) * (0.5 + v.score / 70) * (a === head ? 1 : 0.6) * (1 - a.fame / 130);
      a.fame = clamp(a.fame + g, 0, 100); a.gain += g; a.plays++; a.last = sim.day; if (!a.first) a.first = v.name;
      const after = fameTier(a.fame);
      if (after > before) {
        if (a.follow || after === 3) game.ui.toast(`${a.name} is now ${after === 3 ? 'a Headliner' : after === 2 ? 'an SF staple' : 'a Local favorite'}`, 'gold');
        if (after === 3) post(`${a.name} sold out ${v.name} last night. They started at the open mic at ${a.first}.`, 'night'); else if (after === 2) post(`If you have not seen ${a.name} yet, go. ${v.name} was packed.`, 'night');
      }
    }
    if (!top || draw > top.draw) top = { v, draw, head };
  }
  for (const a of pool) if (sim.day - a.last > 3 && a.fame > 2) a.fame = Math.max(0, a.fame - 0.25);
  if (pool.length < 28 + culture.venues.length * 3 && Math.random() < 0.6) { const k = rp(['dj', 'dj', 'band', 'comic']); addArtist(artistName(k), k); }
  culture.rising = pool.filter((a) => a.gain > 0.4 && a.fame < 75).sort((a, b) => b.gain - a.gain).slice(0, 10).map((a) => a.id);
  if (top && top.draw > 300 && Math.random() < 0.4) post(`${top.head.name} at ${top.v.name} last night. ${top.draw.toLocaleString('en-US')} people and not one phone out.`, 'night');
}
export const artistById = (id) => culture.artists.find((a) => a.id === id);
export const venueRank = () => culture.venues.slice().sort((a, b) => b.score - a.score);

// ---- sports -----------------------------------------------------------------------------------------
function sportsDay() {
  const s = seasonOf();
  for (const t of Object.values(culture.teams)) {
    const L = LEAGUES[t.lg], b = buildings.get(t.venue); if (!b) continue; const [x, z] = bpos(b);
    if (!L.seasons.includes(s)) continue;
    const start = sim.day * 24;
    if (L.tournament) {
      const champ = `${rp(NAMES.comic[0])} ${rp(NAMES.comic[1])}`; t.last = `${yearOf()}: won by ${champ}`; t.champs.unshift(t.last); t.champs.length = Math.min(t.champs.length, 6);
      culture.live.push({ k: 'game', name: nm(L.team), x, z, kind: 'game', t0: start + 11, t1: start + 18, tour: 4 }); post(`${champ} takes the ${nm(L.team)}. Good crowd out there.`, 'sport'); continue;
    }
    if (s === L.seasons[0]) { t.w = 0; t.l = 0; for (const r of t.table) { r.w = 0; r.l = 0; r.s = clamp(r.s + (Math.random() - 0.5) * 0.12, 0.3, 0.68); } t.str = clamp(t.str + (Math.random() - 0.45) * 0.1 + (city.sat - 0.55) * 0.08, 0.3, 0.72); }
    const n = L.games; let w = 0; for (let k = 0; k < n; k++) if (Math.random() < t.str) w++; t.w += w; t.l += n - w;
    for (const r of t.table) { let rw = 0; for (let k = 0; k < n; k++) if (Math.random() < r.s) rw++; r.w += rw; r.l += n - rw; }
    culture.live.push({ k: 'game', name: `${nm(L.team)} home game`, x, z, kind: 'game', t0: start + 18, t1: start + 22, tour: 2 });
    if (s === L.seasons[L.seasons.length - 1]) {
      const rank = 1 + t.table.filter((r) => r.w > t.w).length;
      if (rank <= 2 && Math.random() < clamp(0.18 + (t.str - 0.5) * 1.6 + (rank === 1 ? 0.12 : 0), 0.05, 0.75)) {
        t.titles++; t.last = `${yearOf()} champions`; t.champs.unshift(t.last); culture.champs.push([yearOf(), t.lg]);
        game.ui.toast(`The ${nm(L.team)} win the title`, 'gold'); post(`THE ${nm(L.team).toUpperCase()} WIN IT ALL. Market Street is a parade already.`, 'sport');
        const a = ll(-122.3960, 37.7935), q = ll(-122.4180, 37.7790); culture.live.push({ k: 'parade', name: `${nm(L.team)} victory parade`, x: a[0], z: a[1], x2: q[0], z2: q[1], kind: 'parade', confetti: true, t0: start + 34, t1: start + 41, tour: 5 }); city.boost = (city.boost || 0) + 0.04;
      } else { t.last = `${yearOf()}: ${t.w}-${t.l}, ${['1st', '2nd', '3rd', '4th', '5th'][rank - 1]} in the division`; if (rank <= 2) post(`${nm(L.team)} out in the playoffs. Next year. It is always next year.`, 'sport'); }
    } else if (Math.random() < 0.35) post(t.w > t.l ? `${nm(L.team)} are ${t.w}-${t.l}. Do not jinx it.` : `${nm(L.team)} are ${t.w}-${t.l}. I am still going to every home game.`, 'sport');
  }
}
export const standings = (t) => [{ n: t.name, w: t.w, l: t.l, us: true }, ...t.table].sort((a, b) => b.w - a.w);

// ---- festivals and events ----------------------------------------------------------------------------
export const festState = (k) => culture.fests[k] || (culture.fests[k] = { on: true, held: 0 });
export function festReady(f) { if (yearOf() < f.from) return `First held in ${f.from}`; if (stats.pop < f.pop) return `Needs ${f.pop.toLocaleString('en-US')} residents`; if (f.need === 'comedy' && !C.has('comedy')) return f.note; if (f.need === 'office' && stats.jobsO < 5000) return f.note; return ''; }
export function holdFest(f, now = false) {
  const a = ll(...f.at), t0 = now ? sim.day * 24 + sim.time : sim.day * 24 + f.h[0], dur = f.h[1] - f.h[0];
  const ev = { k: f.k, name: nm(f.name), x: a[0], z: a[1], kind: f.kind, t0, t1: t0 + dur, tour: f.tour, fest: true };
  if (f.to) { const q = ll(...f.to); ev.x2 = q[0]; ev.z2 = q[1]; } if (f.k === 'pride') ev.confetti = true;
  culture.live.push(ev);
}
function festDay() { const s = seasonOf(); for (const f of FESTS) if (f.season === s && festState(f.k).on && !festReady(f)) holdFest(f); }
const FEST_POST = {
  sketchfest: 'Sketchfest week. Every comic in the country is in a basement on Sutter.', b2b: 'Bay to Breakers. A man dressed as a salmon just ran past my window going the wrong way.', carnaval: 'Carnaval on Mission. Drums since ten this morning and I am not mad.',
  pride: 'Pride on Market Street. Half a million people and the sun actually came out.', outsidelands: 'Outside Lands. Brought four jackets, wearing all of them.', hsb: 'Hardly Strictly in the park. Free music, fog burning off, perfect.',
  fleetweek: 'Fleet Week. The jets just set off every car alarm in the Marina.', portola: 'Portola at the pier. The bass is carrying across the bay.', dreamforce: 'Dreamforce is in town. Every hotel room is $900 and Howard Street is closed.',
};
function startEvent(e) {
  e.on = true;
  if (e.fest) { festState(e.k).held++; culture.held++; game.ui.toast(`${e.name} is on`, 'gold'); if (FEST_POST[e.k]) post(city.cfg.parody ? `${e.name} is on. The whole city showed up.` : FEST_POST[e.k], 'fest'); }
  if (e.kind === 'race') { culture.f1.races++; game.ui.toast(`${e.name}: lights out`, 'gold'); post('Race day. They closed half the waterfront and I can hear the cars from Twin Peaks.', 'sport'); }
  if (e.kind === 'games') { culture.oly.stage = 4; game.ui.toast(`The ${nm('Olympic Games')} open in San Francisco`, 'gold'); post('Opening ceremony tonight. The whole world is looking at the bay.', 'sport'); city.boost = (city.boost || 0) + 0.06; if (city.cfg.money === 'budget') city.treasury += 2500 * priceIndex(); }
}
export function stepCulture(dt) {
  const abs = sim.day * 24 + sim.time; let tour = 0; extraNoise.length = 0;
  for (let k = culture.live.length - 1; k >= 0; k--) {
    const e = culture.live[k];
    if (abs >= e.t1) { culture.live.splice(k, 1); markDirty(); continue; }
    if (abs >= e.t0) { if (!e.on) { startEvent(e); markDirty(); } tour += (e.tour || 0) * 0.12; if (e.kind !== 'run') extraNoise.push([e.x, e.z, e.kind === 'race' || e.kind === 'jets' ? 900 : 480, e.kind === 'expo' ? 0.15 : 0.45]); }
  }
  city.eventTour = tour;
  // fires: buildings with fire cover are saved, the rest burn down and may spread
  for (let k = culture.fires.length - 1; k >= 0; k--) {
    const fr = culture.fires[k], b = buildings.get(fr.id); if (!b) { culture.fires.splice(k, 1); continue; }
    fr.t += dt; const [x, z] = bpos(b), cover = sample(grid.fire, x, z);
    if (cover > 0.05 && fr.t > 5 + (1 - cover) * 9) { delete b.fire; culture.fires.splice(k, 1); C.saved = (C.saved || 0) + 1; continue; }
    if (fr.t > 16 && !fr.spread) { fr.spread = true; if (Math.random() < (cover > 0.05 ? 0.15 : 0.6)) { const n = neighbour(b); if (n) ignite(n); } }
    if (fr.t > 26) { culture.fires.splice(k, 1); removeBuilding(b.id); C.burned = (C.burned || 0) + 1; }
  }
}
function neighbour(b) {
  for (let t = 0; t < 8; t++) { const i = b.i + Math.floor(Math.random() * (b.w + 6)) - 3, j = b.j + Math.floor(Math.random() * (b.d + 6)) - 3; if (!inGrid(i, j)) continue; const id = bid[j * GX + i]; if (id && id !== b.id) { const n = buildings.get(id); if (n && !n.fire && !(n.sp && CAT[n.sp].fixed)) return n; } }
  return null;
}
export function ignite(b) { if (!b || b.fire || (b.sp && CAT[b.sp] && (CAT[b.sp].fixed || CAT[b.sp].green))) return false; b.fire = 1; culture.fires.push({ id: b.id, t: 0 }); return true; }
export function quake(mag) {
  let hit = 0, fires = 0, down = 0; const sev = Math.pow(Math.max(0, mag - 4.6), 2) * 0.011;
  for (const b of [...buildings.values()]) {
    if (b.sp && CAT[b.sp] && (CAT[b.sp].fixed || CAT[b.sp].green || CAT[b.sp].rect)) continue;
    const soft = b.baseY < 4.5 ? 2.2 : 1, old = sim.day - b.born > 80 ? 1.4 : 1, tall = b.height > 120 ? 0.6 : 1; // soft fill shakes hardest, new towers are engineered for it
    if (Math.random() > sev * soft * old * tall) continue; hit++;
    if (Math.random() < 0.45 && fires < 70) { if (ignite(b)) fires++; } else if (!b.locked || Math.random() < 0.5) { removeBuilding(b.id); down++; }
  }
  game.shake = Math.max(game.shake || 0, (mag - 4) * 1.6); if (mag >= 7) C.bigQuake = true;
  game.ui.toast(`Magnitude ${mag.toFixed(1)} earthquake: ${down} buildings down, ${fires} fires`, 'warn');
  post(mag >= 7 ? 'That was the big one. Everyone check on your neighbors.' : 'Did you feel that? Whole building rolled.', 'life', 'usgs_bay_area'); city.boost = (city.boost || 0) - 0.03 * (mag - 5);
  return { hit, fires, down };
}

// ---- street circuit ----------------------------------------------------------------------------------
export function prebuiltCircuit(cx, cz) { // rounded loop with a chicane, sized to the map scale
  const a = 620 * Math.max(K, 0.6), b = 300 * Math.max(K, 0.6), pts = [];
  for (let k = 0; k < 44; k++) { const t = (k / 44) * Math.PI * 2, sq = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.55); let x = cx + a * sq(Math.cos(t)), z = cz + b * sq(Math.sin(t)); if (k > 5 && k < 9) z += (k === 7 ? 46 : 22) * Math.max(K, 0.6); pts.push(Math.round(x), Math.round(z)); }
  return pts;
}
export function circuitOk(pts) { let n = 0; for (let k = 0; k < pts.length; k += 2) if (heightAt(pts[k], pts[k + 1]) > 0.8) n++; return n >= (pts.length / 2) * 0.95; }
export function setCircuit(pts) { culture.f1.pts = pts; if (game.life) game.life.setCircuit(pts); if (pts) { game.ui.toast('Circuit ready. The Grand Prix runs each spring.', 'gold'); } }
export function raceNow() { const p = culture.f1.pts; if (!p) return false; const t0 = sim.day * 24 + sim.time; culture.live.push({ k: 'gp', name: nm('San Francisco Grand Prix'), x: p[0], z: p[1], kind: 'race', t0, t1: t0 + 3, tour: 9 }); return true; }

// ---- Olympic bid --------------------------------------------------------------------------------------
export function olyChecks() {
  const big = [...buildings.values()].some((b) => b.sp && CAT[b.sp] && (CAT[b.sp].fx.cap || 0) >= 40000), arena = C.has('arena');
  return [['50,000 residents', stats.pop >= 50000], ['A stadium or ballpark', big], ['An arena', arena], ['3 transit lines', city.lines.length >= 3], ['Satisfaction of 55%', city.sat >= 0.55]];
}
export function startBid() {
  const o = culture.oly; if (o.stage === 1 || o.stage === 2 || o.stage === 4) return false; if (olyChecks().some((c) => !c[1])) return false;
  const cost = 800 * priceIndex(); if (city.cfg.money === 'budget') { if (city.treasury < cost) { game.ui.toast('The bid costs more than the treasury holds', 'warn'); return false; } city.treasury -= cost; }
  o.stage = 1; o.day = sim.day + 8; o.tries++; game.ui.toast('Olympic bid filed. The vote is in two years.', 'gold'); post('We are bidding for the Games. I have opinions about the traffic already.', 'sport'); return true;
}
function olyDay() {
  const o = culture.oly;
  if (o.stage === 1 && sim.day >= o.day) {
    const score = clamp(0.2 + city.sat * 0.35 + city.transitShare * 0.25 + Math.min(0.2, city.tourism / 200) + Math.min(0.15, culture.venues.length * 0.02) + o.tries * 0.05, 0.2, 0.92); o.score = score;
    if (Math.random() < score) { o.stage = 2; let d = sim.day + 14; while ((d - 1) % 4 !== 2) d++; o.day = d; game.ui.toast('San Francisco wins the Games. Build the Olympic park before they open.', 'gold'); post('WE GOT THE GAMES. Four years to build a stadium. No pressure.', 'sport'); }
    else { o.stage = 3; game.ui.toast('The Games go to another city', 'warn'); post('We lost the vote. Paris again, apparently. Bid again in a few years.', 'sport'); }
  } else if (o.stage === 2 && sim.day >= o.day) {
    const park = [...buildings.values()].find((b) => b.sp === 'olympic');
    if (park) { const [x, z] = bpos(park); culture.live.push({ k: 'games', name: nm('Olympic Games'), x, z, kind: 'games', t0: sim.day * 24 + 10, t1: sim.day * 24 + 58, tour: 30 }); }
    else { o.stage = 3; game.ui.toast('No Olympic park. The Games move to Los Angeles.', 'warn'); post('They took the Games away. We never built the park.', 'sport'); }
  }
}
export const olyUnlocked = () => culture.oly.stage === 2 || culture.oly.stage === 4;

// ---- achievements and tips -----------------------------------------------------------------------------
export function checkAch() {
  for (const a of ACH) if (!culture.ach[a[0]]) { let ok = false; try { ok = a[3](); } catch { ok = false; } if (ok) { culture.ach[a[0]] = yearOf(); game.ui.toast(`Achievement: ${a[1]}`, 'gold'); } }
}
let tipAcc = 0;
export function stepTips(dt) {
  tipAcc += dt; if (tipAcc < 4 || !city.cfg.tips || game.mode !== 'play' || game.readOnly) return; tipAcc = 0;
  if (game.ui.tipOpen && game.ui.tipOpen()) return;
  for (const t of TIPS) if (!culture.tips[t[0]]) { let ok = false; try { ok = t[2](game); } catch { ok = false; } if (ok) { culture.tips[t[0]] = 1; game.ui.tip(t[1]); return; } }
}
let prevPhase = 'calm';
export function cultureDay() {
  if (sim.day % 4 === 0) for (const b of buildings.values()) { const c = b.sp && CAT[b.sp]; if (c && c.fx.league) for (const lg of c.fx.league.split(',')) ensureTeam(lg, b); }   // teams that arrive in a later year
  nightly(); sportsDay(); festDay(); olyDay();
  if (culture.f1.pts && seasonOf() === 1) { const p = culture.f1.pts; culture.live.push({ k: 'gp', name: nm('San Francisco Grand Prix'), x: p[0], z: p[1], kind: 'race', t0: sim.day * 24 + 13, t1: sim.day * 24 + 16, tour: 9 }); }
  if (seasonOf() === 0) { const [x, z] = ll(-122.3937, 37.7955); culture.live.push({ k: 'ny', name: 'New Year', x, z, kind: 'fireworks', t0: sim.day * 24 + 0.05, t1: sim.day * 24 + 0.9, tour: 2 }); }
  if (prevPhase === 'bust' && tech.phase !== 'bust') C.bustOver = true; prevPhase = tech.phase;
  let lk = 0, mh = 0; for (const b of buildings.values()) { if (b.locked) lk++; if (!b.sp && b.height > mh) mh = b.height; } C.locked = lk; C.maxH = mh;
  if (city.boost) city.boost *= 0.8; if (Math.abs(city.boost || 0) < 0.003) city.boost = 0;
  checkAch();
}
export function serializeCulture() {
  const { venues, artists, nextArtist, teams, fests, f1, oly, ach, tips, champs, held } = culture;
  return { venues, artists, nextArtist, teams, fests, f1, oly, ach, tips, champs, held, c: { bustOver: C.bustOver, soldOut: C.soldOut, bigQuake: C.bigQuake, fillArea: C.fillArea } };
}
export function loadCulture(d) { // call after buildings are loaded: venue records made by onAdded are replaced by the saved ones
  if (!d) return;
  for (const k of ['artists', 'nextArtist', 'teams', 'fests', 'f1', 'oly', 'ach', 'champs', 'held']) if (d[k] != null) culture[k] = d[k];
  if (d.tips) Object.assign(culture.tips, d.tips);
  if (d.venues) { const byId = new Map(d.venues.map((v) => [v.id, v])); culture.venues = culture.venues.map((v) => { const s = byId.get(v.id); if (s) { const b = buildings.get(v.id); if (b) { b.name = s.name; b.vname = s.name; } return { ...v, ...s }; } return v; }); }
  if (d.c) Object.assign(C, d.c); culture.live = []; culture.fires = [];
  if (game.life) game.life.setCircuit(culture.f1.pts);
}
void tierOf; void W; void land; void road; void toI; void toJ; void hoodName; void hoodAt;
