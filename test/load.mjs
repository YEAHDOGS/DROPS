// Load test against a deployed environment (never production during a real drop). Opens a crowd of viewer sockets
// to one drop and measures what the 20M design claims: every socket gets the same broadcast, quickly.
//
//   TARGET=https://drops-staging.dogs.red DROP=<drop id> VIEWERS=20000 RAMP=1000 HOLD_S=120 npm run load
//
// One machine tops out around 20-50k sockets (raise `ulimit -n`). Run it from several machines/regions at once;
// each prints its own numbers and the drop's total viewer count shows the sum.
// Reports: connect success, time to first state, fan-out spread (first->last socket to receive the same broadcast).

const TARGET = process.env.TARGET
const DROP = process.env.DROP
const VIEWERS = Number(process.env.VIEWERS ?? 1000)
const RAMP = Number(process.env.RAMP ?? 500) // new sockets per second
const HOLD_S = Number(process.env.HOLD_S ?? 60)
const REPORT_MS = 5000
const KEEP_MS = 30_000 // forget broadcasts older than this
const BATCH_MS = 100

if (!TARGET || !DROP) {
  console.error('Set TARGET (https://...) and DROP (drop id). See the header of this file.')
  process.exit(1)
}

const url = `${TARGET.replace(/^http/, 'ws')}/api/live/${DROP}`
const stats = { open: 0, failed: 0, closed: 0, firstState: [] }
/** raw broadcast -> { first, last, n } */
const seen = new Map()
const spreads = []
let lastViewers = 0

function connect() {
  const t0 = Date.now()
  let first = true
  const ws = new WebSocket(url)
  ws.onopen = () => stats.open++
  ws.onerror = () => stats.failed++
  ws.onclose = () => stats.closed++
  ws.onmessage = (e) => {
    const now = Date.now()
    if (first) {
      first = false
      return stats.firstState.push(now - t0) // a replay of the cached state, not a live broadcast
    }
    const b = seen.get(e.data)
    if (b) [b.last, b.n] = [now, b.n + 1]
    else seen.set(e.data, { first: now, last: now, n: 1 })
    if (e.data.includes('"t":"state"')) lastViewers = JSON.parse(e.data).v
  }
  return ws
}

const pct = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0)

function sweep(cutoff = Date.now() - KEEP_MS) {
  for (const [k, b] of seen) {
    if (b.first > cutoff) continue
    if (b.n >= stats.open * 0.9) spreads.push(b.last - b.first) // only broadcasts most of the crowd received
    seen.delete(k)
  }
}

function report(final = false) {
  sweep(final ? Infinity : undefined)
  const line = {
    open: stats.open, failed: stats.failed, closed: stats.closed, roomViewers: lastViewers,
    firstStateMs: { p50: pct(stats.firstState, 0.5), p95: pct(stats.firstState, 0.95) },
    fanoutSpreadMs: { p50: pct(spreads, 0.5), p95: pct(spreads, 0.95), samples: spreads.length },
  }
  console.log(final ? `\nFINAL ${JSON.stringify(line, null, 2)}` : JSON.stringify(line))
}

const sockets = []
const perBatch = Math.max(1, Math.round((RAMP * BATCH_MS) / 1000))
const ramp = setInterval(() => {
  for (let i = 0; i < perBatch && sockets.length < VIEWERS; i++) sockets.push(connect())
  if (sockets.length >= VIEWERS) clearInterval(ramp)
}, BATCH_MS)
const ticker = setInterval(report, REPORT_MS)

console.log(`ramping ${VIEWERS} viewers at ${RAMP}/s into ${url}, holding ${HOLD_S}s`)
setTimeout(() => {
  clearInterval(ticker)
  for (const ws of sockets) ws.close()
  report(true)
  setTimeout(() => process.exit(0), 500)
}, (VIEWERS / RAMP) * 1000 + HOLD_S * 1000)
