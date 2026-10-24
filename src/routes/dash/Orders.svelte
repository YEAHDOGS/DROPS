<script>
  // Orders ledger: who bought, where it ships, ship/refund, CSV for the warehouse.
  import { Download } from '@lucide/svelte'
  import { api } from '../../lib/api.js'
  import { money, toMajor } from '../../lib/time.js'
  import { BTN_GHOST, CARD, CHIP } from '../../lib/ui.js'

  const STATUS_CLS = { paid: 'bg-accent text-white', fulfilled: 'bg-ok/20 text-ok', refunded: 'bg-white/5 text-neutral-500' }
  /** @type {any[]} */
  let orders = $state([])
  let error = $state('')

  const load = () => api('/me/orders').then((o) => (orders = o), (e) => (error = e.message))
  $effect(() => void load())

  const address = (s) => (s?.address ? [s.address.line1, s.address.line2, s.address.city, s.address.state, s.address.postal_code, s.address.country].filter(Boolean).join(', ') : '')

  async function setStatus(o, status) {
    if (status === 'refunded' && !confirm(`Refund ${money(o.amount_cents, o.currency)} to ${o.email}?`)) return
    try {
      await api(`/me/orders/${o.id}`, { method: 'PUT', body: { status } })
      await load()
    } catch (e) {
      error = e.message
    }
  }

  function csv() {
    const rows = [['date', 'order', 'drop', 'qty', 'amount', 'currency', 'email', 'name', 'address', 'status'],
      ...orders.map((o) => [new Date(o.created_at).toISOString(), o.id, o.drop_id, o.qty, toMajor(o.amount_cents, o.currency), o.currency, o.email, o.name, address(o.shipping), o.status])]
    const text = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: 'orders.csv' })
    a.click()
    URL.revokeObjectURL(a.href)
  }
</script>

<div class="{CARD} flex h-full min-h-0 flex-col p-3 md:p-5 2xl:p-8">
  <div class="mb-3 flex items-center justify-between">
    <h2 class="text-xs font-black uppercase tracking-[.2em] 2xl:text-lg">{orders.length} orders</h2>
    <button class={BTN_GHOST} onclick={csv} disabled={!orders.length}><Download size={14} />CSV</button>
  </div>
  {#if error}<p class="mb-2 text-xs text-accent" role="alert">{error}</p>{/if}
  <ol class="selectable min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
    {#each orders as o (o.id)}
      <li class="grid gap-2 rounded-xl border border-white/5 p-3 text-sm sm:grid-cols-[1fr_auto] 2xl:text-lg">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-bold">{money(o.amount_cents, o.currency)}</span>
            <span class="text-muted">× {o.qty}</span>
            <span class="{CHIP} px-1.5! py-0.5! {STATUS_CLS[o.status]}">{o.status}</span>
            <span class="text-[11px] text-muted">{new Date(o.created_at).toLocaleString()}</span>
          </div>
          <div class="mt-1 truncate text-xs text-neutral-400 2xl:text-base">{o.name ?? ''} · {o.email ?? ''}</div>
          {#if o.shipping}<div class="truncate text-xs text-neutral-500 2xl:text-base">{address(o.shipping)}</div>{/if}
        </div>
        {#if o.status === 'paid'}
          <div class="flex gap-2 sm:flex-col">
            <button class={BTN_GHOST} onclick={() => setStatus(o, 'fulfilled')}>Shipped</button>
            <button class={BTN_GHOST} onclick={() => setStatus(o, 'refunded')}>Refund</button>
          </div>
        {/if}
      </li>
    {:else}
      <li class="p-6 text-center text-xs uppercase tracking-widest text-muted">No orders yet. They land here the second Stripe confirms.</li>
    {/each}
  </ol>
</div>
