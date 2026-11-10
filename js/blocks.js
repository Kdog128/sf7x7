// More kinds of ordinary buildings: painted rowhouses, bay-window flats, a mix of shops, and industry
// with different layouts. Each kind is picked from the building's seed, so a zone no longer repeats one shape.
import { prim, ext } from './buildings.js';

const { lbox, lroof, lcyl, ltree, lpoly, lbarrel, cornice, roofClutter, yardTrees, P, ST, hx, sh, mixc } = prim;
const WHITE = [240, 234, 222];
const glow = (seed = 0) => ({ bay: 1, fh: 1, base: 0, ww: 0, wh: 0, style: ST.glow, seed });
const one = (W) => ({ ...W, bay: 99 }); // one window per wall face

// ---- small parts -------------------------------------------------------------------------------------
function angledBay(m, F, x0, x1, zf, dep, y0, y1, wall, cap, W) {
  const ch = Math.min(dep * 0.95, (x1 - x0) * 0.27);
  lpoly(m, F, [[x1, zf], [x1 - ch, zf - dep], [x0 + ch, zf - dep], [x0, zf]], y0, y1, wall, cap, W ? one(W) : null, true);
}
function fireEscape(m, F, lx, zf, y0, fh, floors, w = 2.6) {
  for (let k = 1; k < floors; k++) {
    const y = y0 + k * fh - 0.25;
    lbox(m, F, lx, zf - 1.0, lx + w, zf, y, y + 0.09, P.iron, P.iron); lbox(m, F, lx, zf - 1.0, lx + w, zf - 0.93, y + 0.09, y + 0.95, P.iron, null);
    lbox(m, F, lx + w * 0.4, zf - 0.62, lx + w * 0.4 + 0.3, zf - 0.5, y - fh + 0.09, y, P.iron, null);
  }
}
const blade = (m, F, lx, zf, y0, h, c, seed, out = 1.15) => lbox(m, F, lx - 0.16, zf - out, lx + 0.16, zf - 0.1, y0, y0 + h, c, sh(c, 0.7), glow(seed));
function roofSign(m, F, x0, x1, lz, y, h, c) {
  for (const x of [x0 + 0.4, x1 - 0.4]) lbox(m, F, x - 0.1, lz, x + 0.1, lz + 0.2, y, y + 1.1, P.iron, null);
  lbox(m, F, x0, lz - 0.05, x1, lz + 0.25, y + 1.1, y + 1.1 + h, c, sh(c, 0.7), glow());
}
function awning(m, F, a0, a1, zf, y, dep, c) { lbox(m, F, a0, zf - dep, a1, zf, y, y + 0.14, c, sh(c, 0.82)); lbox(m, F, a0, zf - dep, a1, zf - dep + 0.07, y - 0.34, y, sh(c, 0.86), null); }
const panel = (m, F, x0, x1, zf, y0, y1, c) => lbox(m, F, x0, zf - 0.07, x1, zf, y0, y1, c, null);
function stoop(m, F, x0, x1, zf, dep, yLo, yHi) {
  const n = 3;
  for (let k = 0; k < n; k++) lbox(m, F, x0, zf - dep * ((n - k) / n), x1, zf - dep * ((n - k - 1) / n), yLo - 0.6, yLo + ((yHi - yLo) * (k + 1)) / n, P.concrete, P.concrete);
}
function car(m, F, lx, lz, across, c, y) {
  const a = across ? [2.2, 0.9] : [0.9, 2.2], b = across ? [1.1, 0.78] : [0.78, 1.1];
  lbox(m, F, lx - a[0], lz - a[1], lx + a[0], lz + a[1], y + 0.25, y + 0.85, c, c);
  lbox(m, F, lx - b[0], lz - b[1], lx + b[0], lz + b[1], y + 0.85, y + 1.4, P.glassDark, sh(c, 0.9));
}
function truck(m, F, lx, lz, across, c, y) {
  const L = 3.6, w = 1.25, bx = (a, b2, y0, y1, col) => (across ? lbox(m, F, lx + a, lz - w, lx + b2, lz + w, y0, y1, col, col) : lbox(m, F, lx - w, lz + a, lx + w, lz + b2, y0, y1, col, col));
  bx(-L, L * 0.45, y + 0.5, y + 3.0, c); bx(L * 0.5, L, y + 0.4, y + 2.2, hx('#c9c4b6'));
}
function boxes(m, F, r, x0, z0, x1, z1, y, maxStack, across = true) { // shipping containers in rows
  const L = 6.1, w = 2.44, h = 2.6, sx = across ? L + 0.5 : w + 0.4, sz = across ? w + 0.4 : L + 0.5;
  for (let z = z0; z + (across ? w : L) <= z1; z += sz) for (let x = x0; x + (across ? L : w) <= x1; x += sx) {
    const n = r.int(0, maxStack); for (let k = 0; k < n; k++) { const c = r.pick(P.box); lbox(m, F, x, z, x + (across ? L : w), z + (across ? w : L), y + k * h, y + (k + 1) * h, c, sh(c, 0.8)); }
  }
}
function tank(m, F, lx, lz, rr, y, h, c, roofK = 0.2) { lcyl(m, F, lx, lz, rr, rr, y - 0.6, y + h, c, 12, false); lcyl(m, F, lx, lz, rr, rr * roofK, y + h, y + h + rr * 0.35, sh(c, 0.88), 12, true); }
function chimney(m, F, lx, lz, rr, y0, y1, c) { lcyl(m, F, lx, lz, rr, rr * 0.62, y0, y1, c, 8, false); lcyl(m, F, lx, lz, rr * 0.7, rr * 0.7, y1, y1 + 1.2, P.dark[0], 8, true); }
function silo(m, F, lx, lz, rr, y, h, c) { lcyl(m, F, lx, lz, rr, rr, y - 0.5, y + h, c, 10, false); lcyl(m, F, lx, lz, rr, 0.15, y + h, y + h + rr * 0.9, sh(c, 0.85), 10, false); }
function fence(m, F, x0, z0, x1, z1, y) { const c = hx('#6f6a60'); lbox(m, F, x0, z0, x1, z0 + 0.12, y, y + 1.7, c, null); lbox(m, F, x0, z0, x0 + 0.12, z1, y, y + 1.7, c, null); lbox(m, F, x1 - 0.12, z0, x1, z1, y, y + 1.7, c, null); }
const pad = (m, F, x0, z0, x1, z1, y, c = P.asphalt) => lbox(m, F, x0, z0, x1, z1, F.lo - 0.8, y + 0.06, c, c);

// ---- which kind a lot becomes ------------------------------------------------------------------------
const KINDS = {
  theater: { label: 'Movie theater' }, market: { label: 'Market' }, bank: { label: 'Bank', floors: 2 }, diner: { label: 'Diner', floors: 1, cov: 0.45 }, gas: { label: 'Service station', floors: 1, cov: 0.25 }, shops: null,
  sawtooth: { label: 'Workshop' }, warehouse: { label: 'Warehouse' }, garage: { label: 'Auto garage', floors: 1, cov: 0.5 }, brewery: { label: 'Brewery', names: ['Brewery', 'Brewing Company', 'Roastery', 'Distillery'] },
  storage: { label: 'Storage yard', floors: 1, cov: 0.45 }, lab: { label: 'Lab and workshop' }, quonset: { label: 'Quonset huts', floors: 1, cov: 0.5 }, yard: { label: 'Builders yard', floors: 1, cov: 0.35 },
  mill: { label: 'Mill', names: ['Mill', 'Flour Mill', 'Woolen Mill', 'Paper Mill'] }, power: { label: 'Power plant', names: ['Power Station', 'Steam Plant', 'Substation'] }, tanks: { label: 'Tank farm', cov: 0.4, names: ['Oil Depot', 'Tank Farm', 'Fuel Terminal'] },
  foundry: { label: 'Foundry', names: ['Iron Works', 'Foundry', 'Steel Company', 'Machine Works'] }, cannery: { label: 'Cannery', names: ['Cannery', 'Sugar Refinery', 'Coffee Company', 'Packing Company'] }, gasworks: { label: 'Gasworks', cov: 0.4, names: ['Gas Works', 'Gas Light Company'] },
  pier: { label: 'Pier shed' }, containers: { label: 'Container yard', cov: 0.5 }, shipyard: { label: 'Ship repair', cov: 0.5 }, fish: { label: 'Fish wharf', cov: 0.5 },
  store: null, parking: { label: 'Parking garage' }, lofts: { label: 'Loft building' }, palace: { label: 'Theater' },
};
function kindKey(b, floors) {
  const z = b.zone, a = b.w * b.d, h = (b.seed >>> 3) % 100;
  if (z === 3) return a >= 4 ? (h < 12 ? 'theater' : h < 27 ? 'market' : h < 37 ? 'bank' : h < 49 ? 'diner' : h < 57 ? 'gas' : 'shops') : a >= 2 && h < 10 ? 'diner' : 'shops';
  if (z === 4) return floors > 7 ? '' : ['store', 'parking', 'lofts', 'palace', 'store', 'lofts'][h % 6];
  if (z === 7) return (a >= 9 ? ['sawtooth', 'warehouse', 'garage', 'brewery', 'storage', 'lab', 'quonset', 'yard', 'warehouse', 'lab'] : ['sawtooth', 'garage', 'brewery', 'lab', 'quonset', 'warehouse', 'yard', 'garage', 'storage', 'sawtooth'])[h % 10];
  if (z === 8) return ['mill', 'power', 'tanks', 'foundry', 'cannery', 'gasworks', 'foundry', 'cannery'][h % 8];
  if (z === 12) return ['pier', 'containers', 'shipyard', 'fish', 'pier', 'containers'][h % 6];
  return '';
}
ext.kind = (b, floors) => { const k = kindKey(b, floors); return k && KINDS[k] ? { key: k, ...KINDS[k] } : null; };

