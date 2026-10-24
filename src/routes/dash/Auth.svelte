<script>
  import Field from '../../components/Field.svelte'
  import { api } from '../../lib/api.js'
  import { BTN, CARD, INPUT } from '../../lib/ui.js'
  import { HANDLE_RE, LIMITS } from '../../../shared/drop.js'

  /** @type {{ onauthed: () => void }} */
  let { onauthed } = $props()
  let mode = $state('signup')
  let form = $state({ email: '', password: '', handle: '', name: '' })
  let error = $state('')
  let busy = $state(false)

  const handleOk = $derived(!form.handle || HANDLE_RE.test(form.handle))

  async function submit(e) {
    e.preventDefault()
    busy = true
    error = ''
    try {
      await api(`/auth/${mode}`, { method: 'POST', body: form })
      onauthed()
    } catch (err) {
      error = err.message
    } finally {
      busy = false
    }
  }
</script>

<form class="{CARD} m-auto w-full max-w-sm space-y-3 p-5 md:max-w-md md:p-7 2xl:max-w-2xl 2xl:space-y-6 2xl:p-12 short:space-y-2 short:p-3" onsubmit={submit}>
  <div class="flex gap-1 rounded-xl bg-black/40 p-1">
    {#each [['signup', 'Create shop'], ['login', 'Sign in']] as [key, label]}
      <button type="button" class="flex-1 rounded-lg py-1.5 text-xs font-bold uppercase tracking-widest transition 2xl:py-3 2xl:text-lg {mode === key ? 'bg-accent' : 'text-neutral-400'}" onclick={() => (mode = key)}>{label}</button>
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
  <Field label="Password"><input class={INPUT} type="password" bind:value={form.password} minlength="8" autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} required /></Field>
  {#if error}<p class="text-xs text-accent 2xl:text-base" role="alert">{error}</p>{/if}
  <button class="{BTN} w-full" disabled={busy || !handleOk}>{mode === 'signup' ? 'Claim your handle' : 'Sign in'}</button>
</form>
