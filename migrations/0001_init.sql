-- D1: the cold path. Merchants, drop definitions and the order ledger for dashboards.
-- Live stock never lives here: each drop's DropRoom Durable Object owns it (SQLite, single-threaded, atomic).
-- Times are epoch milliseconds (UTC). JSON columns hold small, validated blobs (see shared/drop.js).

CREATE TABLE merchants (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,              -- drops.dogs.red/{handle}
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  payout_mode TEXT NOT NULL DEFAULT 'platform' CHECK (payout_mode IN ('platform', 'connect')),
  stripe_account_id TEXT,                   -- Stripe Connect Express account, when payout_mode = 'connect'
  stripe_ready INTEGER NOT NULL DEFAULT 0,  -- charges_enabled on that account
  theme TEXT NOT NULL DEFAULT '{}',
  shipping TEXT NOT NULL DEFAULT '{"countries":[],"rates":[]}',
  created_at INTEGER NOT NULL
);

CREATE TABLE drops (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants (id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  total_stock INTEGER NOT NULL,
  max_per_order INTEGER NOT NULL DEFAULT 1,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,                          -- null = open until sold out
  hold_minutes INTEGER NOT NULL DEFAULT 10,
  shards INTEGER NOT NULL DEFAULT 64,       -- broadcast tree leaves (crowd size)
  chat INTEGER NOT NULL DEFAULT 1,
  media TEXT NOT NULL DEFAULT '[]',
  published INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (merchant_id, slug)
);
CREATE INDEX drops_merchant ON drops (merchant_id, starts_at);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,                      -- Stripe Checkout session id
  drop_id TEXT NOT NULL REFERENCES drops (id),
  merchant_id TEXT NOT NULL REFERENCES merchants (id),
  payment_intent TEXT,
  qty INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  email TEXT,
  name TEXT,
  shipping TEXT,                            -- JSON address from Checkout
  connected INTEGER NOT NULL DEFAULT 0,     -- destination charge to the merchant's Connect account
  status TEXT NOT NULL CHECK (status IN ('paid', 'refunded', 'fulfilled')),
  created_at INTEGER NOT NULL
);
CREATE INDEX orders_merchant ON orders (merchant_id, created_at);
CREATE INDEX orders_drop ON orders (drop_id);
