# DOGS DROPS

Limited runs, dropped live. `drops.dogs.red/{handle}` is a storefront. Shops set the second a drop goes live, and
every sale lands as a hitmarker for the whole crowd.

Svelte 5 + Tailwind 4 (from the DOGS svelte-template) on one Cloudflare Worker with Durable Objects, D1, KV and R2,
plus Stripe Checkout and Connect.

## Architecture

```
viewer ──ws──► leaf Fanout ──► hub Fanout ──► DropRoom (1 per drop: SQLite stock, atomic)
          (≤64 per hub, ~5k viewers per leaf)        ▲
viewer ──GET /handle──► static assets (no Worker)    │ RPC reserve/attach/cancel/complete
viewer ──GET /api/s/handle──► KV snapshot (edge-cached, no D1 on the hot path)
Stripe ──webhook──► Worker ──► DropRoom.complete ──► D1 orders
```

- **Stock never oversells.** `worker/inventory.js` checks and decrements with no `await` in between, inside a
  single-threaded Durable Object. A buy parks units as a *hold* while the buyer is in Checkout. Holds expire on an
  alarm, which also expires the Stripe session. A payment that lands after its hold lapsed is honored from free stock
  or refunded automatically.
- **The crowd size doesn't change the room's load.** The room streams state to at most 64 children. Fanout nodes
  relay it down the tree (`worker/tree.js`): 4096 leaves × ~5k sockets ≈ 20M viewers at depth 2. Sales batch into
  250 ms ticks, and the client replays each tick as one ding per unit. Leaves turn away doomed clicks using the last
  known stock and cap in-flight reserves, so a stampede never reaches the room at full size.
- **Every time zone sees the same moment.** Drop times are stored as UTC ms. Clients sync to the edge clock
  NTP-style, the room's alarm flips the drop live, and merchants type times in any zone.
- **Chat scales by sampling.** Your own shard sees you instantly, and the room rebroadcasts a budgeted global
  stream.
- **Money.** "DOGS handles it": platform Checkout. "Connect my Stripe": Express onboarding plus destination charges
  with `PLATFORM_FEE_BPS`. Stripe Checkout collects shipping and generates the invoice, and Stripe Tax is optional.
- **Sizes and colors.** Each option has its own atomic stock. The checkout line item names the option, and the
  order records it.
- **Fair buying.** Cloudflare Turnstile proves a human once per socket, the hold limit is per person, and auth
  endpoints are rate limited per IP.
- **Shops own their room.** The host can post in chat with a badge, delete messages, and silence people
  everywhere. Silenced people still see their own messages (a shadow ban).
- **Payouts.** Shops on "DOGS handles the money" are paid with one Stripe Transfer per order, on demand or daily,
  minus `PLATFORM_FEE_BPS` + `PLATFORM_FEE_FIXED_CENTS`. Refunds claw the transfer back first.
- **Limits per person.** Counted on paid units by person (hashed IP) at reserve time, and by email at payment
  (extra orders are auto-refunded and restocked).
- **Demo mode.** `/demo` builds a drop and `/demo/live` runs it from the customer side. It's the real room UI and
  client against a crowd simulated in the browser (`src/lib/sim.js`), with no server, no account and no money.
- **Launch gate.** `SIGNUPS_OPEN=false` keeps accounts closed (enforced by the Worker, greyed out in the UI).
- **Accounts.** One-time emailed sign-in links (which double as password reset). Changing the password signs out
  every other session.

## Run it

```sh
npm i
cp .dev.vars.example .dev.vars          # fill in Stripe test keys
npm run db:init                         # local D1 schema
npm run dev:api                         # Worker on :8787
npm run dev                             # app on :5173 (proxies /api + /media)
```

Webhooks in dev: `stripe listen --forward-to localhost:8787/api/stripe/webhook`.

## Test

```sh
npm test          # unit: per-size inventory fuzz (50k ops), tree, webhooks, passwords, rules, time zones, CSP
npm run battle    # real workerd + mock Stripe/Turnstile: 1500 viewers, 600-buyer stampede, 44 checks
VIEWERS=4000 BUYERS=2000 npm run battle
TARGET=https://drops-staging.dogs.red DROP=<id> VIEWERS=30000 npm run load   # deployed load test
```

## Deploy

See [DEPLOY.md](DEPLOY.md) for keys, resources, Stripe setup, the staging acceptance list, the load test and
rollback. CI (`.github/workflows/ci.yml`) runs the tests, the battle test and a zero-warning build on every push.
**Deploy** is a manual workflow that targets staging or production.
