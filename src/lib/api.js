// JSON client for the Worker API. Throws Error(message from the server) on non-2xx.

/**
 * @param {string} path under /api
 * @param {{ method?: string, body?: any, file?: File }} [opts]
 */
export async function api(path, { method = 'GET', body, file } = {}) {
  const headers = file ? { 'Content-Type': file.type } : body ? { 'Content-Type': 'application/json' } : undefined
  const res = await fetch(`/api${path}`, { method: file ? 'POST' : method, headers, body: file ?? (body && JSON.stringify(body)) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status })
  return data
}
