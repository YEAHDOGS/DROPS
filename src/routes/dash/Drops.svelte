<script>
  // Master/detail: drop list + editor side by side from tablet up; one at a time on phones.
  import { ChevronLeft, Plus } from '@lucide/svelte'
  import DropEditor from './DropEditor.svelte'
  import { api } from '../../lib/api.js'
  import { when } from '../../lib/time.js'
  import { dropStatus } from '../../../shared/drop.js'
  import { BTN, CARD, CHIP, STATUS_UI } from '../../lib/ui.js'

  /** @type {{ me: any }} */
  let { me } = $props()
  /** @type {any[]} */
  let drops = $state([])
  /** @type {string|null} 'new' | drop id | null */
  let selected = $state(null)

  async function load(select = selected) {
    drops = await api('/me/drops')
    selected = select ?? drops[0]?.id ?? 'new'
  }
  $effect(() => void load())

  const current = $derived(drops.find((d) => d.id === selected) ?? null)
</script>

<div class="grid h-full min-h-0 gap-3 md:grid-cols-[14rem_1fr] lg:grid-cols-[17rem_1fr] 2xl:grid-cols-[24rem_1fr] 2xl:gap-8">
  <aside class="{CARD} {selected ? 'hidden md:flex' : 'flex'} min-h-0 flex-col gap-2 p-3 2xl:p-6">
    <button class="{BTN} w-full" onclick={() => (selected = 'new')}><Plus size={16} />New drop</button>
    <ol class="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
      {#each drops as d (d.id)}
        {@const st = dropStatus(d, 0, Date.now())}
        <li>
          <button class="w-full rounded-xl border p-2.5 text-left transition 2xl:p-4 {selected === d.id ? 'border-accent/60 bg-accent/10' : 'border-white/5 hover:bg-white/5'}" onclick={() => (selected = d.id)}>
            <span class="block truncate text-sm font-bold 2xl:text-xl">{d.title}</span>
            <span class="mt-1 flex items-center gap-2">
              <span class="{CHIP} px-1.5! py-0.5! {STATUS_UI[st].cls}">{STATUS_UI[st].label}</span>
              <span class="truncate text-[10px] text-muted 2xl:text-sm">{when(d.startsAt)}</span>
            </span>
          </button>
        </li>
      {:else}
        <li class="p-4 text-center text-xs text-muted">No drops yet. Make your first.</li>
      {/each}
    </ol>
  </aside>

  {#if selected}
    <section class="{CARD} flex min-h-0 flex-col p-3 md:p-5 2xl:p-8">
      <button class="mb-2 flex items-center gap-1 text-xs uppercase tracking-widest text-muted md:hidden" onclick={() => (selected = null)}><ChevronLeft size={14} />All drops</button>
      {#key selected}
        <DropEditor drop={current} {me} onsaved={(d) => load(d.id)} />
      {/key}
    </section>
  {/if}
</div>
