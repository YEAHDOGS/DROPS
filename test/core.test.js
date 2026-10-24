import { describe, expect, it } from 'vitest'
import { BRANCH, depthFor, nodeName, parseNode } from '../worker/tree.js'
import { verifyWebhook } from '../worker/stripe.js'
import { hashPassword, verifyPassword } from '../worker/auth.js'
import { dropStatus, validateDrop, validateShop } from '../shared/drop.js'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

describe('broadcast tree', () => {
  it('sizes depth so no node has more than BRANCH children', () => {
    expect([1, BRANCH, BRANCH + 1, 4096].map(depthFor)).toEqual([1, 1, 2, 2])
  })

  it('every leaf of a 4096-shard drop reaches the room through one hub', () => {
    const hubs = new Set()
    for (let i = 0; i < 4096; i++) {
      const leaf = parseNode(nodeName('d', 2, i))
      const hub = parseNode(leaf.parent)
      expect(hub.parent).toBeNull()
      hubs.add(leaf.parent)
    }
    expect(hubs.size).toBe(BRANCH)
  })

  it('rejects junk node names', () => {
    expect(parseNode('')).toBeNull()
    expect(parseNode('d:0:1')).toBeNull()
    expect(parseNode('d:1:-1')).toBeNull()
  })
})

describe('stripe webhook signatures', () => {
  const secret = 'whsec_test'
  const sign = async (payload, t) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))
    return `t=${t},v1=${Buffer.from(sig).toString('hex')}`
  }

  it('accepts a valid signature and rejects tampering, staleness and missing secrets', async () => {
    const payload = '{"type":"checkout.session.completed"}'
    const t = 1_700_000_000
    const header = await sign(payload, t)
    expect(await verifyWebhook(payload, header, secret, t)).toEqual({ type: 'checkout.session.completed' })
    expect(await verifyWebhook(payload.replace('completed', 'expired'), header, secret, t)).toBeNull()
    expect(await verifyWebhook(payload, header, secret, t + 301)).toBeNull()
    expect(await verifyWebhook(payload, header, '', t)).toBeNull()
    expect(await verifyWebhook(payload, null, secret, t)).toBeNull()
  })
})

describe('passwords', () => {
  it('round-trips and rejects wrong passwords', async () => {
    const h = await hashPassword('correct horse')
    expect(await verifyPassword('correct horse', h)).toBe(true)
    expect(await verifyPassword('wrong horse', h)).toBe(false)
  })
})

describe('drop rules', () => {
  const base = { title: 'Kid A — 100 copies', priceCents: 4000, totalStock: 100, startsAt: 1000 }

  it('normalizes a valid drop', () => {
    const { value } = validateDrop(base)
    expect(value).toMatchObject({ slug: 'kid-a-100-copies', currency: 'usd', maxPerOrder: 1, holdMinutes: 10, chat: { mode: 'open' }, mystery: false, published: false })
  })

  it('rejects bad input with a readable reason', () => {
    expect(validateDrop({ ...base, title: '' }).error).toMatch(/Title/)
    expect(validateDrop({ ...base, priceCents: 10 }).error).toMatch(/Price/)
    expect(validateDrop({ ...base, endsAt: 500 }).error).toMatch(/end after/)
    expect(validateDrop({ ...base, media: [{ url: 'https://evil.example/x.png', kind: 'image' }] }).error).toMatch(/media/)
    expect(validateShop({ name: 'x', payoutMode: 'platform', theme: { accent: 'red' } }).error).toMatch(/hex/)
  })

  it('walks the lifecycle', () => {
    const d = { published: true, startsAt: 100, endsAt: 200, totalStock: 5 }
    expect([50, 100, 150, 200].map((t) => dropStatus(d, 0, t))).toEqual(['scheduled', 'live', 'live', 'ended'])
    expect(dropStatus(d, 5, 150)).toBe('sold_out')
    expect(dropStatus({ ...d, published: false }, 0, 150)).toBe('draft')
  })
})

describe('content security policy', () => {
  it('allows exactly the inline fallback script in index.html', () => {
    const script = readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
    const hash = createHash('sha256').update(script).digest('base64')
    expect(readFileSync('public/_headers', 'utf8')).toContain(`'sha256-${hash}'`)
  })
})

describe('chat rules', async () => {
  const { chatBlock, chatConfig } = await import('../shared/chat.js')
  const open = chatConfig({ mode: 'open', slowSec: 5, maxLen: 30 })
  const at = { status: 'live', lastAt: 0, now: 10_000 }

  it('normalizes old booleans and junk', () => {
    expect(chatConfig(false).mode).toBe('off')
    expect(chatConfig(true).mode).toBe('open')
    expect(chatConfig({ mode: 'party', slowSec: 9999, maxLen: 1 })).toMatchObject({ mode: 'open', slowSec: 120, maxLen: 20 })
  })

  it('enforces mode, timing, links, length and slow mode', () => {
    expect(chatBlock(open, { ...at, text: 'yo' })).toBeNull()
    expect(chatBlock(chatConfig(false), { ...at, text: 'yo' }).reason).toBe('off')
    expect(chatBlock(chatConfig({ mode: 'host' }), { ...at, text: 'yo' }).reason).toBe('host')
    expect(chatBlock(chatConfig({ whenLive: true }), { ...at, status: 'scheduled', text: 'yo' }).reason).toBe('not_live')
    for (const link of ['http://x.co', 'go to www.scam', 'buy at cheapkicks.shop']) expect(chatBlock(open, { ...at, text: link }).reason).toBe('link')
    expect(chatBlock(chatConfig({ links: true }), { ...at, text: 'see radiohead.com' })).toBeNull()
    expect(chatBlock(open, { ...at, text: 'x'.repeat(31) }).reason).toBe('long')
    expect(chatBlock(open, { ...at, text: 'yo', lastAt: 8000 })).toEqual({ reason: 'slow', wait: 3000 })
  })
})

describe('mystery drops', async () => {
  const { storefrontDrop } = await import('../shared/drop.js')
  const d = { id: 'd', slug: 'vault', title: 'Secret', description: 'shh', media: [{ url: '/media/a/b.png', kind: 'image' }], priceCents: 9900, currency: 'usd',
    variants: [{ id: 's', label: 'S', stock: 5 }], maxPerOrder: 1, startsAt: 1000, mystery: true, teaser: 'soon', totalStock: 5, holdMinutes: 10, published: true }

  it('seals every product field until the drop opens, and never publishes per-option stock', () => {
    const before = storefrontDrop(d, 999)
    expect(JSON.stringify(before)).not.toMatch(/Secret|shh|b\.png|9900|"S"/)
    expect(before).toMatchObject({ hidden: true, teaser: 'soon', totalStock: 5 })
    const after = storefrontDrop(d, 1000)
    expect(after).toMatchObject({ title: 'Secret', variants: [{ id: 's', label: 'S' }] })
    expect(after.variants[0].stock).toBeUndefined()
    expect(after.holdMinutes).toBeUndefined()
  })
})
