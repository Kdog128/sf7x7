// DOM heads-up display: stats, demand bars, clock, toolbar, tool options, info panel, menu.
import { ZONES, TIERS, stats, tierOf, buildings, removeBuilding, CELL } from './world.js';
import { sim } from './sim.js';
import { ROAD_TYPES } from './roads.js';
import { slots, saveSlot, loadSlot, exportFile, importFile } from './save.js';
import { fmt } from './util.js';

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
  function renderOptions() {
    const t = T(), key = [t.tool, t.roadType, t.roadMode, t.zoneId, t.zoneMode, t.snapGrid, t.snapAngle].join('|');
    if (key === optKey) return; optKey = key;
    const el = $('options'); let h = '';
    if (t.tool === 'inspect') h = '<span class="hint">Click a building for details. Drag to move, right-drag to rotate, scroll or pinch to zoom.</span>';
    else if (t.tool === 'bulldoze') h = '<span class="hint">Click a building or a road to remove it. Drag to clear an area.</span>';
    else if (t.tool === 'road') {
      h = `<div class="grp">${seg('roadType', t.roadType, Object.entries(ROAD_TYPES).map(([k, r]) => [k, r.name, r.hint]))}</div>
        <div class="grp">${seg('roadMode', t.roadMode, [['straight', 'Straight', 'Click to place points. Right-click or Esc ends the road.'], ['curve', 'Curve', 'Click start, bend point, then end.'], ['grid', 'Grid', 'Drag a rectangle to lay a street grid.']])}</div>`;
      if (t.roadMode === 'grid') h += `<div class="grp"><span>Block</span><input type="number" id="blockW" min="48" max="400" step="8" value="${t.blockW}" aria-label="Block width in metres" /><span>by</span><input type="number" id="blockH" min="48" max="400" step="8" value="${t.blockH}" aria-label="Block length in metres" /><span>m</span></div>`;
      h += `<div class="grp"><label class="check"><input type="checkbox" data-act="snapGrid" ${t.snapGrid ? 'checked' : ''}/> Snap to grid</label>${t.roadMode === 'straight' ? `<label class="check"><input type="checkbox" data-act="snapAngle" ${t.snapAngle ? 'checked' : ''}/> Snap angles</label>` : ''}</div>`;
    } else {
      const sw = (id) => `<button class="sw" data-act="zone" data-v="${id}" aria-pressed="${t.zoneId === id}" style="--c:${id ? ZONES[id].color : '#8d867a'}" title="${id ? `${ZONES[id].name}, ${ZONES[id].density.toLowerCase()} density` : 'Remove zoning'}"><i></i>${id ? `${ZONES[id].name} ${ZONES[id].density.toLowerCase()}` : 'De-zone'}</button>`;
      h = `<div class="grp swatches">${[1, 3, 5, 7, 2, 4, 6, 8].map(sw).join('')}</div><div class="grp">${sw(0)}</div>
        <div class="grp">${seg('zoneMode', t.zoneMode, [['brush', 'Brush', 'Paint cells'], ['fill', 'Block fill', 'Fill the block enclosed by roads'], ['rect', 'Rectangle', 'Drag a rectangle']])}</div>`;
      if (t.zoneMode === 'brush') h += `<div class="grp"><span>Size</span><input type="range" id="brush" min="1" max="15" step="2" value="${t.brush}" aria-label="Brush size" /></div>`;
    }
    el.innerHTML = h;
  }
  $('options').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
    const t = T(), a = b.dataset.act, v = b.dataset.v;
    if (a === 'zone') t.zoneId = +v; else t[a] = v;
    game.tools.cancel(); refresh();
  });
  $('options').addEventListener('change', (e) => {
    const t = T(), el = e.target;
    if (el.dataset.act) t[el.dataset.act] = el.checked;
    if (el.id === 'blockW') t.blockW = Math.min(400, Math.max(48, Math.round(+el.value / 8) * 8 || 96));
    if (el.id === 'blockH') t.blockH = Math.min(400, Math.max(48, Math.round(+el.value / 8) * 8 || 176));
    if (el.id === 'blockW' || el.id === 'blockH') el.value = el.id === 'blockW' ? t.blockW : t.blockH;
    refresh();
  });
  $('options').addEventListener('input', (e) => { if (e.target.id === 'brush') { T().brush = +e.target.value; game.tools.touch(); } });

  // ---- toolbar, speed, clock ---------------------------------------------------------------------
  document.querySelectorAll('.toolbar [data-tool]').forEach((b) => b.addEventListener('click', () => game.tools.setTool(b.dataset.tool)));
  $('undoBtn').addEventListener('click', () => game.doUndo(false)); $('redoBtn').addEventListener('click', () => game.doUndo(true));
  document.querySelectorAll('.speed [data-speed]').forEach((b) => b.addEventListener('click', () => game.setSpeed(+b.dataset.speed)));
  $('sunBtn').addEventListener('click', () => { const p = $('sunPop'); p.hidden = !p.hidden; $('sunBtn').setAttribute('aria-expanded', String(!p.hidden)); });
  $('hour').addEventListener('input', (e) => { game.setHour(+e.target.value); $('hourLbl').textContent = hhmm(game.viewHour()); });
  $('cycle').addEventListener('change', (e) => { game.fixedHour = game.viewHour(); game.cycle = e.target.checked; });

  function refresh() {
    const t = T();
    document.querySelectorAll('.toolbar [data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t.tool)));
    document.querySelectorAll('.speed [data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.speed === game.speed)));
    $('undoBtn').disabled = !game.undo.canUndo(); $('redoBtn').disabled = !game.undo.canRedo();
    document.querySelectorAll('#growthSeg button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === sim.growth)));
    document.querySelectorAll('#scrollSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === t.scroll)));
    renderOptions();
  }

  // ---- info panel ---------------------------------------------------------------------------------
  function showInfo(b) {
    const el = $('info');
    if (!b) { el.hidden = true; infoId = 0; return; }
    infoId = b.id; const z = ZONES[b.zone];
    el.innerHTML = `<button class="icon close" aria-label="Close details"><i data-lucide="x"></i></button>
      <h2>${b.name || b.label}</h2>
      <div class="kind"><span class="dot" style="background:${z.color}"></span>${b.name ? b.label + ' · ' : ''}${z.name}, ${z.density.toLowerCase()}</div>
      <dl>
        <dt>${b.res ? 'Residents' : 'Jobs'}</dt><dd>${fmt(b.res || b.jobs)}</dd>
        <dt>Floors</dt><dd>${b.floors}</dd>
        <dt>Height</dt><dd>${Math.round(b.height)} m</dd>
        <dt>Lot</dt><dd>${b.w * CELL} by ${b.d * CELL} m</dd>
        <dt>Level</dt><dd>${b.level}</dd>
        <dt>Built</dt><dd>Day ${b.born}</dd>
      </dl>
      <button class="btn" data-act="demolish">Demolish</button>`;
    el.hidden = false; icons();
  }
  $('info').addEventListener('click', (e) => {
    if (e.target.closest('.close')) { T().selected = null; showInfo(null); game.tools.touch(); }
    else if (e.target.closest('[data-act="demolish"]') && buildings.has(infoId)) {
      game.undo.begin('bulldoze'); game.undo.logBuilding(removeBuilding(infoId)); game.undo.commit();
      T().selected = null; showInfo(null); game.tools.touch(); refresh();
    }
  });

  // ---- menu ---------------------------------------------------------------------------------------
  let pending = null;
  const err = (m) => { const e = $('saveErr'); e.textContent = m || ''; e.hidden = !m; };
  function renderSlots() {
    $('slots').innerHTML = slots.map((s, k) => `<li><div><div>${s.name}</div><div class="meta">${s.meta ? `Day ${s.meta.day}, ${fmt(s.meta.pop)} residents, saved ${new Date(s.meta.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : s.auto ? 'Saves every 3 minutes' : 'Empty'}</div></div>
      ${s.auto ? '<span></span>' : `<button class="btn" data-save="${k}">Save</button>`}<button class="btn" data-load="${k}" ${s.data ? '' : 'disabled'}>Load</button></li>`).join('');
  }
  function openMenu(open) { $('menu').hidden = !open; if (open) { renderSlots(); err(''); $('confirm').hidden = true; refresh(); $('menuClose').focus(); } else $('menuBtn').focus(); }
  const ask = (msg, fn) => { pending = fn; $('confirmMsg').textContent = msg; $('confirm').hidden = false; $('confirmYes').focus(); };
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
    importFile(game, f).then(() => { openMenu(false); game.begin(); toast('City imported'); }).catch((x) => { err(x.message); toast(x.message, 'warn'); });
  });
  $('newEmpty').addEventListener('click', () => ask('Start over on empty land? The current city will be replaced.', () => { game.startEmpty(); openMenu(false); }));
  $('newDemo').addEventListener('click', () => ask('Load the demo district? The current city will be replaced.', () => { game.startDemo(); openMenu(false); }));
  $('confirmYes').addEventListener('click', () => { const f = pending; pending = null; $('confirm').hidden = true; if (f) f(); });
  $('confirmNo').addEventListener('click', () => { pending = null; $('confirm').hidden = true; });
  $('growthSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { sim.growth = +b.dataset.v; refresh(); } });
  $('scrollSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { T().scroll = b.dataset.v; refresh(); } });
  $('shadows').addEventListener('change', (e) => game.setShadows(e.target.checked));
  $('stats').addEventListener('change', (e) => { $('debug').style.display = e.target.checked ? '' : 'none'; });
  $('startEmpty').addEventListener('click', () => { game.startEmpty(); game.begin(); });
  $('startDemo').addEventListener('click', () => { game.startDemo(); game.begin(); });
  $('startImport').addEventListener('click', pickFile);

  // ---- per-frame-ish update ------------------------------------------------------------------------
  function update() {
    shownPop += (stats.pop - shownPop) * 0.35; if (Math.abs(stats.pop - shownPop) < 1) shownPop = stats.pop;
    const jobs = stats.jobsC + stats.jobsO + stats.jobsI; shownJobs += (jobs - shownJobs) * 0.35; if (Math.abs(jobs - shownJobs) < 1) shownJobs = jobs;
    $('pop').textContent = fmt(shownPop); $('jobs').textContent = fmt(shownJobs);
    const tier = tierOf(stats.pop), next = TIERS[tier + 1];
    $('tier').textContent = TIERS[tier][0];
    $('tierbar').style.width = next ? `${Math.min(100, ((stats.pop - TIERS[tier][1]) / (next[1] - TIERS[tier][1])) * 100)}%` : '100%';
    $('tiernext').textContent = next ? `${fmt(next[1] - stats.pop)} to ${next[0]}` : 'Top tier reached';
    if (tier > lastTier) toast(`San Francisco is now a ${TIERS[tier][0]}`, 'gold');
    lastTier = tier;
    for (const el of document.querySelectorAll('.dbar')) {
      const v = sim.demand[el.dataset.k], bar = el.querySelector('i');
      bar.style.height = `${Math.abs(v) * 50}%`; bar.style.bottom = v >= 0 ? '50%' : `${50 - Math.abs(v) * 50}%`; bar.style.opacity = v >= 0 ? 1 : 0.45;
      el.title = `${{ R: 'Residential', C: 'Commercial', O: 'Office', I: 'Industrial' }[el.dataset.k]} demand ${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
    }
    $('day').textContent = `Day ${sim.day}`; $('time').textContent = hhmm(game.viewHour());
    if ($('sunPop').hidden === false && document.activeElement !== $('hour')) { $('hour').value = game.viewHour(); $('hourLbl').textContent = hhmm(game.viewHour()); }
    if (infoId && !buildings.has(infoId)) showInfo(null);
  }
  return { toast, refresh, update, showInfo, openMenu, resetTier() { lastTier = tierOf(stats.pop); shownPop = stats.pop; }, setDebug(t) { $('debug').textContent = t; }, menuOpen: () => !$('menu').hidden };
}
