import { HANDLE_RE, LIMITS, RESERVED_HANDLES, validateDrop, validateShop } from '../shared/drop.js'
import { clearCookie, hashPassword, newToken, sessionCookie, sha256, verifyPassword } from './auth.js'
import { sendEmail } from './email.js'
import { body, fail, json, roomOf } from './http.js'
import { configureRooms, loadShop, publishStorefront, roomConfig, toDrop } from './shop.js'
import { connectLink, refundPayment, stripe } from './stripe.js'

// Merchant API: signup/login, shop settings, drops, orders, uploads. Handlers get (req, env, merchantId, match).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // Workers request body ceiling on Free/Pro
const UPLOAD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm' }
const ORDER_LIMIT = 500
const LINK_TTL_MS = 15 * 60_000
const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$none' // same work for unknown emails: no timing leak

// ── auth ──

export async function signup(req, env) {
  const b = await body(req)
  const handle = String(b?.handle ?? '').toLowerCase()
  const email = String(b?.email ?? '').trim().toLowerCase()
  const name = String(b?.name ?? '').trim().slice(0, LIMITS.NAME)
  if (!HANDLE_RE.test(handle) || handle.length > LIMITS.HANDLE) return fail(400, 'Handle: lowercase letters, numbers and dashes')
  if (RESERVED_HANDLES.has(handle)) return fail(409, 'That handle is reserved')
  if (!EMAIL_RE.test(email)) return fail(400, 'Enter a valid email')
  if (String(b?.password ?? '').length < MIN_PASSWORD) return fail(400, `Password needs ${MIN_PASSWORD}+ characters`)

  const id = crypto.randomUUID()
  try {
    await env.DB.prepare('INSERT INTO merchants (id, handle, email, pass_hash, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, handle, email, await hashPassword(b.password), name || handle, Date.now()).run()
  } catch {
    return fail(409, 'Handle or email already taken')
  }
  await publishStorefront(env, await loadShop(env, id))
  return json({ ok: true }, 201, { 'Set-Cookie': await sessionCookie(env, id, 1) })
}

export async function login(req, env) {
  const b = await body(req)
  const row = await env.DB.prepare('SELECT id, pass_hash, session_version FROM merchants WHERE email = ?').bind(String(b?.email ?? '').trim().toLowerCase()).first()
  const ok = await verifyPassword(String(b?.password ?? ''), row?.pass_hash ?? DUMMY_HASH)
  if (!row || !ok) return fail(401, 'Wrong email or password')
  return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(env, row.id, row.session_version) })
}

/** Email a one-time sign-in link. Doubles as password reset. Same answer whether or not the email exists. */
export async function sendLink(req, env) {
  const email = String((await body(req))?.email ?? '').trim().toLowerCase()
  const row = await env.DB.prepare('SELECT id FROM merchants WHERE email = ?').bind(email).first()
  if (row) {
    const { token, hash } = await newToken()
    await env.DB.batch([
      env.DB.prepare('DELETE FROM login_tokens WHERE merchant_id = ? OR expires_at < ?').bind(row.id, Date.now()),
      env.DB.prepare('INSERT INTO login_tokens (hash, merchant_id, expires_at) VALUES (?, ?, ?)').bind(hash, row.id, Date.now() + LINK_TTL_MS),
    ])
    await sendEmail(env, {
      to: email,
      subject: 'Your DOGS DROPS sign-in link',
      text: `Sign in (link works once, for 15 minutes):\n${env.PUBLIC_ORIGIN}/dash?token=${token}\n\nDidn't ask for this? Ignore it.`,
    })
  }
  return json({ ok: true })
}

export async function redeemLink(req, env) {
  const hash = await sha256(String((await body(req))?.token ?? ''))
  const row = await env.DB.prepare(`SELECT t.merchant_id, m.session_version FROM login_tokens t JOIN merchants m ON m.id = t.merchant_id
    WHERE t.hash = ? AND t.expires_at > ?`).bind(hash, Date.now()).first()
  if (!row) return fail(401, 'That link expired or was already used')
  await env.DB.prepare('DELETE FROM login_tokens WHERE hash = ?').bind(hash).run()
  return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(env, row.merchant_id, row.session_version) })
}

