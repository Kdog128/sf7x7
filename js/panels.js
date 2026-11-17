// The city panel (economy, neighborhoods, feed, startups, nightlife, sports, events, graphs, awards),
// plus the overlay legend, neighborhood labels and the feed ticker.
import { stats, buildings, TIERS, tierOf } from './world.js';
import { sim, yearOf, SEASONS, seasonOf } from './sim.js';
import { city, POLICIES, money, hoodCenters, hoodName, onFeed, markDirty, nm, OVERLAYS, OVERLAY_NOTE, bpos, priceIndex, jobsTotal } from './city.js';
import { tech, STAGES, startWave, startBust, waveLabel } from './tech.js';
import { culture, FAME, fameTier, ROOM, roomTier, venueRank, artistById, addArtist, KIND_LABEL, LEAGUES, standings, FESTS, festState, festReady, holdFest, olyChecks, startBid, ACH, raceNow, quake } from './culture.js';
import { fmt } from './util.js';
import { HAS_AREAS, AREAS, areaOpen, ll } from './terrain.js';

const TABS = [['economy', 'Economy'], ['hoods', 'Neighborhoods'], ['feed', 'Feed'], ['tech', 'Startups'], ['night', 'Nightlife'], ['sports', 'Sports'], ['events', 'Events'], ['graphs', 'Graphs'], ['ach', 'Awards']];
const RAMPS = { lv: '#963c32,#cdaa50,#5a965f', sat: '#963c32,#cdaa50,#5a965f', dens: '#46465a,#785aaa,#d7a0d7', traffic: '#5a965f,#cdaa50,#aa3c32', noise: '#5a965f,#cdaa50,#aa3c32', transit: '#3c4650,#3c78be,#96cdeb', svc: '#464646,#328c8c,#96dccd' };

