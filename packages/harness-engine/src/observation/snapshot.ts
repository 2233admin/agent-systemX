import type { EvidenceRef } from '../core/result.ts';
import type { ObservationProjection } from './projection.ts';

export interface ObservationSnapshot {
  readonly snapshotId: string;
  readonly observedAt: string;
  readonly projections: readonly ObservationProjection[];
  readonly evidence: readonly EvidenceRef[];
}

export function createObservationSnapshot(snapshotId: string, projections: readonly ObservationProjection[], evidence: readonly EvidenceRef[]): ObservationSnapshot {
  if (!snapshotId.trim() || projections.length === 0 || evidence.length === 0) throw new TypeError('Observation snapshot requires identity, projections, and evidence');
  return { snapshotId, observedAt: evidence[0]?.observedAt ?? new Date().toISOString(), projections, evidence };
}
