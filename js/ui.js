// DOM heads-up display: stats, demand bars, clock, toolbar, tool options, info panel, menu and the start screen.
import { ZONES, TIERS, stats, tierOf, buildings, removeBuilding, CELL } from './world.js';
import { MAPMODE } from './terrain.js';
import { sim, yearOf } from './sim.js';
import { ROAD_TYPES } from './roads.js';
import { ext } from './buildings.js';
import { slots, saveSlot, loadSlot, exportFile, importFile, serialize, metaOf, MAP_NAMES } from './save.js';
import { CAT, CATALOG, CATS } from './structures.js';
import { city, nm, money, dateLabel, hoodName, hoodAt, bpos, sample, grid, OVERLAYS, markDirty } from './city.js';
import { tech, waveLabel } from './tech.js';
import { culture, artistById, FAME, fameTier, ROOM, roomTier, venueRank, LEAGUES, quake, raceNow, setCircuit, olyUnlocked } from './culture.js';
import { LINE_TYPES } from './life.js';
import { costOf, parsePrompt, ERAS } from './place.js';
import { cloud, syncCode, setSyncCode, isPersisted } from './cloud.js';
import { makePanels } from './panels.js';
import { fmt } from './util.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function makeUI(game) {
  const $ = (id) => document.getElementById(id), T = () => game.tools.state;
  const icons = () => window.lucide && window.lucide.createIcons();
  icons();
  let shownPop = 0, shownJobs = 0, optKey = '', lastTier = 0, infoId = 0;
  const hhmm = (h) => { const m = Math.floor((h % 24) * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

  function toast(msg, kind = '') {
    const box = $('toasts'); if ([...box.children].some((c) => c.textContent === msg)) return;
    const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = msg; box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 420); }, kind === 'gold' ? 4200 : 2600);
  }

  // ---- tool options -------------------------------------------------------------------------------
  const seg = (name, cur, items) => `<div class="seg" role="group">${items.map(([v, l, t]) => `<button data-act="${name}" data-v="${v}" aria-pressed="${String(v) === String(cur)}" title="${t || ''}">${l}</button>`).join('')}</div>`;
  const chip = (act, v, on, label, sub = '', dis = false, title = '') => `<button class="sw" data-act="${act}" data-v="${v}" aria-pressed="${on}" ${dis ? 'disabled' : ''} title="${esc(title)}">${esc(label)}${sub ? `<em>${sub}</em>` : ''}</button>`;
  function renderOptions(force) {
    const t = T(), key = [t.tool, t.roadType, t.roadMode, t.clip ? t.clip.segs.length : 0, t.zoneId, t.zoneMode, t.snapGrid, t.snapAngle, t.buildCat, t.buildKey, t.lineType, t.lineDraft ? t.lineDraft.length : 0, city.lines.length, t.terraMode, t.lockMode, t.circuitMode, t.circuitDraft ? t.circuitDraft.length : 0, !!culture.f1.pts, t.hoodId, city.cfg.parody, olyUnlocked(), JSON.stringify(t.fill.items)].join('|');
    if (key === optKey && !force) return; optKey = key;
    const el = $('options'); let h = '';
    if (game.readOnly) h = '<span class="hint">Shared city. Look around: drag to move, right-drag to rotate, scroll or pinch to zoom. Click a building for details.</span>';
    else if (t.tool === 'inspect') h = '<span class="hint">Click a building for details. Drag to move, right-drag to rotate, scroll or pinch to zoom.</span><div class="grp"><button class="btn sm" data-act="tool" data-v="lock">Historic locks</button></div>';
    else if (t.tool === 'bulldoze') h = '<span class="hint">Click a building or a road to remove it. Drag to clear an area.</span>';
    else if (t.tool === 'lock') h = `<div class="grp">${seg('lockMode', t.lockMode, [['lock', 'Lock'], ['unlock', 'Unlock']])}</div><span class="hint">Click a building, or drag an area. Locked buildings are never redeveloped.</span>`;
    else if (t.tool === 'disaster') h = `<span class="hint">Click a building to set it alight. Fire stations in range put fires out.</span><div class="grp"><span>Magnitude <b id="magLbl">${t.quakeMag.toFixed(1)}</b></span><input type="range" id="quakeMag" min="5" max="8.2" step="0.1" value="${t.quakeMag}" aria-label="Earthquake magnitude" /><button class="btn sm danger" data-act="quake">Trigger earthquake</button></div>`;
    else if (t.tool === 'hood') h = `<span class="hint">Painting ${esc(hoodName(t.hoodId))}. Drag over the blocks that belong to it.</span><div class="grp"><span>Size</span><input type="range" id="hoodSize" min="80" max="600" step="20" value="${t.hoodSize}" aria-label="Brush size" /><button class="btn sm" data-act="tool" data-v="inspect">Done</button></div>`;
    else if (t.tool === 'road') {
      h = `<div class="grp">${seg('roadType', t.roadType, Object.entries(ROAD_TYPES).map(([k, r]) => [k, r.name, r.hint]))}</div>
        <div class="grp">${seg('roadMode', t.roadMode, [['straight', 'Straight', 'Click to place points. Right-click or Esc ends the road.'], ['curve', 'Curve', 'Click start, bend point, then end.'], ['blocks', 'Blocks', 'Stamp a grid of city blocks with one click.'], ['copy', 'Copy', 'Drag over roads to copy them, then click to paste.']])}</div>`;
      const num = (id, v, min, max, step, label) => `<input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${label}" />`;
      if (t.roadMode === 'blocks') h += `<div class="grp">${num('blocksX', t.blocksX, 1, 12, 1, 'Blocks across')}<span>by</span>${num('blocksZ', t.blocksZ, 1, 12, 1, 'Blocks down')}<span>blocks of</span>${num('blockW', t.blockW, 48, 400, 8, 'Block width in metres')}<span>by</span>${num('blockH', t.blockH, 48, 400, 8, 'Block length in metres')}<span>m</span></div><div class="grp"><button class="btn sm" data-act="stampRot">Turn (T)</button></div><span class="hint">Click to stamp. It lines up with a road under the cursor.</span>`;
      else if (t.roadMode === 'copy') h += t.clip ? `<div class="grp"><button class="btn sm" data-act="stampRot">Turn (T)</button><button class="btn sm ghost" data-act="noclip">Copy something else</button></div><span class="hint">Click to paste ${t.clip.segs.length} road piece${t.clip.segs.length === 1 ? '' : 's'}.</span>` : '<span class="hint">Drag over the roads you want to copy.</span>';
      if (t.roadMode !== 'copy' || t.clip) h += `<div class="grp"><label class="check"><input type="checkbox" data-act="snapGrid" ${t.snapGrid ? 'checked' : ''}/> Snap to grid</label>${t.roadMode === 'straight' ? `<label class="check"><input type="checkbox" data-act="snapAngle" ${t.snapAngle ? 'checked' : ''}/> Snap angles</label>` : ''}</div>`;
    } else if (t.tool === 'zone') {
      const sw = (id) => `<button class="sw" data-act="zone" data-v="${id}" aria-pressed="${t.zoneId === id}" style="--c:${id ? ZONES[id].color : '#8d867a'}" title="${id ? `${ZONES[id].name}, ${ZONES[id].density.toLowerCase()}` : 'Remove zoning'}"><i></i>${id ? (ZONES[id].spec ? ZONES[id].name : `${ZONES[id].name} ${ZONES[id].density.toLowerCase()}`) : 'De-zone'}</button>`;
      h = `<div class="grp swatches">${[1, 3, 5, 7, 2, 4, 6, 8].map(sw).join('')}</div><div class="grp swatches two">${[11, 10, 9, 12].map(sw).join('')}</div><div class="grp">${sw(0)}</div>
        <div class="grp">${seg('zoneMode', t.zoneMode, [['brush', 'Brush', 'Paint cells'], ['fill', 'Block fill', 'Fill the block enclosed by roads'], ['rect', 'Rectangle', 'Drag a rectangle']])}</div>`;
      if (t.zoneMode === 'brush') h += `<div class="grp"><span>Size</span><input type="range" id="brush" min="1" max="15" step="2" value="${t.brush}" aria-label="Brush size" /></div>`;
    } else if (t.tool === 'build') {
      h = `<div class="grp">${seg('buildCat', t.buildCat, [...CATS, ['fill', 'Smart-fill']])}</div>`;
      if (t.buildCat === 'fill') {
        h += `<div class="grp">${[['tree', 'Trees'], ['bench', 'Benches'], ['lamp', 'Lamps'], ['planter', 'Planters'], ['fountain', 'Fountains'], ['plaza', 'Plazas']].map(([k, l]) => `<label class="check"><input type="checkbox" data-fill="${k}" ${t.fill.items[k] ? 'checked' : ''}/> ${l}</label>`).join('')}</div>
          <div class="grp"><span>Density</span><input type="range" id="fillDens" min="0.1" max="1" step="0.05" value="${t.fill.density}" aria-label="Density" /></div>
          <div class="grp"><input type="text" id="fillPrompt" placeholder="Or describe it: leafy and well lit" value="${esc(t.fill.prompt)}" aria-label="Describe the detail you want" /><button class="btn sm" data-act="prompt">Apply</button></div><span class="hint">Then drag over an area.</span>`;
      } else {
        const list = CATALOG.filter((c) => c.cat === t.buildCat && !c.hidden);
        h += `<div class="grp items">${list.map((c) => chip('buildKey', c.k, t.buildKey === c.k, nm(c.name), money(costOf(c.k, 1, 1)) + (c.per ? '/cell' : ''), c.needs === 'olympics' && !olyUnlocked(), c.needs ? 'Win the Olympic bid to unlock' : '')).join('')}${t.buildCat === 'sport' ? chip('buildKey', 'circuit', t.buildKey === 'circuit', 'Street circuit') : ''}</div>`;
        const c = CAT[t.buildKey];
        if (t.buildKey === 'circuit') h += `<div class="grp">${seg('circuitMode', t.circuitMode, [['prebuilt', 'Prebuilt', 'Click to drop a ready-made loop'], ['draw', 'Draw', 'Click each corner, then press Enter']])}${t.circuitDraft ? '<button class="btn sm" data-act="finish">Close the loop</button>' : ''}${culture.f1.pts ? '<button class="btn sm" data-act="race">Race now</button><button class="btn sm ghost" data-act="nocircuit">Remove</button>' : ''}</div>`;
        else if (c && c.rect) h += '<span class="hint">Drag a rectangle.</span>';
        else if (c) h += `<div class="grp">${c.site ? '<button class="btn sm" data-act="site">Build at real site</button>' : ''}${c.fixed ? '' : '<button class="btn sm ghost" data-act="rot" title="Rotate (T)">Rotate</button>'}</div>`;
      }
    } else if (t.tool === 'transit') {
      h = `<div class="grp">${seg('lineType', t.lineType, Object.entries(LINE_TYPES).map(([k, l]) => [k, l.name]))}</div>`;
      h += t.lineDraft && t.lineDraft.length ? `<span class="hint">${t.lineDraft.length / 2} stop${t.lineDraft.length === 2 ? '' : 's'}. Click to add more.</span><div class="grp"><button class="btn sm primary" data-act="finish">Finish line</button></div>` : `<span class="hint">${t.lineType === 'ferry' ? 'Click points on the shore to place ferry landings.' : 'Click along streets to place stops.'} Enter finishes the line.</span>`;
      if (city.lines.length) h += `<div class="grp items">${city.lines.map((l) => `<span class="linechip" style="--c:${l.color}"><i></i>${esc(l.name)}<button data-act="rmline" data-v="${l.id}" aria-label="Remove ${esc(l.name)}">&times;</button></span>`).join('')}</div>`;
    } else if (t.tool === 'terrain') {
      h = `<div class="grp">${seg('terraMode', t.terraMode, [['raise', 'Raise'], ['lower', 'Lower'], ['flatten', 'Flatten'], ['fill', 'Landfill', 'Turn shallow water into land'], ['dig', 'Dig', 'Turn land into water'], ['pier', 'Pier', 'Drag a straight strip of new land']])}</div>
        <div class="grp"><span>Size</span><input type="range" id="terraSize" min="40" max="320" step="10" value="${t.terraSize}" aria-label="Brush size" /></div><span class="hint">${t.terraMode === 'pier' ? 'Drag from the shore out into the water.' : 'Hold and drag. Roads and buildings stay put.'}</span>`;
    }
    el.innerHTML = h;
  }
  $('options').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
    const t = T(), a = b.dataset.act, v = b.dataset.v;
    if (a === 'tool') { if (t.tool === 'hood' && game.overlay === 'hood') game.setOverlay('none'); return game.tools.setTool(v); }
    if (a === 'zone') t.zoneId = +v;
    else if (a === 'buildCat') { t.buildCat = v; t.buildKey = v === 'fill' ? 'smartfill' : CATALOG.find((c) => c.cat === v && !c.hidden).k; }
    else if (a === 'rot') t.buildRot = (t.buildRot + 1) & 3;
    else if (a === 'stampRot') { t.stampRot = (t.stampRot + 1) & 3; game.tools.touch(); return; }
    else if (a === 'noclip') t.clip = null;
    else if (a === 'site') { game.tools.siteBuild(t.buildKey); }
    else if (a === 'finish') return game.tools.finish();
    else if (a === 'rmline') { game.tools.removeLine(+v); }
    else if (a === 'quake') { quake(t.quakeMag); if (game.audio) game.audio.quake(t.quakeMag); }
    else if (a === 'race') { if (raceNow()) toast('Race weekend starts now'); }
    else if (a === 'nocircuit') setCircuit(null);
    else if (a === 'prompt') applyPrompt();
    else { t[a] = v; if (a === 'lineType') t.lineDraft = null; }
    game.tools.cancel(); refresh(true);
  });
  async function applyPrompt() {
    const t = T(), text = ($('fillPrompt').value || '').trim(); t.fill.prompt = text; if (!text) return;
    let r = null;
    try { const res = await fetch('./api/detail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text }) }); if (res.ok) { const j = await res.json(); if (j && j.items) r = j; } } catch { /* no server: fall back to the local reading */ }
    const local = !r; if (!r) r = parsePrompt(text);
    t.fill.items = { tree: !!r.items.tree, bench: !!r.items.bench, lamp: !!r.items.lamp, planter: !!r.items.planter, fountain: !!r.items.fountain, plaza: !!r.items.plaza }; t.fill.density = Math.min(1, Math.max(0.1, +r.density || 0.5));
    toast(local ? 'Prompt read by keywords. Drag over an area to apply.' : 'Prompt read by Claude. Drag over an area to apply.'); refresh(true);
  }
  $('options').addEventListener('change', (e) => {
    const t = T(), el = e.target;
    if (el.dataset.act) t[el.dataset.act] = el.checked;
    if (el.dataset.fill) t.fill.items[el.dataset.fill] = el.checked;
    if (el.id === 'blockW') t.blockW = Math.min(400, Math.max(48, Math.round(+el.value / 8) * 8 || 96));
    if (el.id === 'blockH') t.blockH = Math.min(400, Math.max(48, Math.round(+el.value / 8) * 8 || 176));
    if (el.id === 'blockW' || el.id === 'blockH') el.value = el.id === 'blockW' ? t.blockW : t.blockH;
    if (el.id === 'blocksX' || el.id === 'blocksZ') { t[el.id] = Math.min(12, Math.max(1, Math.round(+el.value) || 3)); el.value = t[el.id]; }
    if (/^block/.test(el.id)) game.tools.touch();
    if (el.id === 'fillPrompt') { t.fill.prompt = el.value; return; }
    refresh();
  });
  $('options').addEventListener('keydown', (e) => { if (e.target.id === 'fillPrompt' && e.key === 'Enter') { e.preventDefault(); applyPrompt(); } });
  $('options').addEventListener('input', (e) => {
    const t = T(), id = e.target.id, v = +e.target.value;
    if (id === 'brush') t.brush = v; else if (id === 'terraSize') t.terraSize = v; else if (id === 'fillDens') t.fill.density = v; else if (id === 'hoodSize') t.hoodSize = v; else if (id === 'quakeMag') { t.quakeMag = v; $('magLbl').textContent = v.toFixed(1); } else return;
    game.tools.touch();
  });

  // ---- toolbar, speed, clock, pop-overs ------------------------------------------------------------
  document.querySelectorAll('.toolbar [data-tool]').forEach((b) => b.addEventListener('click', () => game.tools.setTool(b.dataset.tool)));
  $('undoBtn').addEventListener('click', () => game.doUndo(false)); $('redoBtn').addEventListener('click', () => game.doUndo(true));
  document.querySelectorAll('.speed [data-speed]').forEach((b) => b.addEventListener('click', () => game.setSpeed(+b.dataset.speed)));
  const POPS = ['sunPop', 'wxPop', 'ovPop'];
  document.querySelectorAll('[data-pop]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.pop, open = $(id).hidden; for (const p of POPS) { $(p).hidden = true; } document.querySelectorAll('[data-pop]').forEach((q) => q.setAttribute('aria-expanded', 'false')); if (open) { $(id).hidden = false; b.setAttribute('aria-expanded', 'true'); syncPops(); } }));
  $('hour').addEventListener('input', (e) => { game.setHour(+e.target.value); $('hourLbl').textContent = hhmm(game.viewHour()); });
  $('cycle').addEventListener('change', (e) => { game.fixedHour = game.viewHour(); game.cycle = e.target.checked; });
  $('ovList').innerHTML = OVERLAYS.map(([k, n]) => `<button role="radio" data-v="${k}" aria-checked="false">${n}</button>`).join('');
  $('ovList').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { game.setOverlay(b.dataset.v); syncPops(); } });
  function syncPops() {
    document.querySelectorAll('#ovList button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === (game.overlay || 'none'))));
    const c = city.cfg; $('wxAuto').checked = c.wxAuto; $('wxFog').checked = c.fog; $('wxRain').checked = c.rain; $('wxSun').checked = c.sunsets; $('fogAmt').value = c.fogAmt; $('rainAmt').value = c.rainAmt;
  }
  $('wxAuto').addEventListener('change', (e) => { city.cfg.wxAuto = e.target.checked; city.wx.manual = 0; });
  $('wxFog').addEventListener('change', (e) => { city.cfg.fog = e.target.checked; }); $('wxRain').addEventListener('change', (e) => { city.cfg.rain = e.target.checked; });
  $('wxSun').addEventListener('change', (e) => { city.cfg.sunsets = e.target.checked; game.sky.wx.sunset = e.target.checked ? 0.8 : 0; });
  $('fogAmt').addEventListener('input', (e) => { city.cfg.fogAmt = +e.target.value; }); $('rainAmt').addEventListener('input', (e) => { city.cfg.rainAmt = +e.target.value; });
  $('wxNow').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) game.setWeather(b.dataset.v); });
  $('topMin').addEventListener('click', () => { city.cfg.topMin = !city.cfg.topMin; for (const p of POPS) $(p).hidden = true; document.querySelectorAll('[data-pop]').forEach((q) => q.setAttribute('aria-expanded', 'false')); refresh(true); });
  $('soundBtn').addEventListener('click', () => { const on = !game.audio.on; game.audio.setOn(on); city.cfg.sound = on; syncSound(); });
  function syncSound() { const b = $('soundBtn'); b.setAttribute('aria-pressed', String(game.audio.on)); b.innerHTML = `<i data-lucide="${game.audio.on ? 'volume-2' : 'volume-x'}"></i>`; b.title = game.audio.on ? 'Sound on' : 'Sound off'; icons(); }

  function refresh(force) {
    const t = T();
    document.querySelectorAll('.toolbar [data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t.tool)));
    document.querySelectorAll('.speed [data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.speed === game.speed)));
    $('undoBtn').disabled = !game.undo.canUndo(); $('redoBtn').disabled = !game.undo.canRedo();
    const segs = { growthSeg: sim.growth, scrollSeg: t.scroll, gfxSeg: city.cfg.gfx, camSeg: game.camMode, uiSeg: city.cfg.ui, trafficSeg: city.cfg.traffic, moneySeg: city.cfg.money };
    for (const id in segs) document.querySelectorAll(`#${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(segs[id]))));
    $('landValue').checked = city.cfg.landValue; $('tipsOn').checked = city.cfg.tips; $('parody').checked = city.cfg.parody; $('parody').disabled = !!game.readOnly;
    $('cashChip').hidden = city.cfg.money !== 'budget';
    const hud = $('hud'); hud.classList.toggle('ui-side', city.cfg.ui === 'side'); hud.classList.toggle('ui-ro', !!game.readOnly);
    const tm = !!city.cfg.topMin; $('topRight').classList.toggle('min', tm); $('topMin').setAttribute('aria-expanded', String(!tm)); $('topMin').title = tm ? 'Show all controls' : 'Collapse controls'; $('topMin').setAttribute('aria-label', $('topMin').title);
    $('toolbar').hidden = !!game.readOnly; $('options').hidden = !!game.readOnly; $('roBanner').hidden = !game.readOnly;
    renderOptions(force);
  }

  // ---- info panel ---------------------------------------------------------------------------------
  const KIND = { park: 'Park and decor', service: 'City service', landmark: 'Landmark', night: 'Nightlife venue', sport: 'Sports venue' };
  function showInfo(b) {
    const el = $('info');
    if (!b) { el.hidden = true; infoId = 0; return; }
    infoId = b.id; const [x, z] = bpos(b), hood = hoodName(hoodAt(x, z)), lv = Math.round(sample(grid.lv, x, z) * 100), sat = Math.round(sample(grid.sat, x, z) * 100), built = sim.year0 + Math.floor((b.born - 1) / 4);
    let h = '<button class="icon close" aria-label="Close details"><i data-lucide="x"></i></button>';
    if (b.sp) {
      const c = CAT[b.sp], v = culture.venues.find((q) => q.id === b.id), rows = [];
      if (b.jobs) rows.push(['Jobs', fmt(b.jobs)]); if (b.res) rows.push(['Residents', fmt(b.res)]); if (c.fx.cap) rows.push(['Capacity', fmt(c.fx.cap)]);
      rows.push(['Upkeep', `${money((c.per ? c.up * b.w * b.d : c.up))} a day`]); if (c.fx.amen) rows.push(['Raises land value within', `${Math.round(c.fx.amen[0])} m`]); if (c.fx.svc) rows.push(['Covers', `${Math.round(c.fx.svc[1])} m`]); if (c.fx.noise) rows.push(['Noise reaches', `${Math.round(c.fx.noise[0])} m`]);
      rows.push(['Lot', `${b.w * CELL} by ${b.d * CELL} m`], ['Built', built]); if (hood) rows.push(['Neighborhood', esc(hood)]);
      h += `<h2>${esc(v ? v.name : nm(c.name))}</h2><div class="kind"><span class="dot" style="background:#dcb466"></span>${v ? nm(c.name) + ' · ' : ''}${KIND[c.cat]}</div><dl>${rows.map((r) => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('')}</dl>`;
      if (v) {
        const rank = venueRank().findIndex((q) => q.id === v.id) + 1, tn = v.tonight;
        h += `<div class="sub"><b>${ROOM[roomTier(v.score)]}</b><span>Rank ${rank} of ${culture.venues.length}, score ${Math.round(v.score)}</span></div>`;
        h += tn ? `<div class="sub"><b>Last night</b><span>${fmt(tn.draw)} of ${fmt(v.cap)} in the room</span></div><ul class="acts">${tn.acts.map((id) => { const a = artistById(id); return a ? `<li>${esc(a.name)}<em>${FAME[fameTier(a.fame)]}</em></li>` : ''; }).join('')}</ul>` : '<p class="note">First night is tonight.</p>';
      }
      if (c.fx.league) for (const lg of c.fx.league.split(',')) { const tm = culture.teams[lg]; if (tm && tm.venue === b.id) h += `<div class="sub"><b>${esc(nm(tm.name))}</b><span>${LEAGUES[lg].tournament ? esc(tm.last || 'First edition is coming up') : `${tm.w}-${tm.l}${tm.titles ? `, ${tm.titles} title${tm.titles > 1 ? 's' : ''}` : ''}`}</span></div>`; }
    } else {
      const zn = ZONES[b.zone], st = ext.styles[b.st | 0];
      h += `<h2>${esc(b.name || b.label)}</h2>
      <div class="kind"><span class="dot" style="background:${zn.color}"></span>${b.name ? esc(b.label) + ' · ' : ''}${zn.name}, ${zn.density.toLowerCase()}</div>
      <dl>
        <dt>${b.res ? 'Residents' : 'Jobs'}</dt><dd>${fmt(b.res || b.jobs)}</dd>
        <dt>Floors</dt><dd>${b.floors}</dd><dt>Height</dt><dd>${Math.round(b.height)} m</dd>
        <dt>Lot</dt><dd>${b.w * CELL} by ${b.d * CELL} m</dd><dt>Built</dt><dd>${built}</dd>
        ${st ? `<dt>Style</dt><dd>${st.name}</dd>` : ''}${hood ? `<dt>Neighborhood</dt><dd>${esc(hood)}</dd>` : ''}
        <dt>Land value</dt><dd>${lv}%</dd><dt>Satisfaction</dt><dd>${sat}%</dd>
        ${b.vac ? '<dt>Status</dt><dd>Vacant floors</dd>' : ''}${b.fire ? '<dt>Status</dt><dd>On fire</dd>' : ''}
      </dl>
      ${game.readOnly ? '' : `<button class="btn" data-act="lock" aria-pressed="${!!b.locked}">${b.locked ? 'Historic: locked. Unlock' : 'Lock as historic'}</button>`}`;
    }
    if (!game.readOnly) h += '<button class="btn" data-act="demolish">Demolish</button>';
    el.innerHTML = h; el.hidden = false; icons();
  }
  $('info').addEventListener('click', (e) => {
    const b = buildings.get(infoId);
    if (e.target.closest('.close')) { T().selected = null; showInfo(null); game.tools.touch(); }
    else if (e.target.closest('[data-act="lock"]') && b) { if (b.locked) delete b.locked; else b.locked = true; showInfo(b); }
    else if (e.target.closest('[data-act="demolish"]') && b) {
      game.undo.begin('bulldoze'); game.undo.logBuilding(removeBuilding(infoId)); game.undo.commit();
      T().selected = null; showInfo(null); game.tools.touch(); refresh();
    }
  });

  // ---- menu: cloud saves, files, settings -----------------------------------------------------------
  let pending = null, cloudRows = null;
  const err = (m) => { const e = $('saveErr'); e.textContent = m || ''; e.hidden = !m; };
  const when = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  function renderSlots() {
    $('slots').innerHTML = slots.map((s, k) => `<li><div><div>${s.name}</div><div class="meta">${s.meta ? `${fmt(s.meta.pop)} residents, saved ${new Date(s.meta.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : s.auto ? 'Saves every 3 minutes' : 'Empty'}</div></div>
      ${s.auto ? '<span></span>' : `<button class="btn" data-save="${k}">Save</button>`}<button class="btn" data-load="${k}" ${s.data ? '' : 'disabled'}>Load</button></li>`).join('');
  }
  const rowHtml = (r, title) => `<li data-id="${r.id}"><div><div>${esc(r.name)}${r.id === game.cloudId ? ' <em class="tag2">current</em>' : ''}</div><div class="meta">${r.meta && r.meta.year ? `${r.meta.year}, ` : ''}${fmt((r.meta && r.meta.pop) || 0)} residents, ${MAP_NAMES[(r.meta && r.meta.map) || 'real']}, ${when(r.updated_at)}</div>${r.share_id && !title ? `<div class="meta share"><input readonly value="${esc(cloud.shareUrl(r.share_id, r.meta && r.meta.map))}" aria-label="Share link" /><button class="btn" data-c="copy">Copy</button><button class="btn ghost" data-c="unshare">Stop sharing</button></div>` : ''}</div>
    <div class="acts2"><button class="btn" data-c="load">Load</button>${title ? '' : `<button class="btn" data-c="over" title="Overwrite with the current city">Overwrite</button>${r.share_id ? '' : '<button class="btn" data-c="share">Share</button>'}<button class="btn ghost" data-c="del" aria-label="Delete ${esc(r.name)}"><i data-lucide="trash-2"></i></button>`}</div></li>`;
  async function renderCloud() {
    const ul = $('cloudList'); $('syncCode').value = syncCode(); $('cloudNote').textContent = isPersisted() ? '' : 'This browser blocks cookies here, so copy your sync code from below to find these saves again.';
    ul.innerHTML = '<li class="meta">Loading saves</li>';
    try { cloudRows = await cloud.list(); ul.innerHTML = cloudRows.length ? cloudRows.map((r) => rowHtml(r, false)).join('') : '<li class="meta">No cloud saves yet. Name the city and press Save.</li>'; icons(); }
    catch (x) { ul.innerHTML = ''; err(x.message); }
  }
  const defaultName = () => `San Francisco ${yearOf()}`;
  async function cloudSave(id = null, name = null) {
    err(''); const d = serialize(game), nmv = name || $('saveName').value.trim() || defaultName();
    try { const rid = await cloud.save(nmv, metaOf(d), d, id); game.cloudId = rid; game.cloudName = nmv; toast('Saved to the cloud'); await renderCloud(); return rid; } catch (x) { err(x.message); toast(x.message, 'warn'); return null; }
  }
  $('cloudSave').addEventListener('click', () => cloudSave(null));
  async function cloudAction(li, act, fromTitle) {
    const id = li.dataset.id, r = (cloudRows || []).find((q) => q.id === id) || {};
    try {
      if (act === 'load') {
        const map = (r.meta && r.meta.map) || 'real';
        if (map !== MAPMODE) { const u = new URL(location.href); u.search = ''; if (map !== 'real') u.searchParams.set('map', map); u.searchParams.set('load', id); location.href = u.toString(); return; }
        await game.loadCloud(id, r.name); if (!fromTitle) openMenu(false);
      } else if (act === 'over') { await cloudSave(id, r.name); }
      else if (act === 'share') { await cloud.share(id, true); await renderCloud(); toast('Share link created. Anyone with the link can view this city.'); }
      else if (act === 'unshare') { await cloud.share(id, false); await renderCloud(); toast('Sharing stopped'); }
      else if (act === 'copy') { const inp = li.querySelector('.share input'); try { await navigator.clipboard.writeText(inp.value); toast('Link copied'); } catch { inp.select(); toast('Select the link and copy it'); } }
      else if (act === 'del') { ask(`Delete the cloud save "${r.name}"?`, async () => { try { await cloud.remove(id); if (game.cloudId === id) game.cloudId = null; await renderCloud(); } catch (x) { err(x.message); } }, 'Delete save'); }
    } catch (x) { (fromTitle ? titleErr : err)(x.message); toast(x.message, 'warn'); }
  }
  $('cloudList').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'), li = e.target.closest('li[data-id]'); if (b && li) cloudAction(li, b.dataset.c, false); });
  $('syncUse').addEventListener('click', () => { try { setSyncCode($('syncCode').value); err(''); renderCloud(); toast('Sync code set'); } catch (x) { err(x.message); } });
  function openMenu(open) { $('menu').hidden = !open; if (open) { renderSlots(); err(''); $('confirm').hidden = true; $('saveName').value = game.cloudName || defaultName(); refresh(); renderCloud(); $('menuClose').focus(); } else $('menuBtn').focus(); }
  const ask = (msg, fn, label = 'Replace city') => { pending = fn; $('confirmMsg').textContent = msg; $('confirmYes').textContent = label; $('confirm').hidden = false; $('confirmYes').focus(); $('confirm').scrollIntoView({ block: 'nearest' }); };
  $('menuBtn').addEventListener('click', () => openMenu(true)); $('menuClose').addEventListener('click', () => openMenu(false));
  $('menu').addEventListener('click', (e) => { if (e.target === $('menu')) openMenu(false); });
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !$('menu').hidden) openMenu(false); });
  $('slots').addEventListener('click', (e) => {
    const s = e.target.closest('[data-save]'), l = e.target.closest('[data-load]');
    if (s) { saveSlot(game, +s.dataset.save); renderSlots(); toast(`Saved to ${slots[+s.dataset.save].name}`); }
    if (l) { try { loadSlot(game, +l.dataset.load); openMenu(false); toast(`Loaded ${slots[+l.dataset.load].name}`); } catch (x) { err(x.message); } }
  });
  $('exportBtn').addEventListener('click', () => { exportFile(game); toast('City exported'); });
  const pickFile = () => { $('file').value = ''; $('file').click(); };
  $('importBtn').addEventListener('click', pickFile);
  $('file').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    importFile(game, f).then(() => { openMenu(false); game.cloudId = null; game.begin(); toast('City imported'); }).catch((x) => { err(x.message); titleErr(x.message); toast(x.message, 'warn'); });
  });
  $('newCity').addEventListener('click', () => ask('Start a new city? Anything not saved will be lost.', () => { openMenu(false); game.toSetup(); }, 'New city'));
  $('newDemo').addEventListener('click', () => ask('Load the demo district? The current city will be replaced.', () => { game.startDemo(); openMenu(false); }));
  $('confirmYes').addEventListener('click', () => { const f = pending; pending = null; $('confirm').hidden = true; if (f) f(); });
  $('confirmNo').addEventListener('click', () => { pending = null; $('confirm').hidden = true; });
  const segClick = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { fn(b.dataset.v); refresh(); } });
  segClick('growthSeg', (v) => { sim.growth = +v; }); segClick('scrollSeg', (v) => { T().scroll = v; }); segClick('gfxSeg', (v) => game.setGfx(v)); segClick('camSeg', (v) => game.setCam(v));
  segClick('uiSeg', (v) => { city.cfg.ui = v; setHud(true); }); segClick('trafficSeg', (v) => { city.cfg.traffic = v; markDirty(); }); segClick('moneySeg', (v) => { city.cfg.money = v; });
  $('landValue').addEventListener('change', (e) => { city.cfg.landValue = e.target.checked; markDirty(); });
  $('tipsOn').addEventListener('change', (e) => { city.cfg.tips = e.target.checked; if (!e.target.checked) $('tip').hidden = true; });
  $('parody').addEventListener('change', (e) => { city.cfg.parody = e.target.checked; refresh(true); if (infoId) showInfo(buildings.get(infoId)); panels.render(); });
  $('stats').addEventListener('change', (e) => { $('debug').style.display = e.target.checked ? '' : 'none'; }); $('debug').style.display = 'none';

  // ---- hide-able HUD ---------------------------------------------------------------------------------
  let hudShown = true;
  function setHud(show) { hudShown = show; $('hud').classList.toggle('ui-hidden', !show); $('showHud').hidden = show || game.mode !== 'play'; }
  $('showHud').addEventListener('click', () => setHud(true));
  const toggleHud = () => { if (game.mode === 'play') setHud(!hudShown); };

  // ---- start screen ------------------------------------------------------------------------------------
  const q = new URLSearchParams(location.search), pick = (k, d, ok) => (ok.includes(q.get(k)) ? q.get(k) : d);
  const S = { map: MAPMODE, start: pick('start', 'empty', ['empty', 'grid', 'south', 'demo']), era: pick('era', 'today', Object.keys(ERAS)), money: pick('money', 'unlimited', ['unlimited', 'budget']), growth: pick('growth', '1', ['0.5', '1', '2']), traffic: pick('traffic', 'cosmetic', ['cosmetic', 'sim']), lv: pick('lv', 'on', ['on', 'off']), ui: pick('ui', 'bottom', ['bottom', 'side', 'hide']), cam: pick('cam', 'angled', ['angled', 'top', 'street']), gfx: pick('gfx', 'auto', ['low', 'medium', 'high', 'ultra', 'auto']), fog: pick('fog', 'on', ['on', 'off']), rain: pick('rain', 'on', ['on', 'off']), sunsets: pick('sunsets', 'on', ['on', 'off']) };
  const SETUP = [
    ['map', 'Map', [['real', 'Real-scale SF', 'The 7 by 7 mile city at true size'], ['compact', 'Compressed SF', 'Same shape at half size. Fills in faster.'], ['bay', 'Bay Area', 'The city plus Marin and the East Bay shore, at reduced scale']]],
    ['start', 'Start', [['empty', 'Empty land'], ['grid', 'Street grid', 'The real main streets, already drawn'], ['south', 'Highway from the south', 'Empty, with the freeways coming up the peninsula']]],
    ['era', 'Era', Object.entries(ERAS).map(([k, e]) => [k, e.label, e.note])],
    ['money', 'Money', [['unlimited', 'Unlimited'], ['budget', 'Budget', 'Taxes pay for what you build']]],
    ['growth', 'Growth', [['0.5', 'Slow'], ['1', 'Normal'], ['2', 'Fast']]],
    ['traffic', 'Traffic', [['cosmetic', 'Cosmetic'], ['sim', 'Simulated', 'Congestion slows cars and lowers satisfaction']]],
    ['lv', 'Land value', [['on', 'On'], ['off', 'Off']]],
    ['ui', 'Interface', [['bottom', 'Bottom bar'], ['side', 'Side panel'], ['hide', 'Hide-able', 'Press H to hide the controls']]],
    ['cam', 'Camera', [['angled', 'Angled'], ['top', 'Top-down'], ['street', 'Street level']]],
    ['fog', 'Fog', [['on', 'On'], ['off', 'Off']]], ['rain', 'Rain', [['on', 'On'], ['off', 'Off']]], ['sunsets', 'Sunsets', [['on', 'On'], ['off', 'Off']]],
    ['gfx', 'Graphics', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['auto', 'Auto']]],
  ];
  function renderSetup() { $('setupGrid').innerHTML = SETUP.map(([k, label, items]) => `<div class="field"><span>${label}</span><div class="seg" data-k="${k}">${items.map(([v, l, t]) => `<button data-v="${v}" aria-pressed="${S[k] === v}" title="${t || ''}">${l}</button>`).join('')}</div></div>`).join('') + `<p class="note" id="setupNote">${ERAS[S.era].note}${S.map !== MAPMODE ? ' Changing the map size reloads the page.' : ''}</p>`; }
  $('setupGrid').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S[b.parentElement.dataset.k] = b.dataset.v; renderSetup(); });
  const titleErr = (m) => { const e = $('titleErr'); e.textContent = m || ''; e.hidden = !m; };
  function go(start) {
    const o = { ...S, start: start || S.start };
    if (o.map !== MAPMODE) { const u = new URL(location.href); u.search = ''; for (const k in o) if (k !== 'map' || o.map !== 'real') u.searchParams.set(k, o[k]); u.searchParams.set('go', '1'); location.href = u.toString(); return; }
    game.startNew(o); game.begin();
  }
  $('startGo').addEventListener('click', () => go()); $('startDemo').addEventListener('click', () => go('demo'));
  $('startCloud').addEventListener('click', async () => {
    const box = $('titleCloud'); if (!box.hidden) { box.hidden = true; return; } box.hidden = false; titleErr(''); box.innerHTML = '<p class="note">Loading saves</p>';
    try { cloudRows = await cloud.list(); box.innerHTML = `<ul class="slots">${cloudRows.map((r) => rowHtml(r, true)).join('') || '<li class="meta">No cloud saves for this browser yet.</li>'}</ul><div class="row"><button class="btn sm ghost" id="titleImport">Import from a file</button></div>`; icons(); $('titleImport').addEventListener('click', pickFile); }
    catch (x) { box.innerHTML = ''; titleErr(x.message); }
  });
  $('titleCloud').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'), li = e.target.closest('li[data-id]'); if (b && li) cloudAction(li, b.dataset.c, true); });
  renderSetup();

  // ---- quick tips -------------------------------------------------------------------------------------
  function tip(text) { $('tipText').textContent = text; $('tip').hidden = false; }
  $('tipOk').addEventListener('click', () => { $('tip').hidden = true; });
  $('tipOff').addEventListener('click', () => { $('tip').hidden = true; city.cfg.tips = false; refresh(); });

  const panels = makePanels(game, { $, esc, toast, icons, refresh: () => refresh(true) });
  $('cityBtn').addEventListener('click', () => panels.toggle());

  // ---- per-frame-ish update ------------------------------------------------------------------------
  function update() {
    shownPop += (stats.pop - shownPop) * 0.35; if (Math.abs(stats.pop - shownPop) < 1) shownPop = stats.pop;
    const jobs = stats.jobsC + stats.jobsO + stats.jobsI; shownJobs += (jobs - shownJobs) * 0.35; if (Math.abs(jobs - shownJobs) < 1) shownJobs = jobs;
    $('pop').textContent = fmt(shownPop); $('jobs').textContent = fmt(shownJobs);
    const tier = tierOf(stats.pop), next = TIERS[tier + 1];
    $('tier').textContent = TIERS[tier][0];
    $('tierbar').style.width = next ? `${Math.min(100, ((stats.pop - TIERS[tier][1]) / (next[1] - TIERS[tier][1])) * 100)}%` : '100%';
    $('tiernext').textContent = next ? `${fmt(next[1] - stats.pop)} to ${next[0]}` : 'Top tier reached';
    $('tierbar').parentElement.title = $('tiernext').textContent;
    if (tier > lastTier) toast(`San Francisco is now a ${TIERS[tier][0]}`, 'gold');
    lastTier = tier;
    for (const el of document.querySelectorAll('.dbar')) {
      const v = sim.demand[el.dataset.k], bar = el.querySelector('i');
      bar.style.height = `${Math.abs(v) * 50}%`; bar.style.bottom = v >= 0 ? '50%' : `${50 - Math.abs(v) * 50}%`; bar.style.opacity = v >= 0 ? 1 : 0.45;
      el.title = `${{ R: 'Residential', C: 'Commercial', O: 'Office', I: 'Industrial' }[el.dataset.k]} demand ${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
    }
    $('day').textContent = dateLabel(); $('time').textContent = hhmm(game.viewHour());
    $('sat').textContent = `${Math.round(city.sat * 100)}%`; $('satChip').title = `Satisfaction ${Math.round(city.sat * 100)}%`;
    if (city.cfg.money === 'budget') { $('cash').textContent = money(city.treasury); $('cashChip').classList.toggle('bad', city.treasury < 0); $('cashChip').title = `Treasury. ${money(city.income - city.expense)} a day`; }
    const wv = tech.phase !== 'calm'; $('waveChip').hidden = !wv; if (wv) { $('wave').textContent = waveLabel(); $('waveChip').classList.toggle('bad', tech.phase === 'bust'); }
    if ($('sunPop').hidden === false && document.activeElement !== $('hour')) { $('hour').value = game.viewHour(); $('hourLbl').textContent = hhmm(game.viewHour()); }
    if (infoId && !buildings.has(infoId)) showInfo(null);
    renderOptions(false); panels.update();
  }
  return {
    toast, refresh, update, showInfo, openMenu, tip, tipOpen: () => !$('tip').hidden, toggleHud, setHud, syncSound, syncPops, panels, setup: S, go, titleErr,
    resetTier() { lastTier = tierOf(stats.pop); shownPop = stats.pop; }, setDebug(t) { $('debug').textContent = t; }, menuOpen: () => !$('menu').hidden,
    frame() { panels.frame(); },
  };
}
