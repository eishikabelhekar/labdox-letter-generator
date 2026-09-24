ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

-- The two demo/bootstrap accounts ship with a public, known password.
-- Force a change on next login once this migration is applied.
UPDATE users SET must_change_password = 1 WHERE id IN ('usr_admin', 'usr_issuer');
