<script>
  // /demo — build a drop in ten seconds, then watch it go live as a customer. Nothing leaves the browser.
  import { ImagePlus, Play, Trash2 } from '@lucide/svelte'
  import Shell from '../../components/Shell.svelte'
  import Field from '../../components/Field.svelte'
  import { draft } from '../../lib/demo-draft.svelte.js'
  import { DEMO_DEFAULTS } from '../../lib/sim.js'
  import { navigate } from '../../lib/router.svelte.js'
  import { toMajor, toMinor } from '../../lib/time.js'
  import { BTN, BTN_GHOST, CARD, CHIP, INPUT, LABEL, STRINGS } from '../../lib/ui.js'
  import { LIMITS, THEME_DEFAULTS, slugify } from '../../../shared/drop.js'
  import { CHAT_BOUNDS } from '../../../shared/chat.js'

  const OPENS_IN = { 5: 'in 5 seconds', 10: 'in 10 seconds', 30: 'in 30 seconds', 60: 'in a minute' }
  const SECTION = `${CARD} space-y-3 p-4 md:p-5 2xl:space-y-5 2xl:p-8`
  const MAX_OPTIONS = 6

  const c = draft.cfg
  let f = $state({
    shop: c.shop,
    title: c.title,
    description: c.description,
    price: toMajor(c.priceCents, c.currency),
    options: c.variants.map((v) => v.label).join(', '),
    stock: c.variants.reduce((a, v) => a + v.stock, 0),
    limit: c.maxPerOrder,
    mystery: c.mystery,
    teaser: c.teaser,
    startsInSec: c.startsInSec,
    chat: { ...c.chat },
    accent: c.accent ?? THEME_DEFAULTS.accent,
    media: [...c.media],
  })

  /** Split the stock evenly across the options ("S, M, L"), remainder to the first. */
  function variants() {
    const labels = f.options.split(',').map((x) => x.trim()).filter(Boolean).slice(0, MAX_OPTIONS)
    const stock = Math.max(1, Math.min(LIMITS.MAX_STOCK, Math.round(Number(f.stock) || 1)))
    if (labels.length < 2) return [{ id: 'one', label: '', stock }]
    const each = Math.floor(stock / labels.length)
    return labels.map((label, i) => ({ id: slugify(label) || `opt-${i}`, label, stock: each + (i === 0 ? stock - each * labels.length : 0) }))
  }

  function addImage(e) {
    const [file] = e.currentTarget.files
    if (file) f.media = [{ url: URL.createObjectURL(file), kind: file.type.startsWith('video/') ? 'video' : 'image' }]
  }

  function launch(e) {
    e?.preventDefault()
    draft.cfg = {
      ...DEMO_DEFAULTS, shop: f.shop || 'Your shop', title: f.title || 'Your drop', description: f.description, priceCents: Math.max(50, toMinor(f.price)),
      variants: variants(), maxPerOrder: Math.max(1, Math.min(LIMITS.MAX_PER_ORDER, Number(f.limit) || 1)), mystery: f.mystery, teaser: f.teaser,
      startsInSec: Number(f.startsInSec), chat: { ...f.chat }, accent: f.accent, media: f.media,
    }
    navigate('/demo/live')
  }

  function skip() {
    draft.cfg = { ...DEMO_DEFAULTS }
    navigate('/demo/live')
  }
</script>

