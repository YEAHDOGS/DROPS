<script>
  // Fixed-width digit boxes: ticking never reflows anything around them.
  import { parts } from '../lib/time.js'

  /** @type {{ target: number, now: number, label: string }} */
  let { target, now, label } = $props()

  const p = $derived(parts(target - now))
  const units = $derived([['days', p.d], ['hrs', p.h], ['min', p.m], ['sec', p.s]].filter(([u, v], i) => i > 0 || v > 0))
</script>

<div>
  <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-[.25em] text-muted 2xl:text-sm short:mb-1">{label}</div>
  <div class="grid gap-1.5 sm:gap-2 2xl:gap-3" style="grid-template-columns: repeat({units.length}, minmax(0, 1fr))">
    {#each units as [unit, value] (unit)}
      <div class="rounded-xl border border-white/5 bg-black/40 px-1 py-2 text-center md:py-3 2xl:py-5 short:py-1">
        <div class="text-2xl font-black tabular-nums leading-none sm:text-3xl lg:text-4xl 2xl:text-6xl short:text-xl">{String(value).padStart(2, '0')}</div>
        <div class="mt-1 text-[9px] uppercase tracking-widest text-muted 2xl:text-xs">{unit}</div>
      </div>
    {/each}
  </div>
</div>