/** New password; every other device is signed out. */
export async function changePassword(req, env, mid) {
  const password = String((await body(req))?.password ?? '')
  if (password.length < MIN_PASSWORD) return fail(400, `Password needs ${MIN_PASSWORD}+ characters`)
  const row = await env.DB.prepare('UPDATE merchants SET pass_hash = ?, session_version = session_version + 1 WHERE id = ? RETURNING session_version')
    .bind(await hashPassword(password), mid).first()
  return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(env, mid, row.session_version) })
}

export async function signOutEverywhere(req, env, mid) {
  await env.DB.prepare('UPDATE merchants SET session_version = session_version + 1 WHERE id = ?').bind(mid).run()
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() })
}

export const logout = () => json({ ok: true }, 200, { 'Set-Cookie': clearCookie() })

// ── shop ──

export async function me(req, env, mid) {
  const shop = await loadShop(env, mid)
  if (!shop) return json(null)
  const m = shop.merchant
  if (m.payoutMode === 'connect' && m.stripeAccountId && !m.stripeReady && env.STRIPE_SECRET_KEY) {
    const acct = await stripe(env, `accounts/${m.stripeAccountId}`).catch(() => null)
    if (acct?.charges_enabled) {
      await env.DB.prepare('UPDATE merchants SET stripe_ready = 1 WHERE id = ?').bind(mid).run()
      m.stripeReady = true
      await configureRooms(env, shop)
    }
  }
  return json({ ...m, origin: env.PUBLIC_ORIGIN })
}

export async function updateShop(req, env, mid) {
  const v = validateShop((await body(req)) ?? {})
  if (v.error) return fail(400, v.error)
  const s = v.value
  await env.DB.prepare('UPDATE merchants SET name = ?, payout_mode = ?, theme = ?, shipping = ?, tax = ? WHERE id = ?')
    .bind(s.name, s.payoutMode, JSON.stringify(s.theme), JSON.stringify(s.shipping), s.tax ? 1 : 0, mid).run()
  const shop = await loadShop(env, mid)
  await Promise.all([configureRooms(env, shop), publishStorefront(env, shop)])
  return json({ ok: true })
}

export async function stripeConnect(req, env, mid) {
  const { merchant } = await loadShop(env, mid)
  const { accountId, url } = await connectLink(env, { ...merchant, stripe_account_id: merchant.stripeAccountId })
  await env.DB.prepare(`UPDATE merchants SET stripe_account_id = ?, payout_mode = 'connect' WHERE id = ?`).bind(accountId, mid).run()
  return json({ url })
}

// ── drops ──

export async function listDrops(req, env, mid) {
  const { results } = await env.DB.prepare('SELECT * FROM drops WHERE merchant_id = ? ORDER BY starts_at DESC').bind(mid).all()
  return json(results.map(toDrop))
}

/** Create (POST) or update (PUT /:id). The room accepts the config first, so D1 never promises what it can't sell. */
export async function saveDrop(req, env, mid, match) {
  const v = validateDrop((await body(req)) ?? {})
  if (v.error) return fail(400, v.error)
  const id = match[1] ?? crypto.randomUUID()
  const shop = await loadShop(env, mid)
  const existing = shop.drops.find((d) => d.id === id)
  if (match[1] && !existing) return fail(404, 'No such drop')
  if (shop.drops.some((d) => d.slug === v.value.slug && d.id !== id)) return fail(409, 'You already have a drop at that link')

  const drop = { ...v.value, id }
  const r = await roomOf(env, id).configure(roomConfig(env, shop.merchant, drop))
  if (!r.ok) return fail(409, r.reason)

  const d = drop
  const now = Date.now()
  const cols = [d.slug, d.title, d.description, d.priceCents, d.currency, d.totalStock, JSON.stringify(d.variants), d.maxPerOrder, d.startsAt, d.endsAt,
    d.holdMinutes, d.shards, d.chat ? 1 : 0, JSON.stringify(d.media), d.published ? 1 : 0, now]
  if (existing) {
    await env.DB.prepare(`UPDATE drops SET slug = ?, title = ?, description = ?, price_cents = ?, currency = ?, total_stock = ?, variants = ?, max_per_order = ?,
      starts_at = ?, ends_at = ?, hold_minutes = ?, shards = ?, chat = ?, media = ?, published = ?, updated_at = ? WHERE id = ?`).bind(...cols, id).run()
  } else {
    await env.DB.prepare(`INSERT INTO drops (slug, title, description, price_cents, currency, total_stock, variants, max_per_order, starts_at, ends_at,
      hold_minutes, shards, chat, media, published, updated_at, created_at, merchant_id, id) VALUES (${'?, '.repeat(18)}?)`).bind(...cols, now, mid, id).run()
  }
  await publishStorefront(env, { merchant: shop.merchant, drops: [...shop.drops.filter((x) => x.id !== id), drop] })
  return json(drop, existing ? 200 : 201)
}

