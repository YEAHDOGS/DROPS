<script>
  // Drop editor. Times are typed in any zone and stored as UTC; the preview shows the moment around the world.
  import { untrack } from 'svelte'
  import { ImagePlus, Plus, Trash2 } from '@lucide/svelte'
  import Field from '../../components/Field.svelte'
  import { api } from '../../lib/api.js'
  import { LOCAL_ZONE, WORLD_ZONES, ZONES, money, toMajor, toMinor, utcToZoned, when, zonedToUtc } from '../../lib/time.js'
  import { CROWDS, CURRENCIES, LIMITS, slugify } from '../../../shared/drop.js'
  import { BTN, BTN_GHOST, INPUT, LABEL, STRINGS } from '../../lib/ui.js'

  /** @type {{ drop: any, me: any, onsaved: (d: any) => void, ondeleted: () => void }} */
  let { drop, me, onsaved, ondeleted } = $props()

  const HOUR = 3_600_000
  const WINDOW_MS = { '1h': HOUR, '24h': 24 * HOUR, '7d': 168 * HOUR }
  const STATE_POLL_MS = 3000
  const nextHour = Math.ceil(Date.now() / HOUR) * HOUR

  const d = untrack(() => drop) ?? {} // a snapshot on purpose: Drops.svelte re-keys this editor per drop
  let f = $state({
    title: d.title ?? '',
    slug: d.slug ?? '',
    description: d.description ?? '',
    price: d.priceCents ? toMajor(d.priceCents, d.currency) : 40,
    currency: d.currency ?? 'usd',
    totalStock: d.totalStock ?? 100,
    variants: (d.variants ?? []).filter((v) => v.label).map((v) => ({ ...v })),
    maxPerOrder: d.maxPerOrder ?? 1,
    zone: LOCAL_ZONE,
    start: utcToZoned(d.startsAt ?? nextHour + 24 * HOUR, LOCAL_ZONE),
    window: d.endsAt ? 'custom' : 'none',
    end: d.endsAt ? utcToZoned(d.endsAt, LOCAL_ZONE) : '',
    holdMinutes: d.holdMinutes ?? 10,
    crowd: Object.keys(CROWDS).find((k) => CROWDS[k] === d.shards) ?? 'medium',
    chat: d.chat ?? true,
    published: d.published ?? false,
    media: d.media ?? [],
  })
  let error = $state('')
  let busy = $state(false)
  let uploading = $state(0)
  /** @type {any} */
  let stats = $state(null)

  const startsAt = $derived(f.start ? zonedToUtc(f.start, f.zone) : 0)
  const endsAt = $derived(f.window === 'none' ? null : f.window === 'custom' ? (f.end ? zonedToUtc(f.end, f.zone) : null) : startsAt + WINDOW_MS[f.window])

  $effect(() => {
    if (!drop?.id) return
    const poll = () => api(`/me/drops/${drop.id}/state`).then((s) => (stats = s), () => {})
    poll()
    const t = setInterval(poll, STATE_POLL_MS)
    return () => clearInterval(t)
  })

  async function upload(e) {
    const files = [...e.currentTarget.files]
    e.currentTarget.value = ''
    for (const file of files.slice(0, LIMITS.MEDIA - f.media.length)) {
      uploading++
      try {
        f.media.push(await api('/me/media', { file }))
      } catch (err) {
        error = err.message
      } finally {
        uploading--
      }
    }
  }

  async function remove() {
    if (!confirm(`Delete "${drop.title}"? This can't be undone.`)) return
    try {
      await api(`/me/drops/${drop.id}`, { method: 'DELETE' })
      ondeleted()
    } catch (err) {
      error = err.message
    }
  }

  const addVariant = () => f.variants.push({ id: '', label: '', stock: f.variants.length ? 0 : Number(f.totalStock) })
  const totalOf = (vs) => vs.reduce((a, v) => a + (Number(v.stock) || 0), 0)

  async function save(e) {
    e.preventDefault()
    busy = true
    error = ''
    try {
      const body = {
        ...f, slug: f.slug || slugify(f.title), priceCents: toMinor(f.price, f.currency), startsAt, endsAt,
        totalStock: Number(f.totalStock), variants: f.variants.map((v) => ({ ...v, stock: Number(v.stock) })), maxPerOrder: Number(f.maxPerOrder), holdMinutes: Number(f.holdMinutes), shards: CROWDS[f.crowd],
      }
      onsaved(await api(drop ? `/me/drops/${drop.id}` : '/me/drops', { method: drop ? 'PUT' : 'POST', body }))
    } catch (err) {
      error = err.message
    } finally {
      busy = false
    }
  }