// ---- houses ------------------------------------------------------------------------------------------
function rowhouse(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, v = s.variant, wall = r.pick(P.house), trim = mixc(wall, WHITE, r.range(0.62, 0.85)), roofC = r.pick(P.roof), doorC = r.pick(P.door);
  const set = v === 2 || v === 6 ? r.range(2.6, 3.6) : r.range(1.8, 3.0), depth = Math.min(D - set - 3.5, r.range(10.5, 13.5) + (D > 20 ? 2.5 : 0));
  const lx0 = 0.1, lx1 = W - 0.1, w = lx1 - lx0, z0 = set, z1 = set + depth, hasGarage = v === 2 || v === 6 || r.chance(0.3), g = hasGarage ? 2.6 : r.range(0.9, 1.6);
  const top = y + g + s.floors * s.fh, seed = b.seed & 255, Wn = { bay: w / 2, fh: s.fh, base: y + g, ww: 0.42, wh: 0.6, style: ST.home, seed };
  const left = r.chance(0.5), bw = w * (v === 1 ? 0.4 : 0.46), bx = left ? lx0 + 0.25 : lx1 - 0.25 - bw, ex = left ? lx1 - w * 0.27 : lx0 + w * 0.27; // bay on one side, entry on the other
  lbox(m, F, lx0, z0, lx1, z1, F.lo - 1, y + g, sh(wall, 0.86), null);                                    // base storey
  if (hasGarage) panel(m, F, bx + 0.15, bx + bw - 0.15, z0, y + 0.1, y + 2.25, mixc(wall, WHITE, 0.45));  // garage door under the bay
  if (v === 0) { // Stick or Queen Anne: gable to the street, full-height bay, porch hood
    lbox(m, F, lx0, z0, lx1, z1, y + g, top, wall, null, { ...Wn, ww: 0.34, wh: 0.66 }, 5);
    lroof(m, F, lx0 - 0.3, z0 - 0.45, lx1 + 0.3, z1, top, r.range(2.4, 3.4), r.pick(P.pitch), trim, true, 'z');
    angledBay(m, F, bx, bx + bw, z0, 0.9, y + g, top - 0.25, wall, sh(roofC, 1.1), { ...Wn, ww: 0.64, wh: 0.66 });
    lbox(m, F, bx - 0.1, z0 - 1.0, bx + bw + 0.1, z0, top - 0.25, top + 0.05, trim, sh(trim, 0.8));
    lbox(m, F, lx0, z0 - 0.22, lx1, z0, y + g + s.fh - 0.18, y + g + s.fh + 0.12, trim, trim);            // belt course
    lbox(m, F, ex - 1.0, z0 - 1.2, ex + 1.0, z0, y + g + 2.5, y + g + 2.75, trim, sh(trim, 0.8));          // porch hood
  } else if (v === 5) { // Italianate: flat front that hides the roof, tall narrow windows, bracketed cornice
    lbox(m, F, lx0, z0, lx1, z1, y + g, top, wall, roofC, { ...Wn, bay: w / 3, ww: 0.3, wh: 0.72 }, 5);
    angledBay(m, F, bx, bx + bw, z0, 0.8, y + g, top - 0.5, wall, sh(roofC, 1.1), { ...Wn, ww: 0.6, wh: 0.72 });
    lbox(m, F, lx0 - 0.1, z0 - 1.05, lx1 + 0.1, z0 + 0.25, top - 0.15, top + 0.35, trim, sh(trim, 0.8));
    lbox(m, F, lx0, z0 - 0.2, lx1, z0 + 0.3, top + 0.35, top + 1.0, wall, sh(wall, 0.8));
    for (let k = 0; k < 5; k++) { const px = lx0 + 0.3 + (k * (w - 0.9)) / 4; lbox(m, F, px, z0 - 0.75, px + 0.3, z0, top - 0.75, top - 0.15, trim, null); }
    lbox(m, F, ex - 0.9, z0 - 1.0, ex + 0.9, z0, y + g + 2.5, y + g + 2.8, trim, sh(trim, 0.8));
  } else if (v === 1) { // Edwardian flats: a pair of bays under a heavy cornice
    lbox(m, F, lx0, z0, lx1, z1, y + g, top, wall, roofC, Wn, 5);
    for (const x of [lx0 + 0.3, lx1 - 0.3 - bw]) angledBay(m, F, x, x + bw, z0, 0.75, y + g + 0.15, top - 0.55, wall, sh(roofC, 1.1), { ...Wn, ww: 0.66, wh: 0.62 });
    lbox(m, F, lx0 - 0.12, z0 - 1.0, lx1 + 0.12, z0 + 0.2, top - 0.2, top + 0.55, trim, sh(trim, 0.8));
    lbox(m, F, lx0, z0 - 0.2, lx1, z0, y + g - 0.1, y + g + 0.2, trim, trim);
    roofClutter(m, F, r, lx0, z0 + 2, lx1, z1, top, 1, roofC);
  } else if (v === 2) { // Sunset stucco: garage below, picture window, stepped parapet or a tile hood
    lbox(m, F, lx0, z0, lx1, z1, y + g, top, wall, roofC, { ...Wn, ww: 0.5, wh: 0.5 }, 4);
    lbox(m, F, bx, z0 - 0.5, bx + bw, z0, y + g + 0.1, top - 0.3, wall, sh(roofC, 1.1), { ...Wn, bay: bw, ww: 0.76, wh: 0.56 }, 1);
    if (r.chance(0.5)) { lbox(m, F, lx0, z0 - 0.15, lx1, z0 + 0.4, top, top + 0.6, wall, sh(wall, 0.8)); lbox(m, F, lx0 + w * 0.28, z0 - 0.15, lx1 - w * 0.28, z0 + 0.4, top + 0.6, top + 1.1, wall, sh(wall, 0.8)); }
    else { lbox(m, F, lx0, z0 - 0.15, lx1, z0 + 0.4, top, top + 0.45, wall, sh(wall, 0.8)); lroof(m, F, lx0 - 0.1, z0 - 0.75, lx1 + 0.1, z0 + 0.9, top - 0.55, 0.6, P.tile, wall, false, 'x'); }
    lbox(m, F, ex - 0.75, z0 - 0.08, ex + 0.75, z0, y + 0.1, y + g + 2.2, sh(wall, 0.55), null);          // tunnel entrance
  } else { // Marina style: two floors over the garage, tile roof, rounded bay
    lbox(m, F, lx0, z0, lx1, z1, y + g, top, wall, roofC, { ...Wn, ww: 0.44, wh: 0.6 }, 5);
    angledBay(m, F, bx, bx + bw, z0, 0.7, y + g + 0.1, top - 0.6, wall, P.tile, { ...Wn, ww: 0.7, wh: 0.62 });
    lroof(m, F, lx0 - 0.15, z0 - 0.6, lx1 + 0.15, z0 + 1.6, top - 0.15, 0.95, P.tile, wall, false, 'x');
    lbox(m, F, lx0, z0, lx1, z0 + 0.5, top, top + 0.3, wall, sh(wall, 0.8));
  }
  if (v !== 2) { panel(m, F, ex - 0.5, ex + 0.5, z0, y + g, y + g + 2.2, doorC); stoop(m, F, ex - 0.85, ex + 0.85, z0, Math.min(set - 0.3, 1.2 + g * 0.9), y, y + g); }
  if (set > 2.4 && r.chance(0.5)) lbox(m, F, bx + 0.2, 0.4, bx + bw - 0.2, 1.3, y - 0.2, y + 0.55, hx('#5f7a4a'), hx('#6a8a52'));     // hedge or planter by the pavement
  if (D - z1 > 5 && r.chance(0.6)) yardTrees(m, F, r, 2, z1 + 2.5, W - 2, D - 1.5, 1);
}

