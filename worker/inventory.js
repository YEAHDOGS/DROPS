import { dropStatus, STATUS, DEFAULT_VARIANT } from '../shared/drop.js'

// Atomic inventory for one drop, on the Durable Object's embedded SQLite.
// Every method is synchronous: no await between check and write, so the DO's single thread makes it atomic.
// Stock is per variant (sizes, colors): available(v) = stock(v) - sold(v) - held(v).
// A hold is a unit parked while its buyer is in Stripe Checkout.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS holds (id TEXT PRIMARY KEY, qty INTEGER NOT NULL, buyer TEXT NOT NULL, session TEXT, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS holds_expires ON holds (expires_at)`,
  `CREATE INDEX IF NOT EXISTS holds_buyer ON holds (buyer)`,
  `CREATE TABLE IF NOT EXISTS sales (session TEXT PRIMARY KEY, qty INTEGER NOT NULL, at INTEGER NOT NULL)`,
]
const MS_PER_MIN = 60_000

/** @typedef {{ exec: (query: string, ...binds: any[]) => { toArray: () => any[], one: () => any } }} SqlStorage */

export class Inventory {
  /** @param {SqlStorage} sql */
  constructor(sql) {
    this.sql = sql
    for (const q of SCHEMA) sql.exec(q)
    // in-place upgrades for rooms created before a column existed
    const UPGRADES = [['holds', 'variant', `TEXT NOT NULL DEFAULT '${DEFAULT_VARIANT}'`], ['sales', 'variant', `TEXT NOT NULL DEFAULT '${DEFAULT_VARIANT}'`], ['sales', 'buyer', 'TEXT']]
    for (const [table, col, type] of UPGRADES) {
      const cols = sql.exec(`PRAGMA table_info(${table})`).toArray()
      if (!cols.some((c) => c.name === col)) sql.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
    }
    sql.exec(`CREATE INDEX IF NOT EXISTS sales_buyer ON sales (buyer)`)
    /** @type {any} */
    this.config = this.get('config')
    this.soldOutAt = this.get('soldOutAt')
    this.peak = this.get('peak') ?? 0
    this.soldBy = this.sums('sales')
    this.heldBy = this.sums('holds')
  }

  get(k) {
    const row = this.sql.exec(`SELECT v FROM kv WHERE k = ?`, k).toArray()[0]
    return row ? JSON.parse(row.v) : null
  }

