import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import CANONICAL_SQL from '../../../migrations/0001_canonical.sql' with { type: 'text' };
import LEGACY_SQL from '../../../migrations/0002_legacy_preservation.sql' with { type: 'text' };
import SEARCH_SQL from '../../../migrations/0003_search.sql' with { type: 'text' };
import { openSqliteDatabase } from './connection';

interface MigrationDefinition {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface MigrationManifest {
  readonly databasePath: string;
  readonly appliedVersions: readonly number[];
  readonly legacyBootstrap: boolean;
  readonly canonicalCounts: { readonly configurations: number; readonly revisions: number; readonly operations: number; readonly observations: number };
}

const MIGRATIONS: readonly MigrationDefinition[] = [
  { version: 1, name: 'canonical', sql: CANONICAL_SQL },
  { version: 2, name: 'legacy-preservation', sql: LEGACY_SQL },
  { version: 3, name: 'search-projection', sql: SEARCH_SQL },
];

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

function splitStatements(sql: string): readonly string[] {
  return [sql];
}
function runStatement(db: Database, sql: string, bindings: readonly unknown[]): void {
  db.query(sql).run(...(bindings as never[]));
}

function tableExists(db: Database, name: string): boolean {
  return db.query<{ present: number }, [string]>("SELECT COUNT(*) AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.present === 1;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function legacyTableColumns(db: Database, table: string): readonly string[] {
  return db.query<{ name: string }, []>(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((row) => row.name);
}

function captureLegacyInventory(db: Database, discoveredAt: string): void {
  const canonical = new Set(['schema_migrations', 'configuration', 'configuration_revision', 'activation_operation', 'launch_observation', 'legacy_schema_inventory', 'legacy_launch_plan', 'configuration_search_document', 'configuration_revision_fts']);
  const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const insert = db.query('INSERT OR IGNORE INTO legacy_schema_inventory(table_name, columns_json, owner_status, discovered_at) VALUES (?, ?, ?, ?)');
  for (const table of tables) {
    if (canonical.has(table.name) || table.name.startsWith('configuration_revision_fts_')) continue;
    insert.run(table.name, JSON.stringify(legacyTableColumns(db, table.name)), 'owner-unknown', discoveredAt);
  }
}

function legacyFact(status: string | undefined, value: string | null | undefined, reason: string | null | undefined, observedAt: string | null | undefined, parse: (raw: string) => unknown): unknown {
  if (status === 'known' && value !== null && value !== undefined) return { kind: 'known', value: parse(value) };
  return { kind: 'unknown', reason: reason ?? 'legacy-unknown', observedAt: observedAt ?? new Date(0).toISOString() };
}

function legacyCapabilityRows(row: Record<string, unknown>): unknown[] {
  const groups = [
    ['instructions_json', 'instruction'],
    ['skills_json', 'skill'],
    ['mcp_json', 'mcp'],
    ['hooks_json', 'hook'],
    ['plugins_json', 'plugin'],
  ] as const;
  const capabilities: unknown[] = [];
  for (const [column, kind] of groups) {
    const raw = row[column];
    if (typeof raw !== 'string') continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = []; }
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.name !== 'string' || entry.name.trim().length === 0) continue;
      capabilities.push({
        kind: entry.kind ?? kind,
        name: entry.name,
        source: typeof entry.sourceCategory === 'object' && entry.sourceCategory !== null && (entry.sourceCategory as Record<string, unknown>).kind === 'known' ? (entry.sourceCategory as Record<string, unknown>).value : undefined,
        summary: typeof entry.summary === 'object' && entry.summary !== null && (entry.summary as Record<string, unknown>).kind === 'known' ? (entry.summary as Record<string, unknown>).value : undefined,
        sourceRef: typeof entry.sourceRef === 'object' && entry.sourceRef !== null && (entry.sourceRef as Record<string, unknown>).kind === 'known' ? (entry.sourceRef as Record<string, unknown>).value : undefined,
        contentFingerprint: typeof entry.contentFingerprint === 'object' && entry.contentFingerprint !== null && (entry.contentFingerprint as Record<string, unknown>).kind === 'known' ? (entry.contentFingerprint as Record<string, unknown>).value : undefined,
      });
    }
  }
  return capabilities;
}

