import { DurableObject } from 'cloudflare:workers'
import { LIMITS } from '../shared/drop.js'
import { Inventory } from './inventory.js'
import { expireCheckout } from './stripe.js'

// DropRoom: one per drop, the single source of truth for stock. It never talks to viewers directly; it streams
// state to at most BRANCH Fanout children (see tree.js), so its load is flat whether 50 or 20M people watch.

const TICK_MS = 250 // stock + chat broadcast cadence: sales batch into ticks, clients replay them as one ding per unit
const VIEWERS_MS = 1000 // viewer count cadence
const CHAT_PER_TICK = 12 // global chat budget; past this, messages still reach their own shard of the crowd
const MAX_BANS = 5000
const CHILD = 'child'

export class DropRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.inv = new Inventory(ctx.storage.sql)
    /** @type {string[]} chat authors (hashed keys) silenced by the shop */
    this.bans = this.inv.get('bans') ?? []
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
    if (this.bans.length) server.send(JSON.stringify({ t: 'mod', ban: this.bans }))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, raw) {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    if (msg.t === 'n' && Number.isSafeInteger(msg.n) && msg.n >= 0) {
      ws.serializeAttachment({ n: msg.n })
      return this.schedule(VIEWERS_MS)
    }
    if (msg.t === 'chat' && msg.m && !this.bans.includes(msg.m.k) && this.chat.length < CHAT_PER_TICK) {
      this.chat.push(msg.m)
      this.schedule(TICK_MS)
    }
  }

  async webSocketClose() {
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

  /** Shard count for the live router when the KV copy hasn't propagated yet. Null = not published. */
  meta() {
    return this.inv.config?.published ? { shards: this.inv.config.shards } : null
  }

  reserve(qty, buyer, variant) {
    const r = this.inv.reserve(qty, buyer, Date.now(), crypto.randomUUID(), variant)
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

  complete(session, holdId, qty, variant) {
    const r = this.inv.complete(session, holdId, qty, Date.now(), variant)
    if (r.ok && !r.duplicate) this.changed()
    return r
  }

  /** Dashboard numbers. */
  state() {
    return { ...this.inv.snapshot(Date.now()), v: this.viewers(), held: this.inv.held, peak: this.inv.peak, soldOutAt: this.inv.soldOutAt }
  }

  /** Erase a drop that never sold anything. False if it has sales or open holds. */
  async wipe() {
    if (this.inv.sold || this.inv.held) return false
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'deleted')
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    return true
  }

  // ── moderation (shop owner) ──

  /** Delete messages and/or silence their authors, everywhere in the tree. */
  moderate({ del = [], ban = [] }) {
    const fresh = ban.filter((k) => typeof k === 'string' && !this.bans.includes(k))
    if (fresh.length) {
      this.bans = [...this.bans, ...fresh].slice(-MAX_BANS)
      this.inv.put('bans', this.bans)
    }
    this.chat = this.chat.filter((m) => !del.includes(m.id) && !fresh.includes(m.k))
    this.broadcast(JSON.stringify({ t: 'mod', del: del.slice(0, 100), ban: fresh }))
  }

  /** The shop speaks: skips the budget, wears a host badge. */
  say(name, text) {
    const x = String(text ?? '').trim().slice(0, LIMITS.CHAT_TEXT)
    if (!x) return
    this.chat.unshift({ id: crypto.randomUUID().slice(0, 12), n: String(name).slice(0, LIMITS.CHAT_NAME), x, at: Date.now(), host: true })
    this.schedule(0)
  }

  // ── broadcast ──

  viewers() {
    let n = 0
    for (const ws of this.ctx.getWebSockets(CHILD)) n += ws.deserializeAttachment()?.n ?? 0
    return n
  }

  message(chat) {
    const v = this.viewers()
    this.inv.notePeak(v)
    return JSON.stringify({ t: 'state', ...this.inv.snapshot(Date.now()), ch: this.inv.config?.chat ?? false, v, c: chat.length ? chat : undefined })
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
    this.broadcast(this.message(this.chat.splice(0)))
  }

  broadcast(data) {
    for (const ws of this.ctx.getWebSockets(CHILD)) {
      try { ws.send(data) } catch { /* closing socket */ }
    }
  }
}
