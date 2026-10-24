// Time + money formatting. Drops are stored as UTC epoch ms; humans see their own zone, merchants pick theirs.

const ZERO_DECIMAL = new Set(['jpy'])
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const KNOWN_ZONES = Intl.supportedValuesOf?.('timeZone') ?? []
export const ZONES = KNOWN_ZONES.includes(LOCAL_ZONE) ? KNOWN_ZONES : [LOCAL_ZONE, ...KNOWN_ZONES]
export const WORLD_ZONES = ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney']

/** Offset (ms) of a zone from UTC at an instant. */
function zoneOffset(ms, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(ms).map((x) => [x.type, Number(x.value)]),
  )
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / SEC) * SEC
}

/** "2026-11-01T21:00" wall time in `timeZone` -> epoch ms (DST-safe). */
export function zonedToUtc(local, timeZone) {
  const [d, t = '00:00'] = local.split('T')
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, da, h, mi)
  return guess - zoneOffset(guess - zoneOffset(guess, timeZone), timeZone)
}

/** epoch ms -> "YYYY-MM-DDTHH:mm" wall time in `timeZone` (for datetime-local inputs). */
export function utcToZoned(ms, timeZone) {
  return new Date(ms + zoneOffset(ms, timeZone)).toISOString().slice(0, 16)
}

/** "Fri, Oct 30, 9:00 PM PDT" in the viewer's (or a given) zone. */
export const when = (ms, timeZone) =>
  new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(ms)

/** Split a duration into countdown units. */
export function parts(ms) {
  const t = Math.max(0, ms)
  return { d: Math.floor(t / DAY), h: Math.floor((t % DAY) / HOUR), m: Math.floor((t % HOUR) / MIN), s: Math.floor((t % MIN) / SEC) }
}

export const money = (cents, currency = 'usd') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(ZERO_DECIMAL.has(currency) ? cents : cents / 100)

/** Major units typed in a form -> Stripe minor units. */
export const toMinor = (amount, currency = 'usd') => Math.round(Number(amount) * (ZERO_DECIMAL.has(currency) ? 1 : 100))
export const toMajor = (cents, currency = 'usd') => (ZERO_DECIMAL.has(currency) ? cents : cents / 100)
