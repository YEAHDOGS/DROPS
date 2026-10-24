import { buyerKey, sessionMerchant } from './auth.js'
import * as dash from './dash.js'
import { fail, json, roomOf } from './http.js'
import { depthFor, nodeName } from './tree.js'
import { refundPayment, verifyWebhook } from './stripe.js'
import { loadShop, publishStorefront, storefrontData } from './shop.js'
import { storefrontDrop } from '../shared/drop.js'

export { DropRoom } from './room.js'
export { Fanout } from './fanout.js'

// Edge router. Static app files never reach this Worker (wrangler.jsonc run_worker_first: only /api and /media).
// Hot path per viewer: one KV read (edge-cached) to find the drop's shard count, then straight into a leaf Fanout.

const STOREFRONT_TTL_S = 30
const MEDIA_CACHE = 'public, max-age=31536000, immutable'

/** @type {[string, RegExp, Function][]} */
const ROUTES = [
  ['GET', /^\/api\/s\/([a-z0-9-]+)$/, storefront],
  ['GET', /^\/api\/live\/([\w-]+)$/, live],
  ['POST', /^\/api\/stripe\/webhook$/, webhook],
  ['GET', /^\/media\/([\w-]+\/[\w-]+\.\w+)$/, media],
  ['POST', /^\/api\/auth\/signup$/, limited(dash.signup)],
  ['POST', /^\/api\/auth\/login$/, limited(dash.login)],
  ['POST', /^\/api\/auth\/link$/, limited(dash.sendLink)],
  ['POST', /^\/api\/auth\/redeem$/, limited(dash.redeemLink)],
  ['POST', /^\/api\/auth\/logout$/, dash.logout],
  ['GET', /^\/api\/me$/, whoami],
  ['PUT', /^\/api\/me$/, signedIn(dash.updateShop)],
  ['PUT', /^\/api\/me\/password$/, signedIn(dash.changePassword)],
  ['POST', /^\/api\/me\/signout-all$/, signedIn(dash.signOutEverywhere)],
  ['POST', /^\/api\/me\/stripe$/, signedIn(dash.stripeConnect)],
  ['GET', /^\/api\/me\/drops$/, signedIn(dash.listDrops)],
  ['POST', /^\/api\/me\/drops$/, signedIn(dash.saveDrop)],
  ['PUT', /^\/api\/me\/drops\/([\w-]+)$/, signedIn(dash.saveDrop)],
  ['DELETE', /^\/api\/me\/drops\/([\w-]+)$/, signedIn(dash.deleteDrop)],
  ['GET', /^\/api\/me\/drops\/([\w-]+)\/state$/, signedIn(dash.dropState)],
  ['POST', /^\/api\/me\/drops\/([\w-]+)\/mod$/, signedIn(dash.moderate)],
  ['POST', /^\/api\/me\/drops\/([\w-]+)\/say$/, signedIn(dash.hostSay)],
  ['GET', /^\/api\/me\/orders$/, signedIn(dash.listOrders)],
  ['PUT', /^\/api\/me\/orders\/([\w-]+)$/, signedIn(dash.updateOrder)],
  ['POST', /^\/api\/me\/media$/, signedIn(dash.upload)],
]

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url)
    const route = ROUTES.find(([method, re]) => method === req.method && re.test(url.pathname))
    if (!route) return url.pathname.startsWith('/api/') ? fail(404, 'Not found') : env.ASSETS.fetch(req)

    // CSRF: browsers always send Origin on cross-site writes; refuse any that isn't us. (Webhooks carry no Origin.)
    const origin = req.headers.get('Origin')
    if (req.method !== 'GET' && origin && origin !== url.origin) return fail(403, 'Cross-origin request refused')

    try {
      return await route[2](req, env, ctx, url.pathname.match(route[1]))
    } catch (err) {
      console.error(req.method, url.pathname, err)
      return fail(500, 'Something broke on our side')
    }
  },
}

/** Merchant id for a signed cookie whose version is still current (password changes revoke old cookies). */
async function currentMerchant(env, req) {
  const s = await sessionMerchant(env, req)
  if (!s) return null
  const row = await env.DB.prepare('SELECT session_version FROM merchants WHERE id = ?').bind(s.id).first()
  return row?.session_version === s.version ? s.id : null
}

/** Wrap a dashboard handler: resolves the session or 401s. */
function signedIn(handler) {
  return async (req, env, ctx, match) => {
    const mid = await currentMerchant(env, req)
    return mid ? handler(req, env, mid, match) : fail(401, 'Sign in first')
  }
}

/** Wrap an auth handler with the per-IP rate limit (AUTH_LIMIT binding; absent in tests = unlimited). */
function limited(handler) {
  return async (req, env, ctx, match) => {
    const key = `${new URL(req.url).pathname}:${req.headers.get('CF-Connecting-IP') ?? 'local'}`
    const { success } = env.AUTH_LIMIT ? await env.AUTH_LIMIT.limit({ key }) : { success: true }
    return success ? handler(req, env, ctx, match) : fail(429, 'Too many tries. Wait a minute.')
  }
}

/** The dashboard asks "who am I?": signed out is an answer (null), not an error. */
async function whoami(req, env, ctx, match) {
  const mid = await currentMerchant(env, req)
  return mid ? dash.me(req, env, mid, match) : json(null)
}

