<script>
  // drops.dogs.red/:handle[/:slug] — the live drop room.
  import { Eye, MessageCircle, Volume2, VolumeX, X } from '@lucide/svelte'
  import Shell from '../components/Shell.svelte'
  import Media from '../components/Media.svelte'
  import Countdown from '../components/Countdown.svelte'
  import StockBar from '../components/StockBar.svelte'
  import Chat from '../components/Chat.svelte'
  import { api } from '../lib/api.js'
  import { LiveDrop } from '../lib/live.svelte.js'
  import { ding, unlockSound } from '../lib/sound.js'
  import { money, when } from '../lib/time.js'
  import { route, navigate } from '../lib/router.svelte.js'
  import { BTN, BTN_GHOST, BUY_REASON, CARD, CHIP, STATUS_UI } from '../lib/ui.js'

  /** @type {{ handle: string, slug?: string }} */
  let { handle, slug } = $props()

  const FONTS = {
    sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    serif: 'Georgia, "Times New Roman", serif',
    display: '"Arial Black", Impact, "Helvetica Neue", sans-serif',
  }
  const CLOCK_MS = 250
  const WITH_CHAT = 'lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(15rem,19rem)] xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_30rem]'
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

  /** @type {{ shop: any, drops: any[] } | null} */
  let data = $state(null)
  let error = $state('')
  /** @type {LiveDrop | null} */
  let live = $state(null)
  let now = $state(Date.now())
  let sound = $state(false)
  let chatOpen = $state(false)
  let qty = $state(1)
  let notice = $state('')

  $effect(() => {
    api(`/s/${handle}`).then((d) => (data = d), (e) => (error = e.message))
  })

  const drop = $derived.by(() => {
    if (!data) return null
    if (slug) return data.drops.find((d) => d.slug === slug) ?? null
    const t = Date.now()
    const open = data.drops.filter((d) => !d.endsAt || d.endsAt > t)
    return open.find((d) => d.startsAt <= t) ?? open[0] ?? data.drops.at(-1) ?? null
  })

  // one live connection per drop on screen
  $effect(() => {
    if (!drop) return
    const conn = new LiveDrop(drop.id)
    live = conn
    return () => conn.close()
  })

  $effect(() => {
    const t = setInterval(() => (now = live ? live.now() : Date.now()), CLOCK_MS)
    return () => clearInterval(t)
  })

  // back from Stripe Checkout
  $effect(() => {
    if (!live) return
    const paid = route.query.get('paid')
    const cancel = route.query.get('cancel')
    if (!paid && !cancel) return
    if (cancel) live.cancel(cancel)
    notice = paid ? "You're in. Stripe is emailing your receipt." : 'Checkout cancelled. Your unit went back on the shelf.'
    navigate(route.path, true)
  })

  async function toggleSound() {
    sound = !sound
    if (sound) await unlockSound()
    if (live) live.onDing = sound ? ding : null
  }

  const s = $derived(live?.state)
  const status = $derived(!s ? null : s.st === 'scheduled' && now >= s.at ? 'opening' : s.st)
  const theme = $derived(data?.shop.theme ?? {})
  const style = $derived(
    [theme.accent && `--color-accent: ${theme.accent}`, theme.bg && `--color-app: ${theme.bg}`, `--font-shop: ${FONTS[theme.font] ?? FONTS.sans}`].filter(Boolean).join('; '),
  )
  const buyLabel = $derived.by(() => {
    if (!s || !drop) return 'Connecting…'
    if (live?.buying.phase === 'trying') return 'Securing yours…'
    if (live?.buying.phase === 'held') return 'Finish checkout'
    if (status === 'scheduled') return 'Not live yet'
    if (status === 'opening') return 'Opening…'
    if (status === 'sold_out') return 'Sold out'
    if (status === 'ended') return 'Ended'
    if (s.a < 1) return 'All claimed'
    return `Buy · ${money(drop.priceCents * qty, drop.currency)}`
  })
  const canBuy = $derived(status === 'live' && (s?.a ?? 0) > 0 && live?.connected && live?.buying.phase !== 'trying')
</script>

