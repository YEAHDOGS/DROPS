<script>
  // Page frame: brand header, a body that fills the viewport exactly, and the DOGS sticker footer.
  import logo from '../assets/dogs-logo-cropped.png'
  import madeByDogs from '../assets/made-by-dogs-small.png'

  /**
   * @type {{ title?: string, href?: string, logo?: string | null, links?: { label: string, url: string }[], style?: string,
   *   right?: import('svelte').Snippet, children: import('svelte').Snippet, footer?: import('svelte').Snippet }}
   */
  let { title = 'DROPS', href = '/', logo: shopLogo = null, links = [], right, children, footer, style = '' } = $props()

  const WEAREDOGS_URL = 'https://wearedogs.net'
  const YEAR = new Date().getFullYear()
</script>

<main
  class="relative flex h-dvh w-full flex-col overflow-hidden bg-app font-shop text-white px-3 pt-3 pb-2 sm:px-4 sm:pt-3 md:px-6 md:pt-5 lg:px-8 2xl:px-14 2xl:pt-8 short:pt-2 short:pb-1"
  {style}
>
  <div class="pointer-events-none absolute inset-0 bg-radial-[ellipse_at_top_right] from-accent/10 to-transparent to-50%"></div>
  <div class="pointer-events-none absolute inset-0 bg-radial-[ellipse_at_bottom_left] from-accent/5 to-transparent to-50%"></div>

  <header class="relative z-10 mx-auto flex w-full max-w-7xl 2xl:max-w-[110rem] items-center justify-between gap-3 border-b border-white/5 pb-2.5 md:pb-4 short:pb-1.5">
    <a {href} class="flex min-w-0 items-center gap-2.5 sm:gap-3">
      <img src={shopLogo ?? logo} alt={shopLogo ? title : 'DOGS'} class="h-8 w-8 shrink-0 object-contain transition-transform duration-500 hover:rotate-12 sm:h-9 sm:w-9 2xl:h-14 2xl:w-14 short:h-6 short:w-6" />
      <span class="truncate text-base font-black uppercase tracking-[.18em] sm:text-lg md:text-xl 2xl:text-3xl short:text-sm">{title}</span>
    </a>
    {#if right}<div class="flex shrink-0 items-center gap-2">{@render right()}</div>{/if}
  </header>

  <div class="relative z-10 mx-auto my-2 flex min-h-0 w-full max-w-7xl 2xl:max-w-[110rem] flex-1 flex-col md:my-4 short:my-1.5">
    {@render children()}
  </div>

  <footer class="relative z-10 mx-auto flex w-full max-w-7xl 2xl:max-w-[110rem] items-center justify-between gap-3 border-t border-white/5 pt-2 text-[10px] tracking-wider text-neutral-600 2xl:text-sm short:pt-1">
    <span class="flex min-w-0 items-center gap-3">
      <span class="truncate">{#if footer}{@render footer()}{:else}&copy; {YEAR} DOGS DROPS{/if}</span>
      {#each links as l}
        <a href={l.url} target="_blank" rel="noopener noreferrer" class="hidden shrink-0 uppercase text-neutral-400 hover:text-accent sm:inline">{l.label}</a>
      {/each}
    </span>
    <a href={WEAREDOGS_URL} target="_blank" rel="noopener noreferrer" class="shrink-0 opacity-70 transition-opacity hover:opacity-100">
      <img src={madeByDogs} alt="This product was made by DOGS" width="480" height="159" class="h-6 w-auto sm:h-7 2xl:h-11 short:h-5" />
    </a>
  </footer>
</main>
