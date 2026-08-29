import type { ActivationOperationRepository } from '../../application/ports/activation-operation-repository';
import { ConcurrencyConflictError } from '../../domain/errors';
import type { ActivationOperation } from '../../domain/activation-operation';
import { clientId } from '../../domain/client';
import { configurationName, configurationRevisionId } from '../../domain/configuration';
import { SqliteStore } from './store';

function fromRow(row: Record<string, unknown>): ActivationOperation {
  return {
    operationId: String(row.operation_id),
    revisionId: row.revision_id === null ? null : configurationRevisionId(String(row.revision_id)),
    configName: configurationName(String(row.config_name)),
    clientId: clientId(String(row.client_id)),
    phase: String(row.phase) as ActivationOperation['phase'],
    version: Number(row.version),
    planHash: String(row.plan_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    terminalReason: row.terminal_reason === null ? undefined : String(row.terminal_reason),
  };
}

const COLUMNS = 'operation_id, revision_id, config_name, client_id, phase, version, plan_hash, created_at, updated_at, terminal_reason';

export class SqliteActivationOperationRepository implements ActivationOperationRepository {
  constructor(readonly store: SqliteStore) {}

  async insert(operation: ActivationOperation): Promise<void> {
    this.store.db.query(`INSERT INTO activation_operation(${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(operation.operationId, operation.revisionId, operation.configName, operation.clientId, operation.phase, operation.version, operation.planHash, operation.createdAt, operation.updatedAt, operation.terminalReason ?? null);
  }

  async updateIfVersion(operationId: string, expectedVersion: number, nextState: ActivationOperation): Promise<void> {
    const result = this.store.db.query(`UPDATE activation_operation SET revision_id = ?, config_name = ?, client_id = ?, phase = ?, version = ?, plan_hash = ?, updated_at = ?, terminal_reason = ? WHERE operation_id = ? AND version = ?`).run(nextState.revisionId, nextState.configName, nextState.clientId, nextState.phase, nextState.version, nextState.planHash, nextState.updatedAt, nextState.terminalReason ?? null, operationId, expectedVersion);
    if (result.changes !== 1) throw new ConcurrencyConflictError(operationId, expectedVersion);
  }

  async claimApplying(operationId: string, expectedVersion: number, claimedAt: string): Promise<ActivationOperation> {
    const result = this.store.db.query('UPDATE activation_operation SET version = version + 1, updated_at = ? WHERE operation_id = ? AND version = ? AND phase = ?').run(claimedAt, operationId, expectedVersion, 'applying');
    if (result.changes !== 1) throw new ConcurrencyConflictError(operationId, expectedVersion);
    const claimed = await this.findById(operationId);
    if (claimed === null) throw new ConcurrencyConflictError(operationId, expectedVersion);
    return claimed;
  }

  async findById(operationId: string): Promise<ActivationOperation | null> {
    const row = this.store.db.query<Record<string, unknown>, [string]>(`SELECT ${COLUMNS} FROM activation_operation WHERE operation_id = ?`).get(operationId);
    return row === null ? null : fromRow(row);
  }

  async findLatest(): Promise<ActivationOperation | null> {
    const row = this.store.db.query<Record<string, unknown>, []>(`SELECT ${COLUMNS} FROM activation_operation ORDER BY updated_at DESC, rowid DESC LIMIT 1`).get();
    return row === null ? null : fromRow(row);
  }

  async findLatestForClient(client: ActivationOperation['clientId']): Promise<ActivationOperation | null> {
    const row = this.store.db.query<Record<string, unknown>, [string]>(`SELECT ${COLUMNS} FROM activation_operation WHERE client_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1`).get(client);
    return row === null ? null : fromRow(row);
  }
}
