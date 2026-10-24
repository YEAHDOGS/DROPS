<script>
  // drops.dogs.red/:handle[/:slug] — data + connection. The room itself is components/DropRoom.svelte.
  import Shell from '../components/Shell.svelte'
  import DropRoom from '../components/DropRoom.svelte'
  import RoomControls from '../components/RoomControls.svelte'
  import { api } from '../lib/api.js'
  import { LiveDrop } from '../lib/live.svelte.js'
  import { route, navigate } from '../lib/router.svelte.js'
  import { SPINNER } from '../lib/ui.js'

  /** @type {{ handle: string, slug?: string }} */
  let { handle, slug } = $props()

  const FONTS = {
    sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    serif: 'Georgia, "Times New Roman", serif',
    display: '"Arial Black", Impact, "Helvetica Neue", sans-serif',
  }

  /** @type {{ shop: any, drops: any[], turnstile: string | null } | null} */
  let data = $state(null)
  let error = $state('')
  /** @type {LiveDrop | null} */
  let live = $state(null)
  /** @type {any} signed-in merchant, if any: the owner gets moderation tools */
  let me = $state(null)
  let chatOpen = $state(false)
  let notice = $state('')

  $effect(() => {
    api(`/s/${handle}${slug ? `?d=${encodeURIComponent(slug)}` : ''}`).then((d) => (data = d), (e) => (error = e.message))
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

  const isOwner = $derived(me?.handle === handle)
  const hostSay = (name, text) => api(`/me/drops/${drop.id}/say`, { method: 'POST', body: { text } })
  const moderate = (m, ban) => api(`/me/drops/${drop.id}/mod`, { method: 'POST', body: ban ? { del: [m.id], ban: [m.k] } : { del: [m.id] } })

  const theme = $derived(data?.shop.theme ?? {})
  const style = $derived(
    [theme.accent && `--color-accent: ${theme.accent}`, theme.bg && `--color-app: ${theme.bg}`, `--font-shop: ${FONTS[theme.font] ?? FONTS.sans}`].filter(Boolean).join('; '),
  )
</script>

<Shell title={data?.shop.name ?? handle} href={drop?.link ?? `/${handle}`} logo={drop?.logo ?? theme.logo} links={theme.links ?? []} {style}>
  {#snippet right()}
    <RoomControls {live} bind:chatOpen />
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
    <DropRoom {live} {drop} drops={data.drops} {handle} layout={theme.layout} {notice} ondismiss={() => (notice = '')} sitekey={data.turnstile}
      bind:chatOpen onsay={isOwner ? hostSay : null} onmod={isOwner ? moderate : null} />
  {:else}
    <div class={SPINNER}></div>
  {/if}

  {#snippet footer()}
    Times shown in your zone · {Intl.DateTimeFormat().resolvedOptions().timeZone}
  {/snippet}
</Shell>
