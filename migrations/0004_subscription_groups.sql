-- many groups per subscription
CREATE TABLE IF NOT EXISTS subscription_groups (
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subscription_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_subscription_groups_group ON subscription_groups(group_id);

-- backfill from legacy single group_id
INSERT OR IGNORE INTO subscription_groups (subscription_id, group_id, sort_order)
SELECT id, group_id, 0 FROM subscriptions WHERE group_id IS NOT NULL;
