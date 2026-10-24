<script>
  // drops.dogs.red: the pitch and the proof. Left: what it is. Right: a drop running live on a loop
  // (mystery countdown -> reveal -> hitmarker sellout), rendered with the same components the real room uses.
  import { Eye, Radio, Timer, Wallet } from '@lucide/svelte'
  import Shell from '../components/Shell.svelte'
  import Countdown from '../components/Countdown.svelte'
  import StockBar from '../components/StockBar.svelte'
  import Media from '../components/Media.svelte'
  import sticker from '../assets/made-by-dogs-small.png'
  import { DemoDrop } from '../lib/demo.svelte.js'
  import { BTN, BTN_GHOST, CARD, CHIP, STATUS_CLS, STRINGS } from '../lib/ui.js'

  const ICONS = { timer: Timer, radio: Radio, wallet: Wallet }
  const DEMO_PRODUCT = { title: 'Made by DOGS sticker', price: '$5', media: [{ url: sticker, kind: 'image' }] }
  const CLOCK_MS = 200
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

  /** @type {DemoDrop | null} */
  let demo = $state(null)
  let now = $state(Date.now())

  $effect(() => {
    const d = new DemoDrop()
    demo = d
    const t = setInterval(() => (now = Date.now()), CLOCK_MS)
    return () => {
      clearInterval(t)
      d.close()
    }
  })

  const s = $derived(demo?.state)
</script>

<Shell>
  {#snippet right()}
    <a href="/dash" class={BTN_GHOST}>Sign in</a>
    <a href="/dash" class="{BTN} hidden py-2! text-xs! sm:inline-flex">Start a drop</a>
  {/snippet}

  <div class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[1fr_minmax(0,22rem)] sm:grid-rows-1 md:gap-8 lg:grid-cols-[1fr_minmax(0,28rem)] xl:gap-14 2xl:grid-cols-[1fr_minmax(0,44rem)] 2xl:gap-24">
    <section class="text-center sm:text-left">
      <p class="text-[10px] font-semibold uppercase tracking-[.3em] text-accent md:text-xs 2xl:text-lg">drops.dogs.red/you</p>
      <h1 class="mt-2 text-[2.6rem] font-black uppercase leading-[.9] tracking-tight sm:text-5xl lg:text-7xl xl:text-8xl 2xl:text-[10rem] short:text-3xl">
        The drop<br />is the <span class="text-accent [text-shadow:0_0_40px_var(--color-accent)]">show.</span>
      </h1>
      <p class="mx-auto mt-3 max-w-xl text-sm text-neutral-400 sm:mx-0 md:text-base lg:text-lg 2xl:max-w-4xl 2xl:text-3xl short:mt-2 short:text-xs">
        100 vinyl. 50 hoodies. One second, every timezone. Your crowd watches the countdown, the reveal, and every unit fall live, like a game, not a checkout page.
      </p>
      <div class="mt-4 flex justify-center gap-2 sm:justify-start md:mt-6 short:mt-2">
        <a href="/dash" class="{BTN} px-6! py-3! 2xl:px-10! 2xl:py-5!">Claim your handle</a>
      </div>
      <ul class="mt-6 hidden gap-3 md:grid md:grid-cols-3 lg:mt-10 2xl:mt-16 2xl:gap-8 short:hidden">
        {#each STRINGS.features as f}
          {@const Icon = ICONS[f.icon]}
          <li class="{CARD} p-3 lg:p-4 2xl:p-8">
            <Icon size={18} class="text-accent" />
            <h3 class="mt-1.5 text-xs font-bold uppercase tracking-wide lg:text-sm 2xl:text-xl">{f.title}</h3>
            <p class="mt-1 hidden text-[11px] leading-relaxed text-neutral-500 lg:block 2xl:text-lg">{f.text}</p>
          </li>
        {/each}
      </ul>
    </section>

    <section class="{CARD} relative flex h-full max-h-full min-h-0 flex-col gap-3 overflow-hidden p-3 shadow-[0_0_80px] shadow-accent/15 sm:h-auto md:p-5 2xl:gap-6 2xl:p-8 short:gap-2 short:p-2.5" aria-label="Live demo drop">
      {#if s}
        <div class="flex items-center justify-between gap-2">
          <span class="{CHIP} {STATUS_CLS[s.st]}">
            {#if s.st === 'live'}<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-white"></span>{/if}{STRINGS.status[s.st]}
          </span>
          <span class="{CHIP} bg-white/5 text-white"><Eye size={13} />{compact.format(s.v)} · demo</span>
        </div>
        <div class="relative min-h-24 flex-1 sm:aspect-[4/3] sm:flex-none short:hidden">
          {#key demo.revealed}
            <div class="absolute inset-0 {demo.revealed ? 'animate-reveal' : ''}">
              <Media media={DEMO_PRODUCT.media} title={DEMO_PRODUCT.title} mystery={!demo.revealed} fit="contain" />
            </div>
          {/key}
        </div>
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="truncate text-base font-black uppercase tracking-wide md:text-lg 2xl:text-3xl">{demo.revealed ? DEMO_PRODUCT.title : STRINGS.mystery.title}</h2>
          <span class="font-bold text-accent 2xl:text-2xl">{demo.revealed ? DEMO_PRODUCT.price : STRINGS.mystery.price}</span>
        </div>
        {#if s.st === 'scheduled'}
          <Countdown target={s.at} {now} label={STRINGS.mystery.countdown} />
        {:else}
          <StockBar shown={demo.shown} total={s.T} sold={s.s} marks={demo.marks} />
        {/if}
      {/if}
    </section>
  </div>
</Shell>
