// DemoDrop: a scripted drop for the landing page. Same shape the real LiveDrop exposes (state, shown, marks), so the
// landing page renders it with the real StockBar and Countdown. Loops: mystery countdown -> reveal -> sellout -> reset.

const TOTAL = 100
const COUNTDOWN_MS = 7000
const SOLD_OUT_HOLD_MS = 3500
const TICK_MS = 250
const MARK_LIFE_MS = 900
const CROWD_BASE = 18_400_000
const CROWD_JITTER = 90_000

export class DemoDrop {
  /** @type {{ st: string, a: number, s: number, T: number, at: number, end: null, v: number }} */
  state = $state({ st: 'scheduled', a: TOTAL, s: 0, T: TOTAL, at: 0, end: null, v: CROWD_BASE })
  shown = $state(TOTAL)
  /** @type {{ id: number, n: number, back?: boolean }[]} */
  marks = $state([])
  revealed = $state(false)

  #timer = null
  #markId = 0
  #soldAt = 0

  constructor() {
    this.#reset()
    this.#timer = setInterval(() => this.#tick(), TICK_MS)
  }

  now() {
    return Date.now()
  }

  close() {
    clearInterval(this.#timer)
  }

  #reset() {
    this.state = { st: 'scheduled', a: TOTAL, s: 0, T: TOTAL, at: Date.now() + COUNTDOWN_MS, end: null, v: CROWD_BASE }
    this.shown = TOTAL
    this.revealed = false
  }

  #tick() {
    const now = Date.now()
    const s = this.state
    const v = CROWD_BASE + Math.round((Math.random() - 0.3) * CROWD_JITTER)
    if (s.st === 'scheduled') {
      this.state = { ...s, v }
      if (now < s.at) return
      this.revealed = true
      this.state = { ...this.state, st: 'live' }
      return
    }
    if (s.st === 'sold_out') {
      if (now - this.#soldAt > SOLD_OUT_HOLD_MS) this.#reset()
      return
    }
    // live: a burst, like the first seconds of a real drop
    const sold = Math.min(s.a, 1 + Math.floor(Math.random() * 4))
    const a = s.a - sold
    this.state = { ...s, a, s: s.s + sold, v, st: a === 0 ? 'sold_out' : 'live' }
    if (a === 0) this.#soldAt = now
    for (let i = 0; i < sold; i++) {
      setTimeout(() => {
        this.shown = Math.max(this.state.a, this.shown - 1)
        this.#mark()
      }, (i * TICK_MS) / sold)
    }
  }

  #mark() {
    const id = ++this.#markId
    this.marks.push({ id, n: 1 })
    setTimeout(() => (this.marks = this.marks.filter((m) => m.id !== id)), MARK_LIFE_MS)
  }
}
