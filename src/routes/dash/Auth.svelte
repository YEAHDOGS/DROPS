<script>
  // Create shop / sign in / email me a link (the link is also the password reset).
  import Field from '../../components/Field.svelte'
  import { api } from '../../lib/api.js'
  import { route, navigate } from '../../lib/router.svelte.js'
  import { BTN, CARD, INPUT } from '../../lib/ui.js'
  import { HANDLE_RE, LIMITS } from '../../../shared/drop.js'

  /** @type {{ onauthed: () => void }} */
  let { onauthed } = $props()
  const MODES = [['signup', 'Create shop'], ['login', 'Sign in'], ['link', 'Email link']]
  const SUBMIT = { signup: 'Claim your handle', login: 'Sign in', link: 'Email me a sign-in link' }

  let mode = $state('signup')
  let form = $state({ email: '', password: '', handle: '', name: '' })
  let error = $state('')
  let sent = $state(false)
  let busy = $state(false)

  const handleOk = $derived(!form.handle || HANDLE_RE.test(form.handle))

  // arriving from an emailed link: /dash?token=...
  $effect(() => {
    const token = route.query.get('token')
    if (!token) return
    navigate('/dash', true)
    api('/auth/redeem', { method: 'POST', body: { token } }).then(onauthed, (err) => ((mode = 'link'), (error = err.message)))
  })

  async function submit(e) {
    e.preventDefault()
    busy = true
    error = ''
    try {
      await api(`/auth/${mode}`, { method: 'POST', body: form })
      if (mode === 'link') sent = true
      else onauthed()
    } catch (err) {
      error = err.message
    } finally {
      busy = false
    }
  }
</script>

<form class="{CARD} m-auto w-full max-w-sm space-y-3 p-5 sm:max-w-md md:p-7 2xl:max-w-2xl 2xl:space-y-6 2xl:p-12 short:space-y-2 short:p-3" onsubmit={submit}>
  <div class="grid grid-cols-3 gap-1 rounded-xl bg-black/40 p-1">
    {#each MODES as [key, label]}
      <button type="button" class="rounded-lg py-1.5 text-[10px] font-bold uppercase tracking-widest transition sm:text-xs 2xl:py-3 2xl:text-lg {mode === key ? 'bg-accent' : 'text-neutral-400'}" onclick={() => ((mode = key), (sent = false), (error = ''))}>{label}</button>
    {/each}
  </div>
  {#if mode === 'signup'}
    <div class="grid grid-cols-2 gap-2 short:gap-1.5">
      <Field label="Your handle" hint={handleOk ? `drops.dogs.red/${form.handle || 'you'}` : 'a-z, 0-9 and dashes'}>
        <input class={INPUT} bind:value={form.handle} maxlength={LIMITS.HANDLE} autocomplete="off" required oninput={() => (form.handle = form.handle.toLowerCase())} />
      </Field>
      <Field label="Display name"><input class={INPUT} bind:value={form.name} maxlength={LIMITS.NAME} placeholder="Radiohead" /></Field>
    </div>
  {/if}
  <Field label="Email"><input class={INPUT} type="email" bind:value={form.email} autocomplete="email" required /></Field>
  {#if mode !== 'link'}
    <Field label="Password"><input class={INPUT} type="password" bind:value={form.password} minlength="8" autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} required /></Field>
  {/if}
  {#if sent}<p class="text-xs text-ok 2xl:text-base" role="status">If that email has a shop, a sign-in link is on its way. It works once, for 15 minutes.</p>{/if}
  {#if error}<p class="text-xs text-accent 2xl:text-base" role="alert">{error}</p>{/if}
  <button class="{BTN} w-full" disabled={busy || !handleOk}>{SUBMIT[mode]}</button>
  {#if mode === 'login'}<button type="button" class="w-full text-center text-[11px] text-muted underline 2xl:text-base" onclick={() => (mode = 'link')}>Forgot password? Email me a link</button>{/if}
</form>
