// Cloud saves and share links on Supabase. Two ways in:
// - Signed in (auth.js): the player's own rows, read and written directly under row level security.
// - Guest: a private sync code kept in a cookie, through a small set of security definer functions.
// Signing in moves the guest's saves onto the account (sf7x7_claim).
import { SB_URL as URL_, SB_KEY as KEY, auth } from './auth.js';
const COOKIE = 'sf7x7_sync';
let token = null, persisted = false;

function readCookie() { try { const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`)); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }
function writeCookie(v) { try { document.cookie = `${COOKIE}=${encodeURIComponent(v)}; max-age=${3600 * 24 * 400}; path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; return readCookie() === v; } catch { return false; } }
function newToken() { const a = new Uint8Array(20); crypto.getRandomValues(a); return 'sf-' + [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32); }
export function syncCode() { if (!token) { token = readCookie(); persisted = !!token; if (!token) { token = newToken(); persisted = writeCookie(token); } } return token; }
export function setSyncCode(v) { v = (v || '').trim(); if (v.length < 24 || v.length > 128) throw new Error('That sync code is not valid'); token = v; persisted = writeCookie(v); return persisted; }
export const isPersisted = () => { syncCode(); return persisted; };

const MESSAGES = {
  'save limit reached': 'All 12 cloud saves are in use. Delete one first.',
  'save too large': 'This city is too large for a cloud save. Export it to a file instead.',
  'storage is full': 'Cloud storage is full.',
};
async function send(url, init) {
  let res; const call = () => fetch(url, init);
  try { res = await call(); }
  catch { // one retry: a dropped connection is common after the tab has been busy
    await new Promise((r) => setTimeout(r, 700));
    try { res = await call(); } catch { throw new Error('Could not reach the save server. Check the connection and try again.'); }
  }
  if (!res.ok) {
    let m = ''; try { m = (await res.json()).message || ''; } catch { /* ignore */ }
    if (res.status === 401) throw new Error('Your sign-in has expired. Sign in again to reach your saves.');
    throw new Error(MESSAGES[m] || `The save server answered with an error (${res.status}).`);
  }
  return res.status === 204 ? null : res.json();
}
const headers = (bearer, extra) => ({ apikey: KEY, Authorization: `Bearer ${bearer || KEY}`, 'Content-Type': 'application/json', ...extra });
const rpc = (fn, args, bearer) => send(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(bearer), body: JSON.stringify(args) });

// Direct table access for signed-in players. Ids go into a query string, so check their shape first.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOk = (id) => { if (!UUID.test(String(id))) throw new Error('That save could not be found'); return id; };
const table = (bearer, method, query, body) => send(`${URL_}/rest/v1/sf7x7_saves?${query}`, {
  method, headers: headers(bearer, { Prefer: 'return=representation' }), ...(body ? { body: JSON.stringify(body) } : {}),
});
const mine = {
  list: (t) => table(t, 'GET', 'select=id,name,meta,share_id,updated_at&order=updated_at.desc&limit=20'),
  async save(t, name, meta, data, id) {
    const row = { name: String(name || '').slice(0, 60), meta: meta || {}, data };
    if (id) { const r = await table(t, 'PATCH', `id=eq.${idOk(id)}&select=id`, row); if (r && r.length) return r[0].id; }   // gone since: save as new, like the guest path
    const r = await table(t, 'POST', 'select=id', row); return r[0].id;
  },
  async load(t, id) { const r = await table(t, 'GET', `id=eq.${idOk(id)}&select=data`); return r && r.length ? r[0].data : null; },
  async remove(t, id) { const r = await table(t, 'DELETE', `id=eq.${idOk(id)}&select=id`); return !!(r && r.length); },
  share: (t, id, on) => rpc('sf7x7_share_mine', { p_id: idOk(id), p_on: on }, t),
};

async function pack(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') return 'j:' + json;
  const buf = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return 'g:' + btoa(s);
}
async function unpack(str) {
  if (!str) throw new Error('That save could not be found');
  if (str.startsWith('j:')) return JSON.parse(str.slice(2));
  if (!str.startsWith('g:')) throw new Error('That save is in a format this version cannot read');
  const bin = atob(str.slice(2)), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return JSON.parse(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
export const cloud = {
  /** The signed-in player, or null for a guest. */
  account: () => auth.user(),
  async list() { const t = await auth.token(); return t ? mine.list(t) : rpc('sf7x7_list', { p_token: syncCode() }); },
  async save(name, meta, data, id = null) { const t = await auth.token(), packed = await pack(data); return t ? mine.save(t, name, meta, packed, id) : rpc('sf7x7_save', { p_token: syncCode(), p_id: id, p_name: name, p_meta: meta, p_data: packed }); },
  async load(id) { const t = await auth.token(); return unpack(t ? await mine.load(t, id) : await rpc('sf7x7_load', { p_token: syncCode(), p_id: id })); },
  async remove(id) { const t = await auth.token(); return t ? mine.remove(t, id) : rpc('sf7x7_delete', { p_token: syncCode(), p_id: id }); },
  async share(id, on = true) { const t = await auth.token(); return t ? mine.share(t, id, on) : rpc('sf7x7_share', { p_token: syncCode(), p_id: id, p_on: on }); },
  /** Move this browser's guest saves onto the signed-in account. Returns how many moved. */
  async claimGuest() { const t = await auth.token(), code = readCookie(); if (!t || !code) return 0; return rpc('sf7x7_claim', { p_token: code }, t); },
  async shared(shareId) { const r = await rpc('sf7x7_get_shared', { p_share: shareId }); if (!r || !r.length) throw new Error('This shared city no longer exists'); return { name: r[0].name, meta: r[0].meta, data: await unpack(r[0].data) }; },
  shareUrl(shareId, map) { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('city', shareId); if (map && map !== 'region') u.searchParams.set('map', map); return u.toString(); },
};
