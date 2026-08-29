import type { EvidenceRef } from '../core/result.ts';
import { evaluate, evidenceFrom, finding, invalidInput, isRecord, nonEmpty, readEvidence } from './helpers.ts';
import type { QualityEvaluation, QualityFinding } from './types.ts';

export interface RoleMapping {
  readonly roleId: string;
  readonly allowedHostIds: readonly string[];
  readonly sourceDigest: string;
  readonly evidence: EvidenceRef;
}

export interface RoleMapInput {
  readonly mappings: readonly RoleMapping[];
  readonly loadOrder: readonly string[];
  readonly evidence?: EvidenceRef;
  readonly sourceAvailable?: boolean;
}

function validMapping(value: unknown): value is RoleMapping {
  if (!isRecord(value) || !nonEmpty(value.roleId) || !Array.isArray(value.allowedHostIds)
    || value.allowedHostIds.length === 0 || !value.allowedHostIds.every(nonEmpty)
    || !/^[0-9a-f]{32,128}$/i.test(String(value.sourceDigest))) return false;
  return evidenceFrom(value.evidence) !== undefined;
}

function parseInput(value: unknown): RoleMapInput | null {
  if (!isRecord(value) || !Array.isArray(value.mappings) || !Array.isArray(value.loadOrder)) return null;
  const evidence = evidenceFrom(value.evidence);
  return {
    mappings: value.mappings as RoleMapping[],
    loadOrder: value.loadOrder as string[],
    ...(evidence === undefined ? {} : { evidence }),
    ...(value.sourceAvailable === false ? { sourceAvailable: false } : {}),
  };
}

export function validateRoleMap(value: unknown): QualityEvaluation {
  const input = parseInput(value);
  const { evidence, sourceAvailable } = readEvidence(value);
  if (input === null) return invalidInput('roles', evidence, 'roles.input.invalid');
  if (!sourceAvailable) return evaluate('unknown', [], evidence, 'roles.source.unavailable');

  const findings: QualityFinding[] = [];
  const seenRoles = new Set<string>();
  for (const mapping of input.mappings) {
    if (!validMapping(mapping)) {
      findings.push(finding('roles.mapping.invalid', 'error', 'roles', evidence, 'roles.fix-mapping'));
      continue;
    }
    if (seenRoles.has(mapping.roleId)) {
      findings.push(finding('roles.role.duplicate', 'error', `roles/${mapping.roleId}`, mapping.evidence, 'roles.remove-duplicate'));
    }
    seenRoles.add(mapping.roleId);
  }

  const seenOrder = new Set<string>();
  for (const roleId of input.loadOrder) {
    if (typeof roleId !== 'string' || roleId.trim().length === 0) {
      findings.push(finding('roles.load-order.invalid', 'error', 'roles', evidence, 'roles.fix-load-order'));
      continue;
    }
    if (seenOrder.has(roleId)) findings.push(finding('roles.load-order.duplicate', 'error', `roles/${roleId}`, evidence, 'roles-remove-duplicate'));
    seenOrder.add(roleId);
    if (!seenRoles.has(roleId)) findings.push(finding('roles.load-order.unknown-role', 'error', `roles/${roleId}`, evidence, 'roles.fix-load-order'));
  }
  if (seenOrder.size !== seenRoles.size || input.loadOrder.length !== seenRoles.size) {
    findings.push(finding('roles.load-order.incomplete', 'error', 'roles', evidence, 'roles.fix-load-order'));
  }
  return evaluate(findings.length === 0 ? 'pass' : 'invalid', findings, evidence);
}

export const checkRoles = validateRoleMap;
