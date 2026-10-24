import { describe, expect, it } from 'vitest'
import { Inventory } from '../worker/inventory.js'
import { memorySql } from './sqlite.js'

const T0 = 1_800_000_000_000
const MIN = 60_000
const config = (o = {}) => {
  const c = { published: true, startsAt: T0, endsAt: null, totalStock: 100, maxPerOrder: 2, holdMinutes: 10, chat: true, ...o }
  c.variants ??= [{ id: 'one', stock: c.totalStock }]
  return c
}
const fresh = (o) => {
  const inv = new Inventory(memorySql())
  inv.configure(config(o))
  return inv
}
let n = 0
const uid = () => `h${n++}`

describe('Inventory', () => {
  it('refuses sales before the drop and after it ends', () => {
    const inv = fresh({ endsAt: T0 + 60 * MIN })
    expect(inv.reserve(1, 'a', T0 - 1, uid())).toEqual({ ok: false, reason: 'scheduled' })
    expect(inv.reserve(1, 'a', T0, uid()).ok).toBe(true)
    expect(inv.reserve(1, 'b', T0 + 60 * MIN, uid())).toEqual({ ok: false, reason: 'ended' })
  })

  it('refuses unpublished drops', () => {
    expect(fresh({ published: false }).reserve(1, 'a', T0, uid()).reason).toBe('draft')
  })

  it('enforces the per-person limit across holds', () => {
    const inv = fresh()
    expect(inv.reserve(2, 'a', T0, uid()).ok).toBe(true)
    expect(inv.reserve(1, 'a', T0, uid()).reason).toBe('limit')
    expect(inv.reserve(3, 'b', T0, uid()).reason).toBe('limit')
    expect(inv.reserve(0, 'b', T0, uid()).reason).toBe('limit')
    expect(inv.reserve(1.5, 'b', T0, uid()).reason).toBe('limit')
  })

  it('expired holds go back on the shelf, and close their sessions', () => {
    const inv = fresh({ totalStock: 1 })
    const r = inv.reserve(1, 'a', T0, uid())
    inv.attach(r.hold.id, 'cs_1')
    expect(inv.reserve(1, 'b', T0, uid()).reason).toBe('claimed')
    expect(inv.nextWake(T0)).toBe(T0 + 10 * MIN)
    expect(inv.expire(T0 + 10 * MIN)).toEqual([{ id: r.hold.id, qty: 1, session: 'cs_1' }])
    expect(inv.available).toBe(1)
    expect(inv.attach(r.hold.id, 'cs_1')).toBe(false)
  })

  it('completes idempotently and honors late payments only from free stock', () => {
    const inv = fresh({ totalStock: 2, maxPerOrder: 1 })
    const a = inv.reserve(1, 'a', T0, uid())
    expect(inv.complete('cs_a', a.hold.id, 1, T0)).toEqual({ ok: true, qty: 1, variant: 'one' })
    expect(inv.complete('cs_a', a.hold.id, 1, T0)).toEqual({ ok: true, duplicate: true })
    expect(inv.sold).toBe(1)

    const late = inv.reserve(1, 'b', T0, uid())
    inv.expire(T0 + 10 * MIN)
    const c = inv.reserve(1, 'c', T0 + 10 * MIN, uid())
    expect(c.ok).toBe(true)
    expect(inv.complete('cs_b', late.hold.id, 1, T0)).toEqual({ ok: false, reason: 'oversold' })
    expect(inv.complete('cs_c', c.hold.id, 1, T0)).toEqual({ ok: true, qty: 1, variant: 'one' })
    expect(inv.status(T0 + 11 * MIN)).toBe('sold_out')
    expect(inv.soldOutAt).toBe(T0)
  })

  it('never lets stock shrink under sold + held', () => {
    const inv = fresh({ totalStock: 3 })
    inv.reserve(2, 'a', T0, uid())
    expect(inv.configure(config({ totalStock: 1 })).ok).toBe(false)
    expect(inv.configure(config({ totalStock: 2 })).ok).toBe(true)
    expect(inv.available).toBe(0)
    expect(inv.configure(config({ totalStock: 2, variants: [{ id: 'other', stock: 2 }] })).ok).toBe(false)
  })

  it('keeps stock per variant: one size selling out leaves the others', () => {
    const sizes = [{ id: 's', stock: 1 }, { id: 'm', stock: 2 }]
    const inv = fresh({ totalStock: 3, maxPerOrder: 1, variants: sizes })
    expect(inv.reserve(1, 'a', T0, uid(), 's').ok).toBe(true)
    expect(inv.reserve(1, 'b', T0, uid(), 's').reason).toBe('claimed')
    expect(inv.reserve(1, 'b', T0, uid(), 'xl').reason).toBe('variant')
    const m = inv.reserve(1, 'b', T0, uid(), 'm')
    expect(inv.snapshot(T0).va).toEqual({ s: 0, m: 1 })
    expect(inv.complete('cs_m', m.hold.id, 1, T0)).toEqual({ ok: true, qty: 1, variant: 'm' })
    expect(inv.complete('cs_late', 'gone', 1, T0, 's')).toEqual({ ok: false, reason: 'oversold' })
    expect([inv.sold, inv.held, inv.available]).toEqual([1, 1, 1])
  })

  it('upgrades a room created before variants existed', () => {
    const sql = memorySql()
    sql.exec(`CREATE TABLE holds (id TEXT PRIMARY KEY, qty INTEGER NOT NULL, buyer TEXT NOT NULL, session TEXT, expires_at INTEGER NOT NULL)`)
    sql.exec(`CREATE TABLE sales (session TEXT PRIMARY KEY, qty INTEGER NOT NULL, at INTEGER NOT NULL)`)
    sql.exec(`INSERT INTO sales (session, qty, at) VALUES ('old', 3, 1)`)
    const inv = new Inventory(sql)
    expect(inv.soldBy).toEqual({ one: 3 })
  })

  it('tracks the peak crowd', () => {
    const inv = fresh()
    inv.notePeak(10)
    inv.notePeak(4)
    expect(inv.peak).toBe(10)
  })

  it('survives a restart (state rebuilt from SQLite)', () => {
    const sql = memorySql()
    const inv = new Inventory(sql)
    inv.configure(config({ totalStock: 10 }))
    const h = inv.reserve(2, 'a', T0, uid())
    inv.complete('cs', h.hold.id, 2, T0)
    inv.reserve(1, 'b', T0, uid())
    const again = new Inventory(sql)
    expect([again.sold, again.held, again.available]).toEqual([2, 1, 7])
  })

  it('battle: 50k random buyers, expiries and payments never oversell', () => {
    const STOCK = 1000
    const SIZES = ['s', 'm', 'l', 'xl']
    const inv = fresh({ totalStock: STOCK, maxPerOrder: 3, holdMinutes: 2, variants: SIZES.map((id) => ({ id, stock: STOCK / 4 })) })
    const open = []
    let now = T0
    let rand = 42
    const rnd = () => ((rand = (rand * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)

    for (let i = 0; i < 50_000; i++) {
      now += Math.floor(rnd() * 50)
      const roll = rnd()
      if (roll < 0.6) {
        const r = inv.reserve(1 + Math.floor(rnd() * 3), `b${Math.floor(rnd() * 20_000)}`, now, uid(), SIZES[Math.floor(rnd() * 4)])
        if (r.ok) open.push(r.hold)
      } else if (roll < 0.85 && open.length) {
        const h = open.splice(Math.floor(rnd() * open.length), 1)[0]
        inv.complete(`cs_${h.id}`, h.id, h.qty, now)
      } else if (roll < 0.9 && open.length) {
        inv.release(open.pop().id)
      } else {
        inv.expire(now)
      }
      expect(inv.sold + inv.held + inv.available).toBe(STOCK)
      for (const v of SIZES) expect((inv.soldBy[v] ?? 0) + (inv.heldBy[v] ?? 0)).toBeLessThanOrEqual(STOCK / 4)
    }
    expect(inv.sold).toBeGreaterThan(STOCK * 0.9)
  })
})
