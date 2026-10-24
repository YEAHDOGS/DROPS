<script>
  // Shop: look, payouts, shipping + invoicing. Saving re-publishes every drop's checkout recipe.
  import { Plus, Trash2 } from '@lucide/svelte'
  import Field from '../../components/Field.svelte'
  import { api } from '../../lib/api.js'
  import { toMajor, toMinor } from '../../lib/time.js'
  import { LIMITS } from '../../../shared/drop.js'
  import { BTN, BTN_GHOST, CARD, INPUT } from '../../lib/ui.js'

  /** @type {{ me: any, onsaved: () => void }} */
  let { me, onsaved } = $props()

  const FONTS = { sans: 'Clean sans', mono: 'Mono', serif: 'Serif', display: 'Heavy display' }
  const DEFAULT_ACCENT = '#ff3344'
  const DEFAULT_BG = '#050508'
  const SECTION = `${CARD} space-y-3 p-4 2xl:space-y-5 2xl:p-8`
  const H = 'text-xs font-black uppercase tracking-[.2em] 2xl:text-lg'

  const m = me
  let f = $state({
    name: m.name,
    payoutMode: m.payoutMode,
    theme: { accent: m.theme.accent ?? DEFAULT_ACCENT, bg: m.theme.bg ?? DEFAULT_BG, font: m.theme.font ?? 'sans', tagline: m.theme.tagline ?? '' },
    countries: (m.shipping.countries ?? []).join(', '),
    rates: (m.shipping.rates ?? []).map((r) => ({ label: r.label, amount: toMajor(r.amountCents) })),
    from: m.shipping.from ?? '',
    invoiceNote: m.shipping.invoiceNote ?? '',
  })
  let msg = $state('')
  let busy = $state(false)

  async function save(e) {
    e.preventDefault()
    busy = true
    msg = ''
    try {
      await api('/me', {
        method: 'PUT',
        body: {
          name: f.name, payoutMode: f.payoutMode, theme: f.theme,
          shipping: {
            countries: f.countries.split(/[\s,]+/).filter(Boolean).map((c) => c.toUpperCase()),
            rates: f.rates.map((r) => ({ label: r.label, amountCents: toMinor(r.amount) })),
            from: f.from, invoiceNote: f.invoiceNote,
          },
        },
      })
      msg = 'Saved. Every drop is updated.'
      onsaved()
    } catch (err) {
      msg = err.message
    } finally {
      busy = false
    }
  }

  async function connect() {
    busy = true
    try {
      location.assign((await api('/me/stripe', { method: 'POST' })).url)
    } catch (err) {
      msg = err.message
      busy = false
    }
  }
</script>

<form class="flex h-full min-h-0 flex-col" onsubmit={save}>
  <div class="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pr-1 lg:grid-cols-2 2xl:grid-cols-3 2xl:gap-6">
    <section class={SECTION}>
      <h2 class={H}>Look</h2>
      <Field label="Shop name"><input class={INPUT} bind:value={f.name} maxlength={LIMITS.NAME} required /></Field>
      <Field label="Tagline"><input class={INPUT} bind:value={f.theme.tagline} maxlength="140" placeholder="Pressed in small batches." /></Field>
      <div class="grid grid-cols-3 gap-2">
        <Field label="Accent"><input type="color" class="h-10 w-full cursor-pointer rounded-lg border border-white/10 bg-black/40" bind:value={f.theme.accent} /></Field>
        <Field label="Background"><input type="color" class="h-10 w-full cursor-pointer rounded-lg border border-white/10 bg-black/40" bind:value={f.theme.bg} /></Field>
        <Field label="Font"><select class={INPUT} bind:value={f.theme.font}>{#each Object.entries(FONTS) as [k, v]}<option value={k}>{v}</option>{/each}</select></Field>
      </div>
      <div class="rounded-xl border border-white/10 p-3 text-sm" style="background: {f.theme.bg}">
        <span class="font-black uppercase tracking-widest">{f.name}</span>
        <span class="ml-2 rounded-md px-2 py-1 text-xs font-bold uppercase" style="background: {f.theme.accent}">Buy</span>
      </div>
    </section>

    <section class={SECTION}>
      <h2 class={H}>Payouts</h2>
      {#each [['platform', 'DOGS handles the money', 'Sell today. We collect through our Stripe and pay you out.'], ['connect', 'Connect my Stripe', 'Payments land in your own Stripe account, minus the platform fee.']] as [k, title, text]}
        <label class="flex cursor-pointer gap-3 rounded-xl border p-3 transition {f.payoutMode === k ? 'border-accent/60 bg-accent/10' : 'border-white/10'}">
          <input type="radio" class="mt-1 accent-accent" bind:group={f.payoutMode} value={k} />
          <span><span class="block text-sm font-bold 2xl:text-lg">{title}</span><span class="text-xs text-neutral-400 2xl:text-base">{text}</span></span>
        </label>
      {/each}
      {#if f.payoutMode === 'connect'}
        <div class="flex items-center justify-between gap-2 text-xs 2xl:text-base">
          <span class={me.stripeReady ? 'text-ok' : 'text-neutral-400'}>{me.stripeReady ? 'Stripe connected and ready' : me.stripeAccountId ? 'Finish Stripe onboarding' : 'Not connected yet'}</span>
          {#if !me.stripeReady}<button type="button" class={BTN_GHOST} onclick={connect} disabled={busy}>Connect Stripe</button>{/if}
        </div>
      {/if}
    </section>

    <section class="{SECTION} lg:col-span-2 2xl:col-span-1">
      <h2 class={H}>Shipping & invoices</h2>
      <Field label="Ship to countries" hint="2-letter codes, e.g. US, CA, GB. Leave empty for digital or pickup."><input class={INPUT} bind:value={f.countries} placeholder="US, CA, GB" /></Field>
      <div>
        {#each f.rates as r, i}
          <div class="mb-2 flex gap-2">
            <input class={INPUT} bind:value={r.label} placeholder="Standard" aria-label="Rate name" />
            <input class="{INPUT} w-28!" type="number" min="0" step="0.01" bind:value={r.amount} aria-label="Rate price" />
            <button type="button" class={BTN_GHOST} onclick={() => f.rates.splice(i, 1)} aria-label="Remove rate"><Trash2 size={14} /></button>
          </div>
        {/each}
        {#if f.rates.length < 5}<button type="button" class={BTN_GHOST} onclick={() => f.rates.push({ label: '', amount: 0 })}><Plus size={14} />Shipping rate</button>{/if}
      </div>
      <Field label="Ships from"><textarea class="{INPUT} h-16 resize-none" bind:value={f.from} maxlength="300"></textarea></Field>
      <Field label="Invoice note" hint="Printed on every Stripe invoice"><input class={INPUT} bind:value={f.invoiceNote} maxlength="500" /></Field>
    </section>
  </div>
  <div class="mt-3 flex items-center gap-3 border-t border-white/5 pt-3">
    <p class="flex-1 text-xs text-neutral-400 2xl:text-base" role="status">{msg}</p>
    <button class={BTN} disabled={busy}>Save shop</button>
  </div>
</form>
