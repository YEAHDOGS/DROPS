// Battle test: boots the real Worker + Durable Objects (wrangler dev / workerd) against a mock Stripe, then throws a
// crowd at one drop: viewers on a 2-level broadcast tree, a stampede of buyers, webhooks, cancels and chat.
// Asserts zero oversell per size, every viewer converging on the same stock, viewer counts, chat crossing shards,
// moderation, the bot gate, sign-in links, session revocation, rate limits and safe deletes.
//   npm run battle                      defaults: 1500 viewers, 600 buyers, 100 units
//   VIEWERS=4000 BUYERS=2000 npm run battle
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'

const PORT = 8799
const STRIPE_PORT = 12111
const BASE = `http://127.0.0.1:${PORT}`
const VIEWERS = Number(process.env.VIEWERS ?? 1500)
const BUYERS = Number(process.env.BUYERS ?? 600)
const STOCK = 100
const SHARDS = 128 // > 64 forces hubs: room -> 2 hubs -> 128 leaves
const WEBHOOK_SECRET = 'whsec_battle'
const PAID = 60
const LEAD_MS = 3000
const LATER_MS = 600_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? `  (${detail})` : ''}`)
}

// ── mock Stripe ──
const sessions = new Map()
const stripeCalls = { create: 0, expire: 0, refund: 0 }
const stripeServer = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const p = new URLSearchParams(raw)
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/v1/checkout/sessions') {
      stripeCalls.create++
      const id = `cs_test_${sessions.size}`
      const s = { id, url: `https://checkout.stripe.test/${id}`, metadata: Object.fromEntries(['drop', 'hold', 'qty', 'variant', 'connected'].map((k) => [k, p.get(`metadata[${k}]`)])), name: p.get('line_items[0][price_data][product_data][name]') }
      sessions.set(id, s)
      return res.end(JSON.stringify(s))
    }
    if (req.url === '/turnstile') return res.end(JSON.stringify({ success: p.get('response') === 'human' }))
    if (/\/expire$/.test(req.url)) stripeCalls.expire++
    if (req.url === '/v1/refunds') stripeCalls.refund++
    res.end('{}')
  })
})

function signedWebhook(event) {
  const payload = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex')
  return fetch(`${BASE}/api/stripe/webhook`, { method: 'POST', body: payload, headers: { 'Stripe-Signature': `t=${t},v1=${sig}` } })
}