<Shell title={data?.shop.name ?? handle} href="/{handle}" {style}>
  {#snippet right()}
    {#if s}
      <span class="{CHIP} bg-white/5 text-white" title="Watching now"><Eye size={14} />{compact.format(Math.max(s.v, live?.connected ? 1 : 0))}</span>
    {/if}
    <button class={BTN_GHOST} onclick={toggleSound} aria-label={sound ? 'Mute dings' : 'Play dings'} aria-pressed={sound}>
      {#if sound}<Volume2 size={16} />{:else}<VolumeX size={16} />{/if}
    </button>
    {#if s?.ch}
      <button class="{BTN_GHOST} lg:hidden" onclick={() => (chatOpen = !chatOpen)} aria-label="Chat" aria-expanded={chatOpen}><MessageCircle size={16} /></button>
    {/if}
  {/snippet}

  {#if error}
    <div class="m-auto text-center">
      <p class="text-2xl font-black uppercase tracking-widest 2xl:text-5xl">No shop at /{handle}</p>
      <a href="/" class="mt-4 inline-block text-sm text-accent underline">DOGS DROPS home</a>
    </div>
  {:else if data && !drop}
    <div class="m-auto text-center">
      <p class="text-2xl font-black uppercase tracking-widest 2xl:text-5xl">{slug ? 'No drop here' : 'Nothing dropping yet'}</p>
      <p class="mt-2 text-sm text-muted">{data.shop.theme?.tagline || 'Check back soon.'}</p>
    </div>
  {:else if drop}
    <div class="grid min-h-0 flex-1 gap-3 grid-rows-[minmax(0,1fr)_auto] sm:grid-rows-1 sm:grid-cols-2 md:gap-4 2xl:gap-8 {s?.ch ? WITH_CHAT : ''}">
      <Media media={drop.media} title={drop.title} />

      <section class="{CARD} flex min-h-0 flex-col gap-3 p-3 sm:overflow-y-auto md:gap-5 md:p-5 2xl:gap-8 2xl:p-8 short:gap-2 short:p-2.5">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            {#if status}
              <span class="{CHIP} {STATUS_UI[status === 'opening' ? 'live' : status]?.cls}">
                {#if status === 'live'}<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-white"></span>{/if}
                {status === 'opening' ? 'Opening' : STATUS_UI[status]?.label}
              </span>
            {/if}
            <span class="text-[10px] uppercase tracking-widest text-muted 2xl:text-sm">{when(drop.startsAt)}</span>
          </div>
          <h1 class="mt-2 text-xl font-black uppercase leading-tight tracking-wide sm:text-2xl lg:text-3xl 2xl:text-5xl short:mt-1 short:text-lg">{drop.title}</h1>
          <p class="mt-1 text-lg font-bold text-accent 2xl:text-3xl short:text-base">{money(drop.priceCents, drop.currency)}</p>
          {#if drop.description}
            <p class="selectable mt-2 line-clamp-2 whitespace-pre-line text-sm text-neutral-400 sm:line-clamp-none 2xl:text-xl short:hidden">{drop.description}</p>
          {/if}
        </div>

        {#if s && status === 'scheduled'}
          <Countdown target={s.at} {now} label="Drops in" />
        {:else if s && status === 'live' && s.end}
          <Countdown target={s.end} {now} label="Sale ends in" />
        {/if}

        {#if s && live}
          <StockBar shown={live.shown} total={s.T} sold={s.s} marks={live.marks} />
        {/if}

        <div class="mt-auto space-y-2">
          {#if notice}
            <p class="flex items-start justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-neutral-200 2xl:text-base">
              {notice}<button onclick={() => (notice = '')} aria-label="Dismiss"><X size={14} /></button>
            </p>
          {/if}
          {#if live?.buying.phase === 'refused'}
            <p class="text-xs text-neutral-400 2xl:text-base">{BUY_REASON[live.buying.reason] ?? 'Could not reserve. Try again.'}</p>
          {:else if status === 'live' && s && s.a < 1}
            <p class="text-xs text-neutral-400 2xl:text-base">{BUY_REASON.claimed}</p>
          {/if}
          <div class="flex gap-2">
            {#if drop.maxPerOrder > 1}
              <select class="rounded-xl border border-white/10 bg-black/40 px-2 text-sm 2xl:text-lg" bind:value={qty} aria-label="Quantity">
                {#each Array.from({ length: drop.maxPerOrder }, (_, i) => i + 1) as n}<option value={n}>{n}</option>{/each}
              </select>
            {/if}
            <button class="{BTN} flex-1 py-3.5! text-base! 2xl:py-6! 2xl:text-2xl!" disabled={!canBuy && live?.buying.phase !== 'held'} onclick={() => live?.buy(qty)}>
              {buyLabel}
            </button>
          </div>
        </div>

        {#if data.drops.length > 1}
          <nav class="flex flex-wrap gap-1.5 border-t border-white/5 pt-3 short:hidden" aria-label="More drops">
            {#each data.drops as d (d.id)}
              <a href="/{handle}/{d.slug}" class="{CHIP} {d.id === drop.id ? 'bg-accent text-white' : 'bg-white/5 text-neutral-300 hover:bg-white/10'}">{d.title}</a>
            {/each}
          </nav>
        {/if}
      </section>

      {#if s?.ch}
        <aside
          class="{CARD} {chatOpen ? 'fixed inset-x-3 bottom-12 top-16 z-30 flex sm:left-auto sm:w-96' : 'hidden'} min-h-0 flex-col p-3 lg:static lg:z-auto lg:flex lg:w-auto 2xl:p-6"
          aria-label="Live chat"
        >
          <div class="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.25em] text-muted 2xl:text-sm">
            Live chat
            <button class="lg:hidden" onclick={() => (chatOpen = false)} aria-label="Close chat"><X size={16} /></button>
          </div>
          <Chat messages={live?.chat ?? []} onsay={(n, t) => live?.say(n, t)} />
        </aside>
      {/if}
    </div>
  {:else}
    <div class="m-auto h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-accent"></div>
  {/if}

  {#snippet footer()}
    Times shown in your zone · {Intl.DateTimeFormat().resolvedOptions().timeZone}
  {/snippet}
</Shell>
