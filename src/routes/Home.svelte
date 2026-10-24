<script>
  // drops.dogs.red — what this is, in one screen.
  import { Radio, Timer, Wallet } from '@lucide/svelte'
  import Shell from '../components/Shell.svelte'
  import logo from '../assets/dogs-logo-cropped.png'
  import { BTN, BTN_GHOST, CARD } from '../lib/ui.js'

  const FEATURES = [
    { icon: Timer, title: 'One moment, every zone', text: 'Set the second it drops. Everyone on Earth sees the same countdown in their own time.' },
    { icon: Radio, title: 'Every sale, live', text: 'Stock falls one hitmarker at a time across the whole crowd. Zero oversell, by design.' },
    { icon: Wallet, title: 'Your Stripe or ours', text: 'Connect your own Stripe for direct payouts, or let DOGS hold the money and pay you out.' },
  ]
</script>

<Shell>
  {#snippet right()}
    <a href="/dash" class={BTN_GHOST}>Sign in</a>
  {/snippet}

  <div class="flex min-h-0 flex-1 flex-col justify-center gap-5 md:gap-8 2xl:gap-14 short:gap-3">
    <div class="grid items-center gap-6 sm:grid-cols-[1fr_auto] lg:gap-12 short:grid-cols-1">
      <div class="order-2 text-center sm:order-1 sm:text-left">
        <p class="text-[10px] font-semibold uppercase tracking-[.3em] text-accent 2xl:text-base">drops.dogs.red/you</p>
        <h1 class="mt-2 text-4xl font-black uppercase leading-[.95] tracking-tight sm:text-5xl lg:text-7xl 2xl:text-9xl short:text-3xl">
          Limited runs.<br /><span class="text-accent">Dropped live.</span>
        </h1>
        <p class="mx-auto mt-3 max-w-xl text-sm text-neutral-400 sm:mx-0 md:text-base 2xl:max-w-3xl 2xl:text-2xl short:mt-2 short:text-xs">
          100 vinyl pressings. 50 hoodies. One time, everywhere. Build the page, set the clock, and watch it sell out with your crowd in real time.
        </p>
        <div class="mt-5 flex justify-center gap-2 sm:justify-start short:mt-3">
          <a href="/dash" class="{BTN} px-6!">Start a drop</a>
        </div>
      </div>
      <div class="order-1 flex justify-center sm:order-2 short:hidden">
        <div class="{CARD} relative aspect-square w-32 p-3 sm:w-44 md:w-56 lg:w-72 2xl:w-[26rem]">
          <img src={logo} alt="DOGS" class="h-full w-full object-contain animate-[pulse_6s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>

    <div class="grid gap-2.5 sm:grid-cols-3 md:gap-4 2xl:gap-8">
      {#each FEATURES as f}
        <div class="{CARD} group p-3 transition hover:border-accent/30 md:p-4 2xl:p-8 short:p-2">
          <f.icon size={18} class="text-accent" />
          <h3 class="mt-1.5 text-xs font-bold uppercase tracking-wide sm:text-sm 2xl:text-xl">{f.title}</h3>
          <p class="mt-1 text-[11px] leading-relaxed text-neutral-500 sm:text-xs 2xl:text-lg short:hidden">{f.text}</p>
        </div>
      {/each}
    </div>
  </div>
</Shell>
