<script>
  // Stock meter + hitmarkers. Every unit claimed snaps a marker onto the bar's edge. The fill animates with
  // transform only, and the counter uses tabular digits, so nothing around it ever shifts.

  /** @type {{ shown: number, total: number, sold: number, marks: { id: number, n: number, back?: boolean }[] }} */
  let { shown, total, sold, marks } = $props()

  const frac = $derived(total ? Math.min(1, shown / total) : 0)
  const jitter = (id, spread) => (((id * 7919) % 97) / 97 - 0.5) * spread
</script>

<div>
  <div class="flex items-end justify-between gap-3">
    <div class="leading-none">
      <span class="text-5xl font-black tabular-nums sm:text-5xl lg:text-6xl 2xl:text-8xl short:text-4xl">{shown.toLocaleString()}</span>
      <span class="ml-1 text-xs uppercase tracking-widest text-muted 2xl:text-lg">/ {total.toLocaleString()} left</span>
    </div>
    <div class="text-right text-[10px] uppercase tracking-widest text-muted 2xl:text-sm">{sold.toLocaleString()} sold</div>
  </div>

  <div class="relative mt-3 h-3.5 rounded-full bg-white/5 2xl:h-6 short:mt-2" role="meter" aria-valuemin="0" aria-valuemax={total} aria-valuenow={shown} aria-label="Units left">
    <div class="absolute inset-0 origin-left rounded-full bg-accent shadow-[0_0_24px] shadow-accent/50 transition-transform duration-200 ease-out" style="transform: scaleX({frac})"></div>
    {#each marks as m (m.id)}
      <span
        class="pointer-events-none absolute top-1/2 animate-hit {m.back ? 'text-ok' : 'text-white'}"
        style="left: calc({frac * 100}% + {jitter(m.id, 28)}px); top: calc(50% + {jitter(m.id * 3, 16)}px)"
      >
        <svg viewBox="0 0 24 24" class="h-7 w-7 drop-shadow-[0_0_6px_rgba(0,0,0,.9)] 2xl:h-12 2xl:w-12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" aria-hidden="true">
          <path d="M3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6" />
        </svg>
      </span>
      <span class="pointer-events-none absolute top-5 animate-rise text-sm font-black tabular-nums {m.back ? 'text-ok' : 'text-accent'} 2xl:text-2xl" style="left: calc({frac * 100}% + {jitter(m.id * 5, 40)}px)">
        {m.back ? '+' : '−'}{m.n}
      </span>
    {/each}
  </div>
</div>
