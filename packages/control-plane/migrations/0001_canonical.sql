CREATE TABLE IF NOT EXISTS configuration (
  config_name TEXT PRIMARY KEY
) STRICT;

CREATE TABLE IF NOT EXISTS configuration_revision (
  revision_id TEXT PRIMARY KEY,
  config_name TEXT NOT NULL REFERENCES configuration(config_name),
  schema_version INTEGER NOT NULL,
  default_marker_json TEXT NOT NULL,
  scope_boundary_json TEXT NOT NULL,
  availability_json TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  trigger_category TEXT NOT NULL CHECK (trigger_category IN ('new-scenario', 'known-insufficiency', 'bad-case')),
  evidence_ref TEXT NOT NULL,
  supersedes_revision_id TEXT REFERENCES configuration_revision(revision_id),
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_configuration_revision_supersedes
  ON configuration_revision(supersedes_revision_id)
  WHERE supersedes_revision_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS activation_operation (
  operation_id TEXT PRIMARY KEY,
  revision_id TEXT REFERENCES configuration_revision(revision_id),
  config_name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('prepared', 'awaiting-confirmation', 'applying', 'succeeded', 'degraded', 'failed', 'cancelled', 'requires-restart')),
  version INTEGER NOT NULL,
  plan_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminal_reason TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS launch_observation (
  observation_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES activation_operation(operation_id),
  client_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('process-started', 'context-written', 'process-exited', 'outcome-observed')),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'degraded', 'failed', 'incomplete', 'unknown', 'not-available')),
  process_reference_json TEXT,
  reason TEXT,
  observed_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_activation_operation_client_updated
  ON activation_operation(client_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_launch_observation_operation_time
  ON launch_observation(operation_id, observed_at);
