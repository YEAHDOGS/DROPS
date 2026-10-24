<script>
  // Header controls for a live room: crowd size, dings on/off, chat toggle (below desktop).
  import { Eye, MessageCircle, Volume2, VolumeX } from '@lucide/svelte'
  import { ding, unlockSound } from '../lib/sound.js'
  import { BTN_GHOST, CHIP } from '../lib/ui.js'

  /** @type {{ live: import('../lib/live.svelte.js').LiveDrop | null, chatOpen?: boolean }} */
  let { live, chatOpen = $bindable(false) } = $props()
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

  let sound = $state(false)
  const s = $derived(live?.state)
  const chatOn = $derived(!!live?.cfg?.chat && live.cfg.chat.mode !== 'off')

  async function toggleSound() {
    sound = !sound
    if (sound) await unlockSound()
    if (live) live.onDing = sound ? ding : null
  }
</script>

{#if s}
  <span class="{CHIP} bg-white/5 text-white" title="Watching now"><Eye size={14} />{compact.format(Math.max(s.v, live?.connected ? 1 : 0))}</span>
{/if}
<button class={BTN_GHOST} onclick={toggleSound} aria-label={sound ? 'Mute dings' : 'Play dings'} aria-pressed={sound}>
  {#if sound}<Volume2 size={16} />{:else}<VolumeX size={16} />{/if}
</button>
{#if chatOn}
  <button class="{BTN_GHOST} lg:hidden" onclick={() => (chatOpen = !chatOpen)} aria-label="Chat" aria-expanded={chatOpen}><MessageCircle size={16} /></button>
{/if}
