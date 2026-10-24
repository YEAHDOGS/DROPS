<script>
  // Centered dialog with backdrop. Escape or a backdrop click closes it.
  import { X } from '@lucide/svelte'
  import { CARD } from '../lib/ui.js'

  /** @type {{ title: string, onclose: () => void, children: import('svelte').Snippet }} */
  let { title, onclose, children } = $props()
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
  <button class="absolute inset-0 cursor-default" onclick={onclose} aria-label="Close"></button>
  <div class="{CARD} relative w-full max-w-sm bg-card! p-5 sm:max-w-md md:p-7 2xl:max-w-2xl 2xl:p-12" role="dialog" aria-modal="true" aria-label={title}>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-black uppercase tracking-[.2em] 2xl:text-2xl">{title}</h2>
      <button onclick={onclose} aria-label="Close"><X size={18} /></button>
    </div>
    {@render children()}
  </div>
</div>
