import { Database } from 'bun:sqlite';
import type { ConfigurationRepository, ConfigurationRevisionWriter, ConfigurationSearchRepository, ConfigurationSearchResult } from '../../application/ports/configuration-repository';
import type { CapabilityReference } from '../../domain/capability';
import { configurationName, configurationRevisionId, type ConfigurationRevision, type UnknownValue } from '../../domain/configuration';
import { SqliteStore } from './store';

function parseUnknown(value: string): UnknownValue | { readonly kind: 'known'; readonly value: boolean } | { readonly kind: 'known'; readonly value: string } | { readonly kind: 'known'; readonly value: 'resolved' } {
  const parsed = JSON.parse(value) as { kind?: string; value?: unknown; reason?: string; observedAt?: string };
  if (parsed.kind === 'unknown' && typeof parsed.reason === 'string' && typeof parsed.observedAt === 'string') return { kind: 'unknown', reason: parsed.reason, observedAt: parsed.observedAt };
  if (parsed.kind === 'known') return { kind: 'known', value: parsed.value as never };
  throw new Error('invalid persisted observation');
}

function parseRevision(row: Record<string, unknown>): ConfigurationRevision {
  const capabilities = JSON.parse(String(row.capabilities_json)) as CapabilityReference[];
  if (!Array.isArray(capabilities)) throw new Error(`invalid capabilities for revision ${String(row.revision_id)}`);
  return {
    configName: configurationName(String(row.config_name)),
    revisionId: configurationRevisionId(String(row.revision_id)),
    schemaVersion: Number(row.schema_version),
    defaultMarker: parseUnknown(String(row.default_marker_json)) as ConfigurationRevision['defaultMarker'],
    scopeBoundary: parseUnknown(String(row.scope_boundary_json)) as ConfigurationRevision['scopeBoundary'],
    availability: parseUnknown(String(row.availability_json)) as ConfigurationRevision['availability'],
    capabilities,
    createdAt: String(row.created_at),
    triggerCategory: String(row.trigger_category) as ConfigurationRevision['triggerCategory'],
    evidenceRef: String(row.evidence_ref),
    supersedesRevisionId: row.supersedes_revision_id === null ? null : configurationRevisionId(String(row.supersedes_revision_id)),
  };
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
