<script>
  // Account: password, sessions.
  import { LogOut, ShieldOff } from '@lucide/svelte'
  import Field from '../../components/Field.svelte'
  import { api } from '../../lib/api.js'
  import { BTN, BTN_GHOST, CARD, INPUT } from '../../lib/ui.js'

  /** @type {{ me: any, onsignedout: () => void }} */
  let { me, onsignedout } = $props()
  const MIN_PASSWORD = 8
  const SECTION = `${CARD} space-y-3 p-4 md:p-5 2xl:space-y-5 2xl:p-8`
  const H = 'text-xs font-black uppercase tracking-[.2em] 2xl:text-lg'

  let password = $state('')
  let msg = $state('')
  let busy = $state(false)

  async function run(fn, done) {
    busy = true
    msg = ''
    try {
      await fn()
      done()
    } catch (err) {
      msg = err.message
    } finally {
      busy = false
    }
  }

  const changePassword = (e) => {
    e.preventDefault()
    run(() => api('/me/password', { method: 'PUT', body: { password } }), () => ((password = ''), (msg = 'Password changed. Other devices are signed out.')))
  }
  const signOut = () => run(() => api('/auth/logout', { method: 'POST' }), onsignedout)
  const signOutAll = () => run(() => api('/me/signout-all', { method: 'POST' }), onsignedout)
</script>

<div class="grid h-full min-h-0 content-start gap-3 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3 2xl:gap-6">
  <form class={SECTION} onsubmit={changePassword}>
    <h2 class={H}>Password</h2>
    <p class="text-xs text-neutral-400 2xl:text-base">Signed in as <span class="selectable text-white">{me.email}</span></p>
    <Field label="New password"><input class={INPUT} type="password" bind:value={password} minlength={MIN_PASSWORD} autocomplete="new-password" required /></Field>
    <button class={BTN} disabled={busy || password.length < MIN_PASSWORD}>Change password</button>
  </form>

  <section class={SECTION}>
    <h2 class={H}>Sessions</h2>
    <p class="text-xs text-neutral-400 2xl:text-base">Lost a laptop? Sign out everywhere kills every session, this one included.</p>
    <div class="flex flex-wrap gap-2">
      <button class={BTN_GHOST} onclick={signOut} disabled={busy}><LogOut size={14} />Sign out</button>
      <button class={BTN_GHOST} onclick={signOutAll} disabled={busy}><ShieldOff size={14} />Sign out everywhere</button>
    </div>
  </section>

  {#if msg}<p class="text-xs text-neutral-300 sm:col-span-2 xl:col-span-3 2xl:text-base" role="status">{msg}</p>{/if}
</div>
