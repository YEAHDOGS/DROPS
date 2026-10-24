<script>
  // Cloudflare Turnstile, invisible unless Cloudflare wants an interaction. Hands each fresh pass to `ontoken`.
  /** @type {{ sitekey: string, ontoken: (token: string) => void }} */
  let { sitekey, ontoken } = $props()

  const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
  /** @type {HTMLElement} */
  let el
  let widget = null

  /** Ask for a new pass (the edge spent or rejected the last one). */
  export function reset() {
    if (widget !== null) window.turnstile?.reset(widget)
  }

  /** One script tag per page, however many widgets mount. */
  function load() {
    window.__turnstileLoad ??= new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement('script'), { src: SRC, async: true, onload: resolve, onerror: reject })
      document.head.append(s)
    })
    return window.__turnstileLoad
  }

  $effect(() => {
    let gone = false
    load().then(() => {
      if (gone) return
      widget = window.turnstile.render(el, { sitekey, callback: ontoken, appearance: 'interaction-only', theme: 'dark', 'refresh-expired': 'auto' })
    }, () => {})
    return () => {
      gone = true
      if (widget !== null) window.turnstile?.remove(widget)
    }
  })
</script>

<div bind:this={el} class="flex justify-center empty:hidden"></div>