// ---- flats: three to seven storeys with columns of bay windows --------------------------------------
function flats(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, f = s.floors, seed = b.seed & 255, mixed = b.zone === 11, shops = mixed || r.chance(0.3);
  const u = r(), wall = u < 0.68 ? r.pick(P.house) : u < 0.84 ? r.pick(P.stone) : r.pick(P.brick), trim = mixc(wall, WHITE, r.range(0.5, 0.8)), roofC = r.pick(P.roof);
  const mx = W > 20 ? 0.8 : 0.25, lx0 = mx, lx1 = W - mx, w = lx1 - lx0, z0 = D > 20 ? r.range(1.0, 1.8) : 0.9, z1 = D - (D > 20 ? r.range(3.5, 5.5) : 1.2);
  const gh = shops ? 4.2 : 3.3, y1 = y + gh, top = y1 + (f - 1) * s.fh, Wn = { bay: r.range(2.6, 3.1), fh: s.fh, base: y1, ww: 0.44, wh: 0.6, style: ST.home, seed };
  lbox(m, F, lx0, z0, lx1, z1, F.lo - 1.5, y1, sh(wall, shops ? 0.8 : 0.88), null, shops ? { bay: w / Math.max(1, Math.round(w / 6)), fh: gh, base: y, ww: 0.84, wh: 0.66, style: ST.shop | ST.front, seed } : null, 1);
  lbox(m, F, lx0, z0, lx1, z1, y1, top, wall, roofC, Wn);
  lbox(m, F, lx0 - 0.1, z0 - 0.2, lx1 + 0.1, z0 + 0.1, y1 - 0.15, y1 + 0.2, trim, trim);
  const nb = Math.max(1, Math.round(w / r.range(4.8, 6.2))), slot = w / nb, bw = Math.min(3.1, slot * 0.6), escape = f >= 4 && nb >= 2 && r.chance(0.55) ? r.int(0, nb - 2) : -1, turret = nb >= 2 && r.chance(0.3);
  for (let k = 0; k < nb; k++) {
    const cx = lx0 + slot * (k + 0.5);
    if (turret && k === 0) { lcyl(m, F, lx0 + 1.5, z0 + 0.4, 1.9, 1.9, y1 + 0.2, top + 0.4, wall, 10, false); lcyl(m, F, lx0 + 1.5, z0 + 0.4, 2.15, 0.1, top + 0.4, top + 3.6, r.pick(P.pitch), 10, false); continue; }
    angledBay(m, F, cx - bw / 2, cx + bw / 2, z0, 0.8, y1 + 0.25, top - 0.45, wall, sh(roofC, 1.1), { ...Wn, ww: 0.68, wh: 0.62 });
    if (k === escape) fireEscape(m, F, cx + bw / 2 + 0.15, z0, y1, s.fh, f, Math.max(1.4, slot - bw - 0.3));
    if (!shops) panel(m, F, cx - bw / 2 + 0.1, cx + bw / 2 - 0.1, z0, y + 0.1, y + 2.3, mixc(wall, WHITE, 0.4));
  }
  if (shops) { const na = Math.max(1, Math.round(w / 6)), aw = w / na; for (let k = 0; k < na; k++) awning(m, F, lx0 + k * aw + 0.3, lx0 + (k + 1) * aw - 0.3, z0, y + 3.0, 1.1, r.pick(P.awning)); if (r.chance(0.5)) blade(m, F, lx0 + w * r.range(0.2, 0.8), z0, y1 + 0.6, Math.min(5, (f - 1) * s.fh * 0.6), r.pick(P.neon), seed); }
  else { const ex = lx0 + slot * (nb > 1 ? 1 : 0.5) - (nb > 1 ? 0 : bw / 2 + 0.9); panel(m, F, ex - 0.6, ex + 0.6, z0, y, y + 2.4, r.pick(P.door)); lbox(m, F, ex - 1.1, z0 - 0.9, ex + 1.1, z0, y + 2.6, y + 2.85, trim, sh(trim, 0.8)); }
  lbox(m, F, lx0 - 0.3, z0 - 1.0, lx1 + 0.3, z0 + 0.3, top - 0.25, top + 0.5, trim, sh(trim, 0.8));      // cornice over the bays
  lbox(m, F, lx0, z0 + 0.3, lx1, z1, top, top + 0.5, wall, null); lbox(m, F, lx0 + 0.3, z0 + 0.6, lx1 - 0.3, z1 - 0.3, top + 0.1, top + 0.2, roofC, roofC);
  roofClutter(m, F, r, lx0 + 1, z0 + 2, lx1 - 1, z1 - 1, top + 0.2, Math.min(4, 1 + Math.floor((w * (z1 - z0)) / 140)), roofC);
  if (D - z1 > 3 && r.chance(0.6)) yardTrees(m, F, r, 2, z1 + 1.6, W - 2, D - 1.2, r.int(1, 2));
}

