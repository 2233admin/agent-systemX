CREATE TABLE IF NOT EXISTS configuration_search_document (
  revision_id TEXT PRIMARY KEY REFERENCES configuration_revision(revision_id),
  config_name TEXT NOT NULL,
  scope_boundary TEXT NOT NULL,
  capability_names TEXT NOT NULL,
  capability_summaries TEXT NOT NULL,
  trigger_category TEXT NOT NULL
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS configuration_revision_fts USING fts5(
  config_name,
  scope_boundary,
  capability_names,
  capability_summaries,
  trigger_category,
  content='configuration_search_document',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS configuration_search_document_ai AFTER INSERT ON configuration_search_document BEGIN
  INSERT INTO configuration_revision_fts(rowid, config_name, scope_boundary, capability_names, capability_summaries, trigger_category)
  VALUES (new.rowid, new.config_name, new.scope_boundary, new.capability_names, new.capability_summaries, new.trigger_category);
END;

CREATE TRIGGER IF NOT EXISTS configuration_search_document_ad AFTER DELETE ON configuration_search_document BEGIN
  INSERT INTO configuration_revision_fts(configuration_revision_fts) VALUES ('rebuild');
END;

CREATE TRIGGER IF NOT EXISTS configuration_search_document_au AFTER UPDATE ON configuration_search_document BEGIN
  INSERT INTO configuration_revision_fts(configuration_revision_fts) VALUES ('rebuild');
END;
