-- Lifecycle fields for auto-disable and UI status.
ALTER TABLE users ADD COLUMN disabled_reason TEXT;
ALTER TABLE subscriptions ADD COLUMN disabled_reason TEXT;
