-- Mystery drops, per-drop chat rules, per-drop logo + link.

ALTER TABLE drops ADD COLUMN chat_config TEXT;                  -- shared/chat.js chatConfig(); null = legacy `chat` flag
ALTER TABLE drops ADD COLUMN mystery INTEGER NOT NULL DEFAULT 0; -- hide the product until starts_at
ALTER TABLE drops ADD COLUMN teaser TEXT NOT NULL DEFAULT '';    -- what a mystery drop shows before the reveal
ALTER TABLE drops ADD COLUMN logo TEXT;                          -- /media/... shown in the header instead of the shop logo
ALTER TABLE drops ADD COLUMN link TEXT;                          -- https://... the header logo points to
