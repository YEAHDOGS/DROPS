<script>
  // drops.dogs.red/dash — the merchant console. Phones: thumb tab bar at the bottom. Tablet up: side rail.
  import { ExternalLink, Package, Receipt, Store, UserRound, Wallet } from '@lucide/svelte'
  import Shell from '../components/Shell.svelte'
  import Auth from './dash/Auth.svelte'
  import Drops from './dash/Drops.svelte'
  import ShopSettings from './dash/ShopSettings.svelte'
  import Orders from './dash/Orders.svelte'
  import Account from './dash/Account.svelte'
  import Money from './dash/Money.svelte'
  import { api } from '../lib/api.js'
  import { BTN_GHOST, SPINNER, STRINGS } from '../lib/ui.js'

  const TABS = [['drops', Package], ['shop', Store], ['orders', Receipt], ['money', Wallet], ['account', UserRound]]

  /** @type {any} */
  let me = $state(null)
  let loaded = $state(false)
  let tab = $state('drops')

  async function load() {
    me = await api('/me').catch(() => null)
    loaded = true
  }
  $effect(() => void load())
</script>

<Shell title={me ? me.name : 'DROPS'} href="/dash">
  {#snippet right()}
    {#if me}
      <a class={BTN_GHOST} href="/{me.handle}" target="_blank" rel="noopener"><span class="hidden sm:inline">/{me.handle}</span><ExternalLink size={14} /></a>
    {/if}
  {/snippet}

  {#if !loaded}
    <div class={SPINNER}></div>
  {:else if !me}
    <Auth onauthed={load} />
  {:else}
    <div class="flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-4 lg:gap-5 2xl:gap-8">
      <nav
        class="order-last grid shrink-0 grid-cols-5 gap-1 rounded-2xl border border-white/5 bg-card/80 p-1 md:order-first md:flex md:w-20 md:flex-col md:border-0 md:bg-transparent md:p-0 lg:w-44 2xl:w-64"
        aria-label="Dashboard"
      >
        {#each TABS as [key, Icon]}
          <button
            class="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-bold uppercase tracking-widest transition sm:flex-row sm:justify-center sm:text-xs lg:justify-start lg:px-3 2xl:py-4 2xl:text-lg short:py-1.5 {tab === key ? 'bg-accent text-white' : 'text-neutral-400 hover:bg-white/5'} md:flex-col md:py-3 lg:flex-row"
            onclick={() => (tab = key)}
            aria-current={tab === key}
          >
            <Icon size={18} />{STRINGS.dashTabs[key]}
          </button>
        {/each}
      </nav>
      <div class="min-h-0 flex-1">
        {#if tab === 'drops'}<Drops {me} />{:else if tab === 'shop'}<ShopSettings {me} onsaved={load} />{:else if tab === 'orders'}<Orders />{:else if tab === 'money'}<Money {me} />{:else}<Account {me} onsignedout={() => (me = null)} />{/if}
      </div>
    </div>
  {/if}
</Shell>
