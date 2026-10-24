import { dropStatus, STATUS } from '../shared/drop.js'

// Atomic inventory for one drop, on the Durable Object's embedded SQLite.
// Every method is synchronous: no await between check and write, so the DO's single thread makes it atomic.
// Stock math: available = total - sold - held. A hold is a unit parked while its buyer is in Stripe Checkout.

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
    const row = sql.exec(`SELECT v FROM kv WHERE k = 'config'`).toArray()[0]
    /** @type {any} */
    this.config = row ? JSON.parse(row.v) : null
    this.sold = sql.exec(`SELECT COALESCE(SUM(qty), 0) AS n FROM sales`).one().n
    this.held = sql.exec(`SELECT COALESCE(SUM(qty), 0) AS n FROM holds`).one().n
  }

  get available() {
    return this.config ? Math.max(0, this.config.totalStock - this.sold - this.held) : 0
  }

  status(now) {
    return this.config ? dropStatus(this.config, this.sold, now) : STATUS.DRAFT
  }

  /** Public numbers every viewer sees. */
  snapshot(now) {
    const c = this.config ?? {}
    return { st: this.status(now), a: this.available, s: this.sold, T: c.totalStock ?? 0, at: c.startsAt ?? 0, end: c.endsAt ?? null }
  }

  /** Replace the drop config. Stock can never drop below what is already sold or held. */
  configure(config) {
    if (config.totalStock < this.sold + this.held) {
      return { ok: false, reason: `Stock can't go below ${this.sold + this.held} (sold + in checkout)` }
    }
    this.config = config
    this.sql.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('config', ?)`, JSON.stringify(config))
    return { ok: true }
  }

  /**
   * Park units for a buyer while they pay.
   * @param {number} qty
   * @param {string} buyer opaque per-person key (hashed IP)
   * @param {number} now
   * @param {string} id hold id
   */
  reserve(qty, buyer, now, id) {
    const c = this.config
    if (this.status(now) !== STATUS.LIVE) return { ok: false, reason: this.status(now) }
    if (!(Number.isInteger(qty) && qty >= 1 && qty <= c.maxPerOrder)) return { ok: false, reason: 'limit' }
    const mine = this.sql.exec(`SELECT COALESCE(SUM(qty), 0) AS n FROM holds WHERE buyer = ?`, buyer).one().n
    if (mine + qty > c.maxPerOrder) return { ok: false, reason: 'limit' }
    if (this.available < qty) return { ok: false, reason: 'claimed' }

    const expiresAt = now + c.holdMinutes * MS_PER_MIN
    this.sql.exec(`INSERT INTO holds (id, qty, buyer, expires_at) VALUES (?, ?, ?, ?)`, id, qty, buyer, expiresAt)
    this.held += qty
    return { ok: true, hold: { id, qty, expiresAt } }
  }

  /** Link a hold to its Stripe Checkout session. False if the hold already expired. */
  attach(id, session) {
    this.sql.exec(`UPDATE holds SET session = ? WHERE id = ?`, session, id)
    return this.sql.exec(`SELECT COUNT(*) AS n FROM holds WHERE id = ?`, id).one().n === 1
  }

  /** Put a hold's units back on the shelf. Returns the hold, or null if it was already gone. */
  release(id) {
    const hold = this.sql.exec(`SELECT id, qty, session FROM holds WHERE id = ?`, id).toArray()[0]
    if (!hold) return null
    this.sql.exec(`DELETE FROM holds WHERE id = ?`, id)
    this.held -= hold.qty
    return hold
  }

  /**
   * Payment landed. Idempotent per Stripe session. If the hold already expired the sale is honored from
   * free stock; if there is none left the caller must refund.
   */
  complete(session, holdId, qty, now) {
    if (this.sql.exec(`SELECT COUNT(*) AS n FROM sales WHERE session = ?`, session).one().n) return { ok: true, duplicate: true }
    const hold = this.release(holdId)
    const units = hold ? hold.qty : qty
    if (!hold && this.available < units) return { ok: false, reason: 'oversold' }
    this.sql.exec(`INSERT INTO sales (session, qty, at) VALUES (?, ?, ?)`, session, units, now)
    this.sold += units
    return { ok: true, qty: units }
  }

  /** Drop every hold past its deadline. Returns them so their Checkout sessions can be closed. */
  expire(now) {
    const due = this.sql.exec(`SELECT id, qty, session FROM holds WHERE expires_at <= ?`, now).toArray()
    for (const h of due) this.release(h.id)
    return due
  }

  /** Next moment something changes on its own: a hold expiring, the drop opening or closing. */
  nextWake(now) {
    const hold = this.sql.exec(`SELECT MIN(expires_at) AS t FROM holds`).one().t
    const c = this.config ?? {}
    const times = [hold, c.startsAt, c.endsAt].filter((t) => t && t > now)
    return times.length ? Math.min(...times) : null
  }
}
