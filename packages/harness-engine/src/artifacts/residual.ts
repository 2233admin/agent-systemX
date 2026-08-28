import type { EvidenceRef } from '../core/result.ts';
import { validateEvidenceRef } from '../core/result.ts';

export interface ResidualRecord {
  readonly residualId: string;
  readonly owner: string;
  readonly decision: string;
  readonly target: string;
  readonly status: 'open' | 'closed';
  readonly closureEvidence?: readonly EvidenceRef[];
}

export function validateResidualRecord(value: unknown): value is ResidualRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.residualId !== 'string' || record.residualId.trim().length === 0
    || typeof record.owner !== 'string' || record.owner.trim().length === 0
    || typeof record.decision !== 'string' || record.decision.trim().length === 0
    || typeof record.target !== 'string' || record.target.trim().length === 0
    || (record.status !== 'open' && record.status !== 'closed')) return false;
  if (record.status === 'closed') {
    if (!Array.isArray(record.closureEvidence) || record.closureEvidence.length === 0) return false;
    try { record.closureEvidence.forEach((evidence) => validateEvidenceRef(evidence)); } catch { return false; }
  }
  return true;
}

export function closeResidual(record: ResidualRecord, evidence: EvidenceRef | readonly EvidenceRef[]): ResidualRecord {
  if (!validateResidualRecord(record) || record.status !== 'open') throw new TypeError('Only a valid open residual can be closed');
  const closureEvidence = Array.isArray(evidence) ? evidence : [evidence];
  closureEvidence.forEach((item) => validateEvidenceRef(item));
  return { ...record, status: 'closed', closureEvidence };
}