// ---- shops -------------------------------------------------------------------------------------------
function shopRow(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, n = Math.max(1, Math.round(W / r.range(6.5, 9))), uw = (W - 0.3) / n, seed = b.seed & 255;
  for (let k = 0; k < n; k++) {
    const a0 = 0.15 + k * uw, a1 = a0 + uw - 0.06, fl = Math.max(1, s.floors - (r.chance(0.3) ? 1 : 0)), wall = r.chance(0.35) ? r.pick(P.brick) : r.pick(P.house), rc = r.pick(P.roof);
    const z0 = 0.3, z1 = D - r.range(0.6, D > 14 ? 5 : 1.5), gh = 4.1, top = y + gh + (fl - 1) * s.fh, aw = r.pick(P.awning), trim = mixc(wall, WHITE, 0.6), ks = seed + k * 31;
    lbox(m, F, a0, z0, a1, z1, F.lo - 1, y + gh, sh(wall, 0.9), fl === 1 ? rc : null, { bay: uw, fh: gh, base: y, ww: 0.84, wh: 0.62, style: ST.shop | ST.front, seed: ks }, 1);
    awning(m, F, a0 + 0.2, a1 - 0.2, z0, y + 2.95, r.range(0.9, 1.4), aw);
    lbox(m, F, a0, z0 - 0.12, a1, z0, y + 3.3, y + gh, sh(aw, 0.62), null);
    if (fl > 1) {
      lbox(m, F, a0, z0, a1, z1, y + gh, top, wall, rc, { bay: uw / (uw > 7 ? 3 : 2), fh: s.fh, base: y + gh, ww: 0.46, wh: 0.58, style: ST.home, seed: ks }, 5);
      if (r.chance(0.5)) angledBay(m, F, a0 + uw * 0.2, a1 - uw * 0.2, z0, 0.7, y + gh + 0.2, top - 0.4, wall, sh(rc, 1.1), { bay: 9, fh: s.fh, base: y + gh, ww: 0.66, wh: 0.6, style: ST.home, seed: ks });
    }
    lbox(m, F, a0, z0 - 0.25, a1, z0 + 0.35, top, top + r.range(0.5, 1.2), trim, sh(trim, 0.8));
    const sg = r(); if (sg < 0.3) blade(m, F, a0 + uw * r.range(0.25, 0.75), z0, y + gh + 0.2, fl > 1 ? r.range(2.4, 4.2) : 1.6, r.pick(P.neon), ks); else if (sg < 0.5) lbox(m, F, a0 + 0.6, z0 - 0.2, a1 - 0.6, z0 - 0.05, y + 3.35, y + 4.0, r.pick(P.neon), null, glow(ks));
    if (r.chance(0.5)) roofClutter(m, F, r, a0, z0 + 1, a1, z1, top, 1, rc);
  }
}
function theater(m, F, b, s, r, grand = false) {
  const { W, D } = F, y = F.baseY, wall = r.pick(grand ? P.stone : P.house), trim = mixc(wall, WHITE, 0.6), rc = r.pick(P.roof), neon = r.pick(P.neon), seed = b.seed & 255;
  const H = Math.max(grand ? 16 : 10.5, Math.min(s.floors * s.fh, grand ? 26 : 14)), lx0 = 0.4, lx1 = W - 0.4, z0 = 0.5, z1 = D - 0.8, cx = W / 2;
  lbox(m, F, lx0, z0, lx1, z0 + 5, F.lo - 1, y + H * 0.72, wall, rc, { bay: (lx1 - lx0) / 3, fh: 4.4, base: y, ww: 0.7, wh: 0.6, style: ST.shop | ST.front, seed }, 1);
  lbox(m, F, lx0 + 0.6, z0 + 5, lx1 - 0.6, z1, F.lo - 1, y + H, sh(wall, 0.92), rc);                       // blank auditorium
  lbox(m, F, lx0, z0 - 0.3, lx1, z0 + 0.3, y + H * 0.72, y + H * 0.72 + 0.9, trim, sh(trim, 0.8));
  lbox(m, F, cx - (lx1 - lx0) * 0.36, z0 - 2.2, cx + (lx1 - lx0) * 0.36, z0, y + 3.5, y + 4.7, hx('#e9dfc0'), hx('#b8ae96'), glow(seed)); // marquee
  lbox(m, F, cx - (lx1 - lx0) * 0.36, z0 - 2.25, cx + (lx1 - lx0) * 0.36, z0 - 2.15, y + 3.4, y + 3.55, neon, null, glow(seed));
  lbox(m, F, cx - 0.5, z0 - 1.5, cx + 0.5, z0 - 0.1, y + 5.0, y + H * 0.72 + (grand ? 7 : 4.5), neon, sh(neon, 0.7), glow(seed));     // vertical sign
  roofClutter(m, F, r, lx0 + 2, z0 + 6, lx1 - 2, z1 - 1, y + H, 2, rc);
}
function market(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, wall = r.pick(P.house), rc = r.pick(P.roof), sign = r.pick(P.neon), seed = b.seed & 255, lot = D > 20 ? D * 0.36 : 0, z0 = lot + 0.5, z1 = D - 0.8;
  if (lot) { pad(m, F, 0.4, 0.4, W - 0.4, lot, y); for (let x = 2.6; x < W - 2.4; x += 3.1) if (r.chance(0.6)) car(m, F, x, lot * 0.55, false, r.pick(P.car), y); }
  lbox(m, F, 0.5, z0, W - 0.5, z1, F.lo - 1, y + 5.6, wall, rc, { bay: (W - 1) / Math.max(2, Math.round(W / 5.5)), fh: 5.6, base: y, ww: 0.86, wh: 0.6, style: ST.shop | ST.front, seed }, 1);
  awning(m, F, 0.9, W - 0.9, z0, y + 3.4, 1.6, r.pick(P.awning));
  lbox(m, F, W * 0.2, z0 - 0.3, W * 0.8, z0 + 0.5, y + 5.6, y + 7.6, mixc(wall, WHITE, 0.4), sh(wall, 0.8)); lbox(m, F, W * 0.26, z0 - 0.4, W * 0.74, z0 - 0.28, y + 5.9, y + 7.2, sign, null, glow(seed));
  roofClutter(m, F, r, 2, z0 + 2, W - 2, z1 - 1, y + 5.6, 3, rc);
}
function bank(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, wall = r.pick(P.stone), trim = mixc(wall, WHITE, 0.5), H = 11, lx0 = 0.6, lx1 = W - 0.6, z0 = 1.6, z1 = D - 1, seed = b.seed & 255;
  lbox(m, F, lx0, z0, lx1, z1, F.lo - 1, y + H, wall, r.pick(P.roof), { bay: (lx1 - lx0) / 3, fh: H, base: y, ww: 0.4, wh: 0.62, style: ST.office, seed });
  lbox(m, F, lx0 - 0.4, 0.5, lx1 + 0.4, z0, y - 0.4, y + 0.6, trim, trim);
  const n = Math.max(4, Math.round((lx1 - lx0) / 3.2)); for (let k = 0; k < n; k++) { const px = lx0 + 0.6 + (k * (lx1 - lx0 - 1.2)) / (n - 1); lcyl(m, F, px, z0 - 0.55, 0.42, 0.36, y + 0.6, y + H - 1.6, trim, 8, false); }
  lbox(m, F, lx0 - 0.3, z0 - 1.1, lx1 + 0.3, z0 + 0.3, y + H - 1.6, y + H - 0.2, trim, sh(trim, 0.8)); lroof(m, F, lx0 - 0.3, z0 - 1.1, lx1 + 0.3, z0 + 0.3, y + H - 0.2, 1.6, trim, trim, true, 'x');
  cornice(m, F, lx0, z0 + 0.3, lx1, z1, y + H, 0.6, trim, 0.3);
}
function diner(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, steel = r.chance(0.5) ? hx('#c9ccca') : r.pick(P.house), band = r.pick(P.neon), seed = b.seed & 255, side = W > 12 ? W * 0.38 : 0, z0 = Math.min(3.5, D * 0.2), z1 = Math.min(D - 1, z0 + 9);
  pad(m, F, 0.3, 0.3, W - 0.3, D - 0.3, y);
  lbox(m, F, 0.6, z0, W - 0.6 - side, z1, F.lo - 1, y + 3.7, steel, hx('#8a8f8c'), { bay: 2.2, fh: 3.7, base: y, ww: 0.86, wh: 0.5, style: ST.shop | ST.front, seed });
  lbox(m, F, 0.4, z0 - 0.3, W - 0.4 - side, z1 + 0.2, y + 3.0, y + 3.35, band, sh(band, 0.8), glow(seed));
  roofSign(m, F, 1.6, Math.min(W - 1.6 - side, 8.5), z0 + 1.2, y + 3.7, 1.7, r.pick(P.neon));
  if (side) for (let z = 3; z < D - 3; z += 3.2) if (r.chance(0.6)) car(m, F, W - side * 0.5, z, true, r.pick(P.car), y);
  if (D - z1 > 4) for (let x = 3; x < W - 3 - side; x += 3.1) if (r.chance(0.5)) car(m, F, x, z1 + 3.2, false, r.pick(P.car), y);
}
function gas(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, wall = hx('#e3ddd0'), acc = r.pick(P.neon), seed = b.seed & 255, cx = W / 2;
  pad(m, F, 0.3, 0.3, W - 0.3, D - 0.3, y, hx('#6a6966'));
  lbox(m, F, cx - 5.5, D - 8.5, cx + 5.5, D - 1.5, F.lo - 1, y + 4, wall, hx('#8a8780'), { bay: 3.6, fh: 4, base: y, ww: 0.8, wh: 0.6, style: ST.shop | ST.front, seed }, 1);
  lbox(m, F, cx - 5.7, D - 8.7, cx + 5.7, D - 1.3, y + 4, y + 4.5, acc, sh(acc, 0.8));
  const cz = Math.min(D * 0.36, D - 13); lbox(m, F, cx - 6, cz - 2.6, cx + 6, cz + 2.6, y + 4.6, y + 5.2, wall, hx('#cfc9bb')); lbox(m, F, cx - 6.05, cz - 2.65, cx + 6.05, cz + 2.65, y + 4.75, y + 5.05, acc, null, glow(seed));
  for (const px of [cx - 4.2, cx + 4.2]) { lbox(m, F, px - 0.2, cz - 0.2, px + 0.2, cz + 0.2, y, y + 4.6, hx('#b8b4a8'), null); lbox(m, F, px - 0.4, cz - 0.9, px + 0.4, cz + 0.9, y, y + 1.5, acc, sh(acc, 0.7)); }
  lcyl(m, F, 1.6, 1.6, 0.12, 0.12, y, y + 7, P.iron, 5, false); lbox(m, F, 0.6, 1.5, 2.6, 1.7, y + 5.6, y + 7.4, acc, null, glow(seed));
  if (r.chance(0.6)) car(m, F, cx + 1.5, cz + 4.4, true, r.pick(P.car), y);
}
function parking(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, c = r.pick(P.stone), n = Math.max(3, Math.min(6, s.floors)), fh = 3.1, lx0 = 0.5, lx1 = W - 0.5, z0 = 0.6, z1 = D - 0.8, seed = b.seed & 255;
  for (let k = 0; k < n; k++) { const yy = y + k * fh; lbox(m, F, lx0, z0, lx1, z1, k ? yy : F.lo - 1, yy + 1.15, c, null); lbox(m, F, lx0 + 0.3, z0 + 0.3, lx1 - 0.3, z1 - 0.3, yy + 1.15, yy + fh, hx('#2c2b2a'), null); }
  lbox(m, F, lx0, z0, lx1, z1, y + n * fh, y + n * fh + 1.1, c, null); lbox(m, F, lx0 + 0.3, z0 + 0.3, lx1 - 0.3, z1 - 0.3, y + n * fh, y + n * fh + 0.12, P.asphalt, P.asphalt);
  for (let x = lx0 + 3; x < lx1 - 2; x += 3) for (const z of [z0 + 3.2, z1 - 3.2]) if (r.chance(0.5)) car(m, F, x, z, false, r.pick(P.car), y + n * fh - 0.1);
  lbox(m, F, lx0 + 1, z0 + 1, lx0 + 5, z0 + 5, y + n * fh, y + n * fh + 3.2, c, sh(c, 0.8)); blade(m, F, lx1 - 1.2, z0, y + 4, Math.min(8, n * fh - 5), hx('#3f7fd0'), seed);
}
function lofts(m, F, b, s, r) {
  const { W, D } = F, y = F.baseY, wall = r.chance(0.7) ? r.pick(P.brick) : r.pick(P.stone), rc = r.pick(P.roof), trim = mixc(wall, WHITE, 0.45), seed = b.seed & 255, f = s.floors, gh = 4.6, lx0 = 0.4, lx1 = W - 0.4, z0 = 0.5, z1 = D - 0.8, top = y + gh + (f - 1) * s.fh;
  lbox(m, F, lx0, z0, lx1, z1, F.lo - 1.5, y + gh, sh(wall, 0.85), null, { bay: 4.4, fh: gh, base: y, ww: 0.82, wh: 0.68, style: ST.shop | ST.front, seed });
  lbox(m, F, lx0, z0, lx1, z1, y + gh, top, wall, rc, { bay: r.range(3.4, 4.2), fh: s.fh, base: y + gh, ww: 0.72, wh: 0.7, style: ST.office, seed });
  cornice(m, F, lx0, z0, lx1, z1, top, 0.7, trim, 0.35, rc); lbox(m, F, lx0 - 0.1, z0 - 0.15, lx1 + 0.1, z0, y + gh - 0.2, y + gh + 0.25, trim, trim);
  fireEscape(m, F, lx0 + (lx1 - lx0) * r.range(0.15, 0.6), z0, y + gh, s.fh, f, 3.2);
  roofClutter(m, F, r, lx0 + 1, z0 + 1, lx1 - 1, z1 - 1, top + 0.7, 4, rc); awning(m, F, lx0 + 1, lx0 + 6, z0, y + 3.2, 1.2, r.pick(P.awning));
  if (r.chance(0.5)) roofSign(m, F, lx0 + 2, Math.min(lx1 - 2, lx0 + 12), z0 + 1.5, top + 0.7, 2.2, r.pick(P.neon));
}

