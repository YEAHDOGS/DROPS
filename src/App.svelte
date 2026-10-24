<script>
  import { route } from './lib/router.svelte.js'
  import Home from './routes/Home.svelte'
  import Shop from './routes/Shop.svelte'
  import Dash from './routes/Dash.svelte'

  const parts = $derived(route.path.split('/').filter(Boolean).map(decodeURIComponent))
</script>

{#if parts.length === 0}
  <Home />
{:else if parts[0] === 'dash'}
  <Dash />
{:else}
  {#key parts[0]}
    <Shop handle={parts[0].toLowerCase()} slug={parts[1]} />
  {/key}
{/if}
