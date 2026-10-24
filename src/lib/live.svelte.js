// LiveDrop: one viewer's connection to a drop. Reconnects with jittered backoff (a 20M crowd must never reconnect in
// lockstep), syncs the clock to the edge NTP-style, and turns each stock tick into one hitmarker per unit.

const TICK_MS = 250 // matches the room's broadcast cadence: dings are spread across it
const MAX_MARKS_PER_TICK = 24 // past this a tick shows one big "-N" instead of a storm
const MARK_LIFE_MS = 900
const CHAT_KEEP = 150
const PING_EVERY_MS = 30_000
const BACKOFF_MIN_MS = 500
const BACKOFF_MAX_MS = 15_000
const BUSY_RETRY_MS = [120, 480] // leaf is saturated: retry inside this jitter window
const BUSY_MAX_TRIES = 80
const EARLY_CLICK_MS = 500 // clicks this close to the start time retry instead of failing

/** @typedef {{ st: string, a: number, s: number, T: number, at: number, end: number|null, ch: boolean, v: number, va?: Record<string, number> }} DropState */
/** @typedef {{ id: string, n: string, x: string, at: number, k?: string, host?: boolean }} ChatMessage */

export class LiveDrop {
  /** @type {DropState|null} */
  state = $state(null)
  shown = $state(0) // stock as displayed: steps down one unit per ding
  /** @type {{ id: number, n: number, back?: boolean }[]} */
  marks = $state([])
  /** @type {ChatMessage[]} */
  chat = $state([])
  connected = $state(false)
  /** @type {{ phase: 'idle'|'trying'|'held'|'refused', reason?: string, url?: string, expiresAt?: number }} */
  buying = $state({ phase: 'idle' })
  offset = $state(0) // server clock - local clock
  /** @type {{ chat: ReturnType<typeof import('../../shared/chat.js').chatConfig> | null, mystery: boolean } | null} rules from the room */
  cfg = $state(null)
  /** @type {any} product pushed by the room: instant edits, and the mystery reveal */
  product = $state(null)
  /** @type {{ reason: string, wait?: number, at: number } | null} why the last chat message didn't post */
  chatNo = $state(null)

  #url
  #ws = null
  #closed = false
  #backoff = BACKOFF_MIN_MS
  #rtt = Infinity
  #seen = new Set()
  #markId = 0
  #timers = new Set()
  #tries = 0
  #qty = 1
  #variant = undefined
  #pending = []
  #token = null // Turnstile pass, spent on the first buy of each socket
  #awaitingToken = false
  /** @type {(() => void) | null} */
  onDing = null
  /** Called when the edge asks for a fresh Turnstile pass. @type {(() => void) | null} */
  onChallenge = null

  /** @param {string} dropId */
  constructor(dropId) {
    this.#url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/${dropId}`
    this.#connect()
  }

  now() {
    return Date.now() + this.offset
  }

  close() {
    this.#closed = true
    this.#ws?.close()
    for (const t of this.#timers) clearTimeout(t)
  }

  /** @param {number} qty @param {string} [variant] */
  buy(qty = 1, variant = undefined) {
    if (this.buying.phase === 'trying') return
    if (this.buying.phase === 'held' && this.buying.url) return void location.assign(this.buying.url)
    this.#tries = 0
    this.#qty = qty
    this.#variant = variant
    this.buying = { phase: 'trying' }
    this.#sendBuy()
  }

  /** Hand over a Turnstile pass; resumes a buy that was waiting on one. @param {string} token */
  setToken(token) {
    this.#token = token
    if (!this.#awaitingToken) return
    this.#awaitingToken = false
    this.#sendBuy()
  }

  #sendBuy() {
    this.#send({ t: 'buy', qty: this.#qty, variant: this.#variant, ts: this.#token ?? undefined })
  }

  /** @param {string} name @param {string} text */
  say(name, text) {
    this.#send({ t: 'chat', name, text })
  }

  /** Give back a hold after leaving Checkout. @param {string} holdId */
  cancel(holdId) {
    this.#pending.push({ t: 'cancel', id: holdId })
    this.#flush()
  }

  // ── socket ──

  #send(msg) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(msg))
  }

  #flush() {
    while (this.#ws?.readyState === WebSocket.OPEN && this.#pending.length) this.#send(this.#pending.shift())
  }

