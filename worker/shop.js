import { DEFAULT_VARIANT, publicProduct } from '../shared/drop.js'
import { chatConfig } from '../shared/chat.js'
import { roomOf } from './http.js'

// Row mapping + publishing. Publishing pushes each drop's config into its DropRoom and a read-only storefront
// snapshot into KV, so the hot path (20M people loading /handle) never touches D1.

export function toMerchant(row) {
  return {
    id: row.id,
    handle: row.handle,
    email: row.email,
    name: row.name,
    payoutMode: row.payout_mode,
    stripeAccountId: row.stripe_account_id,
    stripeReady: !!row.stripe_ready,
    tax: !!row.tax,
    theme: JSON.parse(row.theme),
    shipping: JSON.parse(row.shipping),
  }
}

export function toDrop(row) {
  const variants = JSON.parse(row.variants ?? '[]')
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    priceCents: row.price_cents,
    currency: row.currency,
    totalStock: row.total_stock,
    variants: variants.length ? variants : [{ id: DEFAULT_VARIANT, label: '', stock: row.total_stock }],
    maxPerOrder: row.max_per_order,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    holdMinutes: row.hold_minutes,
    shards: row.shards,
    chat: row.chat_config ? JSON.parse(row.chat_config) : chatConfig(!!row.chat),
    mystery: !!row.mystery,
    teaser: row.teaser ?? '',
    logo: row.logo ?? null,
    link: row.link ?? null,
    media: JSON.parse(row.media),
    published: !!row.published,
  }
}

/** What a DropRoom needs to sell: timing, stock rules, and the Checkout recipe. */
export function roomConfig(env, m, d) {
  return {
    published: d.published,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    totalStock: d.totalStock,
    variants: d.variants.map(({ id, stock }) => ({ id, stock })),
    maxPerOrder: d.maxPerOrder,
    holdMinutes: d.holdMinutes,
    chat: d.chat,
    shards: d.shards,
    mystery: d.mystery,
    product: publicProduct(d),
    checkout: {
      dropId: d.id,
      title: d.title,
      labels: Object.fromEntries(d.variants.filter((v) => v.label).map((v) => [v.id, v.label])),
      tax: m.tax,
      priceCents: d.priceCents,
      currency: d.currency,
      image: d.media.find((x) => x.kind === 'image')?.url ?? null,
      path: `/${m.handle}/${d.slug}`,
      destination: m.payoutMode === 'connect' && m.stripeReady ? m.stripeAccountId : null,
      shipping: { countries: m.shipping.countries ?? [], rates: m.shipping.rates ?? [] },
      invoiceNote: m.shipping.invoiceNote ?? '',
    },
  }
}

export async function loadShop(env, merchantId) {
  const row = await env.DB.prepare('SELECT * FROM merchants WHERE id = ?').bind(merchantId).first()
  if (!row) return null
  const { results } = await env.DB.prepare('SELECT * FROM drops WHERE merchant_id = ? ORDER BY starts_at').bind(merchantId).all()
  return { merchant: toMerchant(row), drops: results.map(toDrop) }
}

/** Storefront snapshot: published drops in full. The Worker hides mystery fields per request (shared/drop.js). */
export function storefrontData({ merchant: m, drops }) {
  return { shop: { handle: m.handle, name: m.name, theme: m.theme }, drops: drops.filter((d) => d.published) }
}

/** Rewrite the public storefront snapshot (KV). Live stock is not in it: that streams from the room. */
export async function publishStorefront(env, data) {
  const { merchant: m, drops } = data
  await Promise.all([
    env.KV.put(`shop:${m.handle}`, JSON.stringify(storefrontData(data))),
    ...drops.map((d) => (d.published ? env.KV.put(`drop:${d.id}`, JSON.stringify({ shards: d.shards })) : env.KV.delete(`drop:${d.id}`))),
  ])
}

/** Push fresh config to every room of a shop (after payout or shipping changes). */
export const configureRooms = (env, { merchant, drops }) => Promise.all(drops.map((d) => roomOf(env, d.id).configure(roomConfig(env, merchant, d))))
