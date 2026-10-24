// Pricing in one place. The platform keeps a percentage plus a fixed amount per order: the fixed part covers the
// card network's per-charge fee, the percentage covers the card percentage, Cloudflare, and margin.

export const feeBps = (env) => Number(env.PLATFORM_FEE_BPS ?? 800)
export const feeFixed = (env) => Number(env.PLATFORM_FEE_FIXED_CENTS ?? 30)

/** What the platform keeps on an order of `amountCents`. */
export const platformFee = (env, amountCents) => Math.round((amountCents * feeBps(env)) / 10_000) + feeFixed(env)
