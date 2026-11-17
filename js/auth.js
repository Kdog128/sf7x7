// Player accounts on Supabase Auth, by emailed sign-in link. No SDK: the game has no build step, so this
// talks to the Auth REST API directly. The refresh token lives in a cookie (the game keeps no other
// browser storage); the short-lived access token stays in memory and is renewed before it runs out.
export const SB_URL = 'https://iaxxvgwivltgevwkkgmi.supabase.co', SB_KEY = 'sb_publishable_jfhKLY8bmB19epBpiwLaTQ_xXyBa88O';
const COOKIE = 'sf7x7_auth', EARLY = 60;   // renew this many seconds before expiry

let session = null;          // { access, expiresAt, user: { id, email } }
let refreshing = null;       // one renewal at a time, so a rotated refresh token is never spent twice
let epoch = 0;               // bumped on sign-out; a renewal that started before it must not sign the player back in
const listeners = new Set();
const emit = (why) => { for (const fn of listeners) { try { fn(session && session.user, why); } catch { /* a listener's problem */ } } };

function readCookie() { try { const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`)); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }
function writeCookie(v) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  try { document.cookie = v ? `${COOKIE}=${encodeURIComponent(v)}; max-age=${3600 * 24 * 60}; path=/; SameSite=Lax${secure}` : `${COOKIE}=; max-age=0; path=/; SameSite=Lax${secure}`; } catch { /* cookies blocked */ }
}

async function authFetch(path, body, bearer) {
  const res = await fetch(`${SB_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  let j = null; try { j = await res.json(); } catch { /* empty body */ }
  if (!res.ok) { const e = new Error((j && (j.msg || j.error_description || j.message)) || `Sign-in server error (${res.status})`); e.status = res.status; throw e; }
  return j;
}

function adopt(j) {
  if (!j || !j.access_token || !j.refresh_token || !j.user) throw new Error('The sign-in server sent an incomplete answer');
  const expiresAt = Number(j.expires_at) || Math.floor(Date.now() / 1000) + (Number(j.expires_in) || 3600);
  session = { access: j.access_token, expiresAt, user: { id: j.user.id, email: j.user.email || '' } };
  writeCookie(j.refresh_token);
}

async function renew() {
  if (refreshing) return refreshing;
  const rt = readCookie(); if (!rt) { session = null; return null; }
  const mine = epoch;
  refreshing = (async () => {
    try {
      const j = await authFetch('token?grant_type=refresh_token', { refresh_token: rt });
      if (mine !== epoch) return null;   // signed out while this was in flight
      adopt(j); return session;
    } catch (e) {
      if (mine !== epoch) return null;
      if (e.status >= 400 && e.status < 500) { session = null; writeCookie(null); emit('expired'); return null; }   // revoked or used up: sign out
      throw new Error('Could not reach the sign-in server. Check the connection and try again.');                     // network or 5xx: keep the cookie
    } finally { refreshing = null; }
  })();
  return refreshing;
}

// The sign-in link lands back here with the session in the URL fragment (or an error). Read it, then
// scrub it from the address bar and history so the tokens are not left in the URL.
function fromRedirect() {
  const h = location.hash; if (!h || h.length < 2 || !/(?:^#|&)(access_token|error)=/.test(h)) return null;
  const q = new URLSearchParams(h.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  if (q.get('error')) return { error: (q.get('error_description') || q.get('error')).replace(/\+/g, ' ') };
  return { access_token: q.get('access_token'), refresh_token: q.get('refresh_token'), expires_at: q.get('expires_at'), expires_in: q.get('expires_in') };
}

async function start() {
  const r = fromRedirect();
  if (r && r.error) return { error: r.error };
  if (r && r.access_token) {
    try {
      const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${r.access_token}` } });
      if (!res.ok) throw new Error();
      adopt({ ...r, user: await res.json() }); return { signedIn: true };
    } catch { return { error: 'That sign-in link could not be used. Request a new one.' }; }
  }
  try { await renew(); } catch { /* offline at boot: stay signed out for now, the cookie is kept for next time */ }
  return {};
}

/** Settles once any sign-in redirect or saved session has been read. { signedIn } on a fresh sign-in, { error } on a bad link. */
export const authReady = start();

export const auth = {
  user: () => (session ? session.user : null),
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** A valid access token, renewed if close to expiry, or null when signed out. */
  async token() {
    await authReady;
    if (!session) return null;
    if (session.expiresAt - EARLY <= Date.now() / 1000) await renew();
    return session ? session.access : null;
  },
  /** Email a one-time sign-in link that returns to this page. */
  async sendLink(email) {
    email = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address');
    const back = new URL(location.href); back.hash = ''; for (const k of ['city', 'load', 'example', 'go']) back.searchParams.delete(k);
    try { await authFetch(`otp?redirect_to=${encodeURIComponent(back.toString())}`, { email, create_user: true }); }
    catch (e) { throw new Error(e.status === 429 ? 'Too many sign-in emails were sent. Wait a few minutes and try again.' : e.message); }
  },
  async signOut() {
    const access = session && session.access;
    epoch++; refreshing = null; session = null; writeCookie(null); emit('signedOut');
    if (access) { try { await authFetch('logout?scope=local', {}, access); } catch { /* the local sign-out already happened */ } }
  },
};
