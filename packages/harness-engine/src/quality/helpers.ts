import { isRfc3339Timestamp, known, unknown, validateEvidenceRef, type EvidenceRef, type RecoveryAction, type Violation } from '../core/result.ts';
import type { QualityEvaluation, QualityFinding, QualityEvidenceInput, QualitySeverity } from './types.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function denseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  return value.every((_item, index) => index in value);
}

export function evidenceFrom(value: unknown): EvidenceRef | undefined {
  if (!isRecord(value) || !isRfc3339Timestamp(value.observedAt) || !nonEmpty(value.source)) return undefined;
  try {
    validateEvidenceRef(value);
    return value as unknown as EvidenceRef;
  } catch {
    return undefined;
  }
}

function fallbackEvidence(): EvidenceRef {
  return { source: 'harness-engine.quality', observedAt: new Date().toISOString() };
}

export function finding(
  code: string,
  severity: QualitySeverity,
  path: string,
  evidence: EvidenceRef | undefined,
  recoveryCode = 'quality.fix-input',
): QualityFinding {
  const safePath = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) ? `<absolute>/${path.split(/[\\/]/).pop() ?? 'unknown'}` : path;
  const ref = evidence ?? fallbackEvidence();
  return {
    code,
    severity,
    path: safePath,
    evidence: ref,
    recovery: { code: recoveryCode },
  };
}

export function toViolations(findings: readonly QualityFinding[]): readonly Violation[] {
  return findings.map(({ code }) => ({ code }));
}

export function evaluate(
  result: QualityEvaluation['result'],
  findings: readonly QualityFinding[],
  evidence: EvidenceRef | undefined,
  unknownReason?: string,
): QualityEvaluation {
  const evidenceRefs = evidence === undefined ? [] : [evidence];
  if (unknownReason !== undefined) {
    const fact = unknown(unknownReason, evidence?.observedAt ?? new Date().toISOString(), 'provide a readable source and evidence reference');
    return {
      result: 'unknown',
      findings,
      evidenceRefs,
      knowledge: fact,
      unknownFacts: [fact],
      violations: toViolations(findings),
    };
  }
  return {
    result,
    findings,
    evidenceRefs,
    knowledge: known(result === 'pass', evidence ?? fallbackEvidence()),
    violations: toViolations(findings),
  };
}

export function invalidInput(path: string, evidence: EvidenceRef | undefined, code = 'quality.input.invalid'): QualityEvaluation {
  const item = finding(code, 'error', path, evidence);
  return evaluate('invalid', [item], evidence);
}

export function readEvidence(value: unknown): { evidence?: EvidenceRef; sourceAvailable: boolean } {
  const record = isRecord(value) ? value : undefined;
  return {
    evidence: evidenceFrom(record?.evidence),
    sourceAvailable: record?.sourceAvailable !== false,
  };
}

export function asEvidence(value: QualityEvidenceInput): EvidenceRef {
  validateEvidenceRef(value);
  return value;
}

export type QualityInputRecord = Record<string, unknown>;
export type { RecoveryAction };
