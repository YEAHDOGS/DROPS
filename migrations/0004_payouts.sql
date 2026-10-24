-- Creator payouts for "DOGS handles the money" shops: each paid order becomes one Stripe Transfer.

ALTER TABLE orders ADD COLUMN fee_cents INTEGER;      -- platform fee kept on this order
ALTER TABLE orders ADD COLUMN transfer_id TEXT;       -- Stripe Transfer that paid the creator (null = still owed)
ALTER TABLE orders ADD COLUMN payout_id TEXT REFERENCES payouts (id);
ALTER TABLE merchants ADD COLUMN payout_schedule TEXT NOT NULL DEFAULT 'manual' CHECK (payout_schedule IN ('manual', 'daily'));

CREATE TABLE payouts (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants (id),
  amount_cents INTEGER NOT NULL,   -- sum of transfers in this run (single currency per run row)
  currency TEXT NOT NULL,
  orders INTEGER NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'daily')),
  created_at INTEGER NOT NULL
);
CREATE INDEX payouts_merchant ON payouts (merchant_id, created_at);
CREATE INDEX orders_owed ON orders (merchant_id, transfer_id, status);
CREATE INDEX orders_email ON orders (drop_id, email);