/**
 * Shop + drops. KV answers instantly from the edge; when it doesn't know the shop, or a drop the page asked for
 * (`?d=slug`, published seconds ago), D1 answers and the KV copy heals. Mystery drops are stripped here, per request.
 */
async function storefront(req, env, ctx, [, handle]) {
  const want = new URL(req.url).searchParams.get('d')
  let data = await env.KV.get(`shop:${handle}`, { type: 'json', cacheTtl: STOREFRONT_TTL_S })
  if (!data || (want && !data.drops.some((d) => d.slug === want))) {
    const row = await env.DB.prepare('SELECT id FROM merchants WHERE handle = ?').bind(handle).first()
    const shop = row && (await loadShop(env, row.id))
    const fresh = shop && storefrontData(shop)
    // heal KV only when it really was stale: junk ?d= slugs must not turn into KV writes
    if (fresh && (!data || fresh.drops.some((d) => d.slug === want))) ctx.waitUntil(publishStorefront(env, shop))
    data = fresh ?? data
  }
  if (!data) return fail(404, 'No shop at that handle')
  const now = Date.now()
  const drops = data.drops.map((d) => storefrontDrop(d, now))
  return json({ shop: data.shop, drops, turnstile: env.TURNSTILE_SITE_KEY || null }, 200, { 'Cache-Control': 'public, max-age=10' })
}

/**
 * Viewer WebSocket: spread across the drop's leaf shards at random. KV (edge-cached) answers the shard count; for a
 * drop published seconds ago that KV hasn't propagated yet, the room itself answers.
 */
async function live(req, env, ctx, [, dropId]) {
  if (req.headers.get('Upgrade') !== 'websocket') return fail(426, 'Expected websocket')
  const meta = (await env.KV.get(`drop:${dropId}`, { type: 'json', cacheTtl: STOREFRONT_TTL_S })) ?? (await roomOf(env, dropId).meta())
  if (!meta) return fail(404, 'No such drop')
  const name = nodeName(dropId, depthFor(meta.shards), Math.floor(Math.random() * meta.shards))
  const headers = new Headers(req.headers)
  headers.set('x-node', name)
  headers.set('x-buyer', await buyerKey(env, req))
  return env.FANOUT.get(env.FANOUT.idFromName(name)).fetch(new Request(req, { headers }))
}

/** R2 media behind the colo cache, with range support for video scrubbing. */
async function media(req, env, ctx, [, key]) {
  const ranged = req.headers.has('Range')
  const cached = ranged ? null : await caches.default.match(req)
  if (cached) return cached

  const obj = await env.MEDIA.get(key, { range: req.headers, onlyIf: req.headers })
  if (!obj) return new Response('Not found', { status: 404 })
  const headers = new Headers({ 'Cache-Control': MEDIA_CACHE, 'Accept-Ranges': 'bytes', ETag: obj.httpEtag })
  obj.writeHttpMetadata(headers)
  if (!('body' in obj)) return new Response(null, { status: 304, headers })

  if (ranged && obj.range) {
    const offset = obj.range.offset ?? obj.size - obj.range.suffix
    const length = obj.range.length ?? obj.size - offset
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`)
    return new Response(obj.body, { status: 206, headers })
  }
  const res = new Response(obj.body, { headers })
  ctx.waitUntil(caches.default.put(req, res.clone()))
  return res
}

/** Stripe webhook: payments land in the room (idempotent), orders land in D1. */
async function webhook(req, env) {
  const event = await verifyWebhook(await req.text(), req.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET)
  if (!event) return fail(400, 'Bad signature')
  const s = event.data.object
  const meta = s.metadata ?? {}

  if (event.type === 'checkout.session.expired' && meta.drop) await roomOf(env, meta.drop).cancel(meta.hold)
  if (event.type === 'charge.refunded') {
    await env.DB.prepare(`UPDATE orders SET status = 'refunded' WHERE payment_intent = ?`).bind(s.payment_intent).run()
  }
  const paid = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && s.payment_status === 'paid'
  if (paid && meta.drop) await recordSale(env, s, meta)
  return json({ received: true })
}

async function recordSale(env, s, meta) {
  const drop = await env.DB.prepare('SELECT merchant_id FROM drops WHERE id = ?').bind(meta.drop).first()
  if (!drop) return
  const connected = meta.connected === '1'
  const r = await roomOf(env, meta.drop).complete(s.id, meta.hold, Number(meta.qty), meta.variant)
  if (!r.ok) await refundPayment(env, s.payment_intent, connected) // paid after its hold lapsed and stock ran out
  const ship = s.collected_information?.shipping_details ?? s.shipping_details ?? null
  await env.DB.prepare(`INSERT OR IGNORE INTO orders (id, drop_id, merchant_id, payment_intent, qty, amount_cents, currency, email, name, shipping,
    connected, status, created_at, variant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(s.id, meta.drop, drop.merchant_id, s.payment_intent, r.qty ?? Number(meta.qty), s.amount_total, s.currency,
      s.customer_details?.email ?? null, ship?.name ?? s.customer_details?.name ?? null, ship ? JSON.stringify(ship) : null,
      connected ? 1 : 0, r.ok ? 'paid' : 'refunded', Date.now(), r.variant ?? meta.variant ?? null)
    .run()
}