  #later(fn, ms) {
    const t = setTimeout(() => {
      this.#timers.delete(t)
      fn()
    }, ms)
    this.#timers.add(t)
  }

  #connect() {
    if (this.#closed) return
    const ws = new WebSocket(this.#url)
    this.#ws = ws
    ws.onopen = () => {
      this.connected = true
      this.#backoff = BACKOFF_MIN_MS
      this.#ping()
      this.#flush()
    }
    ws.onmessage = (e) => this.#receive(JSON.parse(e.data))
    ws.onclose = () => {
      this.connected = false
      if (this.buying.phase === 'trying') this.buying = { phase: 'idle' }
      const wait = this.#backoff * (0.5 + Math.random())
      this.#backoff = Math.min(this.#backoff * 2, BACKOFF_MAX_MS)
      this.#later(() => this.#connect(), wait)
    }
  }

  #ping() {
    if (this.#closed || this.#ws?.readyState !== WebSocket.OPEN) return
    this.#send({ t: 'ping', c: Date.now() })
    this.#later(() => this.#ping(), this.#rtt === Infinity ? 1000 : PING_EVERY_MS)
  }

  #receive(m) {
    if (m.t === 'state') return this.#onState(m)
    if (m.t === 'chat') return this.#onChat(m.c)
    if (m.t === 'buy') return this.#onBuy(m)
    if (m.t === 'cfg') return void (this.cfg = { chat: m.chat, mystery: m.mystery })
    if (m.t === 'product') return void (this.product = m.p)
    if (m.t === 'chatno') return void (this.chatNo = { reason: m.reason, wait: m.wait, at: Date.now() })
    if (m.t === 'mod' && m.del?.length) return void (this.chat = this.chat.filter((x) => !m.del.includes(x.id)))
    if (m.t === 'pong') {
      const rtt = Date.now() - m.c
      if (rtt > this.#rtt) return
      this.#rtt = rtt
      this.offset = m.s - (m.c + rtt / 2)
    }
  }

  /** @param {DropState & { t: string, c?: any[] }} m */
  #onState(m) {
    const prev = this.state
    const { t, c, ...state } = m
    this.state = state
    this.#onChat(c)
    if (!prev) return void (this.shown = state.a)

    const drop = this.shown - state.a
    if (drop < 0) {
      this.shown = state.a
      this.#mark(-drop, true)
    } else if (drop > MAX_MARKS_PER_TICK) {
      this.shown = state.a
      this.#mark(drop)
    } else {
      for (let i = 0; i < drop; i++) {
        this.#later(() => {
          this.shown = Math.max(this.state?.a ?? 0, this.shown - 1)
          this.#mark(1)
        }, (i * TICK_MS) / drop)
      }
    }
  }

  #mark(n, back = false) {
    const id = ++this.#markId
    this.marks.push({ id, n, back })
    if (!back) this.onDing?.()
    this.#later(() => (this.marks = this.marks.filter((x) => x.id !== id)), MARK_LIFE_MS)
  }

  #onChat(list) {
    if (!list?.length) return
    const fresh = list.filter((x) => !this.#seen.has(x.id))
    for (const x of fresh) this.#seen.add(x.id)
    if (fresh.length) this.chat = [...this.chat, ...fresh].slice(-CHAT_KEEP)
  }

  #onBuy(m) {
    if (m.ok) {
      this.buying = { phase: 'held', url: m.url, expiresAt: m.expiresAt }
      return void location.assign(m.url)
    }
    // clicked on the zero: the edge hadn't flipped yet, so try again in a beat
    const early = m.reason === 'scheduled' && this.state && this.now() >= this.state.at - EARLY_CLICK_MS
    if ((m.reason === 'busy' || early) && ++this.#tries < BUSY_MAX_TRIES) {
      const [lo, hi] = BUSY_RETRY_MS
      return this.#later(() => this.#sendBuy(), lo + Math.random() * (hi - lo))
    }
    if (m.reason === 'challenge' && this.onChallenge && ++this.#tries < BUSY_MAX_TRIES) {
      this.#token = null
      this.#awaitingToken = true
      return this.onChallenge()
    }
    this.buying = { phase: 'refused', reason: m.reason }
  }
}
