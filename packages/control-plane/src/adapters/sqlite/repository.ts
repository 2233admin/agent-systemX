import { Database } from 'bun:sqlite';
import type { ConfigurationRepository, ConfigurationRevisionWriter, ConfigurationSearchRepository, ConfigurationSearchResult } from '../../application/ports/configuration-repository';
import { normalizeCapabilityReference, type CapabilityReference } from '../../domain/capability';
import { configurationName, configurationRevisionId, validateConfigurationRevision, type ConfigurationRevision, type UnknownValue } from '../../domain/configuration';
import { SqliteStore } from './store';

function parseFact<T>(value: string, label: string, isValid: (value: unknown) => value is T): UnknownValue | { readonly kind: 'known'; readonly value: T } {
  const parsed = JSON.parse(value) as { kind?: unknown; value?: unknown; reason?: unknown; observedAt?: unknown };
  if (parsed.kind === 'unknown' && typeof parsed.reason === 'string' && typeof parsed.observedAt === 'string' && parsed.reason.trim().length > 0 && parsed.observedAt.trim().length > 0) return { kind: 'unknown', reason: parsed.reason, observedAt: parsed.observedAt };
  if (parsed.kind === 'known' && isValid(parsed.value)) return { kind: 'known', value: parsed.value };
  throw new Error(`invalid persisted ${label}`);
}

function parseRevision(row: Record<string, unknown>): ConfigurationRevision {
  const parsedCapabilities = JSON.parse(String(row.capabilities_json));
  if (!Array.isArray(parsedCapabilities)) throw new Error(`invalid capabilities for revision ${String(row.revision_id)}`);
  const revision: ConfigurationRevision = {
    configName: configurationName(String(row.config_name)),
    revisionId: configurationRevisionId(String(row.revision_id)),
    schemaVersion: Number(row.schema_version),
    defaultMarker: parseFact(String(row.default_marker_json), 'default marker', (value): value is boolean => typeof value === 'boolean'),
    scopeBoundary: parseFact(String(row.scope_boundary_json), 'scope boundary', (value): value is string => typeof value === 'string' && value.trim().length > 0),
    availability: parseFact(String(row.availability_json), 'availability', (value): value is 'resolved' => value === 'resolved'),
    capabilities: parsedCapabilities.map(normalizeCapabilityReference),
    createdAt: String(row.created_at),
    triggerCategory: String(row.trigger_category) as ConfigurationRevision['triggerCategory'],
    evidenceRef: String(row.evidence_ref),
    supersedesRevisionId: row.supersedes_revision_id === null ? null : configurationRevisionId(String(row.supersedes_revision_id)),
  };
  validateConfigurationRevision(revision);
  return revision;
}

const REVISION_COLUMNS = 'revision_id, config_name, schema_version, default_marker_json, scope_boundary_json, availability_json, capabilities_json, trigger_category, evidence_ref, supersedes_revision_id, created_at';

export class SqliteConfigRevisionRepository implements ConfigurationRepository, ConfigurationSearchRepository {
  constructor(readonly store: SqliteStore) {}

  async listAll(): Promise<readonly ConfigurationRevision[]> {
    return this.store.db.query<Record<string, unknown>, []>(`SELECT ${REVISION_COLUMNS} FROM configuration_revision ORDER BY config_name, revision_id`).all().map(parseRevision);
  }

  async findById(revisionId: string): Promise<ConfigurationRevision | null> {
    const row = this.store.db.query<Record<string, unknown>, [string]>(`SELECT ${REVISION_COLUMNS} FROM configuration_revision WHERE revision_id = ?`).get(revisionId);
    return row === null ? null : parseRevision(row);
  }

  async search(query: string, limit: number): Promise<readonly ConfigurationSearchResult[]> {
    const rows = this.store.db.query<{ revision_id: string; config_name: string; trigger_category: string; rank: number }, [string, number]>(`SELECT d.revision_id, d.config_name, d.trigger_category, f.rank FROM configuration_revision_fts AS f JOIN configuration_search_document AS d ON d.rowid = f.rowid WHERE configuration_revision_fts MATCH ? ORDER BY f.rank LIMIT ?`).all(query, limit);
    return rows.map((row) => ({ revisionId: row.revision_id, configName: row.config_name, triggerCategory: row.trigger_category as ConfigurationRevision['triggerCategory'], rank: row.rank }));
  }

  async rebuild(): Promise<void> {
    this.store.db.transaction(() => {
      this.store.db.exec('DELETE FROM configuration_search_document');
      const rows = this.store.db.query<Record<string, unknown>, []>(`SELECT ${REVISION_COLUMNS} FROM configuration_revision ORDER BY revision_id`).all();
      const insert = this.store.db.query('INSERT INTO configuration_search_document(revision_id, config_name, scope_boundary, capability_names, capability_summaries, trigger_category) VALUES (?, ?, ?, ?, ?, ?)');
      for (const row of rows) {
        const revision = parseRevision(row);
        const scope = revision.scopeBoundary.kind === 'known' ? revision.scopeBoundary.value : '';
        insert.run(revision.revisionId, revision.configName, scope, revision.capabilities.map((item) => item.name).join(' '), revision.capabilities.map((item) => item.summary ?? '').join(' '), revision.triggerCategory);
      }
    })();
  }

  seed(revisions: readonly ConfigurationRevision[]): void {
    this.store.db.transaction(() => {
      this.store.db.exec('DELETE FROM configuration_search_document');
      this.store.db.exec('DELETE FROM configuration_revision');
      this.store.db.exec('DELETE FROM configuration');
      const insertConfig = this.store.db.query('INSERT INTO configuration(config_name) VALUES (?)');
      const insertRevision = this.store.db.query('INSERT INTO configuration_revision(revision_id, config_name, schema_version, default_marker_json, scope_boundary_json, availability_json, capabilities_json, trigger_category, evidence_ref, supersedes_revision_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const revision of revisions) {
        insertConfig.run(revision.configName);
        insertRevision.run(revision.revisionId, revision.configName, revision.schemaVersion, JSON.stringify(revision.defaultMarker), JSON.stringify(revision.scopeBoundary), JSON.stringify(revision.availability), JSON.stringify(revision.capabilities), revision.triggerCategory, revision.evidenceRef, revision.supersedesRevisionId, revision.createdAt);
      }
    })();
    void this.rebuild();
  }

  close(): void {
    this.store.close();
  }
}

export { parseRevision };
