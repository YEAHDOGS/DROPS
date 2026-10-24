// Minimal Stripe REST client over fetch. No SDK: 6 endpoints don't justify 1MB of dependency.
// Money flow: every Checkout runs on the platform account. Merchants on Stripe Connect get destination charges
// (funds transfer to them minus the platform fee); merchants on "platform" mode get paid out by DOGS.

const API = 'https://api.stripe.com'
const CHECKOUT_MIN_TTL_S = 31 * 60 // Stripe requires Checkout expiry >= 30 min; our own hold timer closes it sooner
const SIG_TOLERANCE_S = 300
const encoder = new TextEncoder()

/** Stripe's nested form encoding: { a: { b: [1] } } -> a[b][0]=1 */
function encode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (typeof v === 'object') encode(v, key, out)
    else out.append(key, String(v))
  }
  return out
}

/**
 * Call the Stripe API.
 * @param {any} env
 * @param {string} path e.g. 'checkout/sessions'
 * @param {{ params?: object, method?: string, idempotencyKey?: string }} [opts]
 */
export async function stripe(env, path, { params, method = params ? 'POST' : 'GET', idempotencyKey } = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set')
  const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const res = await fetch(`${env.STRIPE_API || API}/v1/${path}`, { method, headers, body: params ? encode(params) : undefined })
  const body = await res.json()
  if (!res.ok) throw new Error(`Stripe ${path}: ${body?.error?.message ?? res.status}`)
  return body
}

/**
 * Open a Checkout session for a hold.
 * @param {any} env
 * @param {{ dropId: string, title: string, priceCents: number, currency: string, image?: string, path: string,
 *   destination?: string|null, feeBps: number, shipping: { countries: string[], rates: {label: string, amountCents: number}[] },
 *   invoiceNote?: string }} co checkout config the room was published with
 * @param {{ id: string, qty: number, variant: string }} hold
 */
export function createCheckout(env, co, hold) {
  const origin = env.PUBLIC_ORIGIN
  const meta = { drop: co.dropId, hold: hold.id, qty: hold.qty, variant: hold.variant, connected: co.destination ? 1 : 0 }
  const label = co.labels?.[hold.variant]
  const ships = co.shipping.countries.length > 0
  return stripe(env, 'checkout/sessions', {
    idempotencyKey: hold.id,
    params: {
      mode: 'payment',
      client_reference_id: hold.id,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MIN_TTL_S,
      success_url: `${origin}${co.path}?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${co.path}?cancel=${hold.id}`,
      metadata: meta,
      line_items: [{
        quantity: hold.qty,
        price_data: {
          currency: co.currency,
          unit_amount: co.priceCents,
          product_data: { name: label ? `${co.title} — ${label}` : co.title, images: co.image ? [`${origin}${co.image}`] : undefined },
        },
      }],
      payment_intent_data: {
        metadata: meta,
        transfer_data: co.destination ? { destination: co.destination } : undefined,
        application_fee_amount: co.destination ? Math.round((co.priceCents * hold.qty * co.feeBps) / 10_000) : undefined,
      },
      shipping_address_collection: ships ? { allowed_countries: co.shipping.countries } : undefined,
      shipping_options: ships
        ? co.shipping.rates.map((r) => ({
          shipping_rate_data: { type: 'fixed_amount', display_name: r.label, fixed_amount: { amount: r.amountCents, currency: co.currency } },
        }))
        : undefined,
      automatic_tax: co.tax ? { enabled: true } : undefined,
      invoice_creation: { enabled: true, invoice_data: co.invoiceNote ? { footer: co.invoiceNote } : undefined },
    },
  })
}

/** Close a Checkout session so a released hold can't be paid for late. Already-closed sessions are fine. */
export const expireCheckout = (env, id) => stripe(env, `checkout/sessions/${id}/expire`, { params: {} }).catch(() => null)

/** Full refund. Destination charges also pull the transfer and fee back from the merchant. */
export const refundPayment = (env, paymentIntent, connected) =>
  stripe(env, 'refunds', {
    idempotencyKey: `refund-${paymentIntent}`,
    params: { payment_intent: paymentIntent, reverse_transfer: connected || undefined, refund_application_fee: connected || undefined },
  })

/** Express account + onboarding link for "connect your own Stripe". */
export async function connectLink(env, merchant) {
  const account = merchant.stripe_account_id
    ? { id: merchant.stripe_account_id }
    : await stripe(env, 'accounts', { params: { type: 'express', email: merchant.email, metadata: { merchant: merchant.id } } })
  const link = await stripe(env, 'account_links', {
    params: { account: account.id, type: 'account_onboarding', refresh_url: `${env.PUBLIC_ORIGIN}/dash`, return_url: `${env.PUBLIC_ORIGIN}/dash` },
  })
  return { accountId: account.id, url: link.url }
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * Verify a webhook's Stripe-Signature header (t=...,v1=...) and return the parsed event, or null.
 * @param {string} payload raw body
 * @param {string|null} header
 * @param {string} secret whsec_...
 * @param {number} [nowS]
 */
export async function verifyWebhook(payload, header, secret, nowS = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return null
  const parts = header.split(',').map((p) => p.split('='))
  const t = Number(parts.find(([k]) => k === 't')?.[1])
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!t || !sigs.length || Math.abs(nowS - t) > SIG_TOLERANCE_S) return null

  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${t}.${payload}`)))
  if (!sigs.some((s) => timingSafeEqual(s, expected))) return null
  return JSON.parse(payload)
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