</script>

<form class="flex min-h-0 flex-1 flex-col" onsubmit={save}>
  <div class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 2xl:space-y-7">
    {#if stats}
      <div class="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
        {#each [['Left', stats.a], ['In checkout', stats.held], ['Sold', stats.s], ['Watching', stats.v], ['Peak crowd', stats.peak], ['Sold out', stats.soldOutAt ? new Date(stats.soldOutAt).toLocaleTimeString() : '—']] as [k, v]}
          <div class="rounded-xl bg-black/40 p-2 2xl:p-4"><div class="text-xl font-black tabular-nums 2xl:text-4xl">{v}</div><div class="text-[9px] uppercase tracking-widest text-muted 2xl:text-sm">{k}</div></div>
        {/each}
      </div>
    {/if}

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Field label="Title" class="sm:col-span-2 xl:col-span-2"><input class={INPUT} bind:value={f.title} maxlength={LIMITS.TITLE} required placeholder="Kid A — 100 vinyl pressings" /></Field>
      <Field label="Link" hint="{me.origin ?? ''}/{me.handle}/{f.slug || slugify(f.title) || '…'}">
        <input class={INPUT} bind:value={f.slug} maxlength={LIMITS.SLUG} placeholder={slugify(f.title) || 'kid-a'} />
      </Field>
      <Field label="Description" class="sm:col-span-2 xl:col-span-3"><textarea class="{INPUT} h-20 resize-none 2xl:h-32" bind:value={f.description} maxlength={LIMITS.DESC}></textarea></Field>
    </div>

    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Field label="Price" hint={money(toMinor(f.price, f.currency), f.currency)}><input class={INPUT} type="number" min="0.5" step="0.01" bind:value={f.price} required /></Field>
      <Field label="Currency">
        <select class={INPUT} bind:value={f.currency}>{#each CURRENCIES as c}<option value={c}>{c.toUpperCase()}</option>{/each}</select>
      </Field>
      {#if f.variants.length}
        <Field label="Stock" hint="Sum of the options below"><input class="{INPUT} opacity-60" value={totalOf(f.variants)} disabled /></Field>
      {:else}
        <Field label="Stock"><input class={INPUT} type="number" min="1" max={LIMITS.MAX_STOCK} bind:value={f.totalStock} required /></Field>
      {/if}
      <Field label="Max per person"><input class={INPUT} type="number" min="1" max={LIMITS.MAX_PER_ORDER} bind:value={f.maxPerOrder} required /></Field>
    </div>

    <div>
      <span class={LABEL}>Options (sizes, colors)</span>
      {#each f.variants as v, i}
        <div class="mb-2 flex gap-2">
          <input class={INPUT} bind:value={v.label} maxlength={LIMITS.VARIANT_LABEL} placeholder="Size M" aria-label="Option name" required />
          <input class="{INPUT} w-24! sm:w-32!" type="number" min="0" bind:value={v.stock} aria-label="Option stock" required />
          <button type="button" class={BTN_GHOST} onclick={() => f.variants.splice(i, 1)} aria-label="Remove option"><Trash2 size={14} /></button>
        </div>
      {/each}
      {#if f.variants.length < LIMITS.VARIANTS}
        <button type="button" class={BTN_GHOST} onclick={addVariant}><Plus size={14} />{f.variants.length ? 'Option' : 'Split stock into options'}</button>
      {/if}
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Drops at"><input class={INPUT} type="datetime-local" bind:value={f.start} required /></Field>
      <Field label="Time zone">
        <select class={INPUT} bind:value={f.zone}>{#each ZONES as z}<option value={z}>{z.replace(/_/g, ' ')}</option>{/each}</select>
      </Field>
      <Field label="Sale window">
        <select class={INPUT} bind:value={f.window}>{#each Object.entries(STRINGS.windows) as [k, v]}<option value={k}>{v}</option>{/each}</select>
      </Field>
      {#if f.window === 'custom'}
        <Field label="Ends at"><input class={INPUT} type="datetime-local" bind:value={f.end} required /></Field>
      {/if}
    </div>
    {#if startsAt}
      <ul class="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-neutral-400 sm:grid-cols-3 2xl:text-base">
        {#each WORLD_ZONES as z}<li class="truncate"><span class="text-muted">{z.split('/')[1].replace('_', ' ')}</span> {when(startsAt, z)}</li>{/each}
        {#if endsAt}<li class="col-span-full text-accent">Closes {when(endsAt)}</li>{/if}
      </ul>
    {/if}

    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Field label="Crowd size" hint="Sizes the live broadcast tree">
        <select class={INPUT} bind:value={f.crowd}>{#each Object.entries(STRINGS.crowds) as [k, v]}<option value={k}>{v}</option>{/each}</select>
      </Field>
      <Field label="Checkout hold" hint="Minutes a unit waits for payment">
        <input class={INPUT} type="number" min={LIMITS.MIN_HOLD_MIN} max={LIMITS.MAX_HOLD_MIN} bind:value={f.holdMinutes} />
      </Field>
      <label class="flex items-center gap-2 text-sm 2xl:text-lg"><input type="checkbox" class="h-4 w-4 accent-accent" bind:checked={f.chat} />Live chat</label>
      <label class="flex items-center gap-2 text-sm 2xl:text-lg"><input type="checkbox" class="h-4 w-4 accent-accent" bind:checked={f.published} />Published</label>
    </div>

    <div>
      <span class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[.2em] text-muted 2xl:text-sm">Images & video</span>
      <div class="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8">
        {#each f.media as m, i (m.url)}
          <div class="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-black/40">
            {#if m.kind === 'video'}<video src={m.url} class="h-full w-full object-cover" muted playsinline></video>{:else}<img src={m.url} alt="" class="h-full w-full object-cover" />{/if}
            <button type="button" class="absolute right-1 top-1 rounded bg-black/70 p-1 opacity-80 hover:bg-accent" onclick={() => f.media.splice(i, 1)} aria-label="Remove"><Trash2 size={12} /></button>
          </div>
        {/each}
        {#if f.media.length < LIMITS.MEDIA}
          <label class="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-[10px] uppercase tracking-widest text-muted transition hover:border-accent/60 hover:text-white">
            <ImagePlus size={18} />{uploading ? `${uploading}…` : 'Add'}
            <input type="file" class="sr-only" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm" multiple onchange={upload} />
          </label>
        {/if}
      </div>
    </div>
  </div>

  <div class="mt-3 flex items-center gap-3 border-t border-white/5 pt-3">
    {#if error}<p class="flex-1 text-xs text-accent 2xl:text-base" role="alert">{error}</p>{:else}<span class="flex-1"></span>{/if}
    {#if drop}<button type="button" class={BTN_GHOST} onclick={remove} aria-label="Delete drop"><Trash2 size={14} /></button>{/if}
    {#if drop?.published}<a class={BTN_GHOST} href="/{me.handle}/{drop.slug}" target="_blank" rel="noopener">View</a>{/if}
    <button class={BTN} disabled={busy || uploading > 0}>{drop ? 'Save' : 'Create drop'}</button>
  </div>
</form>
