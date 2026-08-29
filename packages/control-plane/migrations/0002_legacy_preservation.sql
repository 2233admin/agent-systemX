CREATE TABLE IF NOT EXISTS legacy_schema_inventory (
  table_name TEXT NOT NULL,
  columns_json TEXT NOT NULL,
  owner_status TEXT NOT NULL CHECK (owner_status = 'owner-unknown'),
  discovered_at TEXT NOT NULL,
  PRIMARY KEY (table_name)
) STRICT;

CREATE TABLE IF NOT EXISTS legacy_launch_plan (
  legacy_id INTEGER PRIMARY KEY,
  source_row_json TEXT NOT NULL,
  copied_at TEXT NOT NULL
) STRICT;
