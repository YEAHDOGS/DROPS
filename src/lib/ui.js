// Shared Tailwind class recipes, so every button, input and card across the app looks like one system.

export const BTN =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition hover:brightness-110 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-40 2xl:px-6 2xl:py-3.5 2xl:text-lg'
export const BTN_GHOST =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-300 transition hover:border-accent/50 hover:text-white disabled:opacity-40 2xl:text-base'
export const INPUT =
  'w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-accent/70 2xl:text-lg'
export const LABEL = 'block text-[10px] font-semibold uppercase tracking-[.2em] text-muted mb-1.5 2xl:text-sm'
export const CARD = 'rounded-2xl border border-white/5 bg-card/70 backdrop-blur-md'
export const CHIP = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest 2xl:text-sm'

/** Status -> label + chip color. */
export const STATUS_UI = {
  draft: { label: 'Draft', cls: 'bg-white/5 text-neutral-400' },
  scheduled: { label: 'Upcoming', cls: 'bg-white/10 text-white' },
  live: { label: 'Live', cls: 'bg-accent text-white' },
  sold_out: { label: 'Sold out', cls: 'bg-white text-black' },
  ended: { label: 'Ended', cls: 'bg-white/5 text-neutral-500' },
}

/** Buy refusal reasons -> what the viewer reads. */
export const BUY_REASON = {
  claimed: 'All claimed. Holds expire. Stay on this page.',
  limit: 'You hit the per-person limit.',
  scheduled: 'Not live yet.',
  ended: 'This drop has ended.',
  sold_out: 'Sold out.',
  draft: 'This drop is not published.',
  payment: 'Checkout failed to open. Try again.',
  expired: 'Your hold expired. Try again.',
  busy: 'The line is packed. Try again.',
}