/** The drop's room, if this merchant owns it. */
async function ownRoom(env, mid, id) {
  const row = await env.DB.prepare('SELECT id FROM drops WHERE id = ? AND merchant_id = ?').bind(id, mid).first()
  return row ? roomOf(env, row.id) : null
}

export async function dropState(req, env, mid, match) {
  const room = await ownRoom(env, mid, match[1])
  return room ? json(await room.state()) : fail(404, 'No such drop')
}

/** Only drops that never sold can be deleted; the rest get unpublished, so the order ledger stays whole. */
export async function deleteDrop(req, env, mid, match) {
  const room = await ownRoom(env, mid, match[1])
  if (!room) return fail(404, 'No such drop')
  if (!(await room.wipe())) return fail(409, 'This drop has sales or open checkouts. Unpublish it instead.')
  await env.DB.prepare('DELETE FROM drops WHERE id = ?').bind(match[1]).run()
  await env.KV.delete(`drop:${match[1]}`)
  await publishStorefront(env, await loadShop(env, mid))
  return json({ ok: true })
}

/** Chat moderation: { del: [messageId], ban: [authorKey] }. */
export async function moderate(req, env, mid, match) {
  const room = await ownRoom(env, mid, match[1])
  if (!room) return fail(404, 'No such drop')
  const b = (await body(req)) ?? {}
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 100) : [])
  await room.moderate({ del: list(b.del), ban: list(b.ban) })
  return json({ ok: true })
}

/** The shop posts in its own chat, with a host badge. */
export async function hostSay(req, env, mid, match) {
  const room = await ownRoom(env, mid, match[1])
  if (!room) return fail(404, 'No such drop')
  const { merchant } = await loadShop(env, mid)
  await room.say(merchant.name, (await body(req))?.text)
  return json({ ok: true })
}

// ── orders ──

export async function listOrders(req, env, mid) {
  const { results } = await env.DB.prepare('SELECT * FROM orders WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?').bind(mid, ORDER_LIMIT).all()
  return json(results.map((o) => ({ ...o, shipping: o.shipping ? JSON.parse(o.shipping) : null })))
}

/** Mark shipped, or refund. */
export async function updateOrder(req, env, mid, match) {
  const status = (await body(req))?.status
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? AND merchant_id = ?').bind(match[1], mid).first()
  if (!order) return fail(404, 'No such order')
  if (!['fulfilled', 'refunded'].includes(status)) return fail(400, 'Status must be fulfilled or refunded')
  if (order.status === 'refunded') return fail(409, 'Already refunded')
  if (status === 'refunded') await refundPayment(env, order.payment_intent, !!order.connected)
  await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(status, order.id).run()
  return json({ ok: true })
}

// ── media ──

export async function upload(req, env, mid) {
  const type = (req.headers.get('Content-Type') ?? '').split(';')[0]
  const ext = UPLOAD_TYPES[type]
  const size = Number(req.headers.get('Content-Length'))
  if (!ext) return fail(415, 'Upload images (jpg, png, webp, gif, avif) or video (mp4, webm)')
  if (!(size > 0 && size <= MAX_UPLOAD_BYTES)) return fail(413, 'Files must be under 100 MB')
  const key = `${mid}/${crypto.randomUUID()}.${ext}`
  await env.MEDIA.put(key, req.body, { httpMetadata: { contentType: type } })
  return json({ url: `/media/${key}`, kind: type.startsWith('video/') ? 'video' : 'image' }, 201)
}
