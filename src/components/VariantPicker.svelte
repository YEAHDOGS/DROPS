<script>
  // Sizes / colors. Each option shows what's left of it; empty ones stay visible but can't be picked.
  /** @type {{ variants: { id: string, label: string }[], left: Record<string, number> | undefined, value: string, onpick: (id: string) => void }} */
  let { variants, left, value, onpick } = $props()
</script>

<div class="flex flex-wrap gap-1.5 2xl:gap-3" role="radiogroup" aria-label="Options">
  {#each variants as v (v.id)}
    {@const n = left?.[v.id]}
    <button
      role="radio"
      aria-checked={value === v.id}
      disabled={n === 0}
      class="rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:line-through disabled:opacity-35 sm:text-xs 2xl:px-5 2xl:py-3 2xl:text-lg short:py-1 {value === v.id ? 'border-accent bg-accent/15 text-white' : 'border-white/10 text-neutral-300 hover:border-white/30'}"
      onclick={() => onpick(v.id)}
    >
      {v.label}{#if n !== undefined}<span class="ml-1.5 font-normal tabular-nums text-muted">{n}</span>{/if}
    </button>
  {/each}
</div>
