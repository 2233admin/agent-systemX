import type { EvidenceRef } from '../core/result.ts';
import { evaluate, evidenceFrom, finding, invalidInput, isRecord, nonEmpty, readEvidence } from './helpers.ts';
import type { QualityEvaluation, QualityFinding } from './types.ts';

export interface PlanQualityInput {
  readonly path: string;
  readonly content: string;
  readonly evidence?: EvidenceRef;
  readonly sourceAvailable?: boolean;
}

const TDD_SECTIONS = [
  ['tests', /^#{1,6}\s+(?:tests?|red|test first)\b/im, 'plan.tdd.tests.missing'],
  ['implementation', /^#{1,6}\s+(?:implementation|green)\b/im, 'plan.tdd.implementation.missing'],
  ['verification', /^#{1,6}\s+(?:verification|refactor|verify)\b/im, 'plan.tdd.verification.missing'],
] as const;

function hasFrontmatter(content: string): boolean {
  const lines = content.split(/\r?\n/);
  return lines[0]?.trim() === '---' && lines.slice(1).some((line) => line.trim() === '---');
}

function hasTemporaryMarker(content: string): boolean {
  return /\b(?:TODO|TBD|FIXME|TEMPORARY|WIP)\b/i.test(content);
}

function validateInput(value: unknown): PlanQualityInput | null {
  if (!isRecord(value) || !nonEmpty(value.path) || typeof value.content !== 'string') return null;
  const evidence = evidenceFrom(value.evidence);
  return {
    path: value.path,
    content: value.content,
    ...(evidence === undefined ? {} : { evidence }),
    ...(value.sourceAvailable === false ? { sourceAvailable: false } : {}),
  };
}

export function validatePlanQuality(value: unknown): QualityEvaluation {
  const input = validateInput(value);
  const { evidence, sourceAvailable } = readEvidence(value);
  if (input === null) return invalidInput('plan', evidence, 'plan.input.invalid');
  if (!sourceAvailable) return evaluate('unknown', [], evidence, 'quality.source.unavailable');
  const findings: QualityFinding[] = [];

  if (!hasFrontmatter(input.content)) {
    findings.push(finding('plan.frontmatter.missing', 'error', input.path, input.evidence, 'plan.add-frontmatter'));
  }
  for (const [, pattern, code] of TDD_SECTIONS) {
    if (!pattern.test(input.content)) {
      findings.push(finding(code, 'error', input.path, input.evidence, 'plan.add-tdd-section'));
    }
  }
  if (hasTemporaryMarker(input.content)) {
    findings.push(finding('plan.temporary-marker.present', 'warning', input.path, input.evidence, 'plan.remove-temporary-marker'));
  }
  return evaluate(findings.length === 0 ? 'pass' : 'invalid', findings, input.evidence);
}

export const lintPlan = validatePlanQuality;