// ── viewer ──
function viewer(i) {
  return new Promise((resolve, reject) => {
    const v = { i, last: null, chats: new Map(), buy: null, ws: null, firstSeen: new Map() }
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/live/${dropId}`, { headers: { 'CF-Connecting-IP': `10.0.${i >> 8}.${i & 255}` } })
    v.ws = ws
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.t === 'state') {
        v.last = m
        if (!v.firstSeen.has(m.a)) v.firstSeen.set(m.a, Date.now())
      }
      for (const c of m.c ?? []) v.chats.set(c.id, c)
      for (const id of m.del ?? []) v.chats.delete(id)
      if (m.t === 'buy') v.buy = m
    }
    ws.onopen = () => resolve(v)
    ws.onerror = reject
  })
}

async function waitFor(fn, ms, label) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (fn()) return true
    await sleep(100)
  }
  console.log(`    timed out waiting for: ${label}`)
  return false
}

// ── run ──
let dropId
const dir = mkdtempSync(join(tmpdir(), 'drops-battle-'))
mkdirSync('dist', { recursive: true })
await new Promise((r) => stripeServer.listen(STRIPE_PORT, '127.0.0.1', r))
execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', dir], { stdio: 'ignore' })
const vars = { TURNSTILE_SECRET: 'ts_battle', TURNSTILE_VERIFY_URL: `http://127.0.0.1:${STRIPE_PORT}/turnstile`, SESSION_SECRET: 'battle', STRIPE_SECRET_KEY: 'sk_test_battle', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_API: `http://127.0.0.1:${STRIPE_PORT}`, PUBLIC_ORIGIN: BASE }
const wrangler = spawn('node_modules/.bin/wrangler', ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', dir, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
let log = ''
wrangler.stdout.on('data', (d) => (log += d))
wrangler.stderr.on('data', (d) => (log += d))

try {
  if (!(await waitFor(() => log.includes('Ready on'), 60_000, 'wrangler dev'))) throw new Error(log)
  console.log(`\nDOGS DROPS battle: ${VIEWERS} viewers, ${BUYERS} buyers, ${STOCK} units, ${SHARDS} shards\n`)

  // merchant + drop
  const signup = await fetch(`${BASE}/api/auth/signup`, { method: 'POST', body: JSON.stringify({ handle: 'radiohead', email: 'band@example.com', password: 'kid-a-2000', name: 'Radiohead' }) })
  const cookie = signup.headers.get('set-cookie').split(';')[0]
  check('merchant signs up', signup.status === 201)
  const SIZES = [{ id: 'black', label: 'Black', stock: STOCK / 2 }, { id: 'red', label: 'Red', stock: STOCK / 2 }]
  const drop = { title: 'Kid A — 100 vinyl', priceCents: 4000, variants: SIZES, maxPerOrder: 1, startsAt: Date.now() + LATER_MS, shards: SHARDS, published: true }
  const created = await fetch(`${BASE}/api/me/drops`, { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify(drop) })
  dropId = (await created.json()).id
  check('drop published', created.status === 201)
  const shop = await (await fetch(`${BASE}/api/s/radiohead`)).json()
  check('storefront serves the drop', shop.drops?.[0]?.id === dropId)

  // crowd
  const t0 = Date.now()
  const crowd = []
  for (let i = 0; i < VIEWERS; i += 100) crowd.push(...(await Promise.all(Array.from({ length: Math.min(100, VIEWERS - i) }, (_, k) => viewer(i + k)))))
  check('crowd connected', crowd.length === VIEWERS, `${Date.now() - t0} ms`)
  await waitFor(() => crowd.every((v) => v.last?.v === VIEWERS), 10_000, 'viewer count')
  check('every viewer sees the full viewer count', crowd.every((v) => v.last?.v === VIEWERS), `v=${crowd[0].last?.v}`)
  check('drop is scheduled before its time', crowd.every((v) => v.last?.st === 'scheduled'))

  // early click is refused
  crowd[0].ws.send(JSON.stringify({ t: 'buy', qty: 1 }))
  await waitFor(() => crowd[0].buy, 5000, 'early buy reply')
  check('buying before the drop is refused', crowd[0].buy?.ok === false && crowd[0].buy?.reason === 'scheduled')
  crowd[0].buy = null

  // merchant pulls the drop forward while the crowd watches
  const startsAt = Date.now() + LEAD_MS
  const moved = await fetch(`${BASE}/api/me/drops/${dropId}`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ ...drop, startsAt }) })
  await waitFor(() => crowd.every((v) => v.last?.at === startsAt), 5000, 'new start time')
  check('reschedule reaches every viewer live', moved.ok && crowd.every((v) => v.last?.at === startsAt))

  // stampede at drop time: buyers retry "busy" like the real client does
  await waitFor(() => Date.now() >= startsAt, LEAD_MS + 1000, 'drop time')
  await waitFor(() => crowd.every((v) => v.last?.st === 'live'), 5000, 'live state')
  check('every viewer flips to live', crowd.every((v) => v.last?.st === 'live'))
  const buyers = crowd.slice(0, BUYERS)
  const tBuy = Date.now()
  const bot = crowd[BUYERS]
  bot.ws.send(JSON.stringify({ t: 'buy', qty: 1, variant: 'black', ts: 'bot' }))
  await waitFor(() => bot.buy, 5000, 'bot reply')
  check('a bot without a Turnstile pass is refused', bot.buy?.reason === 'challenge')
  const attempt = async (v) => {
    for (let tries = 0; tries < 40; tries++) {
      v.buy = null
      v.ws.send(JSON.stringify({ t: 'buy', qty: 1, variant: SIZES[v.i % 2].id, ts: 'human' }))
      await waitFor(() => v.buy, 10_000, 'buy reply')
      if (v.buy?.reason !== 'busy') return v.buy
      await sleep(50 + Math.random() * 200)
    }
    return v.buy
  }
  const replies = await Promise.all(buyers.map(attempt))
  const wins = replies.filter((r) => r?.ok)
  check(`exactly ${STOCK} buyers win a hold`, wins.length === STOCK, `${wins.length} won in ${Date.now() - tBuy} ms`)
  check('losers are told it is claimed', replies.filter((r) => !r?.ok).every((r) => r.reason === 'claimed'), [...new Set(replies.filter((r) => !r?.ok).map((r) => r?.reason))].join(','))
  check('one Checkout session per hold', stripeCalls.create === STOCK, `${stripeCalls.create}`)
  await waitFor(() => crowd.every((v) => v.last?.a === 0), 5000, 'stock 0 everywhere')
  check('every viewer converges on 0 left, per size', crowd.every((v) => v.last?.a === 0 && v.last?.va?.black === 0 && v.last?.va?.red === 0))
  check('checkout names the size', [...sessions.values()].every((x) => / — (Black|Red)$/.test(x.name)))
  const lag = crowd.map((v) => v.firstSeen.get(0) - tBuy).sort((a, b) => a - b)
  check('sellout reached the whole crowd', lag.length === VIEWERS, `p50 ${lag[lag.length >> 1]} ms, max ${lag.at(-1)} ms after the first click`)

  // payments (webhooks), duplicates, and abandoned checkouts
  const holds = [...sessions.values()]
  const paid = holds.slice(0, PAID)
  const event = (s, type = 'checkout.session.completed') => ({ type, data: { object: { ...s, payment_status: 'paid', payment_intent: `pi_${s.id}`, amount_total: 4000, currency: 'usd', customer_details: { email: 'fan@example.com', name: 'Fan' } } } })
  const hookStatus = await Promise.all(paid.map((s) => signedWebhook(event(s)).then((r) => r.status)))
  check('webhooks accepted', hookStatus.every((s) => s === 200))
  await signedWebhook(event(paid[0]))
  const forged = await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST', body: JSON.stringify(event(paid[1])), headers: { 'Stripe-Signature': 't=1,v1=00' } })
  check('forged webhook rejected', forged.status === 400)
  await Promise.all(holds.slice(PAID).map((s) => signedWebhook(event(s, 'checkout.session.expired'))))
  await waitFor(() => crowd.every((v) => v.last?.a === STOCK - PAID && v.last?.s === PAID), 5000, 'post-payment state')
  check(`${PAID} sold, abandoned holds back on the shelf`, crowd.every((v) => v.last?.a === STOCK - PAID && v.last?.s === PAID), `a=${crowd[0].last?.a} s=${crowd[0].last?.s}`)
  const orders = await (await fetch(`${BASE}/api/me/orders`, { headers: { Cookie: cookie } })).json()
  check('orders ledger has each payment once, with its size', orders.length === PAID && orders.every((o) => ['black', 'red'].includes(o.variant)), `${orders.length}`)

  // chat crosses shards
  crowd[1].ws.send(JSON.stringify({ t: 'chat', name: 'thom', text: 'everything in its right place' }))
  await waitFor(() => crowd.every((v) => v.chats.size > 0), 5000, 'chat')
  check('chat reaches every shard', crowd.every((v) => v.chats.size > 0))

  // moderation: delete + shadow-ban the author, host speaks
  const [msg] = crowd[2].chats.values()
  const mod = await fetch(`${BASE}/api/me/drops/${dropId}/mod`, { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ del: [msg.id], ban: [msg.k] }) })
  await waitFor(() => crowd.every((v) => !v.chats.has(msg.id)), 5000, 'delete')
  check('deleted message vanishes everywhere', mod.ok && crowd.every((v) => !v.chats.has(msg.id)))
  await sleep(1600) // chat cooldown
  crowd[1].ws.send(JSON.stringify({ t: 'chat', name: 'thom', text: 'banned words' }))
  await fetch(`${BASE}/api/me/drops/${dropId}/say`, { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ text: 'Restock at midnight.' }) })
  await waitFor(() => crowd.every((v) => [...v.chats.values()].some((m) => m.host)), 5000, 'host message')
  check('host message reaches everyone with a badge', crowd.every((v) => [...v.chats.values()].some((m) => m.host && m.n === 'Radiohead')))
  const sees = (v) => [...v.chats.values()].some((m) => m.x === 'banned words')
  check('banned author only sees themselves', sees(crowd[1]) && crowd.filter((v) => v !== crowd[1]).every((v) => !sees(v)))

  const stats = await (await fetch(`${BASE}/api/me/drops/${dropId}/state`, { headers: { Cookie: cookie } })).json()
  check('dashboard records the peak crowd', stats.peak === VIEWERS, `peak=${stats.peak}`)

  // deletes: refused once sold, allowed when untouched
  const sold = await fetch(`${BASE}/api/me/drops/${dropId}`, { method: 'DELETE', headers: { Cookie: cookie } })
  const spare = await (await fetch(`${BASE}/api/me/drops`, { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ ...drop, title: 'Spare' }) })).json()
  const gone = await fetch(`${BASE}/api/me/drops/${spare.id}`, { method: 'DELETE', headers: { Cookie: cookie } })
  check('a drop with sales cannot be deleted; an empty one can', sold.status === 409 && gone.ok)

  // auth: sign-in link, password change revokes old sessions, rate limit
  await fetch(`${BASE}/api/auth/link`, { method: 'POST', body: JSON.stringify({ email: 'band@example.com' }) })
  await waitFor(() => /token=([\w-]+)/.test(log), 5000, 'sign-in link in log')
  const token = log.match(/token=([\w-]+)/)?.[1]
  const redeem = await fetch(`${BASE}/api/auth/redeem`, { method: 'POST', body: JSON.stringify({ token }) })
  const again = await fetch(`${BASE}/api/auth/redeem`, { method: 'POST', body: JSON.stringify({ token }) })
  check('sign-in link works exactly once', redeem.ok && again.status === 401)
  const linkCookie = redeem.headers.get('set-cookie').split(';')[0]
  const changed = await fetch(`${BASE}/api/me/password`, { method: 'PUT', headers: { Cookie: linkCookie }, body: JSON.stringify({ password: 'ok-computer-97' }) })
  const fresh = changed.headers.get('set-cookie').split(';')[0]
  const [oldMe, newMe] = await Promise.all([cookie, fresh].map((c) => fetch(`${BASE}/api/me`, { headers: { Cookie: c } }).then((r) => r.json())))
  check('password change signs out every other session', oldMe === null && newMe?.handle === 'radiohead')
  const tries = await Promise.all(Array.from({ length: 12 }, () =>
    fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'CF-Connecting-IP': '6.6.6.6' }, body: JSON.stringify({ email: 'x@example.com', password: 'guess-guess' }) }).then((r) => r.status)))
  check('login is rate limited per IP', tries.includes(429), tries.join(','))

  // the crowd leaves
  for (const v of crowd.slice(0, VIEWERS / 2)) v.ws.close()
  const rest = crowd.slice(VIEWERS / 2)
  await waitFor(() => rest.every((v) => v.last?.v === VIEWERS / 2), 10_000, 'viewer count after leave')
  check('viewer count tracks departures', rest.every((v) => v.last?.v === VIEWERS / 2), `v=${rest[0].last?.v}`)
  for (const v of rest) v.ws.close()
} catch (err) {
  console.error(err)
  results.push(false)
} finally {
  process.kill(-wrangler.pid, 'SIGKILL') // whole group: wrangler + workerd
  stripeServer.close()
  rmSync(dir, { recursive: true, force: true })
}

const failed = results.filter((r) => !r).length
console.log(`\n${failed ? `✘ ${failed} failed` : `✔ all ${results.length} checks passed`}\n`)
if (failed) console.log(log.split('\n').filter((l) => /error|✘|exception/i.test(l)).slice(-30).join('\n'))
process.exit(failed ? 1 : 0)
