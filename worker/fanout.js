import { DurableObject } from 'cloudflare:workers'
import { LIMITS } from '../shared/drop.js'
import { chatBlock, chatConfig } from '../shared/chat.js'
import { parseNode } from './tree.js'
import { createCheckout, expireCheckout } from './stripe.js'
import { isHuman } from './turnstile.js'

// Fanout: a node in the broadcast tree. Hubs hold child Fanouts, leaves hold viewers (both use hibernatable sockets).
// Downstream: relays every room state to its sockets, verbatim. Upstream: viewer counts (summed) and chat (budgeted).
// Leaves also front the buy button: they drop doomed attempts using the last known stock before the room sees them.

const VIEWER = 'v'
const CHILD = 'child'
const REPORT_MS = 1000 // viewer count report cadence
const RELINK_MS = 1000
const MAX_INFLIGHT = 16 // buy attempts one leaf has open against the room; extra clicks get "busy" and retry with jitter
const CHAT_UP_PER_SEC = 20
const CONTROL_RE = /[\u0000-\u001f\u007f]/g

const clean = (v, max) => String(v ?? '').replace(CONTROL_RE, '').trim().slice(0, max)

export class Fanout extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.node = null
    this.up = null
    this.linking = null
    this.state = null // last room state, raw JSON, sent to every new socket
    this.snap = null // same, parsed, for buy gating
    this.product = null // last product message (raw), for new sockets
    this.cfg = null // last config message (raw), for new sockets
    this.chatCfg = chatConfig(false) // parsed chat rules; off until the room says otherwise
    this.inflight = 0
    this.reportTimer = null
    this.chatWindow = 0
    this.chatSent = 0
    this.bans = new Set() // silenced chat authors, mirrored from the room
  }

  async fetch(req) {
    const name = req.headers.get('x-node') ?? ''
    this.node ??= parseNode(name)
    if (!this.node || req.headers.get('Upgrade') !== 'websocket') return new Response('Bad request', { status: 400 })

    const child = new URL(req.url).pathname === '/link'
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server, [child ? CHILD : VIEWER])
    server.serializeAttachment(child ? { node: name, n: 0 } : { node: name, buyer: req.headers.get('x-buyer') ?? 'anon', chatAt: 0, hold: null })
    if (this.state) server.send(this.state)
    if (this.cfg) server.send(this.cfg)
    if (this.product) server.send(this.product)
    if (child && this.bans.size) server.send(JSON.stringify({ t: 'mod', ban: [...this.bans] }))
    this.ensureLink()
    this.report()
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, raw) {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    const att = ws.deserializeAttachment()
    this.node ??= parseNode(att.node)
    this.ensureLink()

    if (this.ctx.getTags(ws)[0] === CHILD) {
      if (msg.t === 'chat') return this.chatUp(msg)
      if (msg.t === 'n' && Number.isSafeInteger(msg.n) && msg.n >= 0) ws.serializeAttachment({ ...att, n: msg.n })
      return this.report()
    }

    if (msg.t === 'ping') return ws.send(JSON.stringify({ t: 'pong', c: msg.c, s: Date.now() }))
    if (msg.t === 'chat') return this.chat(ws, att, msg)
    if (msg.t === 'buy') return this.buy(ws, att, msg)
    if (msg.t === 'cancel' && typeof msg.id === 'string') return this.room().cancel(msg.id.slice(0, 64))
  }

  async webSocketClose(ws) {
    try { ws.close() } catch { /* already closed */ }
    this.report()
    if (this.ctx.getWebSockets().some((w) => w !== ws)) return
    this.up?.close(1000, 'idle')
    this.up = null
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws)
  }

  // ── tree links ──

  room() {
    return this.env.DROP_ROOM.get(this.env.DROP_ROOM.idFromName(this.node.dropId))
  }

  ensureLink() {
    if (this.up || this.linking || !this.node) return
    this.linking = this.link().finally(() => (this.linking = null))
  }

  async link() {
    const { parent } = this.node
    const stub = parent ? this.env.FANOUT.get(this.env.FANOUT.idFromName(parent)) : this.room()
    try {
      const res = await stub.fetch('https://do/link', { headers: { Upgrade: 'websocket', 'x-node': parent ?? '' } })
      const ws = res.webSocket
      if (!ws) throw new Error(`link refused: ${res.status}`)
      ws.accept()
      ws.addEventListener('message', (e) => this.down(e.data))
      ws.addEventListener('close', () => this.unlink(ws))
      ws.addEventListener('error', () => this.unlink(ws))
      this.up = ws
      this.report()
    } catch {
      setTimeout(() => this.ctx.getWebSockets().length && this.ensureLink(), RELINK_MS)
    }
  }

  unlink(ws) {
    if (this.up !== ws) return
    this.up = null
    if (this.ctx.getWebSockets().length) setTimeout(() => this.ensureLink(), RELINK_MS)
  }

  sendUp(msg) {
    try { this.up?.send(JSON.stringify(msg)) } catch { /* relinking */ }
  }

  /** Room traffic flowing down the tree: cache state and bans, relay everything untouched. */
  down(data) {
    if (typeof data !== 'string') return
    try {
      const msg = JSON.parse(data)
      if (msg.t === 'state') [this.state, this.snap] = [data, msg]
      if (msg.t === 'mod') this.mod(msg)
      if (msg.t === 'product') this.product = data
      if (msg.t === 'cfg') [this.cfg, this.chatCfg] = [data, chatConfig(msg.chat ?? false)]
    } catch { return }
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data) } catch { /* closing socket */ }
    }
  }

  report() {
    if (this.reportTimer) return
    this.reportTimer = setTimeout(() => {
      this.reportTimer = null
      let n = this.ctx.getWebSockets(VIEWER).length
      for (const ws of this.ctx.getWebSockets(CHILD)) n += ws.deserializeAttachment()?.n ?? 0
      this.sendUp({ t: 'n', n })
    }, REPORT_MS)
  }

  // ── chat ──

  /** Forget deleted messages in the cached state (new joiners never see them) and remember bans. */
  mod({ del = [], ban = [] }) {
    for (const k of ban) this.bans.add(k)
    if (!this.snap?.c || !del.length) return
    this.snap.c = this.snap.c.filter((m) => !del.includes(m.id))
    this.state = JSON.stringify(this.snap)
  }

  chatUp(msg) {
    const now = Date.now()
    if (now >= this.chatWindow) [this.chatWindow, this.chatSent] = [now + 1000, 0]
    if (this.chatSent++ < CHAT_UP_PER_SEC) this.sendUp(msg)
  }

  chat(ws, att, msg) {
    const now = Date.now()
    const text = clean(msg.text, LIMITS.CHAT_TEXT)
    const block = chatBlock(this.chatCfg, { status: this.snap?.st ?? 'scheduled', text, lastAt: att.chatAt, now })
    if (block) return ws.send(JSON.stringify({ t: 'chatno', ...block }))
    ws.serializeAttachment({ ...att, chatAt: now })
    const k = att.buyer.slice(0, 12) // author key: lets the shop ban a person without learning who they are
    const m = { id: crypto.randomUUID().slice(0, 12), n: clean(msg.name, LIMITS.CHAT_NAME) || 'anon', x: text, at: now, k }
    const local = JSON.stringify({ t: 'chat', c: [m] })
    if (this.bans.has(k)) return ws.send(local) // shadow ban: they see themselves, nobody else does
    for (const v of this.ctx.getWebSockets(VIEWER)) {
      try { v.send(local) } catch { /* closing socket */ }
    }
    this.chatUp({ t: 'chat', m })
  }

  // ── buying ──

  async buy(ws, att, { qty, variant, ts }) {
    const reply = (r) => ws.send(JSON.stringify({ t: 'buy', ...r }))
    if (att.hold && att.hold.expiresAt > Date.now()) return reply({ ok: true, ...att.hold })
    if (!Number.isInteger(qty) || qty < 1) return reply({ ok: false, reason: 'limit' })
    if (variant !== undefined && typeof variant !== 'string') return reply({ ok: false, reason: 'variant' })
    // the room's clock decides the opening instant: a stale "scheduled" snapshot past start time goes through
    const opening = this.snap?.st === 'scheduled' && Date.now() >= this.snap.at
    if (this.snap && this.snap.st !== 'live' && !opening) return reply({ ok: false, reason: this.snap.st })
    const left = this.snap ? (variant && this.snap.va ? this.snap.va[variant] ?? 0 : this.snap.a) : Infinity
    if (left < qty) return reply({ ok: false, reason: 'claimed' })
    if (this.inflight >= MAX_INFLIGHT) return reply({ ok: false, reason: 'busy' })

    if (!att.human) {
      if (!(await isHuman(this.env, ts))) return reply({ ok: false, reason: 'challenge' })
      att = { ...ws.deserializeAttachment(), human: true }
      ws.serializeAttachment(att)
    }

    this.inflight++
    try {
      const room = this.room()
      const r = await room.reserve(qty, att.buyer, variant)
      if (!r.ok) return reply(r)
      let session
      try {
        session = await createCheckout(this.env, r.checkout, r.hold)
      } catch (err) {
        console.error('checkout failed', err)
        await room.cancel(r.hold.id)
        return reply({ ok: false, reason: 'payment' })
      }
      if (!(await room.attach(r.hold.id, session.id))) {
        await expireCheckout(this.env, session.id)
        return reply({ ok: false, reason: 'expired' })
      }
      const hold = { id: r.hold.id, qty: r.hold.qty, variant: r.hold.variant, url: session.url, expiresAt: r.hold.expiresAt }
      ws.serializeAttachment({ ...ws.deserializeAttachment(), hold })
      reply({ ok: true, ...hold })
    } finally {
      this.inflight--
    }
  }
}
