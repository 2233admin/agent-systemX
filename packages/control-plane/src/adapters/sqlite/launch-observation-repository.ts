import type { LaunchObservationRepository } from '../../application/ports/launch-observation-repository';
import type { LaunchObservation } from '../../domain/launch-observation';
import { clientId } from '../../domain/client';
import { SqliteStore } from './store';

function fromRow(row: Record<string, unknown>): LaunchObservation {
  return {
    observationId: String(row.observation_id),
    operationId: String(row.operation_id),
    clientId: clientId(String(row.client_id)),
    stage: String(row.stage) as LaunchObservation['stage'],
    outcome: String(row.outcome) as LaunchObservation['outcome'],
    processReference: row.process_reference_json === null ? undefined : JSON.parse(String(row.process_reference_json)),
    reason: row.reason === null ? undefined : String(row.reason),
    observedAt: String(row.observed_at),
  };
}

export class SqliteLaunchObservationRepository implements LaunchObservationRepository {
  constructor(readonly store: SqliteStore) {}

  async append(observation: LaunchObservation): Promise<void> {
    const existing = this.store.db.query<Record<string, unknown>, [string]>('SELECT operation_id, client_id, stage, outcome, process_reference_json, reason, observed_at FROM launch_observation WHERE observation_id = ?').get(observation.observationId);
    if (existing !== null) {
      const same = String(existing.operation_id) === observation.operationId
        && String(existing.client_id) === observation.clientId
        && String(existing.stage) === observation.stage
        && String(existing.outcome) === observation.outcome
        && String(existing.process_reference_json ?? '') === String(observation.processReference === undefined ? '' : JSON.stringify(observation.processReference))
        && String(existing.reason ?? '') === String(observation.reason ?? '')
        && String(existing.observed_at) === observation.observedAt;
      if (same) return;
      throw new Error(`launch observation id conflict: ${observation.observationId}`);
    }
    this.store.db.query('INSERT INTO launch_observation(observation_id, operation_id, client_id, stage, outcome, process_reference_json, reason, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(observation.observationId, observation.operationId, observation.clientId, observation.stage, observation.outcome, observation.processReference === undefined ? null : JSON.stringify(observation.processReference), observation.reason ?? null, observation.observedAt);
  }

  async listByOperation(operationId: string): Promise<readonly LaunchObservation[]> {
    return this.store.db.query<Record<string, unknown>, [string]>('SELECT observation_id, operation_id, client_id, stage, outcome, process_reference_json, reason, observed_at FROM launch_observation WHERE operation_id = ? ORDER BY observed_at, rowid').all(operationId).map(fromRow);
  }
}