// ---- industry ----------------------------------------------------------------------------------------
const IND = {
  sawtooth(m, F, b, s, r, y) {
    const { W, D } = F, wall = r.chance(0.5) ? r.pick(P.brick) : r.pick(P.shed), yard = r.range(1.5, 4), a0 = 0.8, a1 = W - 0.8, z0 = yard, z1 = D - 1, h = y + Math.max(5, s.floors * s.fh);
    lbox(m, F, a0, z0, a1, z1, F.lo - 1, h, wall, null, { bay: r.range(4, 5.5), fh: s.fh, base: y, ww: 0.78, wh: 0.6, style: ST.ind, seed: b.seed & 255 });
    const n = Math.max(2, Math.round((a1 - a0) / r.range(6, 8))), bw = (a1 - a0) / n; for (let k = 0; k < n; k++) lroof(m, F, a0 + k * bw, z0, a0 + (k + 1) * bw, z1, h, bw * 0.3, r.pick(P.metal), wall, true, 'z');
    awning(m, F, a0 + 1, Math.min(a1, a0 + 9), z0, y + 3.3, 1.5, P.metal[1]); if (r.chance(0.4)) chimney(m, F, a1 - 2, z1 - 2, 0.7, h - 0.5, y + r.range(13, 18), r.pick(P.brick));
  },
  warehouse(m, F, b, s, r, y) { // bow-truss shed with a loading dock and trucks
    const { W, D } = F, wall = r.chance(0.4) ? r.pick(P.brick) : r.pick(P.shed), dock = Math.min(7.5, D * 0.26), a0 = 0.7, a1 = W - 0.7, z0 = dock, z1 = D - 0.9, h = y + r.range(6.5, 8.5), roofC = r.pick(P.metal);
    pad(m, F, 0.3, 0.3, W - 0.3, dock, y); lbox(m, F, a0, z0, a1, z1, F.lo - 1, h, wall, null, { bay: 5, fh: h - y, base: y, ww: 0.5, wh: 0.22, style: ST.ind, seed: b.seed & 255 }, 10);
    const n = W > 30 ? 2 : 1, bw = (a1 - a0) / n; for (let k = 0; k < n; k++) lbarrel(m, F, a0 + k * bw, z0 - 0.3, a0 + (k + 1) * bw, z1 + 0.3, h, bw * 0.2, roofC, wall, 'z');
    lbox(m, F, a0, z0 - 1.4, a1, z0, y - 0.3, y + 1.2, P.concrete, P.concrete);
    for (let x = a0 + 2.2; x < a1 - 2; x += 4.6) { panel(m, F, x - 1.5, x + 1.5, z0, y + 1.2, y + 4.4, hx('#8f9496')); if (r.chance(0.45)) truck(m, F, x, z0 - 5.2, false, r.pick(P.box), y); }
    awning(m, F, a0, a1, z0, y + 4.9, 1.8, P.metal[1]);
  },
  garage(m, F, b, s, r, y) { // auto repair: roll-up doors, forecourt full of cars
    const { W, D } = F, wall = r.pick(P.house), acc = r.pick(P.neon), fc = Math.min(D * 0.42, 11), a0 = 0.6, a1 = W - 0.6, z0 = fc, z1 = D - 0.8, h = y + 5.2, seed = b.seed & 255;
    pad(m, F, 0.3, 0.3, W - 0.3, fc, y); lbox(m, F, a0, z0, a1, z1, F.lo - 1, h, wall, r.pick(P.roof)); lbox(m, F, a0 - 0.1, z0 - 0.15, a1 + 0.1, z0 + 0.3, h - 1.3, h + 0.5, acc, sh(acc, 0.8));
    lbox(m, F, a0 + 1, z0 - 0.22, a0 + Math.min(9, a1 - a0 - 2), z0 - 0.14, h - 1.0, h + 0.2, WHITE, null, glow(seed));
    const n = Math.max(2, Math.floor((a1 - a0) / 4.6)), bw = (a1 - a0) / n; for (let k = 0; k < n; k++) panel(m, F, a0 + k * bw + 0.5, a0 + (k + 1) * bw - 0.5, z0, y + 0.1, y + 3.6, k === 0 && r.chance(0.5) ? P.glassDark : hx('#b9bcb8'));
    for (let x = 2.4; x < W - 2; x += 3.0) for (const z of [fc * 0.3, fc * 0.72]) if (r.chance(0.55)) car(m, F, x, z, false, r.pick(P.car), y);
    for (let k = 0; k < 3; k++) lcyl(m, F, a1 - 1.2 - k * 0.5, z0 - 0.9, 0.42, 0.42, y, y + 0.5 + k * 0.25, P.iron, 8, true); // tire stack
  },
  brewery(m, F, b, s, r, y) { // brick block, row of silos, chimney, roof sign
    const { W, D } = F, wall = r.pick(P.brick), rc = r.pick(P.roof), f = Math.max(2, Math.min(4, s.floors + 1)), a0 = 0.7, sx = Math.min(W * 0.34, 9), a1 = W - 0.7 - sx, z0 = r.range(1.2, 2.4), z1 = D - 1, top = y + f * 4.4, seed = b.seed & 255;
    lbox(m, F, a0, z0, a1, z1, F.lo - 1, top, wall, rc, { bay: 3.8, fh: 4.4, base: y, ww: 0.56, wh: 0.66, style: ST.ind, seed }); cornice(m, F, a0, z0, a1, z1, top, 0.6, sh(wall, 1.18), 0.25, rc);
    lbox(m, F, a0 + 1, z0 + 1, a0 + 6, z0 + 6, top + 0.6, top + 4.2, wall, rc, { bay: 2.4, fh: 3.6, base: top + 0.6, ww: 0.4, wh: 0.6, style: ST.ind, seed }); lroof(m, F, a0 + 0.7, z0 + 0.7, a0 + 6.3, z0 + 6.3, top + 4.2, 2, r.pick(P.pitch), wall);
    const rr = Math.min(2.1, sx * 0.24), steel = hx('#c2c6c4'); for (let z = z0 + rr + 0.5, k = 0; z < z1 - rr && k < 5; z += rr * 2.25, k++) for (const x of sx > 7 ? [W - 0.7 - rr - 0.3, W - 0.7 - rr * 3.4] : [W - 0.7 - rr - 0.3]) silo(m, F, x, z, rr, y, r.range(9, 13), steel);
    chimney(m, F, a1 - 2.2, z1 - 2.4, 1.0, top, y + r.range(20, 27), wall); roofSign(m, F, a0 + 7, Math.max(a0 + 11, a1 - 2), z0 + 1.2, top + 0.6, 2.4, r.pick(P.neon)); awning(m, F, a0 + 1.5, a0 + 6.5, z0, y + 3.3, 1.2, r.pick(P.awning));
  },
  storage(m, F, b, s, r, y) { // rows of lock-ups and stacked containers behind a fence
    const { W, D } = F, c = r.pick(P.shed), door = r.pick(P.box), z0 = 2.2;
    pad(m, F, 0.3, 0.3, W - 0.3, D - 0.3, y); fence(m, F, 0.5, 0.6, W - 0.5, D - 0.6, y);
    lbox(m, F, 1.4, z0, 6.4, z0 + 4.4, F.lo - 1, y + 3.2, r.pick(P.house), r.pick(P.roof), { bay: 2.5, fh: 3.2, base: y, ww: 0.6, wh: 0.5, style: ST.shop, seed: b.seed & 255 }, 1);
    const half = D * 0.55; let k = 0;
    for (let x = 8.5; x + 5 <= W - 1.5; x += 8.4, k++) { lbox(m, F, x, z0, x + 5, half, F.lo - 1, y + 3, c, P.metal[k % 3]); for (let z = z0 + 0.4; z + 2.3 < half; z += 2.9) lbox(m, F, x - 0.06, z, x, z + 2.3, y + 0.1, y + 2.5, door, null); }
    boxes(m, F, r, 1.6, half + 2.6, W - 1.6, D - 1.6, y, 3);
  },
  lab(m, F, b, s, r, y) { // two-storey flex building: ribbon windows, rooftop plant, parking strip, trees
    const { W, D } = F, wall = hx(r.pick(['#d9d6cc', '#c9cdc8', '#d6cdbb', '#bfc7c9', '#e0dccf'])), acc = r.pick(P.box), strip = Math.min(7, D * 0.25), a0 = 0.8, a1 = W - 0.8, z0 = strip, z1 = D - 1.2, f = Math.max(2, Math.min(3, s.floors)), top = y + f * 4.2, rc = hx('#a6a69f'), seed = b.seed & 255;
    pad(m, F, 0.3, 0.3, W - 0.3, strip - 0.8, y); for (let x = 2.4; x < W - 2; x += 3.0) if (r.chance(0.55)) car(m, F, x, strip * 0.45, false, r.pick(P.car), y);
    lbox(m, F, a0, z0, a1, z1, F.lo - 1, top, wall, rc, { bay: 1.5, fh: 4.2, base: y, ww: 0.94, wh: 0.46, style: ST.office, seed });
    lbox(m, F, a0 + (a1 - a0) * 0.4, z0 - 0.5, a0 + (a1 - a0) * 0.6, z0 + 0.5, F.lo - 1, top + 0.9, acc, sh(acc, 0.8)); lbox(m, F, a0 - 0.1, z0 - 0.1, a1 + 0.1, z1 + 0.1, top, top + 0.35, sh(wall, 0.8), null);
    for (let k = 0, n = r.int(2, 4); k < n; k++) { const px = a0 + 2 + r() * (a1 - a0 - 6), pz = z0 + 2 + r() * (z1 - z0 - 6); lbox(m, F, px, pz, px + r.range(2, 3.4), pz + r.range(1.6, 2.6), top, top + r.range(1.2, 2), P.metal[k % 3], P.metal[0]); }
    lcyl(m, F, a1 - 2, z1 - 2, 0.35, 0.35, top, top + 3.2, P.metal[0], 6, true); for (let x = 2; x < W - 1; x += 6) ltree(m, F, x, strip - 0.5, r.range(5, 7), r.range(1.8, 2.4), r.pick(P.tree));
  },
  quonset(m, F, b, s, r, y) { // half-round huts and a yard of crates
    const { W, D } = F, steel = r.pick(P.metal), n = W > 20 ? 3 : 2, gap = 1.2, hw = (W - 1.6 - gap * (n - 1)) / n, z0 = r.range(2.5, 5), z1 = Math.min(D - 1, z0 + r.range(13, 19));
    pad(m, F, 0.3, 0.3, W - 0.3, D - 0.3, y, hx('#77746c'));
    for (let k = 0; k < n; k++) { const x0 = 0.8 + k * (hw + gap); lbarrel(m, F, x0, z0, x0 + hw, z1, y, hw * 0.5, k % 2 ? sh(steel, 0.92) : steel, sh(steel, 0.8), 'z', 8); panel(m, F, x0 + hw * 0.3, x0 + hw * 0.7, z0, y + 0.1, y + Math.min(3.4, hw * 0.4), r.pick(P.box)); }
    if (D - z1 > 5) boxes(m, F, r, 1.4, z1 + 1.6, W - 1.4, D - 1.2, y, 2);
    if (r.chance(0.5)) truck(m, F, W * 0.5, z0 - 1.6, true, r.pick(P.box), y);
  },
  yard(m, F, b, s, r, y) { // open shed on posts, timber stacks, a small office
    const { W, D } = F, wood = hx('#b08f62'), rc = r.pick(P.metal), z0 = 2;
    pad(m, F, 0.3, 0.3, W - 0.3, D - 0.3, y, hx('#8a8576')); fence(m, F, 0.5, 0.6, W - 0.5, D - 0.6, y);
    const sx0 = W * 0.36, sx1 = W - 1.4, sz0 = D * 0.4, sz1 = D - 1.6, h = y + 5.4; for (const [px, pz] of [[sx0, sz0], [sx1, sz0], [sx0, sz1], [sx1, sz1], [(sx0 + sx1) / 2, sz0], [(sx0 + sx1) / 2, sz1]]) lbox(m, F, px - 0.18, pz - 0.18, px + 0.18, pz + 0.18, y, h, P.iron, null);
    lroof(m, F, sx0 - 0.6, sz0 - 0.6, sx1 + 0.6, sz1 + 0.6, h, 1.5, rc, rc, true, 'x');
    for (let z = sz0 + 1; z + 1.4 < sz1; z += 2.2) for (let x = sx0 + 1; x + 4 < sx1; x += 4.8) { const n = r.int(1, 3); lbox(m, F, x, z, x + 4.2, z + 1.4, y, y + n * 0.9, sh(wood, 0.85 + r() * 0.3), wood); }
    lbox(m, F, 1.4, z0, 7.4, z0 + 5.5, F.lo - 1, y + 3.4, r.pick(P.house), null, { bay: 3, fh: 3.4, base: y, ww: 0.5, wh: 0.5, style: ST.shop, seed: b.seed & 255 }, 1); lroof(m, F, 1.1, z0 - 0.3, 7.7, z0 + 5.8, y + 3.4, 1.6, r.pick(P.pitch), WHITE, true, 'x');
    for (let z = z0 + 8; z + 1.4 < D * 0.9 && z < sz1; z += 2.4) lbox(m, F, 1.6, z, 6.6, z + 1.5, y, y + r.int(1, 3) * 0.8, sh(wood, 0.9), wood);
    if (r.chance(0.6)) truck(m, F, W * 0.6, sz0 - 3, true, r.pick(P.box), y);
  },
  mill(m, F, b, s, r, y) { // tall brick mill beside a sawtooth shed
    const { W, D } = F, wall = r.pick(P.brick), rc = r.pick(P.roof), yard = r.range(3, 6), a0 = 0.8, a1 = W - 0.8, z0 = yard, z1 = D - 1, split = a0 + (a1 - a0) * r.range(0.42, 0.55), f = Math.max(3, Math.min(6, s.floors)), top = y + f * s.fh, seed = b.seed & 255, Wn = { bay: 4.2, fh: s.fh, base: y, ww: 0.7, wh: 0.64, style: ST.ind, seed };
    lbox(m, F, split + 0.6, z0, a1, z1, F.lo - 1, top, wall, rc, Wn); cornice(m, F, split + 0.6, z0, a1, z1, top, 0.5, sh(wall, 1.15), 0.2); roofClutter(m, F, r, split + 1.5, z0 + 1, a1 - 1, z1 - 1, top + 0.5, 3, rc);
    lbox(m, F, a1 - 5, z0 + 1, a1 - 1, z0 + 5, top, top + 5, wall, null, { ...Wn, bay: 2, base: top }); lroof(m, F, a1 - 5.3, z0 + 0.7, a1 - 0.7, z0 + 5.3, top + 5, 2.4, r.pick(P.pitch), wall);
    const h1 = y + s.fh * 1.5, n = Math.max(1, Math.round((split - a0) / 8)), bw = (split - a0) / n; lbox(m, F, a0, z0, split, z1, F.lo - 1, h1, wall, null, Wn); for (let k = 0; k < n; k++) lroof(m, F, a0 + k * bw, z0, a0 + (k + 1) * bw, z1, h1, bw * 0.28, r.pick(P.metal), wall, true, 'z');
    chimney(m, F, a0 + 3, z1 - 3, 1.4, h1 - 0.5, y + r.range(28, 40), wall); awning(m, F, a0 + 1, a0 + 9, z0, y + 3.3, 1.6, P.metal[1]);
  },
  power(m, F, b, s, r, y) { // turbine hall, a row of stacks, transformer yard
    const { W, D } = F, wall = r.chance(0.6) ? r.pick(P.brick) : r.pick(P.stone), rc = r.pick(P.roof), a0 = 1, a1 = W - 1, z0 = D * 0.28, z1 = D - 1.2, h = y + r.range(15, 20), seed = b.seed & 255;
    pad(m, F, 0.4, 0.4, W - 0.4, z0 - 0.6, y, hx('#8a877e')); fence(m, F, 0.6, 0.7, W - 0.6, z0 - 1, y);
    for (let x = 3; x < W - 3; x += 4.5) { lbox(m, F, x - 1.1, z0 * 0.3, x + 1.1, z0 * 0.3 + 2.2, y, y + 2.4, hx('#7f8a8c'), hx('#6a7476')); lbox(m, F, x - 0.12, z0 * 0.3 + 0.9, x + 0.12, z0 * 0.3 + 1.2, y + 2.4, y + 6.5, P.iron, null); }
    lbox(m, F, 1.5, z0 * 0.3 + 0.95, W - 1.5, z0 * 0.3 + 1.15, y + 6.2, y + 6.5, P.iron, null);
    lbox(m, F, a0, z0, a1, z1, F.lo - 1, h, wall, null, { bay: 4.6, fh: h - y, base: y, ww: 0.5, wh: 0.74, style: ST.ind, seed }); lbox(m, F, a0 + 2, z0 + 2, a1 - 2, z1 - 2, h, h + 2.6, sh(wall, 0.92), rc, { bay: 3, fh: 2.6, base: h, ww: 0.8, wh: 0.6, style: ST.ind, seed });
    cornice(m, F, a0, z0, a1, z1, h, 0.6, sh(wall, 1.15), 0.3, rc);
    const n = W > 36 ? 4 : W > 26 ? 3 : 2; for (let k = 0; k < n; k++) chimney(m, F, a0 + 4 + (k * (a1 - a0 - 8)) / Math.max(1, n - 1), z1 - 4, 1.7, h, y + r.range(42, 56), hx('#b9b2a2'));
  },
  tanks(m, F, b, s, r, y) { // oil tanks in bunds with a pipe rack
    const { W, D } = F, white = hx('#dad6ca'), rr = W > 34 ? 5.4 : 4.2, step = rr * 2 + 1.8;
    pad(m, F, 0.4, 0.4, W - 0.4, D - 0.4, y, hx('#8f8b80'));
    let k = 0; for (let z = 3 + rr; z + rr < D - 7; z += step) for (let x = 1.5 + rr; x + rr < W - 1.5; x += step, k++) tank(m, F, x, z, rr * r.range(0.8, 1), y, r.range(7, 12), k % 4 === 3 ? hx('#b4b9b6') : white, 0.6);
    lbox(m, F, 1.5, D - 5.6, W - 1.5, D - 5.2, y + 3, y + 3.4, hx('#8a8f8c'), null); lbox(m, F, 1.5, D - 5.0, W - 1.5, D - 4.7, y + 3, y + 3.3, hx('#a84a3a'), null); for (let x = 2; x < W - 1; x += 5) lbox(m, F, x, D - 5.5, x + 0.2, D - 4.8, y, y + 3, P.iron, null);
    lbox(m, F, 1.5, D - 4, 8, D - 1, F.lo - 1, y + 3.4, r.pick(P.shed), r.pick(P.roof), { bay: 3, fh: 3.4, base: y, ww: 0.5, wh: 0.5, style: ST.ind, seed: b.seed & 255 }, 4);
    lcyl(m, F, W - 3, D - 2.6, 0.3, 0.2, y, y + 22, P.iron, 6, false); lbox(m, F, W - 3.25, D - 2.85, W - 2.75, D - 2.35, y + 22, y + 23, hx('#f0a03a'), null, glow());
  },
  foundry(m, F, b, s, r, y) { // long hall with a raised monitor roof, crane bay, stacks, scrap
    const { W, D } = F, wall = r.chance(0.5) ? r.pick(P.brick) : r.pick(P.shed), roofC = r.pick(P.metal), a0 = 1, a1 = W - 1, z0 = r.range(4, 7), z1 = D - 1.2, h = y + r.range(11, 14), seed = b.seed & 255;
    pad(m, F, 0.4, 0.4, W - 0.4, z0 - 0.4, y, hx('#7f7c74'));
    lbox(m, F, a0, z0, a1, z1, F.lo - 1, h, wall, null, { bay: 4.4, fh: h - y, base: y, ww: 0.62, wh: 0.5, style: ST.ind, seed }); lroof(m, F, a0 - 0.3, z0 - 0.3, a1 + 0.3, z1 + 0.3, h, (z1 - z0) * 0.16, roofC, wall, true, 'x');
    const mz = (z0 + z1) / 2, mh = h + (z1 - z0) * 0.16; lbox(m, F, a0 + 2, mz - 2.2, a1 - 2, mz + 2.2, mh - 1.2, mh + 1.6, sh(wall, 0.9), null, { bay: 2.2, fh: 2.8, base: mh - 1.2, ww: 0.8, wh: 0.5, style: ST.ind, seed }); lroof(m, F, a0 + 1.7, mz - 2.5, a1 - 1.7, mz + 2.5, mh + 1.6, 1, roofC, wall, true, 'x');
    for (let k = 0, n = r.int(2, 3); k < n; k++) chimney(m, F, a0 + 3 + k * 4, z1 - 3, 1.1, h, y + r.range(24, 34), r.pick(P.brick));
    for (const x of [a0 + 2, a1 - 2]) { lbox(m, F, x - 0.25, 1, x + 0.25, z0, y, y + 8, P.iron, null); } lbox(m, F, a0 + 2, 1.6, a1 - 2, 2.3, y + 7.4, y + 8.2, hx('#c9a23f'), null); // gantry crane over the yard
    for (let k = 0; k < 4; k++) { const px = a0 + 4 + r() * (a1 - a0 - 10); lbox(m, F, px, 2.8, px + r.range(2, 4), 2.8 + r.range(1, 2), y, y + r.range(0.6, 1.6), hx(r.pick(['#6a4a3a', '#5a5a5c', '#7a5a44'])), null); }
  },
  cannery(m, F, b, s, r, y) { // long multi-storey block, loading bays, water tower with a sign
    const { W, D } = F, wall = r.chance(0.65) ? r.pick(P.brick) : r.pick(P.house), rc = r.pick(P.roof), a0 = 0.8, a1 = W - 0.8, z0 = r.range(5, 8), z1 = D - 1, f = Math.max(3, Math.min(5, s.floors)), top = y + f * 4.4, seed = b.seed & 255;
    pad(m, F, 0.4, 0.4, W - 0.4, z0, y); lbox(m, F, a0, z0, a1, z1, F.lo - 1, top, wall, rc, { bay: 3.6, fh: 4.4, base: y, ww: 0.68, wh: 0.66, style: ST.ind, seed });
    lbox(m, F, a0 - 0.15, z0 - 0.15, a1 + 0.15, z1 + 0.15, top, top + 1, wall, null); lbox(m, F, a0 + 0.3, z0 + 0.3, a1 - 0.3, z1 - 0.3, top + 0.2, top + 0.3, rc, rc);
    lbox(m, F, a0, z0 - 1.3, a1, z0, y - 0.3, y + 1.2, P.concrete, P.concrete); awning(m, F, a0, a1, z0, y + 4.6, 2, P.metal[1]);
    for (let x = a0 + 3; x < a1 - 2; x += 6) if (r.chance(0.5)) truck(m, F, x, z0 - 5, false, r.pick(P.box), y);
    const tx = a0 + (a1 - a0) * r.range(0.25, 0.75), tz = (z0 + z1) / 2; for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) lbox(m, F, tx + dx - 0.12, tz + dz - 0.12, tx + dx + 0.12, tz + dz + 0.12, top + 0.3, top + 6, P.iron, null);
    lcyl(m, F, tx, tz, 2.3, 2.3, top + 6, top + 10, hx('#8a6a52'), 10, false); lcyl(m, F, tx, tz, 2.45, 0.1, top + 10, top + 12, hx('#5a4a40'), 10, false);
    lbox(m, F, a0 + 2, z0 + 0.6, a0 + Math.min(16, a1 - a0 - 4), z0 + 0.85, top + 1, top + 3.6, r.pick(P.neon), null, glow(seed));
    chimney(m, F, a1 - 2.5, z1 - 2.5, 1.1, top, y + r.range(26, 34), wall);
  },
  gasworks(m, F, b, s, r, y) { // gasholders in guide frames, retort house
    const { W, D } = F, wall = r.pick(P.brick), n = W > 34 ? 2 : 1, R = Math.min((W - 3) / (2 * n) - 0.8, (D * 0.56) / 2), cz = 1.8 + R, drum = hx(r.pick(['#6f7f7a', '#7a6a5a', '#8a8f8c']));
    pad(m, F, 0.4, 0.4, W - 0.4, D - 0.4, y, hx('#827e74'));
    for (let k = 0; k < n; k++) {
      const cx = W / 2 + (k - (n - 1) / 2) * (R * 2 + 2), h = r.range(12, 18), fh = h + 4;
      lcyl(m, F, cx, cz, R, R, y - 0.5, y + h, drum, 16, false); lcyl(m, F, cx, cz, R, R * 0.3, y + h, y + h + R * 0.18, sh(drum, 0.9), 16, true);
      for (let q = 0; q < 8; q++) { const a = (q / 8) * Math.PI * 2, px = cx + Math.cos(a) * (R + 0.5), pz = cz + Math.sin(a) * (R + 0.5); lbox(m, F, px - 0.2, pz - 0.2, px + 0.2, pz + 0.2, y, y + fh, P.iron, null); }
      lcyl(m, F, cx, cz, R + 0.75, R + 0.75, y + fh - 0.5, y + fh, P.iron, 16, false); lcyl(m, F, cx, cz, R + 0.75, R + 0.75, y + fh * 0.55, y + fh * 0.55 + 0.4, P.iron, 16, false);
    }
    const z0 = cz + R + 2.5; if (D - z0 > 7) { lbox(m, F, 1.2, z0, W - 1.2, D - 1.2, F.lo - 1, y + 8, wall, null, { bay: 4, fh: 8, base: y, ww: 0.5, wh: 0.6, style: ST.ind, seed: b.seed & 255 }); lroof(m, F, 0.9, z0 - 0.3, W - 0.9, D - 0.9, y + 8, 2.6, r.pick(P.metal), wall, true, 'x'); chimney(m, F, W - 4, D - 3.5, 1.2, y + 8, y + r.range(24, 32), wall); }
  },
  pier(m, F, b, s, r, y) { // long transit shed behind an arched bulkhead front
    const { W, D } = F, wall = hx(r.pick(['#d6cfbd', '#cfc4ae', '#c9c2b4', '#bfb7a6'])), roofC = r.pick(P.metal), a0 = 1, a1 = W - 1, z0 = 1, zb = 6, z1 = D - 1.5, h = y + r.range(7.5, 9.5), seed = b.seed & 255, cx = W / 2;
    lbox(m, F, a0, z0, a1, zb, F.lo - 1, h + 2.4, wall, r.pick(P.roof), { bay: (a1 - a0) / Math.max(3, Math.round((a1 - a0) / 5)), fh: h + 2.4 - y, base: y, ww: 0.56, wh: 0.5, style: ST.shop, seed });
    lbox(m, F, cx - 3.4, z0 - 0.5, cx + 3.4, z0 + 0.4, F.lo - 1, h + 5.4, wall, sh(wall, 0.85)); panel(m, F, cx - 2.3, cx + 2.3, z0 - 0.5, y, y + 5.6, hx('#3a3f42')); lbarrel(m, F, cx - 3.4, z0 - 0.5, cx + 3.4, z0 + 0.4, h + 5.4, 1.5, wall, wall, 'z');
    lbox(m, F, cx - 2.6, z0 - 0.62, cx + 2.6, z0 - 0.5, h + 2.6, h + 4.8, hx('#3f5a7a'), null, glow(seed));
    lbox(m, F, a0 + 1.5, zb, a1 - 1.5, z1, F.lo - 1, h, sh(wall, 0.92), null, { bay: 5, fh: h - y, base: y, ww: 0.5, wh: 0.26, style: ST.ind, seed }, 10); lroof(m, F, a0 + 1.2, zb, a1 - 1.2, z1 + 0.3, h, (a1 - a0) * 0.14, roofC, wall, true, 'z');
    for (let z = zb + 4; z < z1 - 3; z += 7) for (const x of [a0 + 0.7, a1 - 0.7]) lbox(m, F, x - 0.35, z - 0.35, x + 0.35, z + 0.35, y, y + 0.9, P.iron, P.iron); // bollards on the apron
  },
  containers(m, F, b, s, r, y) { // stacks, a gantry crane and yard tractors
    const { W, D } = F, crane = hx(r.pick(['#c9d0d4', '#a54a3a', '#c79a44', '#4f6f8a']));
    pad(m, F, 0.3, 0.3, W - 0.3, D - 0.3, y, hx('#6f6e6c')); boxes(m, F, r, 2, 3, W - 2, D * 0.62, y, b.level + 2);
    const gz = D * 0.78, gw = Math.min(W - 6, 26), gx = (W - gw) / 2, H = 19 + b.level * 3;
    for (const x of [gx, gx + gw]) for (const z of [gz - 3.2, gz + 3.2]) lbox(m, F, x - 0.45, z - 0.45, x + 0.45, z + 0.45, y, y + H, crane, null);
    for (const x of [gx, gx + gw]) lbox(m, F, x - 0.35, gz - 3.2, x + 0.35, gz + 3.2, y + H * 0.45, y + H * 0.45 + 0.7, crane, null);
    lbox(m, F, gx - 5, gz - 1.1, gx + gw + 9, gz + 1.1, y + H, y + H + 1.6, crane, sh(crane, 0.8)); lbox(m, F, gx + gw * 0.5 - 1.4, gz - 1.5, gx + gw * 0.5 + 1.4, gz + 1.5, y + H - 2.4, y + H, hx('#d6d2c6'), hx('#8a8780'), { bay: 1.4, fh: 2.4, base: y + H - 2.4, ww: 0.8, wh: 0.6, style: ST.ind, seed: 3 });
    lbox(m, F, gx + gw * 0.5 - 0.3, gz - 0.3, gx + gw * 0.5 + 0.3, gz + 0.3, y + H + 1.6, y + H + 6, crane, null); lbox(m, F, gx + gw - 0.3, gz - 0.3, gx + gw + 0.3, gz + 0.3, y + H + 1.6, y + H + 3, P.iron, null, glow());
    boxes(m, F, r, gx + 2, gz - 1.3, gx + gw - 2, gz + 1.4, y, 1); if (r.chance(0.7)) truck(m, F, W * 0.3, D - 3, true, r.pick(P.box), y);
  },
  shipyard(m, F, b, s, r, y) { // a hull on the slip, tower crane, machine shop
    const { W, D } = F, wall = r.pick(P.shed), hull = hx(r.pick(['#3a4a5a', '#5a2f2a', '#2f3a3a', '#4a4a4e'])), a0 = 1, sw = Math.min(W * 0.45, 16), z0 = 2;
    pad(m, F, 0.3, 0.3, W - 0.3, D - 0.3, y, hx('#7a776f'));
    lbox(m, F, a0, z0, a0 + sw, z0 + D * 0.5, F.lo - 1, y + 9, wall, null, { bay: 4, fh: 9, base: y, ww: 0.6, wh: 0.5, style: ST.ind, seed: b.seed & 255 }); lroof(m, F, a0 - 0.3, z0 - 0.3, a0 + sw + 0.3, z0 + D * 0.5 + 0.3, y + 9, sw * 0.2, r.pick(P.metal), wall, true, 'z');
    const hx0 = a0 + sw + 4, hx1 = W - 2.5, hz0 = 3, hz1 = D - 3, hc = (hx0 + hx1) / 2, bw = Math.min(5.5, (hx1 - hx0) / 2);
    if (hx1 - hx0 > 6) {
      lpoly(m, F, [[hc + bw, hz0 + 7], [hc, hz0], [hc - bw, hz0 + 7], [hc - bw, hz1], [hc + bw, hz1]], y + 1.2, y + 7.5, hull, hx('#8a8780'));
      lpoly(m, F, [[hc + bw, hz0 + 7], [hc, hz0], [hc - bw, hz0 + 7], [hc - bw, hz1], [hc + bw, hz1]], y + 0.2, y + 1.2, hx('#7a2f2a'), null);
      lbox(m, F, hc - bw * 0.6, hz1 - 9, hc + bw * 0.6, hz1 - 2.5, y + 7.5, y + 12, hx('#d6d2c6'), hx('#8a8780'), { bay: 2, fh: 2.2, base: y + 7.5, ww: 0.6, wh: 0.5, style: ST.ind, seed: 5 });
      for (let z = hz0 + 4; z < hz1; z += 6) for (const x of [hc - bw - 0.9, hc + bw + 0.9]) lbox(m, F, x - 0.15, z - 0.15, x + 0.15, z + 0.15, y, y + 6, P.iron, null);
    }
    const tx = a0 + sw + 1.8, tz = D * 0.72, H = 30, yel = hx('#c79a44'); lbox(m, F, tx - 0.7, tz - 0.7, tx + 0.7, tz + 0.7, y, y + H, yel, null); lbox(m, F, tx - 5, tz - 0.5, tx + 17, tz + 0.5, y + H, y + H + 1.2, yel, sh(yel, 0.8)); lbox(m, F, tx - 5, tz - 1.2, tx - 2.5, tz + 1.2, y + H - 2, y + H, hx('#6a6a6c'), null);
    lbox(m, F, tx - 0.25, tz - 0.25, tx + 0.25, tz + 0.25, y + H + 1.2, y + H + 3.4, P.iron, null, glow());
  },
  fish(m, F, b, s, r, y) { // low sheds, ice house, stacked crates and a smokehouse sign
    const { W, D } = F, seed = b.seed & 255, n = W > 28 ? 3 : 2, gap = 1, sw = (W - 2 - gap * (n - 1)) / n, z0 = r.range(3, 5), z1 = D * 0.62;
    pad(m, F, 0.3, 0.3, W - 0.3, D - 0.3, y, hx('#8a8780'));
    for (let k = 0; k < n; k++) { const x0 = 1 + k * (sw + gap), wall = r.pick(P.house); lbox(m, F, x0, z0, x0 + sw, z1, F.lo - 1, y + 4.6, wall, null, { bay: sw / 2, fh: 4.6, base: y, ww: 0.8, wh: 0.6, style: ST.shop | ST.front, seed: seed + k }, 1); lroof(m, F, x0 - 0.2, z0 - 0.5, x0 + sw + 0.2, z1 + 0.2, y + 4.6, sw * 0.22, r.pick(P.pitch), wall, true, 'z'); awning(m, F, x0 + 0.4, x0 + sw - 0.4, z0, y + 3, 1.3, r.pick(P.awning)); }
    roofSign(m, F, 2, Math.min(W - 2, 14), z0 + 1, y + 4.6 + sw * 0.1, 2, r.pick(P.neon));
    lbox(m, F, W - 9, z1 + 2, W - 1.5, D - 1.5, F.lo - 1, y + 7, hx('#d9d6cc'), hx('#a6a69f')); lcyl(m, F, W - 5, D - 4, 1.2, 1.2, y + 7, y + 9, P.metal[0], 8, true);
    for (let x = 1.6; x < W - 11; x += 1.9) for (let z = z1 + 2; z < D - 2; z += 1.9) { const k = r.int(0, 3); if (k) lbox(m, F, x, z, x + 1.5, z + 1.5, y, y + k * 0.7, sh(r.pick(P.box), 0.9), null); }
  },
};
function industry(m, F, b, s, r, key) { const y = F.baseY; IND[key](m, F, b, s, r, y); }

// ---- dispatch ----------------------------------------------------------------------------------------
ext.emit = (m, F, b, s, r) => {
  const z = b.zone;
  if (z === 1 && (s.variant < 3 || s.variant > 4)) { rowhouse(m, F, b, s, r); return true; }
  if ((z === 2 || z === 11) && s.floors <= 7) { flats(m, F, b, s, r); return true; }
  const k = kindKey(b, s.floors);
  if (z === 3) { ({ theater, market, bank, diner, gas })[k] ? ({ theater, market, bank, diner, gas })[k](m, F, b, s, r) : shopRow(m, F, b, s, r); return true; }
  if (z === 10 && s.floors <= 3) { shopRow(m, F, b, s, r); return true; }
  if (z === 4) { if (k === 'parking') parking(m, F, b, s, r); else if (k === 'lofts') lofts(m, F, b, s, r); else if (k === 'palace') theater(m, F, b, s, r, true); else return false; return true; }
  if (IND[k]) { industry(m, F, b, s, r, k); return true; }
  return false;
};