  put(k, v) {
    this.sql.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)`, k, JSON.stringify(v))
  }

  sums(table) {
    const out = {}
    for (const r of this.sql.exec(`SELECT variant, SUM(qty) AS n FROM ${table} GROUP BY variant`).toArray()) out[r.variant] = r.n
    return out
  }

  get variants() {
    return this.config?.variants ?? []
  }

  get sold() {
    return Object.values(this.soldBy).reduce((a, b) => a + b, 0)
  }

  get held() {
    return Object.values(this.heldBy).reduce((a, b) => a + b, 0)
  }

  availableOf(id) {
    const v = this.variants.find((x) => x.id === id)
    return v ? Math.max(0, v.stock - (this.soldBy[id] ?? 0) - (this.heldBy[id] ?? 0)) : 0
  }

  get available() {
    return this.variants.reduce((sum, v) => sum + this.availableOf(v.id), 0)
  }

  status(now) {
    return this.config ? dropStatus(this.config, this.sold, now) : STATUS.DRAFT
  }

  /** Public numbers every viewer sees. `va` (stock per variant) only when there is more than one. */
  snapshot(now) {
    const c = this.config ?? {}
    const snap = { st: this.status(now), a: this.available, s: this.sold, T: c.totalStock ?? 0, at: c.startsAt ?? 0, end: c.endsAt ?? null }
    if (this.variants.length > 1) snap.va = Object.fromEntries(this.variants.map((v) => [v.id, this.availableOf(v.id)]))
    return snap
  }

  /** Replace the drop config. No variant's stock can drop below what is already sold or held of it. */
  configure(config) {
    const ids = new Set(config.variants.map((v) => v.id))
    for (const id of new Set([...Object.keys(this.soldBy), ...Object.keys(this.heldBy)])) {
      const used = (this.soldBy[id] ?? 0) + (this.heldBy[id] ?? 0)
      if (!used) continue
      if (!ids.has(id)) return { ok: false, reason: `A variant with ${used} sold or in checkout can't be removed` }
      const v = config.variants.find((x) => x.id === id)
      if (v.stock < used) return { ok: false, reason: `${v.label || 'Stock'} can't go below ${used} (sold + in checkout)` }
    }
    this.config = config
    this.put('config', config)
    return { ok: true }
  }

  /**
   * Park units for a buyer while they pay.
   * @param {number} qty
   * @param {string} buyer opaque per-person key (hashed IP)
   * @param {number} now
   * @param {string} id hold id
   * @param {string} [variant] defaults to the first variant
   */
  reserve(qty, buyer, now, id, variant = this.variants[0]?.id) {
    const c = this.config
    const status = this.status(now)
    if (status !== STATUS.LIVE) return { ok: false, reason: status }
    if (!this.variants.some((v) => v.id === variant)) return { ok: false, reason: 'variant' }
    if (!(Number.isInteger(qty) && qty >= 1 && qty <= c.maxPerOrder)) return { ok: false, reason: 'limit' }
    // the per-person limit counts what they hold AND what they already paid for
    const mine = this.sql.exec(`SELECT (SELECT COALESCE(SUM(qty), 0) FROM holds WHERE buyer = ?) + (SELECT COALESCE(SUM(qty), 0) FROM sales WHERE buyer = ?) AS n`, buyer, buyer).one().n
    if (mine + qty > c.maxPerOrder) return { ok: false, reason: 'limit' }
    if (this.availableOf(variant) < qty) return { ok: false, reason: 'claimed' }

    const expiresAt = now + c.holdMinutes * MS_PER_MIN
    this.sql.exec(`INSERT INTO holds (id, qty, buyer, expires_at, variant) VALUES (?, ?, ?, ?, ?)`, id, qty, buyer, expiresAt, variant)
    this.heldBy[variant] = (this.heldBy[variant] ?? 0) + qty
    return { ok: true, hold: { id, qty, variant, expiresAt } }
  }

  /** Link a hold to its Stripe Checkout session. False if the hold already expired. */
  attach(id, session) {
    this.sql.exec(`UPDATE holds SET session = ? WHERE id = ?`, session, id)
    return this.sql.exec(`SELECT COUNT(*) AS n FROM holds WHERE id = ?`, id).one().n === 1
  }

  /** Put a hold's units back on the shelf. Returns the hold, or null if it was already gone. */
  release(id) {
    const hold = this.sql.exec(`SELECT id, qty, session, variant, buyer FROM holds WHERE id = ?`, id).toArray()[0]
    if (!hold) return null
    this.sql.exec(`DELETE FROM holds WHERE id = ?`, id)
    this.heldBy[hold.variant] -= hold.qty
    return hold
  }

  /**
   * Payment landed. Idempotent per Stripe session. If the hold already expired the sale is honored from
   * free stock of the same variant; if there is none left the caller must refund.
   */
  complete(session, holdId, qty, now, variant = this.variants[0]?.id) {
    if (this.sql.exec(`SELECT COUNT(*) AS n FROM sales WHERE session = ?`, session).one().n) return { ok: true, duplicate: true }
    const hold = this.release(holdId)
    const units = hold ? hold.qty : qty
    const v = hold ? hold.variant : variant
    if (!hold && this.availableOf(v) < units) return { ok: false, reason: 'oversold' }
    this.sql.exec(`INSERT INTO sales (session, qty, at, variant, buyer) VALUES (?, ?, ?, ?, ?)`, session, units, now, v, hold?.buyer ?? null)
    this.soldBy[v] = (this.soldBy[v] ?? 0) + units
    if (!this.soldOutAt && this.sold >= (this.config?.totalStock ?? Infinity)) {
      this.soldOutAt = now
      this.put('soldOutAt', now)
    }
    return { ok: true, qty: units, variant: v }
  }

  /** Undo a sale (refunded over the limit): the units go back on the shelf. Returns units restocked. */
  unsell(session) {
    const sale = this.sql.exec(`SELECT qty, variant FROM sales WHERE session = ?`, session).toArray()[0]
    if (!sale) return 0
    this.sql.exec(`DELETE FROM sales WHERE session = ?`, session)
    this.soldBy[sale.variant] -= sale.qty
    return sale.qty
  }

  /** Drop every hold past its deadline. Returns them so their Checkout sessions can be closed. */
  expire(now) {
    const due = this.sql.exec(`SELECT id, qty, session FROM holds WHERE expires_at <= ?`, now).toArray()
    for (const h of due) this.release(h.id)
    return due
  }

  /** Remember the biggest crowd this drop has seen. */
  notePeak(viewers) {
    if (viewers <= this.peak) return
    this.peak = viewers
    this.put('peak', viewers)
  }

  /** Next moment something changes on its own: a hold expiring, the drop opening or closing. */
  nextWake(now) {
    const hold = this.sql.exec(`SELECT MIN(expires_at) AS t FROM holds`).one().t
    const c = this.config ?? {}
    const times = [hold, c.startsAt, c.endsAt].filter((t) => t && t > now)
    return times.length ? Math.min(...times) : null
  }
}
