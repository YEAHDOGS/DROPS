// Chat rules per drop, shared by the edge (enforcement, worker/fanout.js) and the app (hints, components/Chat.svelte).

export const CHAT_MODES = ['off', 'open', 'host'] // host = announcements: only the shop posts
export const CHAT_DEFAULTS = { mode: 'open', slowSec: 2, whenLive: false, links: false, maxLen: 280 }
export const CHAT_BOUNDS = { SLOW_MIN: 1, SLOW_MAX: 120, LEN_MIN: 20, LEN_MAX: 280 }

const LINK_RE = /(https?:\/\/|www\.)\S|\b[a-z0-9-]+\.(com|net|org|io|gg|co|xyz|ly|me|app|shop|store|link)\b/i
const clamp = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : dflt)

/** Normalize anything (old boolean `chat`, partial objects, junk) into a full chat config. */
export function chatConfig(c) {
  if (c === false) return { ...CHAT_DEFAULTS, mode: 'off' }
  if (!c || typeof c !== 'object') return { ...CHAT_DEFAULTS }
  return {
    mode: CHAT_MODES.includes(c.mode) ? c.mode : CHAT_DEFAULTS.mode,
    slowSec: clamp(c.slowSec, CHAT_BOUNDS.SLOW_MIN, CHAT_BOUNDS.SLOW_MAX, CHAT_DEFAULTS.slowSec),
    whenLive: c.whenLive === true,
    links: c.links === true,
    maxLen: clamp(c.maxLen, CHAT_BOUNDS.LEN_MIN, CHAT_BOUNDS.LEN_MAX, CHAT_DEFAULTS.maxLen),
  }
}

/**
 * Why a viewer's message can't post right now, or null if it can.
 * @param {ReturnType<typeof chatConfig>} cfg
 * @param {{ status: string, text: string, lastAt: number, now: number }} ctx
 * @returns {{ reason: 'off'|'host'|'not_live'|'slow'|'link'|'long'|'empty', wait?: number } | null}
 */
export function chatBlock(cfg, { status, text, lastAt, now }) {
  if (cfg.mode === 'off') return { reason: 'off' }
  if (cfg.mode === 'host') return { reason: 'host' }
  if (cfg.whenLive && status === 'scheduled') return { reason: 'not_live' }
  if (!text) return { reason: 'empty' }
  if (text.length > cfg.maxLen) return { reason: 'long' }
  if (!cfg.links && LINK_RE.test(text)) return { reason: 'link' }
  const wait = lastAt + cfg.slowSec * 1000 - now
  if (wait > 0) return { reason: 'slow', wait }
  return null
}
