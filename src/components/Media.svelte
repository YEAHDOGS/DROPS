<script>
  // Drop media: images and looping muted video, one at a time with arrows (no horizontal scrollbar, ever).
  import { ChevronLeft, ChevronRight } from '@lucide/svelte'
  import logo from '../assets/dogs-logo-cropped.png'

  /** @type {{ media: { url: string, kind: 'image'|'video' }[], title: string }} */
  let { media, title } = $props()
  let index = $state(0)
  const item = $derived(media[index % Math.max(1, media.length)])
  const step = (d) => (index = (index + d + media.length) % media.length)
  const ARROW = 'absolute top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white backdrop-blur transition hover:bg-accent 2xl:p-3'
</script>

<div class="relative flex h-full min-h-0 items-center justify-center overflow-hidden rounded-2xl border border-white/5 bg-card/40">
  {#if !item}
    <img src={logo} alt="" class="h-1/2 max-h-72 w-auto object-contain opacity-80 animate-[pulse_6s_ease-in-out_infinite]" />
  {:else if item.kind === 'video'}
    {#key item.url}<video src={item.url} class="h-full w-full object-cover" autoplay muted loop playsinline aria-label={title}></video>{/key}
  {:else}
    <img src={item.url} alt={title} class="h-full w-full object-cover" />
  {/if}

  {#if media.length > 1}
    <button class="{ARROW} left-2" onclick={() => step(-1)} aria-label="Previous"><ChevronLeft size={20} /></button>
    <button class="{ARROW} right-2" onclick={() => step(1)} aria-label="Next"><ChevronRight size={20} /></button>
    <div class="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
      {#each media as _, i}
        <button class="h-1.5 rounded-full transition-all {i === index ? 'w-5 bg-accent' : 'w-1.5 bg-white/40'}" onclick={() => (index = i)} aria-label="Show {i + 1}"></button>
      {/each}
    </div>
  {/if}
</div>
