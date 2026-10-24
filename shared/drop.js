// Drop rules shared by the Worker (enforcement) and the Svelte app (forms + countdown). One source of truth.
import { chatConfig } from './chat.js'

export const LIMITS = {
  HANDLE: 32,
  NAME: 60,
  TITLE: 120,
  SLUG: 48,
  DESC: 4000,
  MEDIA: 12,
  CHAT_TEXT: 280,
  CHAT_NAME: 24,
  MAX_STOCK: 1_000_000,
  MAX_PER_ORDER: 10,
  MAX_PRICE_CENTS: 10_000_000,
  MIN_HOLD_MIN: 2,
  MAX_HOLD_MIN: 30,
  MAX_SHARDS: 4096,
  VARIANTS: 20,
  VARIANT_LABEL: 24,
  LINKS: 5,
  TEASER: 200,
}

export const DEFAULT_VARIANT = 'one'

// Shop look defaults. Mirrors the @theme tokens in src/styles/theme.css (CSS can't import JS).
export const THEME_DEFAULTS = { accent: '#ff3344', bg: '#050508', font: 'sans', layout: 'split' }
export const LAYOUTS = ['split', 'poster']

export const STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  SOLD_OUT: 'sold_out',
  ENDED: 'ended',
}

// Crowd presets -> number of leaf shards. ~5k sockets per leaf keeps every Durable Object comfortably idle.
export const CROWDS = { small: 1, medium: 64, large: 512, massive: 4096 }

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
export const RESERVED_HANDLES = new Set([
  'api', 'media', 'dash', 'assets', 'src', 'admin', 'login', 'signup', 'www', 'help', 'about', 'terms', 'privacy',
  'drops', 'dogs', 'demo', 'static', 'public', 'favicon.svg', 'robots.txt', 'site.webmanifest',
])

export const CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud', 'jpy', 'mxn', 'nzd', 'sek', 'chf']
const COUNTRY_RE = /^[A-Z]{2}$/
const HEX_RE = /^#[0-9a-f]{6}$/i
const URL_RE = /^https:\/\/[^\s]{3,300}$/
const MEDIA_RE = /^\/media\//
const FONTS = new Set(['sans', 'mono', 'serif', 'display'])

/**
 * Where a drop is in its life, from the clock and what has been paid for.
 * @param {{published?: boolean, startsAt: number, endsAt?: number|null, totalStock: number}} drop
 * @param {number} sold units paid for
 * @param {number} now epoch ms
 */
export function dropStatus(drop, sold, now) {
  if (!drop.published) return STATUS.DRAFT
  if (now < drop.startsAt) return STATUS.SCHEDULED
  if (drop.endsAt && now >= drop.endsAt) return STATUS.ENDED
  if (sold >= drop.totalStock) return STATUS.SOLD_OUT
  return STATUS.LIVE
}

export const slugify = (s) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.SLUG)

const str = (v, max) => String(v ?? '').trim().slice(0, max)
const int = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : NaN)

/**
 * Validate a drop from the editor. Returns { value } or { error } (first problem only).
 * @param {Record<string, any>} d
 */
export function validateDrop(d) {
  const title = str(d.title, LIMITS.TITLE)
  const slug = slugify(d.slug || title)
  const priceCents = int(d.priceCents)
  const maxPerOrder = int(d.maxPerOrder ?? 1)
  const startsAt = int(d.startsAt)
  const endsAt = d.endsAt ? int(d.endsAt) : null
  const holdMinutes = int(d.holdMinutes ?? 10)
  const shards = int(d.shards ?? CROWDS.medium)
  const currency = str(d.currency || 'usd', 3).toLowerCase()
  const media = Array.isArray(d.media) ? d.media.slice(0, LIMITS.MEDIA) : []
  const rawVariants = Array.isArray(d.variants) && d.variants.length ? d.variants.slice(0, LIMITS.VARIANTS) : null
  const variants = rawVariants
    ? rawVariants.map((v) => ({ id: slugify(v.id || v.label).slice(0, 24), label: str(v.label, LIMITS.VARIANT_LABEL), stock: int(v.stock) }))
    : [{ id: DEFAULT_VARIANT, label: '', stock: int(d.totalStock) }]
  const totalStock = variants.reduce((a, v) => a + v.stock, 0)

  if (!title) return { error: 'Title is required' }
  if (!slug) return { error: 'Slug is required' }
  if (!(priceCents >= 50 && priceCents <= LIMITS.MAX_PRICE_CENTS)) return { error: 'Price must be at least 0.50' }
  if (!CURRENCIES.includes(currency)) return { error: 'Unsupported currency' }
  if (rawVariants && !variants.every((v) => v.id && v.label)) return { error: 'Every variant needs a name' }
  if (new Set(variants.map((v) => v.id)).size !== variants.length) return { error: 'Variant names must be different' }
  if (!variants.every((v) => v.stock >= 0)) return { error: 'Variant stock must be 0 or more' }
  if (!(totalStock >= 1 && totalStock <= LIMITS.MAX_STOCK)) return { error: `Stock must be 1 to ${LIMITS.MAX_STOCK}` }
  if (!(maxPerOrder >= 1 && maxPerOrder <= LIMITS.MAX_PER_ORDER)) return { error: `Max per order must be 1 to ${LIMITS.MAX_PER_ORDER}` }
  if (!(startsAt > 0)) return { error: 'Drop time is required' }
  if (endsAt !== null && !(endsAt > startsAt)) return { error: 'Sale must end after it starts' }
  if (!(holdMinutes >= LIMITS.MIN_HOLD_MIN && holdMinutes <= LIMITS.MAX_HOLD_MIN)) return { error: 'Checkout hold must be 2 to 30 minutes' }
  if (!(shards >= 1 && shards <= LIMITS.MAX_SHARDS)) return { error: 'Invalid crowd size' }
  if (!media.every((m) => m && typeof m.url === 'string' && MEDIA_RE.test(m.url) && /^(image|video)$/.test(m.kind))) {
    return { error: 'Invalid media' }
  }
  if (d.logo && !MEDIA_RE.test(d.logo)) return { error: 'Invalid logo' }
  if (d.link && !URL_RE.test(d.link)) return { error: 'Link must start with https://' }

  return {
    value: {
      title, slug, priceCents, currency, totalStock, variants, maxPerOrder, startsAt, endsAt, holdMinutes, shards,
      description: str(d.description, LIMITS.DESC),
      chat: chatConfig(d.chat),
      mystery: d.mystery === true,
      teaser: str(d.teaser, LIMITS.TEASER),
      logo: d.logo || null,
      link: d.link || null,
      published: d.published === true,
      media: media.map((m) => ({ url: m.url, kind: m.kind })),
    },
  }
}

