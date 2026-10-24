# Deploy runbook

Target: staging live and load-tested first, then production at `drops.dogs.red`.
Every step is either a command or a box to tick in a dashboard.

## 1. Accounts and keys

| What | Where | Goes into |
|---|---|---|
| Cloudflare API token (Workers, D1, KV, R2 edit) | Cloudflare → My Profile → API Tokens | GitHub secret `CLOUDFLARE_API_TOKEN` |
| Cloudflare account id | Cloudflare dashboard sidebar | GitHub secret `CLOUDFLARE_ACCOUNT_ID` |
| Stripe secret key (`sk_test_` on staging, `sk_live_` on production) | Stripe → Developers → API keys | `wrangler secret put STRIPE_SECRET_KEY [--env staging]` |
| Stripe webhook signing secret | Created in step 4 | `wrangler secret put STRIPE_WEBHOOK_SECRET` |
| Session secret (any 64 random chars: `openssl rand -hex 32`) | You | `wrangler secret put SESSION_SECRET` |
| Resend API key, with `dogs.red` verified as a sending domain | resend.com | `wrangler secret put RESEND_API_KEY` |
| Turnstile site key + secret (widget for `drops.dogs.red` and `drops-staging.dogs.red`) | Cloudflare → Turnstile | site key: `TURNSTILE_SITE_KEY` in `wrangler.jsonc` vars; secret: `wrangler secret put TURNSTILE_SECRET` |

Without `RESEND_API_KEY`, sign-in links only go to the Worker logs. Without `TURNSTILE_SECRET`, there is no bot gate.
Both are required for production.

## 2. Create resources (once per environment)

```sh
npx wrangler d1 create dogs-drops-staging
npx wrangler kv namespace create STOREFRONT --env staging
npx wrangler r2 bucket create dogs-drops-media-staging
```

Paste the printed ids into `wrangler.jsonc` under `env.staging`. Production uses the same commands without
`-staging` / `--env staging`, and its ids go in the top-level section.

## 3. Deploy

GitHub → Actions → **Deploy** → staging. It runs the unit tests and the battle test, then builds, migrates D1 and
deploys. From a laptop instead: `npm run deploy:staging`.

`dogs.red` must be a zone on the same Cloudflare account. The custom domain route creates the DNS record.

## 4. Stripe

1. **Connect**: Stripe → Connect → get started → platform, Express accounts. Set the branding, which merchants see
   during onboarding.
2. **Webhook**: Developers → Webhooks → add endpoint `https://drops-staging.dogs.red/api/stripe/webhook` with the
   events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` and
   `charge.refunded`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. **Tax** (only if any shop turns on "Collect sales tax"): Stripe Tax → activate, add registrations.
4. **Payouts** for "DOGS handles the money" shops: the funds sit in the platform balance. Pay those merchants from
   Stripe (manual transfers or payouts) until an automated payout job exists.

## 5. Staging acceptance (all must pass)

- [ ] Sign up, sign out, receive and use an emailed sign-in link, change password.
- [ ] Create a drop with sizes and a video, publish it, open it on a phone and on a laptop.
- [ ] Buy with test card `4242 4242 4242 4242`: the stock drops one unit on both screens, the order lands in the
  Orders tab, and Stripe sends a receipt and invoice.
- [ ] Abandon a checkout: the unit comes back after the hold expires.
- [ ] Connect a test Express account and buy again: the payment shows up as a transfer to that account, minus the fee.
- [ ] Refund from the dashboard.
- [ ] Moderation: post from a second browser, then delete and silence it as the host.
- [ ] Load test (below) passes.

## 6. Load test

Publish a staging drop set to the "Massive" crowd size, then run from 3+ machines in different regions:

```sh
ulimit -n 100000
TARGET=https://drops-staging.dogs.red DROP=<id> VIEWERS=30000 RAMP=1000 HOLD_S=300 npm run load
```

Pass: `failed` under 0.1%, `roomViewers` equal to the sum across machines, `fanoutSpreadMs.p95` under 1000.
Watch the Durable Objects metrics in Cloudflare (CPU per object, errors) while it runs, and note the cost in
Billing afterwards. Repeat at 10x on the next run before promising crowds that size to a shop.

## 7. Production

Repeat steps 1 to 4 for production with live keys, then Actions → **Deploy** → production.
Run one real purchase with a real card on a hidden drop and refund it.

## Static assets: Workers (recommended) or Pages

**Default: one Worker with Static Assets** (what `wrangler.jsonc` sets up). The app is served straight from
Cloudflare's asset layer. Asset requests are free, unlimited and never run Worker code, so 20M page loads cost
nothing. Only `/api/*` and `/media/*` run the Worker. Each deploy ships the app and the API together as one
version: no window where new pages talk to an old API, and `wrangler rollback` reverts both.

**If Muse sets it up on Cloudflare Pages instead**, it works as long as the site and API share one hostname
(cookies, the CSP and WebSockets all rely on that):
1. Pages project: build `npm run build`, output `dist`, custom domain `drops.dogs.red`. Pages honors
   `public/_headers` and serves `index.html` for unknown paths (the SPA fallback) out of the box.
2. Worker: remove `assets` and the `custom_domain` route from `wrangler.jsonc`. Replace them with zone routes
   `drops.dogs.red/api/*` and `drops.dogs.red/media/*` (`"routes": [{ "pattern": "drops.dogs.red/api/*", "zone_name": "dogs.red" }, ...]`).
   Worker routes take precedence over Pages on the same hostname.
3. Every release deploys Pages and the Worker together, API first. Rollbacks have to revert both by hand.

Either way: `/assets/*` files are content-hashed and cached forever. `index.html` revalidates on every load, so a
deploy reaches everyone on their next page load. Mid-drop changes (edits, reveals, stock) never wait on a deploy
or a cache: they ride the WebSocket.

## Rollback

`npx wrangler rollback [--env staging]` restores the previous Worker version. D1 migrations only add tables and
columns, so older code keeps working against a newer schema.
