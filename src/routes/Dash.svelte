<script>
  // drops.dogs.red/dash — the merchant console.
  import { ExternalLink, LogOut } from '@lucide/svelte'
  import Shell from '../components/Shell.svelte'
  import Auth from './dash/Auth.svelte'
  import Drops from './dash/Drops.svelte'
  import ShopSettings from './dash/ShopSettings.svelte'
  import Orders from './dash/Orders.svelte'
  import { api } from '../lib/api.js'
  import { BTN_GHOST } from '../lib/ui.js'

  const TABS = [['drops', 'Drops'], ['shop', 'Shop'], ['orders', 'Orders']]

  /** @type {any} */
  let me = $state(null)
  let loaded = $state(false)
  let tab = $state('drops')

  async function load() {
    me = await api('/me')
    loaded = true
  }
  $effect(() => void load())

  async function logout() {
    await api('/auth/logout', { method: 'POST' })
    me = null
  }
</script>

<Shell title={me ? me.name : 'DROPS'} href="/dash">
  {#snippet right()}
    {#if me}
      <a class="{BTN_GHOST} hidden sm:inline-flex" href="/{me.handle}" target="_blank" rel="noopener">/{me.handle}<ExternalLink size={14} /></a>
      <button class={BTN_GHOST} onclick={logout} aria-label="Sign out"><LogOut size={14} /></button>
    {/if}
  {/snippet}

  {#if !loaded}
    <div class="m-auto h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-accent"></div>
  {:else if !me}
    <Auth onauthed={load} />
  {:else}
    <div class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-5 2xl:gap-8">
      <nav class="flex shrink-0 gap-1 lg:w-44 lg:flex-col xl:w-48 2xl:w-64" aria-label="Dashboard">
        {#each TABS as [key, label]}
          <button
            class="flex-1 rounded-xl px-3 py-2 text-left text-xs font-bold uppercase tracking-widest transition lg:flex-none 2xl:py-4 2xl:text-lg {tab === key ? 'bg-accent text-white' : 'text-neutral-400 hover:bg-white/5'}"
            onclick={() => (tab = key)}
            aria-current={tab === key}>{label}</button>
        {/each}
      </nav>
      <div class="min-h-0 flex-1">
        {#if tab === 'drops'}<Drops {me} />{:else if tab === 'shop'}<ShopSettings {me} onsaved={load} />{:else}<Orders />{/if}
      </div>
    </div>
  {/if}
</Shell>
