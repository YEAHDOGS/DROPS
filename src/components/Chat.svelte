<script>
  // Live chat. Your own shard sees you instantly; the whole crowd sees a sampled global stream.
  // Rules (slow mode, links, length, when it opens, announcements only) are the shop's, enforced at the edge;
  // this component mirrors them so people see why before they type. The host gets delete / silence and a badge.
  import { Ban, Send, Trash2 } from '@lucide/svelte'
  import { INPUT, STRINGS } from '../lib/ui.js'
  import { chatBlock } from '../../shared/chat.js'
  import { LIMITS } from '../../shared/drop.js'

  /**
   * @type {{ messages: import('../lib/live.svelte.js').ChatMessage[], onsay: (name: string, text: string) => void,
   *   rules: ReturnType<typeof import('../../shared/chat.js').chatConfig>, status: string, refused: { reason: string, wait?: number, at: number } | null,
   *   onmod?: ((m: import('../lib/live.svelte.js').ChatMessage, ban: boolean) => void) | null }}
   */
  let { messages, onsay, rules, status, refused, onmod = null } = $props()
  const MOD_BTN = 'rounded p-0.5 text-neutral-500 transition hover:bg-white/10 hover:text-accent'
  const NOTICE_MS = 4000
  const NAME_KEY = 'drops:name'

  const read = () => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } }
  let name = $state(read())
  let text = $state('')
  let lastAt = $state(0)
  let now = $state(Date.now())
  /** @type {HTMLElement} */
  let list

  $effect(() => {
    messages.length
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 120) queueMicrotask(() => list.scrollTo({ top: list.scrollHeight }))
  })
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 500)
    return () => clearInterval(t)
  })

  // the host isn't bound by viewer rules; viewers see the gate before they type
  const gate = $derived(onmod ? null : chatBlock(rules, { status, text: text.trim() || ' ', lastAt, now }))
  const closed = $derived(gate && ['off', 'host', 'not_live'].includes(gate.reason))
  const serverSays = $derived(refused && now - refused.at < NOTICE_MS ? refused : null)
  const hint = $derived.by(() => {
    const g = serverSays ?? gate
    if (!g) return rules.slowSec > 2 ? `Slow mode · one message every ${rules.slowSec}s` : ''
    if (g.reason === 'slow') return `Slow mode · ${Math.ceil((g.wait ?? 0) / 1000)}s`
    return STRINGS.chatBlock[g.reason] ?? ''
  })

  function submit(e) {
    e.preventDefault()
    if (!text.trim() || gate) return
    try { localStorage.setItem(NAME_KEY, name) } catch { /* private mode */ }
    onsay(name, text.trim())
    lastAt = Date.now()
    text = ''
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <ol bind:this={list} class="selectable min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm 2xl:text-lg" aria-live="polite">
    {#each messages as m (m.id)}
      <li class="group flex items-start gap-1 break-words leading-snug">
        <span class="min-w-0 flex-1">
          {#if m.host}<span class="mr-1 rounded bg-accent px-1 text-[9px] font-black uppercase tracking-wider text-white 2xl:text-xs">Host</span>{/if}
          <span class="font-bold text-accent">{m.n}</span> <span class="text-neutral-200">{m.x}</span>
        </span>
        {#if onmod && !m.host}
          <span class="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100 lg:opacity-0">
            <button class={MOD_BTN} onclick={() => onmod(m, false)} aria-label="Delete message"><Trash2 size={13} /></button>
            {#if m.k}<button class={MOD_BTN} onclick={() => onmod(m, true)} aria-label="Silence this person"><Ban size={13} /></button>{/if}
          </span>
        {/if}
      </li>
    {:else}
      <li class="pt-6 text-center text-xs uppercase tracking-widest text-neutral-600 2xl:text-base">{closed ? hint : 'Quiet in here. Say something.'}</li>
    {/each}
  </ol>
  {#if hint}<p class="mt-1.5 text-[10px] uppercase tracking-widest text-muted 2xl:text-sm" role="status">{hint}</p>{/if}
  {#if !closed}
    <form class="mt-1.5 flex gap-1.5" onsubmit={submit}>
      {#if !onmod}<input class="{INPUT} w-24! shrink-0 2xl:w-36!" placeholder="name" maxlength={LIMITS.CHAT_NAME} bind:value={name} aria-label="Your name" />{/if}
      <input class={INPUT} placeholder={onmod ? 'post as host' : 'say something'} maxlength={onmod ? LIMITS.CHAT_TEXT : rules.maxLen} bind:value={text} aria-label="Message" />
      <button class="shrink-0 rounded-lg bg-accent px-3 text-white transition hover:brightness-110 disabled:opacity-40" disabled={!!gate && !!text.trim()} aria-label="Send"><Send size={16} /></button>
    </form>
  {/if}
</div>
