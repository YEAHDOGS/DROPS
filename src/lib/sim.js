// SimSocket: the whole drop room, simulated in the browser, behind a WebSocket-shaped object. The demo hands it to
// the real LiveDrop client, so countdown, reveal, hitmarkers, chat rules and the buy flow run the production code.
// Nothing touches the network, nothing costs anything, nothing can be abused.
import { chatBlock, chatConfig } from '../../shared/chat.js'
import { publicProduct } from '../../shared/drop.js'

const TICK_MS = 250
const VIEWER_EVERY_MS = 1000
const OPEN = 1
const CLOSED = 3
const SELL_OUT_TICKS = 70 // about 18 seconds of frenzy, whatever the stock
const CROWD_START = 40_000
const CROWD_PEAK = 1_350_000
const BOT_CHAT_EVERY_MS = 900
const BOT_NAMES = ['kidA', 'dogwalker', 'nightdrive', 'hitmarker', 'vinylhead', 'fleas', 'lottoscratch', 'sailor', 'bark', 'drumline', 'treehouse', 'birdbrain']
const BOT_LINES = {
  before: ['who else is here early', 'my alarm went off 10 min ago lol', 'refreshing is for amateurs', 'countdown hitting different', 'what do we think it is', 'hands ready'],
  live: ['GO GO GO', 'got one!!!', 'lets gooo', 'missed it by a second', 'hitmarkers everywhere', 'its moving so fast', 'W drop', 'secured'],
  after: ['gg', 'sold out in seconds', 'next one when', 'see you next drop', 'that was insane'],
}

const pick = (a) => a[Math.floor(Math.random() * a.length)]

/** Default demo: a mystery sticker drop, three options, opening in a few seconds. */
export const DEMO_DEFAULTS = {
  shop: 'DOGS',
  title: 'Made by DOGS sticker pack',
  description: 'Three stickers. Weatherproof. Signed by the dogs.',
  priceCents: 900,
  currency: 'usd',
  variants: [{ id: 'small', label: 'Small', stock: 60 }, { id: 'medium', label: 'Medium', stock: 80 }, { id: 'large', label: 'Large', stock: 60 }],
  maxPerOrder: 2,
  mystery: true,
  teaser: 'Something sticky is coming. 200 made.',
  startsInSec: 10,
  media: [],
  chat: { mode: 'open', slowSec: 2, whenLive: false, links: false, maxLen: 140 },
  accent: null,
}

export class SimSocket {
  readyState = 0
  onopen = null
  onmessage = null
  onclose = null

  /** @param {typeof DEMO_DEFAULTS} cfg */
  constructor(cfg) {
    const now = Date.now()
    this.cfg = { ...cfg, chat: chatConfig(cfg.chat) }
    this.stock = Object.fromEntries(cfg.variants.map((v) => [v.id, v.stock]))
    this.total = cfg.variants.reduce((a, v) => a + v.stock, 0)
    this.sold = 0
    this.mine = 0 // units the visitor bought
    this.at = cfg.startsAt ?? now + cfg.startsInSec * 1000
    this.st = 'scheduled'
    this.viewers = CROWD_START
    this.lastViewerAt = 0
    this.lastBotChatAt = 0
    this.revealed = false
    this.lastChatAt = 0
    this.timers = [setTimeout(() => this.#open(), 120)]
  }

  send(raw) {
    const m = JSON.parse(raw)
    if (m.t === 'ping') return this.#emit({ t: 'pong', c: m.c, s: Date.now() })
    if (m.t === 'chat') return this.#chat(m)
    if (m.t === 'buy') return this.#buy(m)
  }

  close() {
    for (const t of this.timers) clearTimeout(t)
    clearInterval(this.ticker)
    this.readyState = CLOSED
  }

  /** The visitor finished the demo checkout. */
  pay(qty) {
    this.sold += qty
    this.mine += qty
    this.#state()
  }

  /** The visitor backed out of the demo checkout: the units go back on the shelf. */
  release(qty, variant) {
    this.stock[variant] += qty
    this.#state()
  }

  // ── room ──

  #emit(msg) {
    if (this.readyState !== OPEN) return
    this.timers.push(setTimeout(() => this.onmessage?.({ data: JSON.stringify(msg) }), 0))
  }

  #left(id) {
    return id ? this.stock[id] ?? 0 : Object.values(this.stock).reduce((a, b) => a + b, 0)
  }