<Shell title="Demo" href="/demo">
  {#snippet right()}
    <button class={BTN_GHOST} onclick={skip}><Play size={14} />Skip, show me a drop</button>
  {/snippet}

  <form class="flex min-h-0 flex-1 flex-col" onsubmit={launch}>
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <span class="{CHIP} bg-accent/15 text-accent">Demo</span>
      <p class="text-xs text-neutral-400 2xl:text-lg">Build a drop, then watch it go live from the customer side, with a simulated crowd. Nothing is saved or charged.</p>
    </div>
    <div class="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3 2xl:gap-6">
      <section class={SECTION}>
        <Field label="Shop name"><input class={INPUT} bind:value={f.shop} maxlength={LIMITS.NAME} /></Field>
        <Field label="Product"><input class={INPUT} bind:value={f.title} maxlength={LIMITS.TITLE} required /></Field>
        <Field label="Description"><textarea class="{INPUT} h-16 resize-none" bind:value={f.description} maxlength="300"></textarea></Field>
        <div class="flex items-center gap-3">
          <label class="flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/15 hover:border-accent/60" aria-label="Add a photo">
            {#if f.media[0]?.kind === 'image'}<img src={f.media[0].url} alt="" class="h-full w-full object-cover" />{:else}<ImagePlus size={18} class="text-muted" />{/if}
            <input type="file" class="sr-only" accept="image/*,video/mp4,video/webm" onchange={addImage} />
          </label>
          <span class="text-xs text-neutral-400 2xl:text-base">{f.media.length ? 'Photo stays on your device.' : 'Add a photo (optional)'}</span>
          {#if f.media.length}<button type="button" class={BTN_GHOST} onclick={() => (f.media = [])} aria-label="Remove photo"><Trash2 size={14} /></button>{/if}
        </div>
      </section>

      <section class={SECTION}>
        <div class="grid grid-cols-2 gap-3">
          <Field label="Price (USD)"><input class={INPUT} type="number" min="0.5" step="0.01" bind:value={f.price} /></Field>
          <Field label="Stock"><input class={INPUT} type="number" min="1" max="100000" bind:value={f.stock} /></Field>
          <Field label="Limit per person"><input class={INPUT} type="number" min="1" max={LIMITS.MAX_PER_ORDER} bind:value={f.limit} /></Field>
          <Field label="Goes live">
            <select class={INPUT} bind:value={f.startsInSec}>{#each Object.entries(OPENS_IN) as [k, v]}<option value={Number(k)}>{v}</option>{/each}</select>
          </Field>
        </div>
        <Field label="Options" hint="Comma separated, stock split evenly. Leave empty for one option."><input class={INPUT} bind:value={f.options} placeholder="S, M, L" /></Field>
        <label class="flex items-center gap-2 text-sm 2xl:text-lg"><input type="checkbox" class="h-4 w-4 accent-accent" bind:checked={f.mystery} />Mystery drop (hidden until it opens)</label>
        {#if f.mystery}<Field label="Teaser"><input class={INPUT} bind:value={f.teaser} maxlength={LIMITS.TEASER} /></Field>{/if}
      </section>

      <section class="{SECTION} md:col-span-2 xl:col-span-1">
        <span class={LABEL}>Live chat</span>
        <div class="grid grid-cols-2 gap-3">
          <Field label="Who can post">
            <select class={INPUT} bind:value={f.chat.mode}>{#each Object.entries(STRINGS.chatModes) as [k, v]}<option value={k}>{v}</option>{/each}</select>
          </Field>
          <Field label="Slow mode (s)"><input class={INPUT} type="number" min={CHAT_BOUNDS.SLOW_MIN} max={CHAT_BOUNDS.SLOW_MAX} bind:value={f.chat.slowSec} /></Field>
        </div>
        <label class="flex items-center gap-2 text-sm 2xl:text-lg"><input type="checkbox" class="h-4 w-4 accent-accent" bind:checked={f.chat.links} />Allow links</label>
        <Field label="Accent"><input type="color" class="h-10 w-full cursor-pointer rounded-lg border border-white/10 bg-black/40" bind:value={f.accent} /></Field>
      </section>
    </div>
    <div class="mt-3 flex items-center justify-end gap-2 border-t border-white/5 pt-3">
      <button type="button" class={BTN_GHOST} onclick={skip}>Skip</button>
      <button class={BTN}><Play size={16} />Launch my demo drop</button>
    </div>
  </form>
</Shell>