export function makePanels(game, { $, esc, toast, icons, refresh }) {
  let tab = 'economy', open = false, acc = 0, showLabels = false, techAll = false, labelEls = new Map(), labelKey = '', openHood = 0;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const fly = (x, z, dist = 900) => game.rig.set(x, z, dist, game.rig.gYaw, Math.max(game.rig.gPitch, 0.5), false);
  $('tabs').innerHTML = TABS.map(([k, n]) => `<button role="tab" data-tab="${k}" aria-selected="false">${n}</button>`).join('');
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; render(); $('drawerBody').scrollTop = 0; } });
  $('drawerClose').addEventListener('click', () => toggle(false));
  function toggle(v) { open = v ?? !open; $('drawer').hidden = !open; $('cityBtn').setAttribute('aria-pressed', String(open)); if (open) { $('info').hidden = true; render(); } }

  // ---- tabs ------------------------------------------------------------------------------------------
  const row = (a, b, cls = '') => `<div class="kv ${cls}"><span>${a}</span><b>${b}</b></div>`;
  const slider = (id, label, v, min, max, step, show) => `<label class="sl"><span>${label}</span><input type="range" data-s="${id}" min="${min}" max="${max}" step="${step}" value="${v}" /><b>${show}</b></label>`;
  function economy() {
    const b = city.breakdown, budget = city.cfg.money === 'budget', ro = game.readOnly ? 'disabled' : '';
    let h = `<h3>Budget</h3>${budget ? row('Treasury', money(city.treasury), city.treasury < 0 ? 'bad' : '') : '<p class="note">Money is unlimited. Switch to Budget in Menu, More settings.</p>'}${row('Income a day', money(city.income))}${row('Spending a day', money(city.expense))}${row('Average rent', '$' + fmt(city.rent))}${row('Visitors index', Math.round(city.tourism))}`;
    if (b.inc) h += `<details><summary>Breakdown</summary>${Object.entries(b.inc).map(([k, v]) => row(k, money(v))).join('')}${Object.entries(b.exp).map(([k, v]) => row(k, '-' + money(v))).join('')}</details>`;
    const TS = game.traffic && game.traffic.stats;
    if (TS && city.cfg.traffic === 'sim' && game.roads.segs.size) {
      h += `<h3>Traffic</h3>${TS.ready ? row('Average commute', `${Math.round(TS.commute)} min`, TS.commute > 30 ? 'bad' : '') + row('Congestion', `${Math.round(TS.congestion * 100)}%`, TS.congestion > 0.8 ? 'bad' : '') : '<p class="note">Counting trips.</p>'}${row('Traffic lights', fmt(TS.signals))}${row('Stop signs', fmt(TS.stops))}`;
      if (TS.isolated) h += `<p class="note">${fmt(TS.isolated)} block${TS.isolated > 1 ? 's' : ''} of homes have no road out.</p>`;
      if (TS.ready && TS.jams.length) h += `<details><summary>Busiest roads</summary>${TS.jams.slice(0, 6).map((j) => { const I = game.traffic.segInfo(j.sid); return I ? `<div class="kv"><span>${esc(I.label)}</span><b>${Math.round(j.x * 100)}% <button class="link" data-a="goroad" data-v="${j.sid}">Go</button></b></div>` : ''; }).join('')}<p class="note">Over 100% means cars queue. Wider roads, parallel routes and transit help.</p></details>`;
    }
    h += `<h3>Taxes</h3>${[['R', 'Residential'], ['C', 'Commercial'], ['O', 'Office'], ['I', 'Industrial']].map(([k, n]) => slider('tax' + k, n, city.tax[k], 0, 20, 1, city.tax[k] + '%')).join('')}<p class="note">9% is neutral. Higher rates bring in more and slow that kind of growth. District rates are under Neighborhoods.</p>`;
    if (city.taxEvents.length) h += `<h3>This year</h3>${city.taxEvents.map((e) => `<p class="note"><b>${esc(e.name)}.</b> ${esc(e.text)}</p>`).join('')}`;
    h += `<h3>Subsidies</h3>${[['R', 'Housing'], ['C', 'Shops'], ['O', 'Offices'], ['I', 'Industry']].map(([k, n]) => `<label class="check"><input type="checkbox" data-sub="${k}" ${city.subsidy[k] ? 'checked' : ''} ${ro}/> ${n}</label>`).join('')}`;
    h += `<h3>Policies</h3>${POLICIES.map((p) => `<label class="check pol"><input type="checkbox" data-pol="${p.k}" ${city.policies[p.k] ? 'checked' : ''} ${ro}/> <span>${p.name}<em>${p.note}</em></span></label>`).join('')}`;
    h += city.custom.map((p, k) => `<label class="check pol"><input type="checkbox" data-cpol="${k}" ${p.on ? 'checked' : ''} ${ro}/> <span>${esc(p.name)}<em>Your policy</em></span><button class="x" data-a="delpol" data-v="${k}" aria-label="Delete policy">&times;</button></label>`).join('');
    if (!game.readOnly) h += `<details id="polNew"><summary>Write your own policy</summary><input type="text" id="polName" maxlength="40" placeholder="Policy name" aria-label="Policy name" />
      ${[['R', 'Housing demand'], ['C', 'Shop demand'], ['O', 'Office demand'], ['I', 'Industry demand']].map(([k, n]) => slider('np' + k, n, 0, -0.3, 0.3, 0.05, '0')).join('')}${slider('npsat', 'Satisfaction', 0, -0.1, 0.1, 0.01, '0')}${slider('npnoise', 'Noise', 1, 0.5, 1.5, 0.05, 'x1')}${slider('nptraffic', 'Traffic', 1, 0.6, 1.4, 0.05, 'x1')}${slider('npcost', 'Cost per 1,000 residents', 0, 0, 3, 0.1, '$0K')}
      <button class="btn sm" data-a="addpol">Add policy</button></details>`;
    return h;
  }
  function hoods() {
    const list = city.hoodStats.slice().sort((a, b) => b.pop + b.jobs - a.pop - a.jobs);
    let h = `<label class="check"><input type="checkbox" id="hoodLabels" ${showLabels ? 'checked' : ''}/> Show names on the map</label>`;
    if (HAS_AREAS) h += `<details><summary>Nearby cities</summary>${AREAS.slice(1).map((a, k) => `<div class="kv"><span>${a.name}</span><b>${areaOpen(k + 1) ? 'Open' : `At ${fmt(a.at)} residents`} <button class="link" data-a="goarea" data-v="${k + 1}">Go</button></b></div>`).join('')}${AREAS.every((a, k) => areaOpen(k)) || game.readOnly ? '' : '<button class="btn sm" data-a="openall">Open all now</button>'}</details>`;
    if (!list.length) return h + '<p class="note">Neighborhoods appear here once people move in. Names follow the real city and can be changed.</p>';
    h += list.map((s) => `<div class="card ${openHood === s.id ? 'open' : ''}"><button class="cardhead" data-a="hood" data-v="${s.id}"><b>${esc(s.name)}</b><span>${s.vibe}</span></button>
      <div class="stats4"><span><b>${fmt(s.pop)}</b>residents</span><span><b>${fmt(s.jobs)}</b>jobs</span><span><b>$${fmt(s.rent)}</b>rent</span><span><b>${pct(s.sat)}</b>happy</span></div>
      ${openHood === s.id ? `<div class="cardbody">
        ${row('Avg rent / resident', !Number.isFinite(s.avgRentPerResident) ? 'No residents' : '$' + fmt(s.avgRentPerResident) + '/mo')}
        ${game.readOnly ? '' : `<div class="row"><input type="text" id="hoodName" maxlength="40" value="${esc(s.name)}" aria-label="Neighborhood name" /><button class="btn sm" data-a="rename" data-v="${s.id}">Rename</button></div>
        ${slider('htax' + s.id, 'District tax', city.hoodTax[s.id] || 0, -3, 6, 1, ((city.hoodTax[s.id] || 0) >= 0 ? '+' : '') + (city.hoodTax[s.id] || 0) + '%')}<div class="row"><button class="btn sm" data-a="paint" data-v="${s.id}">Repaint its borders</button><button class="btn sm ghost" data-a="gohood" data-v="${s.id}">Go there</button></div>`}</div>` : ''}</div>`).join('');
    return h;
  }
  const dateOf = (p) => `${SEASONS[(p.d - 1) % 4]} ${p.y}`;
  const feed = () => (city.feed.length ? city.feed.map((p) => `<article class="post k-${p.kind}"><header><b>@${esc(p.who)}</b><span>${dateOf(p)}</span></header><p>${esc(p.text)}</p></article>`).join('') : '<p class="note">Nobody has posted yet. Give them a city to talk about.</p>');
  function techTab() {
    const act = tech.startups.filter((s) => s.status === 'active' || s.status === 'public'), list = (techAll ? tech.startups.slice().reverse() : act.slice().sort((a, b) => b.val - a.val)).slice(0, 80), ST = { acquired: 'Acquired', closed: 'Closed', public: 'Public' };
    let h = `<h3>Economy</h3>${row('Now', waveLabel())}${row('Heat', (city.heat >= 0 ? '+' : '') + Math.round(city.heat * 100))}${row('Startups', act.length)}${row('IPOs', tech.ipos)}`;
    if (!game.readOnly) h += `<div class="row"><button class="btn sm" data-a="boom">Start a boom</button><button class="btn sm" data-a="bust">Trigger a bust</button></div><label class="check"><input type="checkbox" id="techRandom" ${tech.random ? 'checked' : ''}/> Booms and busts also happen by themselves</label>`;
    h += `<h3>Directory</h3><label class="check"><input type="checkbox" id="techAll" ${techAll ? 'checked' : ''}/> Include closed and acquired</label>`;
    h += list.length ? `<table><thead><tr><th>Company</th><th>Stage</th><th>Staff</th><th>Value</th></tr></thead><tbody>${list.map((s) => `<tr data-a="startup" data-v="${s.id}" class="${s.status}"><td><i class="logo" style="background:#${s.color.toString(16).padStart(6, '0')}">${esc(s.name[0])}</i><span>${esc(s.name)}<em>${esc(s.sector)}${s.hood ? ', ' + esc(s.hood) : ''}</em></span></td><td>${s.status === 'active' ? STAGES[s.stage] : ST[s.status] + (s.by ? ' by ' + esc(s.by) : '')}</td><td>${fmt(s.staff)}</td><td>${money(s.val * 1000)}</td></tr>`).join('')}</tbody></table>` : '<p class="note">No companies yet. Offices, a university and a boom all help.</p>';
    return h;
  }
  function night() {
    const vs = venueRank(), rising = culture.rising.map(artistById).filter(Boolean), all = culture.artists.slice().sort((a, b) => b.fame - a.fame);
    const art = (a, extra = '') => `<li><button class="star" data-a="follow" data-v="${a.id}" aria-pressed="${!!a.follow}" title="${a.follow ? 'Following' : 'Follow'}">${a.follow ? '&#9733;' : '&#9734;'}</button><span>${esc(a.name)}<em>${KIND_LABEL[a.kind]}, ${FAME[fameTier(a.fame)]}${a.own ? ', yours' : ''}</em></span><b>${extra || Math.round(a.fame)}</b></li>`;
    let h = '<h3>Venue ranking</h3>';
    h += vs.length ? `<ol class="rank">${vs.map((v) => `<li data-a="venue" data-v="${v.id}"><span>${esc(v.name)}<em>${ROOM[roomTier(v.score)]}${v.tonight ? `, ${fmt(v.tonight.draw)} last night` : ''}</em></span><b>${Math.round(v.score)}</b></li>`).join('')}</ol>` : '<p class="note">No venues yet. Build clubs, music venues and comedy clubs under Build, Nightlife. They are loud at night, so mind the neighbors.</p>';
    h += `<h3>Rising talent</h3>${rising.length ? `<ol class="rank">${rising.map((a) => art(a, '+' + a.gain.toFixed(1))).join('')}</ol>` : '<p class="note">Artists climb from open mic rooms to headliner rooms as they play to full houses.</p>'}`;
    h += `<details><summary>All artists (${all.length})</summary><ul class="rank">${all.map((a) => art(a)).join('')}</ul></details>`;
    if (!game.readOnly) h += `<h3>Add your own artist</h3><div class="row"><input type="text" id="artName" maxlength="40" placeholder="Stage name" aria-label="Stage name" /><select id="artKind" aria-label="Kind of act"><option value="dj">DJ</option><option value="band">Band</option><option value="comic">Comedian</option></select><button class="btn sm" data-a="addartist">Add</button></div><p class="note">They start as an unknown and get booked into open mic rooms first.</p>`;
    return h;
  }
  function sports() {
    const ts = Object.values(culture.teams); let h = '';
    for (const t of ts) {
      const L = LEAGUES[t.lg], inS = L.seasons.includes(seasonOf());
      h += `<div class="card"><div class="cardhead"><b>${esc(nm(t.name))}</b><span>${t.lg}${inS ? ', in season' : ''}</span></div>`;
      if (L.tournament) h += `<p class="note">${t.champs.length ? t.champs.map(esc).join('<br>') : `Played each ${SEASONS[L.seasons[0]].toLowerCase()}.`}</p>`;
      else h += `<div class="stats4"><span><b>${t.w}-${t.l}</b>record</span><span><b>${t.titles}</b>titles</span><span><b>${pct(t.str)}</b>strength</span></div><details><summary>Standings</summary><table><tbody>${standings(t).map((r) => `<tr class="${r.us ? 'us' : ''}"><td>${esc(nm(r.n))}</td><td>${r.w}-${r.l}</td></tr>`).join('')}</tbody></table></details>${t.last ? `<p class="note">${esc(t.last)}</p>` : ''}`;
      h += '</div>';
    }
    const missing = Object.entries(LEAGUES).filter(([k]) => !culture.teams[k]);
    if (missing.length) h += `<h3>Not here yet</h3><p class="note">${missing.map(([k, L]) => `${k}: ${esc(nm(L.team))}${L.from && yearOf() < L.from ? ` (from ${L.from})` : ''}`).join('. ')}. Build the matching venue under Build, Sports to bring them in: ballpark for MLB, arena for NBA, WNBA and NHL, football stadium for NFL, soccer stadium for MLS, tennis center and golf course for the tournaments.</p>`;
    return h || '<p class="note">No teams yet.</p>';
  }
  function events() {
    const live = culture.live.filter((e) => e.on), o = culture.oly, ro = game.readOnly;
    let h = live.length ? `<h3>Happening now</h3>${live.map((e) => `<div class="kv link" data-a="goev" data-v="${Math.round(e.x)},${Math.round(e.z)}"><span>${esc(e.name)}</span><b>Go</b></div>`).join('')}` : '';
    h += `<h3>Festivals</h3>${FESTS.map((f) => { const st = festState(f.k), why = festReady(f); return `<div class="fest"><label class="check"><input type="checkbox" data-fest="${f.k}" ${st.on ? 'checked' : ''} ${ro ? 'disabled' : ''}/> <span>${esc(nm(f.name))}<em>${SEASONS[f.season]}${why ? '. ' + why : ''}${st.held ? `. Held ${st.held} time${st.held > 1 ? 's' : ''}` : ''}</em></span></label>${ro ? '' : `<button class="btn sm ghost" data-a="hold" data-v="${f.k}" ${why ? 'disabled' : ''}>Hold now</button>`}</div>`; }).join('')}`;
    h += `<h3>${esc(nm('San Francisco Grand Prix'))}</h3>${culture.f1.pts ? `<p class="note">Circuit ready. Raced ${culture.f1.races} time${culture.f1.races === 1 ? '' : 's'}. It runs each spring.</p>${ro ? '' : '<div class="row"><button class="btn sm" data-a="race">Race now</button><button class="btn sm ghost" data-a="circuit">Change circuit</button></div>'}` : `<p class="note">Lay out a street circuit to hold a race each spring.</p>${ro ? '' : '<button class="btn sm" data-a="circuit">Lay out a circuit</button>'}`}`;
    h += `<h3>${esc(nm('Olympic Games'))}</h3>`;
    if (o.stage === 0 || o.stage === 3) h += `${o.stage === 3 ? '<p class="note">No Games came of the last bid. You can bid again.</p>' : ''}<ul class="checks">${olyChecks().map(([n, ok]) => `<li class="${ok ? 'ok' : ''}">${ok ? '&#10003;' : '&#9675;'} ${n}</li>`).join('')}</ul>${ro ? '' : `<button class="btn sm" data-a="bid" ${olyChecks().every((c) => c[1]) ? '' : 'disabled'}>File a bid${city.cfg.money === 'budget' ? ` (${money(800 * priceIndex())})` : ''}</button>`}`;
    else if (o.stage === 1) h += `<p class="note">Bid filed. The vote is in ${SEASONS[(o.day - 1) % 4].toLowerCase()} ${sim.year0 + Math.floor((o.day - 1) / 4)}.</p>`;
    else if (o.stage === 2) h += `<p class="note">The Games open in summer ${sim.year0 + Math.floor((o.day - 1) / 4)}. ${[...buildings.values()].some((b) => b.sp === 'olympic') ? 'The Olympic park is ready.' : 'Build the Olympic park under Build, Sports before then.'}</p>`;
    else h += '<p class="note">San Francisco has hosted the Games.</p>';
    if (!ro) h += `<h3>Disasters</h3><p class="note">Only when you ask for them.</p><div class="row"><button class="btn sm" data-a="firetool">Start a fire</button><button class="btn sm danger" data-a="quake">Earthquake, magnitude ${game.tools.state.quakeMag.toFixed(1)}</button></div>${slider('mag', 'Magnitude', game.tools.state.quakeMag, 5, 8.2, 0.1, game.tools.state.quakeMag.toFixed(1))}`;
    return h;
  }
  const GRAPHS = [['pop', 'Residents', '#8fc27a'], ['jobs', 'Jobs', '#7fb0e0'], ['sat', 'Satisfaction %', '#dcb466'], ['lv', 'Land value %', '#c9a36b'], ['traffic', 'Traffic %', '#e58a70'], ['heat', 'Boom and bust', '#8f7fd6'], ['cash', 'Treasury', '#7fd0cf']];
  const graphs = () => `<p class="note">One point per season, ${Math.max(1, Math.floor(city.hist.pop.length / 4))} year${city.hist.pop.length >= 8 ? 's' : ''} so far.</p>${GRAPHS.filter((g) => g[0] !== 'cash' || city.cfg.money === 'budget').map(([k, n]) => `<figure><figcaption><span>${n}</span><b id="gv-${k}"></b></figcaption><canvas data-g="${k}" width="640" height="150"></canvas></figure>`).join('')}`;
  function drawGraphs() {
    for (const cv of $('drawerBody').querySelectorAll('canvas[data-g]')) {
      const k = cv.dataset.g, d = city.hist[k], c = cv.getContext('2d'), W = cv.width, H = cv.height, col = GRAPHS.find((g) => g[0] === k)[2];
      c.clearRect(0, 0, W, H); c.strokeStyle = 'rgba(255,255,255,0.1)'; c.lineWidth = 1; for (let y = 0; y <= 3; y++) { c.beginPath(); c.moveTo(0, 6 + (y * (H - 12)) / 3); c.lineTo(W, 6 + (y * (H - 12)) / 3); c.stroke(); }
      const el = document.getElementById('gv-' + k); if (!d || d.length < 2) { if (el) el.textContent = d && d.length ? fmt(d[d.length - 1]) : ''; continue; }
      let lo = Math.min(...d), hi = Math.max(...d); if (k === 'heat') { lo = Math.min(lo, -50); hi = Math.max(hi, 100); } else if (k !== 'cash') lo = Math.min(lo, 0); if (hi - lo < 1) hi = lo + 1;
      const X = (i) => (i / (d.length - 1)) * W, Y = (v) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12);
      c.beginPath(); d.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)))); c.strokeStyle = col; c.lineWidth = 3; c.lineJoin = 'round'; c.stroke();
      c.lineTo(W, H); c.lineTo(0, H); c.closePath(); c.fillStyle = col + '22'; c.fill();
      if (lo < 0) { c.strokeStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.moveTo(0, Y(0)); c.lineTo(W, Y(0)); c.stroke(); }
      if (el) el.textContent = k === 'cash' ? money(d[d.length - 1]) : fmt(d[d.length - 1]);
    }
  }
  function ach() { const n = ACH.filter((a) => culture.ach[a[0]]).length; return `<p class="note">${n} of ${ACH.length} earned.</p>${ACH.map((a) => { const y = culture.ach[a[0]]; return `<div class="ach ${y ? 'got' : ''}"><i>${y ? '&#9733;' : '&#9734;'}</i><span>${a[1]}<em>${a[2]}${y ? `. Earned in ${y}` : ''}</em></span></div>`; }).join('')}`; }
  const RENDER = { economy, hoods, feed, tech: techTab, night, sports, events, graphs, ach };
  function render() {
    if (!open) return;
    document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const body = $('drawerBody'), act = document.activeElement, keep = act && body.contains(act) && /INPUT|SELECT/.test(act.tagName) && act.type !== 'checkbox';
    if (keep) return; // do not rebuild under someone typing or dragging a slider
    const openDetails = [...body.querySelectorAll('details[open]')].map((d) => d.querySelector('summary').textContent), top = body.scrollTop;
    body.innerHTML = RENDER[tab](); for (const d of body.querySelectorAll('details')) if (openDetails.includes(d.querySelector('summary').textContent)) d.open = true;
    body.scrollTop = top; if (tab === 'graphs') drawGraphs();
  }

  // ---- actions ---------------------------------------------------------------------------------------
  $('drawerBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a, v = b.dataset.v, T = game.tools.state;
    if (a === 'hood') openHood = openHood === +v ? 0 : +v;
    else if (a === 'goroad') { const sg = game.roads.segs.get(+v); if (sg) { fly((sg.pts[0] + sg.pts[2]) / 2, (sg.pts[1] + sg.pts[3]) / 2, 420); game.tools.setTool('inspect'); toggle(false); game.ui.showRoad(+v); } return; }
    else if (a === 'goarea') { const [x, z] = ll(...AREAS[+v].c); fly(x, z, 3200); }
    else if (a === 'openall') game.openAllAreas();
    else if (a === 'gohood') { const c = hoodCenters().find((q) => q.id === +v); if (c) fly(c.x, c.z, 2200); }
    else if (a === 'rename') { const n = $('hoodName').value.trim(); if (n) { city.hoodNames[+v] = n.slice(0, 40); markDirty(); labelKey = ''; toast('Renamed'); } }
    else if (a === 'paint') { T.hoodId = +v; game.tools.setTool('hood'); game.setOverlay('hood'); toggle(false); toast(`Drag on the map to add blocks to ${hoodName(+v)}`); return; }
    else if (a === 'boom') startWave(`${['Gold', 'Chip', 'Cloud', 'Agent', 'Garage', 'Fog'][Math.floor(Math.random() * 6)]} rush`, 0.9, 3, 1, 'manual');
    else if (a === 'bust') startBust(1.5);
    else if (a === 'startup') { const s = tech.startups.find((q) => q.id === +v), bb = s && buildings.get(s.b); if (bb) { const [x, z] = bpos(bb); fly(x, z, 600); T.selected = bb; game.ui.showInfo(bb); $('drawer').hidden = true; open = false; } return; }
    else if (a === 'venue') { const bb = buildings.get(+v); if (bb) { const [x, z] = bpos(bb); fly(x, z, 500); T.selected = bb; game.ui.showInfo(bb); $('drawer').hidden = true; open = false; } return; }
    else if (a === 'follow') { const ar = artistById(+v); if (ar) ar.follow = !ar.follow; }
    else if (a === 'addartist') { const n = $('artName').value.trim(); if (!n) return toast('Give them a stage name', 'warn'); addArtist(n, $('artKind').value, true); toast(`${n} is on the scene`); }
    else if (a === 'hold') { const f = FESTS.find((q) => q.k === v); if (f) { holdFest(f, true); const p = culture.live[culture.live.length - 1]; fly(p.x, p.z, 1100); } }
    else if (a === 'race') { if (raceNow()) { fly(culture.f1.pts[0], culture.f1.pts[1], 1200); toast('Race weekend starts now'); } }
    else if (a === 'circuit') { T.buildCat = 'sport'; T.buildKey = 'circuit'; game.tools.setTool('build'); toggle(false); return; }
    else if (a === 'bid') startBid();
    else if (a === 'firetool') { game.tools.setTool('disaster'); toggle(false); return; }
    else if (a === 'quake') { quake(T.quakeMag); if (game.audio) game.audio.quake(T.quakeMag); }
    else if (a === 'goev') { const [x, z] = v.split(',').map(Number); fly(x, z, 1100); }
    else if (a === 'delpol') { city.custom.splice(+v, 1); markDirty(); }
    else if (a === 'addpol') {
      const g = (id) => +$('drawerBody').querySelector(`[data-s="${id}"]`).value, name = $('polName').value.trim(); if (!name) return toast('Give the policy a name', 'warn');
      const f = {}; for (const k of 'RCOI') if (g('np' + k)) f[k] = g('np' + k); if (g('npsat')) f.sat = g('npsat'); if (g('npnoise') !== 1) f.noiseMul = g('npnoise'); if (g('nptraffic') !== 1) f.trafficMul = g('nptraffic'); if (g('npcost')) f.cost = g('npcost');
      city.custom.push({ name: name.slice(0, 40), on: true, fx: f }); markDirty(); toast(`${name} is in force`); $('polName').value = ''; $('polName').blur();
    }
    render();
  });
  $('drawerBody').addEventListener('change', (e) => {
    const el = e.target, d = el.dataset;
    if (d.sub) city.subsidy[d.sub] = el.checked; else if (d.pol) city.policies[d.pol] = el.checked; else if (d.cpol) city.custom[+d.cpol].on = el.checked; else if (d.fest) festState(d.fest).on = el.checked;
    else if (el.id === 'hoodLabels') { showLabels = el.checked; labelKey = ''; } else if (el.id === 'techRandom') tech.random = el.checked; else if (el.id === 'techAll') { techAll = el.checked; render(); }
    else return;
    markDirty();
  });
  $('drawerBody').addEventListener('input', (e) => {
    const el = e.target, id = el.dataset.s; if (!id) return; const v = +el.value, out = el.parentElement.querySelector('b');
    if (id.startsWith('tax')) { city.tax[id[3]] = v; out.textContent = v + '%'; markDirty(); }
    else if (id.startsWith('htax')) { city.hoodTax[+id.slice(4)] = v; out.textContent = (v >= 0 ? '+' : '') + v + '%'; markDirty(); }
    else if (id === 'mag') { game.tools.state.quakeMag = v; out.textContent = v.toFixed(1); }
    else if (id === 'npnoise' || id === 'nptraffic') out.textContent = 'x' + v; else if (id === 'npcost') out.textContent = `$${v}K`; else out.textContent = (v > 0 ? '+' : '') + v;
  });
  $('drawerBody').addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; const id = e.target.id; if (id === 'artName') $('drawerBody').querySelector('[data-a="addartist"]').click(); else if (id === 'hoodName') $('drawerBody').querySelector('[data-a="rename"]').click(); });

  // ---- ticker, legend, labels --------------------------------------------------------------------------
  onFeed((p) => { $('ticker').hidden = false; $('tickWho').textContent = '@' + p.who; $('tickText').textContent = p.text; $('ticker').classList.remove('pop'); void $('ticker').offsetWidth; $('ticker').classList.add('pop'); if (open && tab === 'feed') render(); });
  $('ticker').addEventListener('click', () => { tab = 'feed'; toggle(true); });
  function legend() {
    const k = game.overlay, el = $('legend'); if (!k || k === 'none') { el.hidden = true; return; }
    el.hidden = false; el.innerHTML = `<b>${OVERLAYS.find((o) => o[0] === k)[1]}</b>${RAMPS[k] ? `<div class="ramp" style="background:linear-gradient(90deg,${RAMPS[k]})"></div>` : ''}<span>${OVERLAY_NOTE[k]}</span>`;
  }
  function frame() {
    const want = game.mode === 'play' && (showLabels || game.overlay === 'hood'), box = $('labels');
    if (!want) { if (labelEls.size) { box.innerHTML = ''; labelEls.clear(); labelKey = ''; } return; }
    const key = city.hoodNames.join('|').length + ':' + city.hoodStats.length;
    if (key !== labelKey) { labelKey = key; box.innerHTML = ''; labelEls.clear(); for (const c of hoodCenters()) { if (c.n < 12) continue; const el = document.createElement('span'); el.textContent = c.name; box.appendChild(el); labelEls.set(c.id, { el, c }); } }
    const far = game.rig.dist > 9000 * (game.mapK || 1), w = window.innerWidth, h = window.innerHeight;
    for (const { el, c } of labelEls.values()) { const p = game.worldToScreen(c.x, c.z), vis = p[2] && p[0] > 30 && p[0] < w - 30 && p[1] > 70 && p[1] < h - 110 && (!far || c.n > 60); el.style.display = vis ? '' : 'none'; if (vis) el.style.transform = `translate(-50%,-50%) translate(${Math.round(p[0])}px,${Math.round(p[1])}px)`; }
  }
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && game.mode === 'play' && !game.modalOpen()) toggle(); });
  return { toggle, render, frame, legend, update() { acc++; if (open && acc % 5 === 0) render(); }, isOpen: () => open, setTab(t) { tab = t; } };
}
void stats; void TIERS; void tierOf; void yearOf; void jobsTotal;
