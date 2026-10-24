<script>
  /** @type {{ label: string, hint?: string, class?: string, children: import('svelte').Snippet }} */
  let { label, hint = '', class: cls = '', children } = $props()
  import { LABEL } from '../lib/ui.js'
</script>

<label class="block {cls}">
  <span class={LABEL}>{label}</span>
  {@render children()}
  {#if hint}<span class="mt-1 block text-[11px] text-neutral-500 2xl:text-sm">{hint}</span>{/if}
</label>
