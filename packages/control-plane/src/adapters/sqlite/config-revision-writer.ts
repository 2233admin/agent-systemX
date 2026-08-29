import type { ConfigurationRevisionWriter } from '../../application/ports/configuration-repository';
import { SupersedesConfigMismatchError, SupersedesConflictError, SupersedesNotFoundError, createRevisionFromCandidate, parseCandidateRevision, parseEvidenceRef, parseSupersedesRevisionId, parseTriggerCategory } from '../../application/establish';
import type { ConfigurationRevision } from '../../domain/configuration';
import { SqliteStore } from './store';

export class SqliteConfigRevisionWriter implements ConfigurationRevisionWriter {
  constructor(readonly store: SqliteStore) {}

  async create(params: Parameters<ConfigurationRevisionWriter['create']>[0]): Promise<ConfigurationRevision> {
    const candidate = parseCandidateRevision(params.candidate);
    const triggerCategory = parseTriggerCategory(params.triggerCategory);
    const evidenceRef = parseEvidenceRef(params.evidenceRef);
    const supersedesRevisionId = params.supersedesRevisionId === null ? null : parseSupersedesRevisionId(params.supersedesRevisionId);
    const revision = createRevisionFromCandidate(candidate, { triggerCategory, evidenceRef, supersedesRevisionId });
    try {
      this.store.db.transaction(() => {
        if (supersedesRevisionId !== null) {
          const target = this.store.db.query<{ config_name: string }, [string]>('SELECT config_name FROM configuration_revision WHERE revision_id = ?').get(supersedesRevisionId);
          if (target === null) throw new SupersedesNotFoundError(supersedesRevisionId);
          if (target.config_name !== revision.configName) throw new SupersedesConfigMismatchError(supersedesRevisionId, revision.configName, target.config_name);
          const successor = this.store.db.query<{ revision_id: string }, [string]>('SELECT revision_id FROM configuration_revision WHERE supersedes_revision_id = ?').get(supersedesRevisionId);
          if (successor !== null) throw new SupersedesConflictError(supersedesRevisionId);
        }
        this.store.db.query('INSERT OR IGNORE INTO configuration(config_name) VALUES (?)').run(revision.configName);
        this.store.db.query('INSERT INTO configuration_revision(revision_id, config_name, schema_version, default_marker_json, scope_boundary_json, availability_json, capabilities_json, trigger_category, evidence_ref, supersedes_revision_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(revision.revisionId, revision.configName, revision.schemaVersion, JSON.stringify(revision.defaultMarker), JSON.stringify(revision.scopeBoundary), JSON.stringify(revision.availability), JSON.stringify(revision.capabilities), revision.triggerCategory, revision.evidenceRef, revision.supersedesRevisionId, revision.createdAt);
      })();
    } catch (error) {
      if (error instanceof SupersedesNotFoundError || error instanceof SupersedesConfigMismatchError || error instanceof SupersedesConflictError) throw error;
      if (supersedesRevisionId !== null && error instanceof Error && (error.message.includes('idx_configuration_revision_supersedes') || error.message.includes('supersedes_revision_id'))) throw new SupersedesConflictError(supersedesRevisionId);
      throw error;
    }
    this.store.rebuildSearchProjection();
    return revision;
  }
}
