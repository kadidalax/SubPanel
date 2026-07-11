-- preserve import order within a source
ALTER TABLE source_nodes ADD COLUMN source_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_source_nodes_order ON source_nodes(source_id, source_order, id);

-- backfill historical import order (first insert ~ id ASC)
UPDATE source_nodes AS sn
SET source_order = r.ord
FROM (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY id ASC) - 1) AS ord
  FROM source_nodes
) AS r
WHERE sn.id = r.id;

-- rebuild group sort_order from source import order
UPDATE group_nodes AS gn
SET sort_order = r.ord
FROM (
  SELECT
    gn2.group_id AS group_id,
    gn2.node_id AS node_id,
    (ROW_NUMBER() OVER (
      PARTITION BY gn2.group_id
      ORDER BY sn.source_id ASC, sn.source_order ASC, sn.id ASC
    ) - 1) AS ord
  FROM group_nodes gn2
  JOIN source_nodes sn ON sn.id = gn2.node_id
) AS r
WHERE gn.group_id = r.group_id AND gn.node_id = r.node_id;
