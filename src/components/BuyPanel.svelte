<script>
  // The buy column: status, title, price, countdown, stock bar, options and the button.
  import { X } from '@lucide/svelte'
  import Countdown from './Countdown.svelte'
  import StockBar from './StockBar.svelte'
  import VariantPicker from './VariantPicker.svelte'
  import Turnstile from './Turnstile.svelte'
  import { buyLabel, effectiveStatus, leftFor, reasonText } from '../lib/drop-view.js'
  import { money, when } from '../lib/time.js'
  import { BTN, CARD, CHIP, STATUS_CLS, STRINGS } from '../lib/ui.js'

  /**
   * @type {{ drop: any, live: import('../lib/live.svelte.js').LiveDrop | null, now: number, drops: any[], handle: string,
   *   notice: string, ondismiss: () => void, sitekey: string | null, class?: string }}
   */
  let { drop, live, now, drops, handle, notice, ondismiss, sitekey, class: cls = '' } = $props()

  let qty = $state(1)
  const options = $derived((drop.variants ?? []).filter((v) => v.label))
  const hidden = $derived(!!drop.hidden)
  let picked = $state('')
  /** @type {Turnstile | undefined} */
  let turnstile = $state()

  const s = $derived(live?.state ?? null)
  const variant = $derived(options.length > 1 ? (picked || options.find((v) => (s?.va?.[v.id] ?? 1) > 0)?.id || options[0].id) : options[0]?.id)
  const status = $derived(effectiveStatus(s, now))
  const left = $derived(s ? leftFor(s, options.length > 1 ? variant : undefined) : 0)
  const phase = $derived(live?.buying.phase ?? 'idle')
  const label = $derived(buyLabel({ s, status, phase, left, priceCents: drop.priceCents, currency: drop.currency, qty }))
  const canBuy = $derived(phase === 'held' || (status === 'live' && left > 0 && !!live?.connected && phase !== 'trying'))

  $effect(() => {
    if (live) live.onChallenge = () => turnstile?.reset()
  })
</script>

<section class="{CARD} {cls} flex min-h-0 flex-col gap-3 p-3 sm:overflow-y-auto md:gap-5 md:p-5 2xl:gap-8 2xl:p-8 short:gap-2 short:p-2.5">
  <div>
    <div class="flex flex-wrap items-center gap-2">
      {#if status}
        <span class="{CHIP} {STATUS_CLS[status]}">
          {#if status === 'live'}<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-white"></span>{/if}
          {STRINGS.status[status]}
        </span>
      {/if}
      <span class="text-[10px] uppercase tracking-widest text-muted 2xl:text-sm">{when(drop.startsAt)}</span>
    </div>
    {#if hidden}
      <h1 class="mt-2 text-xl font-black uppercase leading-tight tracking-wide sm:text-2xl lg:text-3xl 2xl:text-5xl short:mt-1 short:text-lg">{STRINGS.mystery.title}</h1>
      <p class="mt-1 text-lg font-bold tracking-[.4em] text-accent 2xl:text-3xl short:text-base">{STRINGS.mystery.price}</p>
      <p class="selectable mt-2 whitespace-pre-line text-sm text-neutral-300 2xl:text-xl short:line-clamp-1">{drop.teaser || STRINGS.mystery.fallback}</p>
    {:else}
      <h1 class="mt-2 text-xl font-black uppercase leading-tight tracking-wide sm:text-2xl lg:text-3xl 2xl:text-5xl short:mt-1 short:text-lg">{drop.title}</h1>
      <p class="mt-1 text-lg font-bold text-accent 2xl:text-3xl short:text-base">{money(drop.priceCents, drop.currency)}</p>
      {#if drop.description}
        <p class="selectable mt-2 line-clamp-2 whitespace-pre-line text-sm text-neutral-400 sm:line-clamp-none 2xl:text-xl short:hidden">{drop.description}</p>
      {/if}
    {/if}
  </div>

  {#if s && status === 'scheduled'}
    <Countdown target={s.at} {now} label={hidden ? STRINGS.mystery.countdown : 'Drops in'} />
  {:else if s && status === 'live' && s.end}
    <Countdown target={s.end} {now} label="Sale ends in" />
  {/if}

  {#if s && live}
    <StockBar shown={live.shown} total={s.T} sold={s.s} marks={live.marks} />
  {/if}

  <div class="mt-auto space-y-2">
    {#if options.length > 1}
      <VariantPicker variants={options} left={s?.va} value={variant} onpick={(id) => (picked = id)} />
    {/if}
    {#if notice}
      <p class="flex items-start justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-neutral-200 2xl:text-base">
        {notice}<button onclick={ondismiss} aria-label="Dismiss"><X size={14} /></button>
      </p>
    {/if}
    {#if phase === 'refused'}
      <p class="text-xs text-neutral-400 2xl:text-base">{reasonText(live?.buying.reason)}</p>
    {:else if status === 'live' && s && left < 1}
      <p class="text-xs text-neutral-400 2xl:text-base">{STRINGS.buyReason.claimed}</p>
    {/if}
    {#if sitekey && live}
      <Turnstile bind:this={turnstile} {sitekey} ontoken={(t) => live.setToken(t)} />
    {/if}
    <div class="flex gap-2">
      {#if drop.maxPerOrder > 1 && !hidden}
        <select class="rounded-xl border border-white/10 bg-black/40 px-2 text-sm 2xl:text-lg" bind:value={qty} aria-label="Quantity">
          {#each Array.from({ length: drop.maxPerOrder }, (_, i) => i + 1) as n}<option value={n}>{n}</option>{/each}
        </select>
      {/if}
      <button class="{BTN} flex-1 py-3.5! text-base! 2xl:py-6! 2xl:text-2xl!" disabled={!canBuy || hidden} onclick={() => live?.buy(qty, options.length > 1 ? variant : undefined)}>
        {hidden ? STRINGS.mystery.button : label}
      </button>
    </div>
  </div>

  {#if drops.length > 1}
    <nav class="flex flex-wrap gap-1.5 border-t border-white/5 pt-3 short:hidden" aria-label="More drops">
      {#each drops as d (d.id)}
        <a href="/{handle}/{d.slug}" class="{CHIP} {d.id === drop.id ? 'bg-accent text-white' : 'bg-white/5 text-neutral-300 hover:bg-white/10'}">{d.hidden ? STRINGS.mystery.title : d.title}</a>
      {/each}
    </nav>
  {/if}
</section>
