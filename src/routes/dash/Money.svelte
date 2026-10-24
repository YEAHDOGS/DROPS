<script>
  // Money: what you're owed, pay out now or daily, payout history. Connect-mode shops are paid on every sale.
  import { Banknote, CalendarClock, Landmark } from '@lucide/svelte'
  import Field from '../../components/Field.svelte'
  import { api } from '../../lib/api.js'
  import { money } from '../../lib/time.js'
  import { BTN, BTN_GHOST, CARD, INPUT, STRINGS } from '../../lib/ui.js'

  /** @type {{ me: any }} */
  let { me } = $props()
  const SECTION = `${CARD} space-y-3 p-4 md:p-5 2xl:space-y-5 2xl:p-8`
  const H = 'flex items-center gap-2 text-xs font-black uppercase tracking-[.2em] 2xl:text-lg'

  /** @type {any} */
  let data = $state(null)
  let msg = $state('')
  let busy = $state(false)

  const load = () => api('/me/payouts').then((d) => (data = d), (e) => (msg = e.message))
  $effect(() => void load())

  const feeText = $derived(`${me.fees.bps / 100}% + ${money(me.fees.fixedCents)} per order`)

  async function payNow() {
    busy = true
    msg = ''
    try {
      let total = 0
      for (let more = true; more; ) {
        const r = await api('/me/payouts', { method: 'POST' })
        total += r.paid
        more = r.more
      }
      msg = total ? `Sent ${total} orders to your Stripe. Stripe moves it to your bank on your payout schedule.` : 'Nothing owed right now.'
      await load()
    } catch (err) {
      msg = err.message
    } finally {
      busy = false
    }
  }

  async function setSchedule(e) {
    await api('/me/payouts', { method: 'PUT', body: { schedule: e.currentTarget.value } }).catch((err) => (msg = err.message))
    await load()
  }

  async function connect() {
    busy = true
    try {
      location.assign((await api('/me/stripe', { method: 'POST', body: { forPayouts: true } })).url)
    } catch (err) {
      msg = err.message
      busy = false
    }
  }
</script>

<div class="grid h-full min-h-0 content-start gap-3 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3 2xl:gap-6">
  {#if me.payoutMode === 'connect'}
    <section class="{SECTION} md:col-span-2 xl:col-span-3">
      <h2 class={H}><Landmark size={16} class="text-accent" />Paid on every sale</h2>
      <p class="text-sm text-neutral-300 2xl:text-lg">Your shop uses your own Stripe. Each sale lands in your Stripe balance minus {feeText}. Nothing waits here.</p>
    </section>
  {:else if data}
    <section class={SECTION}>
      <h2 class={H}><Banknote size={16} class="text-accent" />Owed to you</h2>
      {#each data.owed as o}
        <p class="text-3xl font-black tabular-nums 2xl:text-6xl">{money(o.net, o.currency)}</p>
        <p class="text-xs text-neutral-400 2xl:text-base">{o.orders} orders · {money(o.gross, o.currency)} sales minus {feeText}</p>
      {:else}
        <p class="text-3xl font-black tabular-nums 2xl:text-6xl">{money(0)}</p>
        <p class="text-xs text-neutral-400 2xl:text-base">You're all paid up.</p>
      {/each}
      {#if data.hasAccount}
        <button class="{BTN} w-full" onclick={payNow} disabled={busy || !data.owed.length}>Pay me out now</button>
      {:else}
        <button class="{BTN} w-full" onclick={connect} disabled={busy}>Set up payouts with Stripe</button>
        <p class="text-[11px] text-neutral-500 2xl:text-sm">Stripe verifies who gets paid. Takes about five minutes, once.</p>
      {/if}
    </section>

    <section class={SECTION}>
      <h2 class={H}><CalendarClock size={16} class="text-accent" />Schedule</h2>
      <Field label="Pay me">
        <select class={INPUT} value={data.schedule} onchange={setSchedule}>{#each Object.entries(STRINGS.payoutSchedules) as [k, v]}<option value={k}>{v}</option>{/each}</select>
      </Field>
      <p class="text-xs text-neutral-400 2xl:text-base">Payouts go to your Stripe account, then to your bank on Stripe's schedule (usually 2 business days).</p>
    </section>

    <section class="{SECTION} md:col-span-2 xl:col-span-1">
      <h2 class={H}>History</h2>
      <ol class="selectable space-y-1.5 text-sm 2xl:text-lg">
        {#each data.payouts as p (p.id)}
          <li class="flex justify-between gap-2 border-b border-white/5 pb-1.5">
            <span class="text-neutral-400">{new Date(p.created_at).toLocaleDateString()} · {p.orders} orders · {p.trigger}</span>
            <span class="font-bold tabular-nums">{money(p.amount_cents, p.currency)}</span>
          </li>
        {:else}
          <li class="text-xs text-muted">No payouts yet.</li>
        {/each}
      </ol>
    </section>
  {/if}
  {#if msg}<p class="text-xs text-neutral-300 md:col-span-2 xl:col-span-3 2xl:text-base" role="status">{msg}</p>{/if}
  {#if data?.hasAccount && me.payoutMode !== 'connect'}
    <button class="{BTN_GHOST} justify-self-start" onclick={connect} disabled={busy}>Update payout details in Stripe</button>
  {/if}
</div>
