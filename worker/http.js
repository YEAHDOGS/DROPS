// Tiny HTTP helpers shared by the Worker routes.

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })

export const fail = (status, error) => json({ error }, status)

/** Parsed JSON body, or null if it isn't JSON. */
export async function body(req) {
  try { return await req.json() } catch { return null }
}

export const roomOf = (env, dropId) => env.DROP_ROOM.get(env.DROP_ROOM.idFromName(dropId))
