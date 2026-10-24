<script>
  // The live room: media (or poster backdrop), buy column, chat. Shared by real shops (routes/Shop.svelte) and the
  // demo (routes/Demo.svelte), so the demo is the product, not a mock-up of it.
  import { X } from '@lucide/svelte'
  import Media from './Media.svelte'
  import BuyPanel from './BuyPanel.svelte'
  import Chat from './Chat.svelte'
  import { CARD } from '../lib/ui.js'

  /**
   * @type {{ live: import('../lib/live.svelte.js').LiveDrop | null, drop: any, drops?: any[], handle?: string, layout?: 'split'|'poster',
   *   notice?: string, ondismiss?: () => void, sitekey?: string | null, chatOpen?: boolean, fit?: 'cover'|'contain',
   *   onsay?: ((name: string, text: string) => void) | null, onmod?: ((m: any, ban: boolean) => void) | null }}
   */
  let { live, drop, drops = [], handle = '', layout = 'split', notice = '', ondismiss = () => {}, sitekey = null, chatOpen = $bindable(false),
    fit = 'cover', onsay = null, onmod = null } = $props()

  const CLOCK_MS = 250
  const GRID = {
    split: { base: 'sm:grid-cols-2', chat: 'lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(15rem,19rem)] xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_30rem]' },
    poster: { base: 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]', chat: 'lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)_minmax(15rem,19rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)_30rem]' },
  }

  let now = $state(Date.now())
  $effect(() => {
    const t = setInterval(() => (now = live ? live.now() : Date.now()), CLOCK_MS)
    return () => clearInterval(t)
  })

  const s = $derived(live?.state)
  // the room's pushed product beats the storefront copy: edits land instantly, mystery drops reveal on the tick
  const view = $derived(live?.product ? { ...drop, ...live.product, hidden: false } : drop)
  const rules = $derived(live?.cfg?.chat ?? null)
  const chatOn = $derived(!!rules && rules.mode !== 'off')
  const grid = $derived(GRID[layout] ?? GRID.split)

  let revealKey = $state(0)
  let wasHidden = false
  $effect(() => {
    const hidden = !!view?.hidden
    if (wasHidden && !hidden) revealKey++
    wasHidden = hidden
  })
</script>

<div class="relative grid min-h-0 flex-1 gap-3 grid-rows-[minmax(0,1fr)_auto] sm:grid-rows-1 md:gap-4 2xl:gap-8 {grid.base} {chatOn ? grid.chat : ''}">
  {#if layout === 'poster'}
    <div class="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
      {#key revealKey}<div class="h-full {revealKey ? 'animate-reveal' : ''}"><Media media={view.media} title={view.title} mystery={view.hidden} {fit} /></div>{/key}
      <div class="absolute inset-0 bg-linear-to-t from-app via-app/40 to-transparent sm:bg-linear-to-l"></div>
    </div>
    <div aria-hidden="true"></div>
  {:else}
    {#key revealKey}<div class="h-full min-h-0 {revealKey ? 'animate-reveal' : ''}"><Media media={view.media} title={view.title} mystery={view.hidden} {fit} /></div>{/key}
  {/if}

  <BuyPanel drop={view} {live} {now} {drops} {handle} {notice} {ondismiss} {sitekey} class="relative" />

  {#if chatOn && rules}
    <aside
      class="{CARD} {chatOpen ? 'fixed inset-x-3 bottom-12 top-16 z-30 flex sm:left-auto sm:w-96' : 'hidden'} min-h-0 flex-col p-3 lg:relative lg:inset-auto lg:z-auto lg:flex lg:w-auto 2xl:p-6"
      aria-label="Live chat"
    >
      <div class="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.25em] text-muted 2xl:text-sm">
        {onmod ? 'Live chat · you are host' : 'Live chat'}
        <button class="lg:hidden" onclick={() => (chatOpen = false)} aria-label="Close chat"><X size={16} /></button>
      </div>
      <Chat messages={live?.chat ?? []} onsay={onsay ?? ((n, t) => live?.say(n, t))} {onmod} {rules} status={s?.st ?? 'scheduled'} refused={live?.chatNo ?? null} />
    </aside>
  {/if}
</div>
