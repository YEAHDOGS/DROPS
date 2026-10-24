// Cloudflare Turnstile: proves a human before their first buy. Verified once per socket, so a stampede costs one
// siteverify call per person, not per click. With no TURNSTILE_SECRET set (local dev) everyone passes.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * @param {any} env
 * @param {unknown} token from the widget
 * @returns {Promise<boolean>}
 */
export async function isHuman(env, token) {
  if (!env.TURNSTILE_SECRET) return true
  if (typeof token !== 'string' || !token || token.length > 2048) return false
  const res = await fetch(env.TURNSTILE_VERIFY_URL || VERIFY_URL, {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }),
  }).catch(() => null)
  const body = await res?.json().catch(() => null)
  return body?.success === true
}
