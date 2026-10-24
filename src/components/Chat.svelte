<script>
  // Live chat. Your own shard sees you instantly; the whole crowd sees a sampled global stream.
  import { Send } from '@lucide/svelte'
  import { INPUT } from '../lib/ui.js'
  import { LIMITS } from '../../shared/drop.js'

  /** @type {{ messages: { id: string, n: string, x: string }[], onsay: (name: string, text: string) => void }} */
  let { messages, onsay } = $props()

  const NAME_KEY = 'drops:name'
  const read = () => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } }
  let name = $state(read())
  let text = $state('')
  /** @type {HTMLElement} */
  let list

  $effect(() => {
    messages.length
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 120) queueMicrotask(() => list.scrollTo({ top: list.scrollHeight }))
  })

  function submit(e) {
    e.preventDefault()
    if (!text.trim()) return
    try { localStorage.setItem(NAME_KEY, name) } catch { /* private mode */ }
    onsay(name, text)
    text = ''
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <ol bind:this={list} class="selectable min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm 2xl:text-lg" aria-live="polite">
    {#each messages as m (m.id)}
      <li class="break-words leading-snug"><span class="font-bold text-accent">{m.n}</span> <span class="text-neutral-200">{m.x}</span></li>
    {:else}
      <li class="pt-6 text-center text-xs uppercase tracking-widest text-neutral-600">Quiet in here. Say something.</li>
    {/each}
  </ol>
  <form class="mt-2 flex gap-1.5" onsubmit={submit}>
    <input class="{INPUT} w-24! shrink-0 2xl:w-36!" placeholder="name" maxlength={LIMITS.CHAT_NAME} bind:value={name} aria-label="Your name" />
    <input class={INPUT} placeholder="say something" maxlength={LIMITS.CHAT_TEXT} bind:value={text} aria-label="Message" />
    <button class="shrink-0 rounded-lg bg-accent px-3 text-white transition hover:brightness-110" aria-label="Send"><Send size={16} /></button>
  </form>
</div>
