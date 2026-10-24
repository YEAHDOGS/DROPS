import { stripe } from './stripe.js'
import { feeBps, feeFixed, platformFee } from './fees.js'

// Creator payouts for shops on "DOGS handles the money". Every paid order becomes one Stripe Transfer to the
// creator's connected account, tied to its charge (source_transaction) so it can go out before the funds settle,
// and keyed by order id so a retry can never pay twice. Stripe then moves it to their bank on their own schedule.

const BATCH = 40 // orders per run: two Stripe calls each, inside the Worker's subrequest budget
const HOUR_MS = 3_600_000

/** Money summary for the dashboard. */
export async function payoutSummary(env, mid) {
  const owed = await env.DB.prepare(`SELECT currency, COUNT(*) AS orders, SUM(amount_cents) AS gross,
    SUM(amount_cents - CAST(ROUND(amount_cents * ? / 10000.0) AS INTEGER) - ?) AS net FROM orders
    WHERE merchant_id = ? AND connected = 0 AND transfer_id IS NULL AND status IN ('paid', 'fulfilled') GROUP BY currency`).bind(feeBps(env), feeFixed(env), mid).all()
  const { results: payouts } = await env.DB.prepare('SELECT * FROM payouts WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 20').bind(mid).all()
  return {
    owed: owed.results,
    payouts,
  }
}

/** Is the creator's Stripe account able to receive transfers? */
async function canReceive(env, accountId) {
  if (!accountId) return false
  const acct = await stripe(env, `accounts/${accountId}`).catch(() => null)
  return acct?.capabilities?.transfers === 'active'
}

/**
 * Pay a creator everything they're owed (up to BATCH orders per run; run again for more).
 * @returns {{ ok: boolean, reason?: string, paid?: number, orders?: number, more?: boolean }}
 */
export async function payOut(env, mid, trigger = 'manual') {
  const m = await env.DB.prepare('SELECT stripe_account_id FROM merchants WHERE id = ?').bind(mid).first()
  if (!(await canReceive(env, m?.stripe_account_id))) return { ok: false, reason: 'Connect a Stripe account to receive payouts' }

  const cutoff = Date.now() - Number(env.PAYOUT_HOLD_HOURS ?? 0) * HOUR_MS
  const { results: orders } = await env.DB.prepare(`SELECT * FROM orders WHERE merchant_id = ? AND connected = 0 AND transfer_id IS NULL
    AND status IN ('paid', 'fulfilled') AND created_at <= ? ORDER BY created_at LIMIT ?`).bind(mid, cutoff, BATCH + 1).all()
  if (!orders.length) return { ok: true, paid: 0, orders: 0 }

  const runs = new Map() // currency -> payout id; the row exists before any order points at it
  for (const o of orders.slice(0, BATCH)) {
    const fee = platformFee(env, o.amount_cents)
    const amount = o.amount_cents - fee
    if (amount <= 0) continue
    if (!runs.has(o.currency)) {
      const id = crypto.randomUUID()
      await env.DB.prepare('INSERT INTO payouts (id, merchant_id, amount_cents, currency, orders, trigger, created_at) VALUES (?, ?, 0, ?, 0, ?, ?)')
        .bind(id, mid, o.currency, trigger, Date.now()).run()
      runs.set(o.currency, id)
    }
    const pi = await stripe(env, `payment_intents/${o.payment_intent}`)
    const t = await stripe(env, 'transfers', {
      idempotencyKey: `transfer-${o.id}`,
      params: { amount, currency: o.currency, destination: m.stripe_account_id, source_transaction: pi.latest_charge, transfer_group: o.drop_id, metadata: { order: o.id } },
    })
    await env.DB.prepare('UPDATE orders SET transfer_id = ?, fee_cents = ?, payout_id = ? WHERE id = ?').bind(t.id, fee, runs.get(o.currency), o.id).run()
  }
  // totals come from the orders themselves, so an interrupted run still reads true
  let paid = 0
  for (const id of runs.values()) {
    const row = await env.DB.prepare(`UPDATE payouts SET (amount_cents, orders) = (SELECT COALESCE(SUM(amount_cents - fee_cents), 0), COUNT(*) FROM orders WHERE payout_id = ?)
      WHERE id = ? RETURNING orders`).bind(id, id).first()
    paid += row.orders
  }
  return { ok: true, paid, orders: paid, more: orders.length > BATCH }
}

/** Cron: pay every creator on the daily schedule. One failure never blocks the rest. */
export async function dailyPayouts(env) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT m.id FROM merchants m JOIN orders o ON o.merchant_id = m.id
    WHERE m.payout_schedule = 'daily' AND o.connected = 0 AND o.transfer_id IS NULL AND o.status IN ('paid', 'fulfilled')`).all()
  for (const { id } of results) {
    try {
      await payOut(env, id, 'daily')
    } catch (err) {
      console.error('daily payout failed', id, err)
    }
  }
}

/** Refunding an order that was already paid out: pull the creator's share back first. */
export async function reverseTransfer(env, order) {
  if (!order.transfer_id) return
  await stripe(env, `transfers/${order.transfer_id}/reversals`, { idempotencyKey: `reversal-${order.id}`, params: {} })
}