/**
 * Validate shop settings: theme, shipping, payouts.
 * @param {Record<string, any>} s
 */
export function validateShop(s) {
  const name = str(s.name, LIMITS.NAME)
  const theme = s.theme ?? {}
  const shipping = s.shipping ?? {}
  const countries = Array.isArray(shipping.countries) ? shipping.countries.map((c) => str(c, 2).toUpperCase()) : []
  const rates = Array.isArray(shipping.rates) ? shipping.rates.slice(0, 5) : []

  if (!name) return { error: 'Shop name is required' }
  if (!['platform', 'connect'].includes(s.payoutMode)) return { error: 'Pick how you get paid' }
  if (!countries.every((c) => COUNTRY_RE.test(c))) return { error: 'Countries must be 2-letter codes like US' }
  if (!rates.every((r) => str(r.label, 40) && int(r.amountCents) >= 0)) return { error: 'Each shipping rate needs a label and price' }
  for (const k of ['accent', 'bg']) if (theme[k] && !HEX_RE.test(theme[k])) return { error: `Theme ${k} must be a hex color` }
  if (theme.font && !FONTS.has(theme.font)) return { error: 'Unknown font' }
  if (theme.layout && !LAYOUTS.includes(theme.layout)) return { error: 'Unknown layout' }
  if (theme.logo && !MEDIA_RE.test(theme.logo)) return { error: 'Invalid logo' }
  const links = Array.isArray(theme.links) ? theme.links.slice(0, LIMITS.LINKS) : []
  if (!links.every((l) => str(l.label, 30) && URL_RE.test(l.url))) return { error: 'Links need a label and an https:// address' }

  return {
    value: {
      name,
      payoutMode: s.payoutMode,
      tax: s.tax === true,
      theme: {
        accent: theme.accent || null,
        bg: theme.bg || null,
        font: theme.font || THEME_DEFAULTS.font,
        layout: theme.layout || THEME_DEFAULTS.layout,
        tagline: str(theme.tagline, 140),
        logo: theme.logo || null,
        links: links.map((l) => ({ label: str(l.label, 30), url: l.url })),
      },
      shipping: {
        countries,
        rates: rates.map((r) => ({ label: str(r.label, 40), amountCents: int(r.amountCents) })),
        from: str(shipping.from, 300),
        invoiceNote: str(shipping.invoiceNote, 500),
      },
    },
  }
}

/** What viewers see of a drop. Mystery drops show only this until the reveal. */
const PRODUCT_FIELDS = ['title', 'description', 'media', 'priceCents', 'currency', 'variants', 'maxPerOrder']

/** The product half of a drop, safe to publish (variant stock stays private: live numbers come from the room). */
export function publicProduct(d) {
  const p = Object.fromEntries(PRODUCT_FIELDS.map((k) => [k, d[k]]))
  p.variants = (d.variants ?? []).map(({ id, label }) => ({ id, label }))
  return p
}

/** A drop as the public storefront may show it at `now`: mystery drops lose every product field until they open. */
export function storefrontDrop(d, now) {
  const { holdMinutes, published, variants, ...rest } = d
  const shown = { ...rest, variants: (variants ?? []).map(({ id, label }) => ({ id, label })) }
  if (!d.mystery || now >= d.startsAt) return shown
  for (const k of PRODUCT_FIELDS) delete shown[k]
  return { ...shown, hidden: true }
}
