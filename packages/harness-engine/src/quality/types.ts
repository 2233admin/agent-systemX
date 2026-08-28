import type { EvidenceRef, Known, RecoveryAction, Unknown, Violation } from '../core/result.ts';

export type QualitySeverity = 'info' | 'warning' | 'error';
export type QualityResult = 'pass' | 'invalid' | 'unknown' | 'not-available';

export interface QualityFinding {
  readonly code: string;
  readonly severity: QualitySeverity;
  readonly path: string;
  readonly evidence: EvidenceRef;
  readonly recovery: RecoveryAction;
}

export type QualityKnowledge = Known<boolean> | Unknown;

export interface QualityEvaluation {
  readonly result: Exclude<QualityResult, 'not-available'>;
  readonly findings: readonly QualityFinding[];
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly knowledge: QualityKnowledge;
  readonly unknownFacts?: readonly Unknown[];
  readonly violations: readonly Violation[];
}

export interface QualityCommandResult {
  readonly command: 'quality-validate' | 'audit-run' | 'roles-check' | 'plugins-validate';
  readonly result: QualityResult;
  readonly findings: readonly QualityFinding[];
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly unknownFacts?: readonly Unknown[];
  readonly violations: readonly Violation[];
}

export interface QualityEvidenceInput {
  readonly source: string;
  readonly observedAt: string;
  readonly locator?: string;
}

export interface SourceAvailability {
  readonly sourceAvailable?: boolean;
  readonly evidence?: QualityEvidenceInput;
}
