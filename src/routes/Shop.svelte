<script>
  // drops.dogs.red/:handle[/:slug] — the live drop room. Data + connection + layout; the panels do the rest.
  import { Eye, MessageCircle, Volume2, VolumeX, X } from '@lucide/svelte'
  import Shell from '../components/Shell.svelte'
  import Media from '../components/Media.svelte'
  import BuyPanel from '../components/BuyPanel.svelte'
  import Chat from '../components/Chat.svelte'
  import { api } from '../lib/api.js'
  import { LiveDrop } from '../lib/live.svelte.js'
  import { ding, unlockSound } from '../lib/sound.js'
  import { route, navigate } from '../lib/router.svelte.js'
  import { BTN_GHOST, CARD, CHIP, SPINNER } from '../lib/ui.js'

  /** @type {{ handle: string, slug?: string }} */
  let { handle, slug } = $props()

  const FONTS = {
    sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    serif: 'Georgia, "Times New Roman", serif',
    display: '"Arial Black", Impact, "Helvetica Neue", sans-serif',
  }
  const CLOCK_MS = 250
  const GRID = {
    split: { base: 'sm:grid-cols-2', chat: 'lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(15rem,19rem)] xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_30rem]' },
    poster: { base: 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]', chat: 'lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)_minmax(15rem,19rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)_30rem]' },
  }
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

  /** @type {{ shop: any, drops: any[], turnstile: string | null } | null} */
  let data = $state(null)
  let error = $state('')
  /** @type {LiveDrop | null} */
  let live = $state(null)
  /** @type {any} signed-in merchant, if any: the owner gets moderation tools */
  let me = $state(null)
  let now = $state(Date.now())
  let sound = $state(false)
  let chatOpen = $state(false)
  let notice = $state('')

  $effect(() => {
    api(`/s/${handle}`).then((d) => (data = d), (e) => (error = e.message))
    api('/me').then((m) => (me = m), () => {})
  })

  const drop = $derived.by(() => {
    if (!data) return null
    if (slug) return data.drops.find((d) => d.slug === slug) ?? null
    const t = Date.now()
    const open = data.drops.filter((d) => !d.endsAt || d.endsAt > t)
    return open.find((d) => d.startsAt <= t) ?? open[0] ?? data.drops.at(-1) ?? null
  })

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

  const isOwner = $derived(me?.handle === handle)
  const say = (name, text) => (isOwner ? api(`/me/drops/${drop.id}/say`, { method: 'POST', body: { text } }) : live?.say(name, text))
  const moderate = (m, ban) => api(`/me/drops/${drop.id}/mod`, { method: 'POST', body: ban ? { del: [m.id], ban: [m.k] } : { del: [m.id] } })

  const s = $derived(live?.state)
  const theme = $derived(data?.shop.theme ?? {})
  const layout = $derived(GRID[theme.layout] ? theme.layout : 'split')
  const style = $derived(
    [theme.accent && `--color-accent: ${theme.accent}`, theme.bg && `--color-app: ${theme.bg}`, `--font-shop: ${FONTS[theme.font] ?? FONTS.sans}`].filter(Boolean).join('; '),
  )
</script>

<Shell title={data?.shop.name ?? handle} href="/{handle}" logo={theme.logo} links={theme.links ?? []} {style}>
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
      <p class="mt-2 text-sm text-muted">{theme.tagline || 'Check back soon.'}</p>
    </div>
  {:else if drop && data}
    <div class="relative grid min-h-0 flex-1 gap-3 grid-rows-[minmax(0,1fr)_auto] sm:grid-rows-1 md:gap-4 2xl:gap-8 {GRID[layout].base} {s?.ch ? GRID[layout].chat : ''}">
      {#if layout === 'poster'}
        <div class="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <Media media={drop.media} title={drop.title} />
          <div class="absolute inset-0 bg-linear-to-t from-app via-app/40 to-transparent sm:bg-linear-to-l"></div>
        </div>
        <div aria-hidden="true"></div>
      {:else}
        <Media media={drop.media} title={drop.title} />
      {/if}

      <BuyPanel {drop} {live} {now} drops={data.drops} {handle} {notice} ondismiss={() => (notice = '')} sitekey={data.turnstile} class="relative" />

      {#if s?.ch}
        <aside
          class="{CARD} {chatOpen ? 'fixed inset-x-3 bottom-12 top-16 z-30 flex sm:left-auto sm:w-96' : 'hidden'} min-h-0 flex-col p-3 lg:relative lg:inset-auto lg:z-auto lg:flex lg:w-auto 2xl:p-6"
          aria-label="Live chat"
        >
          <div class="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.25em] text-muted 2xl:text-sm">
            {isOwner ? 'Live chat · you are host' : 'Live chat'}
            <button class="lg:hidden" onclick={() => (chatOpen = false)} aria-label="Close chat"><X size={16} /></button>
          </div>
          <Chat messages={live?.chat ?? []} onsay={say} onmod={isOwner ? moderate : null} />
        </aside>
      {/if}
    </div>
  {:else}
    <div class={SPINNER}></div>
  {/if}

  {#snippet footer()}
    Times shown in your zone · {Intl.DateTimeFormat().resolvedOptions().timeZone}
  {/snippet}
</Shell>
