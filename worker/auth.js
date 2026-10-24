// Merchant auth: PBKDF2 password hashes + HMAC-signed session cookie. WebCrypto only, no dependencies.

const PBKDF2_ITERATIONS = 100_000 // Workers' PBKDF2 ceiling
const SESSION_DAYS = 30
const COOKIE = 'dd_session'
const DAY_MS = 86_400_000
const encoder = new TextEncoder()

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))
}

/** Constant-time string compare. */
function same(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split('$')
  if (scheme !== 'pbkdf2') return false
  return same(b64url(await pbkdf2(password, unb64url(salt), Number(iterations))), hash)
}

/** Set-Cookie header value for a fresh session. */
export async function sessionCookie(env, merchantId) {
  const exp = Date.now() + SESSION_DAYS * DAY_MS
  const value = `${merchantId}.${exp}.${await hmac(env.SESSION_SECRET, `${merchantId}.${exp}`)}`
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

/** Merchant id from a valid session cookie, else null. */
export async function sessionMerchant(env, req) {
  const raw = (req.headers.get('Cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))
  if (!raw || !env.SESSION_SECRET) return null
  const [id, exp, sig] = raw.slice(COOKIE.length + 1).split('.')
  if (!id || !(Number(exp) > Date.now()) || !sig) return null
  return same(sig, await hmac(env.SESSION_SECRET, `${id}.${exp}`)) ? id : null
}

/** Stable anonymous key for one buyer (per-person hold limits) that never stores a raw IP. */
export async function buyerKey(env, req) {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local'
  return (await hmac(env.SESSION_SECRET ?? 'dev', `buyer:${ip}`)).slice(0, 22)
}
