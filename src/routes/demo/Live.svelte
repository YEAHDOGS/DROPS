<script>
  // /demo/live — a drop from the customer side. The real room UI and the real LiveDrop client, with the room itself
  // simulated in the browser (lib/sim.js): a crowd, bots buying, chat, the reveal. Nothing is charged.
  import { RotateCcw, Wand2 } from '@lucide/svelte'
  import Shell from '../../components/Shell.svelte'
  import DropRoom from '../../components/DropRoom.svelte'
  import RoomControls from '../../components/RoomControls.svelte'
  import Modal from '../../components/Modal.svelte'
  import sticker from '../../assets/made-by-dogs-small.png'
  import { LiveDrop } from '../../lib/live.svelte.js'
  import { SimSocket } from '../../lib/sim.js'
  import { draft } from '../../lib/demo-draft.svelte.js'
  import { money } from '../../lib/time.js'
  import { BTN, BTN_GHOST, CHIP } from '../../lib/ui.js'

  const DEFAULT_MEDIA = [{ url: sticker, kind: 'image' }]

  /** @type {LiveDrop | null} */
  let live = $state(null)
  /** @type {SimSocket | null} */
  let room = null
  let run = $state(0)
  let chatOpen = $state(false)
  let notice = $state('')
  /** @type {{ qty: number, variant: string } | null} */
  let checkout = $state(null)

  const cfg = $derived({ ...draft.cfg, media: draft.cfg.media.length ? draft.cfg.media : DEFAULT_MEDIA })
  let startsAt = $state(0)

  $effect(() => {
    run
    const at = Date.now() + draft.cfg.startsInSec * 1000
    startsAt = at
    const c = { ...cfg, startsAt: at }
    const conn = new LiveDrop('demo', { transport: () => (room = new SimSocket(c)) })
    conn.onCheckout = () => (checkout = { qty: conn.buying.qty ?? 1, variant: conn.buying.variant })
    live = conn
    notice = ''
    return () => {
      conn.close()
      room?.close()
    }
  })

  const drop = $derived({
    id: 'demo', title: cfg.title, description: cfg.description, priceCents: cfg.priceCents, currency: cfg.currency, media: cfg.media,
    variants: cfg.variants, maxPerOrder: cfg.maxPerOrder, startsAt, hidden: cfg.mystery, teaser: cfg.teaser,
  })

  function pay() {
    room?.pay(checkout.qty)
    live.buying = { phase: 'idle' }
    checkout = null
    notice = "You're in. (Demo: on a real drop, Stripe emails your receipt.)"
  }

  function cancel() {
    room?.release(checkout.qty, checkout.variant ?? cfg.variants[0].id)
    live.buying = { phase: 'idle' }
    checkout = null
    notice = 'Checkout cancelled. Your unit went back on the shelf.'
  }
</script>

<Shell title="{cfg.shop} · demo" href="/demo/live" style={cfg.accent ? `--color-accent: ${cfg.accent}` : ''}>
  {#snippet right()}
    <RoomControls {live} bind:chatOpen />
    <button class={BTN_GHOST} onclick={() => run++} aria-label="Restart the demo"><RotateCcw size={16} /></button>
  {/snippet}

  {#key run}
    {#if live}
      <DropRoom {live} {drop} {notice} ondismiss={() => (notice = '')} bind:chatOpen fit={draft.cfg.media.length ? 'cover' : 'contain'} />
    {/if}
  {/key}

  {#snippet footer()}
    <span class="{CHIP} bg-accent/15 text-accent">Demo</span> Runs in your browser. No account, no money.
    <a href="/demo" class="ml-2 inline-flex items-center gap-1 text-neutral-300 underline"><Wand2 size={12} />Build your own</a>
  {/snippet}
</Shell>

{#if checkout}
  <Modal title="Checkout (demo)" onclose={cancel}>
    <p class="text-sm text-neutral-300 2xl:text-lg">On a real drop this is Stripe Checkout: card, Apple Pay, Google Pay, shipping address. Your unit is held while you pay.</p>
    <p class="mt-3 text-2xl font-black 2xl:text-4xl">{money(cfg.priceCents * checkout.qty, cfg.currency)}</p>
    <p class="text-xs text-muted 2xl:text-base">{checkout.qty} × {cfg.title}{checkout.variant ? ` · ${cfg.variants.find((v) => v.id === checkout.variant)?.label}` : ''}</p>
    <div class="mt-5 flex gap-2">
      <button class={BTN_GHOST} onclick={cancel}>Cancel</button>
      <button class="{BTN} flex-1" onclick={pay}>Pay (demo)</button>
    </div>
  </Modal>
{/if}
