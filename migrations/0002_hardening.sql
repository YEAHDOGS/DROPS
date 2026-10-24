-- Pre-launch hardening: variants, sign-in links, session revocation, Stripe Tax.

ALTER TABLE drops ADD COLUMN variants TEXT NOT NULL DEFAULT '[]';    -- [{ id, label, stock }]
ALTER TABLE orders ADD COLUMN variant TEXT;
ALTER TABLE merchants ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1; -- bump = sign out everywhere
ALTER TABLE merchants ADD COLUMN tax INTEGER NOT NULL DEFAULT 0;            -- Stripe automatic tax

-- One-time sign-in links (also the password reset). Only the SHA-256 of the token is stored.
CREATE TABLE login_tokens (
  hash TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants (id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX login_tokens_merchant ON login_tokens (merchant_id);
