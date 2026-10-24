// Path router: History API + one delegated click handler, so plain <a href="/x"> links stay SPA navigations.

export const route = $state({ path: location.pathname, query: new URLSearchParams(location.search) })

function sync() {
  route.path = location.pathname
  route.query = new URLSearchParams(location.search)
}

/** @param {string} to @param {boolean} [replace] */
export function navigate(to, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({}, '', to)
  sync()
}

addEventListener('popstate', sync)
document.addEventListener('click', (e) => {
  const a = /** @type {HTMLElement} */ (e.target).closest?.('a')
  if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin || a.pathname.startsWith('/media/')) return
  if (a.hash && a.pathname === location.pathname) return // in-page anchor: let the browser scroll
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  navigate(a.pathname + a.search)
})
