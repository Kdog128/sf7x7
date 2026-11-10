// Cloud saves and share links on Supabase. The table has row level security with no policies, so the
// only way in is a small set of functions keyed by a private sync code that this browser keeps in a cookie.
const URL_ = 'https://iaxxvgwivltgevwkkgmi.supabase.co', KEY = 'sb_publishable_jfhKLY8bmB19epBpiwLaTQ_xXyBa88O', COOKIE = 'sf7x7_sync';
let token = null, persisted = false;

function readCookie() { try { const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`)); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }
function writeCookie(v) { try { document.cookie = `${COOKIE}=${encodeURIComponent(v)}; max-age=${3600 * 24 * 400}; path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; return readCookie() === v; } catch { return false; } }
function newToken() { const a = new Uint8Array(20); crypto.getRandomValues(a); return 'sf-' + [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32); }
export function syncCode() { if (!token) { token = readCookie(); persisted = !!token; if (!token) { token = newToken(); persisted = writeCookie(token); } } return token; }
export function setSyncCode(v) { v = (v || '').trim(); if (v.length < 24 || v.length > 128) throw new Error('That sync code is not valid'); token = v; persisted = writeCookie(v); return persisted; }
export const isPersisted = () => { syncCode(); return persisted; };

async function rpc(fn, args) {
  let res; const call = () => fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  try { res = await call(); }
  catch { // one retry: a dropped connection is common after the tab has been busy
    await new Promise((r) => setTimeout(r, 700));
    try { res = await call(); } catch { throw new Error('Could not reach the save server. Check the connection and try again.'); }
  }
  if (!res.ok) { let m = ''; try { m = (await res.json()).message || ''; } catch { /* ignore */ } throw new Error(m === 'save limit reached' ? 'All 12 cloud saves are in use. Delete one first.' : m === 'save too large' ? 'This city is too large for a cloud save. Export it to a file instead.' : m === 'storage is full' ? 'Cloud storage is full.' : `The save server answered with an error (${res.status}).`); }
  return res.json();
}
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
  async list() { return rpc('sf7x7_list', { p_token: syncCode() }); },
  async save(name, meta, data, id = null) { return rpc('sf7x7_save', { p_token: syncCode(), p_id: id, p_name: name, p_meta: meta, p_data: await pack(data) }); },
  async load(id) { return unpack(await rpc('sf7x7_load', { p_token: syncCode(), p_id: id })); },
  async remove(id) { return rpc('sf7x7_delete', { p_token: syncCode(), p_id: id }); },
  async share(id, on = true) { return rpc('sf7x7_share', { p_token: syncCode(), p_id: id, p_on: on }); },
  async shared(shareId) { const r = await rpc('sf7x7_get_shared', { p_share: shareId }); if (!r || !r.length) throw new Error('This shared city no longer exists'); return { name: r[0].name, meta: r[0].meta, data: await unpack(r[0].data) }; },
  shareUrl(shareId, map) { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('city', shareId); if (map && map !== 'region') u.searchParams.set('map', map); return u.toString(); },
};
