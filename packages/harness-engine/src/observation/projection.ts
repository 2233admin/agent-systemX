import type { EvidenceRef } from '../core/result.ts';
import { validateEvidenceRef } from '../core/result.ts';

export interface ObservationProjection {
  readonly source: 'workflow' | 'host' | 'release';
  readonly observedAt: string;
  readonly state: string;
  readonly evidence: readonly EvidenceRef[];
}

export function createObservationProjection(source: ObservationProjection['source'], state: string, evidence: readonly EvidenceRef[]): ObservationProjection {
  try { evidence.forEach((item) => validateEvidenceRef(item)); } catch { return { source, observedAt: new Date().toISOString(), state: 'unknown', evidence: [] }; }
  return { source, observedAt: evidence[0]?.observedAt ?? new Date().toISOString(), state: state.trim() || 'unknown', evidence };
}
