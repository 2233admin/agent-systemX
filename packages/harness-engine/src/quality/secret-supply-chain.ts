import type { EvidenceRef } from '../core/result.ts';
import { evaluate, evidenceFrom, finding, invalidInput, isRecord, nonEmpty, readEvidence } from './helpers.ts';
import type { QualityEvaluation, QualityFinding } from './types.ts';

export interface AuditFileInput {
  readonly path: string;
  readonly content: string;
}

export interface SecretSupplyChainInput {
  readonly files: readonly AuditFileInput[];
  readonly evidence?: EvidenceRef;
  readonly sourceAvailable?: boolean;
}

const SECRET_PATTERNS: readonly [string, RegExp][] = [
  ['audit.secret.private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['audit.secret.github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['audit.secret.provider-key', /\bsk-[A-Za-z0-9]{20,}\b/],
  ['audit.secret.assigned-secret', /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9_./+=-]{12,}["']/i],
];

const SUPPLY_CHAIN_PATTERNS: readonly [string, RegExp][] = [
  ['audit.supply-chain.remote-script', /(?:curl|wget)\s+[^\n|]+\|\s*(?:bash|sh|zsh|pwsh)\b/i],
  ['audit.supply-chain.remote-package', /(?:npm|bun|pnpm|yarn)\s+install\s+(?:https?:\/\/|git\+|github:)/i],
  ['audit.supply-chain.pipe-exec', /\b(?:Invoke-WebRequest|iwr|irm)\b[^\n|]*\|\s*(?:iex|Invoke-Expression)\b/i],
];

function parseFiles(value: unknown): SecretSupplyChainInput | null {
  if (!isRecord(value) || !Array.isArray(value.files)) return null;
  const evidence = evidenceFrom(value.evidence);
  return {
    files: value.files as AuditFileInput[],
    ...(evidence === undefined ? {} : { evidence }),
    ...(value.sourceAvailable === false ? { sourceAvailable: false } : {}),
  };
}

export function scanSecretsAndSupplyChain(value: unknown): QualityEvaluation {
  const input = parseFiles(value);
  const { evidence, sourceAvailable } = readEvidence(value);
  if (input === null || input.files.some((file) => !isRecord(file) || !nonEmpty(file.path) || typeof file.content !== 'string')) {
    return invalidInput('audit', evidence, 'audit.input.invalid');
  }
  if (!sourceAvailable) return evaluate('unknown', [], evidence, 'audit.source.unavailable');

  const findings: QualityFinding[] = [];
  for (const file of input.files) {
    for (const [code, pattern] of SECRET_PATTERNS) {
      if (pattern.test(file.content)) findings.push(finding(code, 'error', file.path, input.evidence, 'audit.remove-secret'));
    }
    for (const [code, pattern] of SUPPLY_CHAIN_PATTERNS) {
      if (pattern.test(file.content)) findings.push(finding(code, 'error', file.path, input.evidence, 'audit.review-dependency-source'));
    }
  }
  return evaluate(findings.length === 0 ? 'pass' : 'invalid', findings, input.evidence);
}

export const scanSecrets = scanSecretsAndSupplyChain;
