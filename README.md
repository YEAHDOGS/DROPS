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
  with `PLATFORM_FEE_BPS`. Stripe Checkout collects shipping and generates the invoice.

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
npm test          # unit: inventory fuzz (50k ops), tree, webhook signatures, passwords, rules, time zones
npm run battle    # boots real workerd + mock Stripe: 1500 viewers, 600-buyer stampede, webhooks, chat
VIEWERS=4000 BUYERS=2000 npm run battle
```

## Deploy

1. `wrangler d1 create dogs-drops`, `wrangler kv namespace create STOREFRONT`, `wrangler r2 bucket create dogs-drops-media`,
   then put the ids in `wrangler.jsonc`.
2. Add the secrets with `wrangler secret put` for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `SESSION_SECRET`.
3. In Stripe, point a webhook at `/api/stripe/webhook` for `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.expired` and `charge.refunded`.
4. `npm run deploy`
