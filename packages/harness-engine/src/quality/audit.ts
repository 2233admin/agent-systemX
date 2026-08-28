import type { EvidenceRef } from '../core/result.ts';
import { evaluate, evidenceFrom, finding, invalidInput, isRecord, nonEmpty, readEvidence } from './helpers.ts';
import { scanSecretsAndSupplyChain, type AuditFileInput } from './secret-supply-chain.ts';
import type { QualityEvaluation, QualityFinding } from './types.ts';

export interface PlanAuditInput {
  readonly root: string;
  readonly files: readonly AuditFileInput[];
  readonly requiredFiles?: readonly string[];
  readonly evidence?: EvidenceRef;
  readonly sourceAvailable?: boolean;
}

function parseInput(value: unknown): PlanAuditInput | null {
  if (!isRecord(value) || !nonEmpty(value.root) || !Array.isArray(value.files)) return null;
  const evidence = evidenceFrom(value.evidence);
  const requiredFiles = value.requiredFiles === undefined
    ? ['PLAN.md']
    : Array.isArray(value.requiredFiles) && value.requiredFiles.every(nonEmpty)
      ? value.requiredFiles
      : undefined;
  if (requiredFiles === undefined) return null;
  return {
    root: value.root,
    files: value.files as AuditFileInput[],
    requiredFiles,
    ...(evidence === undefined ? {} : { evidence }),
    ...(value.sourceAvailable === false ? { sourceAvailable: false } : {}),
  };
}

function withinRoot(root: string, relativePath: string): boolean {
  if (relativePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relativePath)) return false;
  const segments = relativePath.replaceAll('\\', '/').split('/');
  return segments.every((segment) => segment !== '..');
}

export function auditPlanFiles(value: unknown): QualityEvaluation {
  const input = parseInput(value);
  const { evidence, sourceAvailable } = readEvidence(value);
  if (input === null || input.files.some((file) => !isRecord(file) || !nonEmpty(file.path) || typeof file.content !== 'string')) {
    return invalidInput('audit', evidence, 'audit.input.invalid');
  }
  if (!sourceAvailable) return evaluate('unknown', [], evidence, 'audit.source.unavailable');

  const findings: QualityFinding[] = [];
  const paths = new Set<string>();
  for (const file of input.files) {
    const normalized = file.path.replaceAll('\\', '/');
    if (!withinRoot(input.root, normalized)) {
      findings.push(finding('audit.plan.path-escape', 'error', file.path, input.evidence, 'audit.remove-path-escape'));
    }
    if (paths.has(normalized)) {
      findings.push(finding('audit.plan.path.duplicate', 'error', file.path, input.evidence, 'audit-remove-duplicate'));
    }
    paths.add(normalized);
  }

  for (const required of input.requiredFiles ?? []) {
    if (!paths.has(required.replaceAll('\\', '/'))) {
      findings.push(finding('audit.plan.scaffold.missing', 'error', required, input.evidence, 'audit.add-required-plan-file'));
    }
  }

  const supplyResult = scanSecretsAndSupplyChain({ files: input.files, evidence: input.evidence });
  findings.push(...supplyResult.findings);
  return evaluate(findings.length === 0 ? 'pass' : 'invalid', findings, input.evidence);
}

export const runAudit = auditPlanFiles;
