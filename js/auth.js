// Player accounts on Supabase Auth, by emailed sign-in link. No SDK: the game has no build step, so this
// talks to the Auth REST API directly. The link uses PKCE: the browser that asks for it keeps a secret
// verifier, and only that browser can turn the link's code into a session, so a link someone else sends
// cannot sign this browser into their account. The refresh token lives in a cookie (the game keeps no
// other browser storage); the short-lived access token stays in memory and is renewed before it runs out.
export const SB_URL = 'https://iaxxvgwivltgevwkkgmi.supabase.co', SB_KEY = 'sb_publishable_jfhKLY8bmB19epBpiwLaTQ_xXyBa88O';
const COOKIE = 'sf7x7_auth', EARLY = 60;   // renew this many seconds before expiry

let session = null;          // { access, expiresAt, user: { id, email } }
let refreshing = null;       // one renewal at a time, so a rotated refresh token is never spent twice
let epoch = 0;               // bumped on sign-out; a renewal that started before it must not sign the player back in
const listeners = new Set();
const emit = (why) => { for (const fn of listeners) { try { fn(session && session.user, why); } catch { /* a listener's problem */ } } };

const PKCE = 'sf7x7_pkce';   // verifier for a sign-in link this browser asked for; lives as long as the link
function readCookie(name = COOKIE) { try { const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`)); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }
function writeCookie(v, name = COOKIE, maxAge = 3600 * 24 * 60) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  try { document.cookie = v ? `${name}=${encodeURIComponent(v)}; max-age=${maxAge}; path=/; SameSite=Lax${secure}` : `${name}=; max-age=0; path=/; SameSite=Lax${secure}`; } catch { /* cookies blocked */ }
}
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
  const rt = readCookie();
  if (!rt) { const had = !!session; session = null; if (had) emit('signedOut'); return null; }   // signed out in another tab
  const mine = epoch;
  refreshing = (async () => {
    try {
      const j = await authFetch('token?grant_type=refresh_token', { refresh_token: rt });
      if (mine !== epoch) return null;   // signed out while this was in flight
      adopt(j); return session;
    } catch (e) {
      if (mine !== epoch) return null;
      if (e.status >= 400 && e.status < 500 && e.status !== 429) { session = null; writeCookie(null); emit('expired'); return null; }   // revoked or used up: sign out
      throw new Error('The sign-in server is busy or out of reach. Try again in a moment.');   // network, 429 or 5xx: keep the cookie
    } finally { refreshing = null; }
  })();
  return refreshing;
}

// The sign-in link lands back here with ?code=… (or an error). Read it, then scrub it from the address bar
// and history. Tokens in the fragment (the implicit flow) are never accepted: this page never asks for
// them, so they can only come from a link someone else made. They are scrubbed and ignored.
const LINK_KEYS = ['code', 'error', 'error_code', 'error_description'];
function fromRedirect() {
  const u = new URL(location.href), h = new URLSearchParams(u.hash.slice(1));
  const code = u.searchParams.get('code'), err = u.searchParams.get('error') || h.get('error');
  const desc = u.searchParams.get('error_description') || h.get('error_description');
  const stray = h.has('access_token') || h.has('refresh_token');
  if (!code && !err && !stray) return null;
  for (const k of LINK_KEYS) u.searchParams.delete(k);
  if (err || stray) u.hash = '';
  history.replaceState(null, '', u.pathname + u.search + u.hash);
  if (err) return { error: (desc || err).replace(/\+/g, ' ') };
  if (stray) return { error: 'That sign-in link was not requested from this browser, so it was ignored.' };
  return { code };
}

async function start() {
  const r = fromRedirect();
  if (r && r.code) {
    const verifier = readCookie(PKCE); writeCookie(null, PKCE);
    if (verifier) {
      try { adopt(await authFetch('token?grant_type=pkce', { auth_code: r.code, code_verifier: verifier })); return { signedIn: true }; }
      catch { r.error = 'That sign-in link could not be used. Request a new one.'; }
    } else r.error = 'Open the sign-in link in the same browser you asked for it from.';
  }
  // No link, or a link that failed: carry on with any session this browser already has.
  try { await renew(); } catch { /* offline at boot: stay signed out for now, the cookie is kept for next time */ }
  return r && r.error ? { error: r.error } : {};
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
    const back = new URL(location.href); back.hash = ''; for (const k of ['city', 'load', 'example', 'go', ...LINK_KEYS]) back.searchParams.delete(k);
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    writeCookie(verifier, PKCE, 3600);
    try { await authFetch(`otp?redirect_to=${encodeURIComponent(back.toString())}`, { email, create_user: true, code_challenge: challenge, code_challenge_method: 's256' }); }
    catch (e) { throw new Error(e.status === 429 ? 'Too many sign-in emails were sent. Wait a few minutes and try again.' : e.message); }
  },
  async signOut() {
    const access = session && session.access;
    epoch++; refreshing = null; session = null; writeCookie(null); emit('signedOut');
    if (access) { try { await authFetch('logout?scope=local', {}, access); } catch { /* the local sign-out already happened */ } }
  },
};