function copyLegacyData(db: Database, copiedAt: string): void {
  if (tableExists(db, 'stable_config')) {
    const configs = db.query<{ config_name: string }, []>('SELECT config_name FROM stable_config').all();
    const insertConfig = db.query('INSERT OR IGNORE INTO configuration(config_name) VALUES (?)');
    for (const config of configs) insertConfig.run(config.config_name);
  }
  if (tableExists(db, 'stable_config_revision')) {
    const availableColumns = new Set(legacyTableColumns(db, 'stable_config_revision'));
    const columns = ['revision_id', 'config_name', 'schema_version', 'default_marker_status', 'default_marker_value', 'default_marker_reason', 'default_marker_observed_at', 'scope_boundary_status', 'scope_boundary_value', 'scope_boundary_reason', 'scope_boundary_observed_at', 'availability_status', 'availability_value', 'availability_reason', 'availability_observed_at', 'instructions_json', 'skills_json', 'mcp_json', 'hooks_json', 'plugins_json', 'created_at', 'trigger_category', 'evidence_ref', 'supersedes_revision_id'].filter((column) => availableColumns.has(column));
    const rows = db.query<Record<string, unknown>, []>(`SELECT ${columns.map(quoteIdentifier).join(', ')} FROM stable_config_revision`).all();
    for (const row of rows) {
      const revisionId = String(row.revision_id);
      runStatement(db, 'INSERT OR IGNORE INTO configuration_revision(revision_id, config_name, schema_version, default_marker_json, scope_boundary_json, availability_json, capabilities_json, trigger_category, evidence_ref, supersedes_revision_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [revisionId, row.config_name, row.schema_version ?? 1, JSON.stringify(legacyFact(String(row.default_marker_status), row.default_marker_value as string | null, row.default_marker_reason as string | null, row.default_marker_observed_at as string | null, (raw) => raw === 'true')), JSON.stringify(legacyFact(String(row.scope_boundary_status), row.scope_boundary_value as string | null, row.scope_boundary_reason as string | null, row.scope_boundary_observed_at as string | null, (raw) => raw)), JSON.stringify(legacyFact(String(row.availability_status), row.availability_value as string | null, row.availability_reason as string | null, row.availability_observed_at as string | null, (raw) => raw)), JSON.stringify(legacyCapabilityRows(row)), row.trigger_category ?? 'new-scenario', row.evidence_ref ?? `legacy:stable_config_revision:${revisionId}`, row.supersedes_revision_id ?? null, row.created_at ?? copiedAt]);
    }
  }
  if (!tableExists(db, 'launch_plan')) return;
  const columns = legacyTableColumns(db, 'launch_plan');
  if (columns.length === 0) return;
  const selectColumns = ['rowid', ...columns].map(quoteIdentifier).join(', ');
  const rows = db.query<Record<string, unknown>, []>(`SELECT ${selectColumns} FROM launch_plan ORDER BY rowid`).all();
  const allowed = new Set(['prepared', 'awaiting-confirmation', 'applying', 'succeeded', 'degraded', 'failed', 'cancelled', 'requires-restart']);
  for (const row of rows) {
    const legacyId = Number(row.rowid);
    runStatement(db, 'INSERT OR IGNORE INTO legacy_launch_plan(legacy_id, source_row_json, copied_at) VALUES (?, ?, ?)', [legacyId, JSON.stringify(row), copiedAt]);
    const phaseRaw = String(row.phase ?? 'failed');
    const phase = phaseRaw === 'observing' ? 'applying' : allowed.has(phaseRaw) ? phaseRaw : 'failed';
    const revisionId = typeof row.revision_id === 'string' && db.query('SELECT revision_id FROM configuration_revision WHERE revision_id = ?').get(row.revision_id) !== null ? row.revision_id : null;
    const operationId = String(row.operation_id ?? `legacy-operation-${legacyId}`);
    const configName = String(row.config_name ?? row.revision_id ?? 'legacy-unknown');
    const client = String(row.client ?? 'legacy-unknown');
    const reason = revisionId === null ? 'unresolved legacy operation: revision could not be associated' : null;
    runStatement(db, 'INSERT OR IGNORE INTO activation_operation(operation_id, revision_id, config_name, client_id, phase, version, plan_hash, created_at, updated_at, terminal_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [operationId, revisionId, configName, client, phase, 0, String(row.plan_hash ?? `legacy-${legacyId}`), String(row.created_at ?? copiedAt), copiedAt, reason]);
    if (String(row.observed_outcome_status) === 'known' && typeof row.observed_outcome_value === 'string') {
      runStatement(db, 'INSERT OR IGNORE INTO launch_observation(observation_id, operation_id, client_id, stage, outcome, process_reference_json, reason, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [`legacy-observation-${legacyId}`, operationId, client, 'outcome-observed', row.observed_outcome_value, null, row.observed_outcome_reason ?? null, row.observed_outcome_observed_at ?? copiedAt]);
    }
  }
}

function applyMigration(db: Database, migration: MigrationDefinition): void {
  const expectedChecksum = checksum(migration.sql);
  const existing = db.query<{ name: string; checksum: string }, [number]>('SELECT name, checksum FROM schema_migrations WHERE version = ?').get(migration.version);
  if (existing !== null) {
    if (existing.name !== migration.name || existing.checksum !== expectedChecksum) throw new Error(`schema migration checksum mismatch at version ${migration.version}`);
    return;
  }
  const previous = db.query<{ version: number }, []>('SELECT MAX(version) AS version FROM schema_migrations').get()?.version ?? 0;
  if (migration.version > previous + 1) throw new Error(`missing prerequisite schema migration before version ${migration.version}`);
  db.transaction(() => {
    for (const statement of splitStatements(migration.sql)) db.exec(statement);
    db.query('INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)').run(migration.version, migration.name, expectedChecksum, new Date().toISOString());
  })();
}

function reconcileProjection(db: Database): void {
  db.transaction(() => {
    db.exec('DELETE FROM configuration_search_document');
    const rows = db.query<{ revision_id: string; config_name: string; scope_boundary_json: string; capabilities_json: string; trigger_category: string }, []>('SELECT revision_id, config_name, scope_boundary_json, capabilities_json, trigger_category FROM configuration_revision ORDER BY revision_id').all();
    const insert = db.query('INSERT INTO configuration_search_document(revision_id, config_name, scope_boundary, capability_names, capability_summaries, trigger_category) VALUES (?, ?, ?, ?, ?, ?)');
    for (const row of rows) {
      const scope = JSON.parse(row.scope_boundary_json) as { kind: string; value?: string };
      const capabilities = JSON.parse(row.capabilities_json) as Array<{ name: string; summary?: string }>;
      insert.run(row.revision_id, row.config_name, scope.kind === 'known' ? scope.value ?? '' : '', capabilities.map((item) => item.name).join(' '), capabilities.map((item) => item.summary ?? '').join(' '), row.trigger_category);
    }
  })();
}

export class SqliteStore {
  readonly db: Database;
  readonly manifest: MigrationManifest;

  constructor(readonly databasePath: string) {
    this.db = openSqliteDatabase(databasePath);
    this.manifest = this.migrate();
  }

  private migrate(): MigrationManifest {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT');
    const hadHistory = this.db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM schema_migrations').get()?.count !== 0;
    const hadLegacySchema = tableExists(this.db, 'stable_config') || tableExists(this.db, 'launch_plan');
    let legacyBootstrap = false;
    if (!hadHistory && hadLegacySchema) {
      legacyBootstrap = true;
      const bootstrapChecksum = checksum('legacy-bootstrap-v1');
      this.db.query('INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)').run(0, 'legacy-bootstrap', bootstrapChecksum, new Date().toISOString());
    }
    for (const migration of MIGRATIONS) applyMigration(this.db, migration);
    if (hadLegacySchema) {
      this.db.transaction(() => {
        const copiedAt = new Date().toISOString();
        captureLegacyInventory(this.db, copiedAt);
        copyLegacyData(this.db, copiedAt);
      })();
    }
    reconcileProjection(this.db);
    const appliedVersions = this.db.query<{ version: number }, []>('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version);
    this.db.exec('PRAGMA user_version = 3');
    return {
      databasePath: this.databasePath,
      appliedVersions,
      legacyBootstrap,
      canonicalCounts: {
        configurations: this.db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM configuration').get()?.count ?? 0,
        revisions: this.db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM configuration_revision').get()?.count ?? 0,
        operations: this.db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM activation_operation').get()?.count ?? 0,
        observations: this.db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM launch_observation').get()?.count ?? 0,
      },
    };
  }

  rebuildSearchProjection(): void {
    reconcileProjection(this.db);
  }

  close(): void {
    this.db.close();
  }
}