  #state(chat) {
    const va = this.cfg.variants.length > 1 ? { ...this.stock } : undefined
    this.#emit({ t: 'state', st: this.st, a: this.#left(), s: this.sold, T: this.total, at: this.at, end: null, v: this.viewers, va, c: chat })
  }

  #open() {
    this.readyState = OPEN
    this.onopen?.()
    this.#emit({ t: 'cfg', chat: this.cfg.chat, mystery: this.cfg.mystery })
    this.#state()
    if (!this.cfg.mystery) this.#emit({ t: 'product', p: publicProduct(this.cfg) })
    this.ticker = setInterval(() => this.#tick(), TICK_MS)
  }

  #tick() {
    const now = Date.now()
    const phase = this.st === 'scheduled' ? 'before' : this.st === 'live' ? 'live' : 'after'
    this.viewers = Math.round(this.viewers + (CROWD_PEAK - this.viewers) * (phase === 'before' ? 0.04 : 0.01) + (Math.random() - 0.5) * 2000)
    const chat = now - this.lastBotChatAt > BOT_CHAT_EVERY_MS * (0.5 + Math.random()) && this.cfg.chat.mode === 'open' ? [this.#botLine(phase, now)] : undefined
    if (chat) this.lastBotChatAt = now

    if (this.st === 'scheduled' && now >= this.at) {
      this.st = 'live'
      if (this.cfg.mystery) this.#emit({ t: 'product', p: publicProduct(this.cfg) })
    }
    if (this.st === 'live') this.#botsBuy()
    if (this.st === 'live' && this.#left() === 0) this.st = 'sold_out'

    if (chat || this.st === 'live' || now - this.lastViewerAt > VIEWER_EVERY_MS) {
      this.lastViewerAt = now
      this.#state(chat)
    }
  }

  #botLine(phase, now) {
    return { id: Math.random().toString(36).slice(2, 14), n: pick(BOT_NAMES), x: pick(BOT_LINES[phase]), at: now }
  }

  #botsBuy() {
    const perTick = Math.max(1, Math.ceil(this.total / SELL_OUT_TICKS))
    const units = Math.floor(Math.random() * perTick * 2)
    for (let i = 0; i < units; i++) {
      const open = Object.keys(this.stock).filter((id) => this.stock[id] > 0)
      if (!open.length) return
      this.stock[pick(open)]--
      this.sold++
    }
  }

  // ── visitor ──

  #chat(m) {
    const text = String(m.text ?? '').trim()
    const block = chatBlock(this.cfg.chat, { status: this.st, text, lastAt: this.lastChatAt, now: Date.now() })
    if (block) return this.#emit({ t: 'chatno', ...block })
    this.lastChatAt = Date.now()
    this.#emit({ t: 'chat', c: [{ id: Math.random().toString(36).slice(2, 14), n: String(m.name || 'you').slice(0, 24), x: text, at: Date.now() }] })
  }

  #buy({ qty, variant }) {
    const reply = (r) => this.#emit({ t: 'buy', ...r })
    const id = variant ?? this.cfg.variants[0].id
    if (this.st === 'scheduled') return reply({ ok: false, reason: 'scheduled' })
    if (this.st !== 'live') return reply({ ok: false, reason: this.st })
    if (this.mine + qty > this.cfg.maxPerOrder) return reply({ ok: false, reason: 'limit' })
    if ((this.stock[id] ?? 0) < qty) return reply({ ok: false, reason: 'claimed' })
    this.stock[id] -= qty // held for the visitor while they "pay"
    this.#state()
    reply({ ok: true, id: 'demo-hold', qty, variant: id, url: 'demo:checkout', expiresAt: Date.now() + 600_000 })
  }
}
