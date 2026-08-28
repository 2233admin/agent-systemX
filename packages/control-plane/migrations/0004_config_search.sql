CREATE TABLE IF NOT EXISTS config_search_document (
  revision_id TEXT PRIMARY KEY,
  config_name TEXT NOT NULL,
  scope_boundary TEXT NOT NULL,
  capability_names TEXT NOT NULL,
  capability_summaries TEXT NOT NULL,
  trigger_category TEXT NOT NULL CHECK (trigger_category IN ('new-scenario', 'known-insufficiency', 'bad-case'))
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS config_revision_fts USING fts5(
  config_name,
  scope_boundary,
  capability_names,
  capability_summaries,
  trigger_category,
  content='config_search_document',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS config_search_document_ai AFTER INSERT ON config_search_document BEGIN
  INSERT INTO config_revision_fts(rowid, config_name, scope_boundary, capability_names, capability_summaries, trigger_category)
  VALUES (new.rowid, new.config_name, new.scope_boundary, new.capability_names, new.capability_summaries, new.trigger_category);
END;

CREATE TRIGGER IF NOT EXISTS config_search_document_ad AFTER DELETE ON config_search_document BEGIN
  INSERT INTO config_revision_fts(config_revision_fts) VALUES ('rebuild');
END;

CREATE TRIGGER IF NOT EXISTS config_search_document_au AFTER UPDATE ON config_search_document BEGIN
  INSERT INTO config_revision_fts(config_revision_fts) VALUES ('rebuild');
END;
