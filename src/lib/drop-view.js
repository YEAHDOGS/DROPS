// Pure view logic for the drop room: what status to show and what the buy button says. Kept out of the markup.
import STRINGS from './strings.json'
import { money } from './time.js'

/** @typedef {import('./live.svelte.js').DropState} DropState */

/** Server status, except a countdown that already hit zero reads "opening" until the room flips it. */
export function effectiveStatus(/** @type {DropState|null} */ s, now) {
  if (!s) return null
  return s.st === 'scheduled' && now >= s.at ? 'opening' : s.st
}

/** Units left for a variant (or the whole drop when there's only one). */
export const leftFor = (/** @type {DropState} */ s, variant) => (variant && s.va ? s.va[variant] ?? 0 : s.a)

/**
 * @param {{ s: DropState|null, status: string|null, phase: string, left: number, priceCents: number, currency: string, qty: number }} p
 */
export function buyLabel({ s, status, phase, left, priceCents, currency, qty }) {
  if (!s) return 'Connecting…'
  if (phase === 'trying') return 'Securing yours…'
  if (phase === 'held') return 'Finish checkout'
  if (status === 'scheduled') return 'Not live yet'
  if (status === 'opening') return 'Opening…'
  if (status === 'sold_out' || status === 'ended') return STRINGS.status[status]
  if (left < 1) return 'All claimed'
  return `Buy · ${money(priceCents * qty, currency)}`
}

export const reasonText = (reason) => STRINGS.buyReason[reason] ?? STRINGS.buyReason.fallback
