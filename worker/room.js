import { DurableObject } from 'cloudflare:workers'
import { Inventory } from './inventory.js'
import { expireCheckout } from './stripe.js'

// DropRoom: one per drop, the single source of truth for stock. It never talks to viewers directly; it streams
// state to at most BRANCH Fanout children (see tree.js), so its load is flat whether 50 or 20M people watch.

const TICK_MS = 250 // stock + chat broadcast cadence: sales batch into ticks, clients replay them as one ding per unit
const VIEWERS_MS = 1000 // viewer count cadence
const CHAT_PER_TICK = 12 // global chat budget; past this, messages still reach their own shard of the crowd
const CHILD = 'child'

export class DropRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.inv = new Inventory(ctx.storage.sql)
    this.chat = []
    this.timer = null
    this.dueAt = 0
    this.alarmAt = null
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 })
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server, [CHILD])
    server.serializeAttachment({ n: 0 })
    server.send(this.message([]))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, raw) {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    if (msg.t === 'n' && Number.isSafeInteger(msg.n) && msg.n >= 0) {
      ws.serializeAttachment({ n: msg.n })
      return this.schedule(VIEWERS_MS)
    }
    if (msg.t === 'chat' && msg.m && this.chat.length < CHAT_PER_TICK) {
      this.chat.push(msg.m)
      this.schedule(TICK_MS)
    }
  }

  async webSocketClose(ws) {
    this.schedule(VIEWERS_MS)
  }

  async alarm() {
    const expired = this.inv.expire(Date.now())
    this.alarmAt = null
    this.changed()
    await Promise.all(expired.filter((h) => h.session).map((h) => expireCheckout(this.env, h.session)))
  }

  // ── RPC (called by the Worker and Fanout leaves) ──

  configure(config) {
    const r = this.inv.configure(config)
    if (r.ok) this.changed()
    return r
  }

  reserve(qty, buyer) {
    const r = this.inv.reserve(qty, buyer, Date.now(), crypto.randomUUID())
    if (!r.ok) return r
    this.changed()
    return { ...r, checkout: this.inv.config.checkout }
  }

  attach(holdId, session) {
    return this.inv.attach(holdId, session)
  }

  async cancel(holdId) {
    const hold = this.inv.release(holdId)
    if (!hold) return false
    this.changed()
    if (hold.session) await expireCheckout(this.env, hold.session)
    return true
  }

  complete(session, holdId, qty) {
    const r = this.inv.complete(session, holdId, qty, Date.now())
    if (r.ok && !r.duplicate) this.changed()
    return r
  }

  state() {
    return { ...this.inv.snapshot(Date.now()), v: this.viewers(), held: this.inv.held }
  }

  // ── broadcast ──

  viewers() {
    let n = 0
    for (const ws of this.ctx.getWebSockets(CHILD)) n += ws.deserializeAttachment()?.n ?? 0
    return n
  }

  message(chat) {
    return JSON.stringify({ t: 'state', ...this.inv.snapshot(Date.now()), ch: this.inv.config?.chat ?? false, v: this.viewers(), c: chat.length ? chat : undefined })
  }

  changed() {
    this.schedule(TICK_MS)
    const next = this.inv.nextWake(Date.now())
    if (next === this.alarmAt) return
    this.alarmAt = next
    if (next) this.ctx.storage.setAlarm(next)
    else this.ctx.storage.deleteAlarm()
  }

  /** Coalesce broadcasts: at most one per delay window, never later than the earliest request. */
  schedule(delay) {
    const due = Date.now() + delay
    if (this.timer && this.dueAt <= due) return
    clearTimeout(this.timer)
    this.dueAt = due
    this.timer = setTimeout(() => this.flush(), delay)
  }

  flush() {
    this.timer = null
    const data = this.message(this.chat.splice(0))
    for (const ws of this.ctx.getWebSockets(CHILD)) {
      try { ws.send(data) } catch { /* closing socket */ }
    }
  }
}
