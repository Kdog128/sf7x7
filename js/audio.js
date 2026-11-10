// Ambient sound, synthesised with WebAudio: traffic hum, waves, rain, foghorns, cable car bells, crowds.
import { coastDist } from './terrain.js';
import { city, grid, sample } from './city.js';
import { stats } from './world.js';
import { culture } from './culture.js';
import { clamp } from './util.js';

export function makeAudio(game) {
  let ctx = null, master = null, on = true, vol = 0.6; const ch = {}; let hornT = 14, bellT = 9, boomT = 0, jetT = 0;
  function noiseBuf(kind) {
    const n = ctx.sampleRate * 3, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return buf;
  }
  function loop(kind, type, freq, q) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(kind); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0; src.connect(f).connect(g).connect(master); src.start(); return { g, f };
  }
  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ctx = new AC(); } catch { return; }
    master = ctx.createGain(); master.gain.value = on ? vol : 0; master.connect(ctx.destination);
    ch.traffic = loop('brown', 'lowpass', 420, 0.4); ch.waves = loop('white', 'lowpass', 520, 0.6); ch.rain = loop('white', 'bandpass', 5200, 0.5); ch.crowd = loop('white', 'bandpass', 900, 0.7); ch.wind = loop('brown', 'bandpass', 300, 0.8);
  }
  const set = (c, v, t = 0.6) => { if (c) c.g.gain.setTargetAtTime(v, ctx.currentTime, t); };
  function tone(freq, t0, dur, peak, type = 'sine', attack = 0.01) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function foghorn(near) { const t = ctx.currentTime, p = 0.05 + 0.1 * near; for (const [f, d] of [[92, 0], [69, 2.3]]) { tone(f, t + d, 2.4, p, 'sawtooth', 0.35); tone(f * 2.01, t + d, 2.2, p * 0.25, 'sine', 0.35); } }
  function bell() { const t = ctx.currentTime; for (const d of [0, 0.22, 0.55]) for (const [f, p] of [[1568, 0.05], [2349, 0.03], [3136, 0.015]]) tone(f, t + d, 0.5, p, 'sine', 0.004); }
  // Short sounds for player actions. Quiet, so they sit under the city ambience.
  let cueT = 0;
  function thud(t, freq, dur, peak) { const src = ctx.createBufferSource(); src.buffer = cueBuf || (cueBuf = noiseBuf('brown')); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 2); src.stop(t + dur + 0.05); }
  let cueBuf = null;
  function cue(kind) {
    if (!ctx || !on || ctx.state !== 'running') return; const t = ctx.currentTime; if (t < cueT) return; cueT = t + 0.05;
    if (kind === 'ui') tone(1320, t, 0.06, 0.025, 'sine', 0.002);
    else if (kind === 'road') { thud(t, 380, 0.22, 0.5); tone(196, t, 0.18, 0.05, 'triangle', 0.004); }
    else if (kind === 'zone') { tone(660, t, 0.12, 0.04, 'sine', 0.004); tone(990, t + 0.06, 0.14, 0.03, 'sine', 0.004); }
    else if (kind === 'build') { thud(t, 300, 0.3, 0.6); tone(523, t + 0.03, 0.25, 0.05, 'triangle', 0.005); tone(784, t + 0.1, 0.3, 0.04, 'triangle', 0.005); }
    else if (kind === 'bulldoze') { thud(t, 900, 0.35, 0.55); thud(t + 0.08, 240, 0.4, 0.5); }
    else if (kind === 'line') for (const [k, f] of [[0, 784], [1, 988], [2, 1175]]) tone(f, t + k * 0.09, 0.3, 0.04, 'sine', 0.004);
    else if (kind === 'undo') { tone(880, t, 0.08, 0.035, 'sine', 0.003); tone(660, t + 0.06, 0.1, 0.03, 'sine', 0.003); }
    else if (kind === 'redo') { tone(660, t, 0.08, 0.035, 'sine', 0.003); tone(880, t + 0.06, 0.1, 0.03, 'sine', 0.003); }
    else if (kind === 'tier') for (const [k, f] of [[0, 523], [1, 659], [2, 784], [3, 1047]]) tone(f, t + k * 0.12, 0.6, 0.05, 'triangle', 0.01);
    else if (kind === 'warn') tone(220, t, 0.18, 0.04, 'square', 0.004);
  }
  const api = {
    start, get on() { return on; },
    setOn(v) { on = v; if (master) master.gain.setTargetAtTime(on ? vol : 0, ctx.currentTime, 0.1); if (on && (ctx || navigator.userActivation?.isActive)) start(); },
    get state() { return ctx ? ctx.state : 'off'; },
    cue,
    boom(x, z) { if (!ctx || !on || ctx.currentTime < boomT) return; boomT = ctx.currentTime + 0.25; const d = Math.hypot(x - game.rig.target.x, z - game.rig.target.z) + game.rig.dist; tone(55, ctx.currentTime, 0.7, clamp(120 / d, 0.01, 0.14), 'sine', 0.005); },
    jet() { if (!ctx || !on || ctx.currentTime < jetT) return; jetT = ctx.currentTime + 5; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(150, t); o.frequency.linearRampToValueAtTime(70, t + 5); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 2); g.gain.linearRampToValueAtTime(0, t + 5); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 5.1); },
    quake(mag) { if (!ctx || !on) return; const t = ctx.currentTime; tone(38, t, 3.5, 0.22 * clamp((mag - 4) / 4, 0.2, 1), 'sawtooth', 0.4); tone(51, t, 3, 0.1, 'triangle', 0.6); },
    update(dt) {
      if (!ctx || !on || ctx.state !== 'running') return;
      const r = game.rig, x = r.target.x, z = r.target.z, near = 1 - clamp((r.dist - 250) / 5000, 0, 1), paused = game.speed === 0 ? 0.35 : 1;
      const act = Math.min(1, sample(grid.act, x, z) / 600), traf = city.cfg.traffic === 'sim' ? 0.6 + 0.6 * Math.min(1, sample(grid.traffic, x, z)) : 1;
      const bed = stats.pop > 0 ? Math.min(1, Math.log10(1 + stats.pop) / 5) : 0;   // far-off hum of the whole city
      set(ch.traffic, Math.min(0.7, (0.5 * act * traf * (0.25 + 0.75 * near) + 0.22 * bed) * paused)); ch.traffic.f.frequency.setTargetAtTime(260 + 500 * near, ctx.currentTime, 0.5);
      const shore = 1 - clamp(Math.abs(coastDist(x, z)) / 500, 0, 1), swell = 0.6 + 0.4 * Math.sin(ctx.currentTime * 0.7);
      set(ch.waves, 0.12 * shore * (0.3 + 0.7 * near) * swell, 0.3);
      set(ch.rain, 0.1 * city.wx.rain * (0.5 + 0.5 * near)); set(ch.wind, 0.12 * (1 - near) + 0.05 * city.wx.fog + 0.02);
      let crowd = 0; for (const e of culture.live) if (e.on && e.kind !== 'fireworks') crowd = Math.max(crowd, 1 - clamp((Math.hypot(e.x - x, e.z - z) + r.dist * 0.5) / 1600, 0, 1));
      set(ch.crowd, 0.09 * crowd, 0.4);
      hornT -= dt; if (hornT <= 0) { hornT = 16 + Math.random() * 14; if (city.wx.fog > 0.35) foghorn(shore); }
      bellT -= dt; if (bellT <= 0) { bellT = 7 + Math.random() * 9; if (near > 0.5 && city.lines.some((l) => l.type === 'cable' && l.path && nearPath(l.path, x, z, 500))) bell(); }
    },
  };
  const nearPath = (p, x, z, d) => { for (let k = 0; k < p.length; k += 2) if (Math.abs(p[k] - x) < d && Math.abs(p[k + 1] - z) < d) return true; return false; };
  // Browsers only allow sound after the player interacts, so the first click or key press starts it.
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => { if (on) start(); }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (ctx && on && !document.hidden && ctx.state === 'suspended') ctx.resume(); });
  return api;
}
