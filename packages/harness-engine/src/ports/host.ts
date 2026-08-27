import type { EvidenceRef } from '../core/result.ts';
import { validateEvidenceRef } from '../core/result.ts';

export type CapabilityStatus = 'supported' | 'degraded' | 'unsupported' | 'unknown';

export interface HostCapabilityEvidence extends EvidenceRef {
  readonly hostId: string;
  readonly hostVersion: string;
}

export interface SupportedCapability {
  readonly status: 'supported';
  readonly hostId: string;
  readonly hostVersion: string;
  readonly evidence: HostCapabilityEvidence;
}

export interface NonSupportedCapability {
  readonly status: 'degraded' | 'unsupported' | 'unknown';
  readonly hostId: string;
  readonly hostVersion: string;
  readonly reasonCode: string;
  readonly evidence?: HostCapabilityEvidence;
}

export type CapabilityResult = SupportedCapability | NonSupportedCapability;

export interface HostContext {
  readonly hostId: string;
  readonly hostVersion: string;
}

export interface HostAssignment extends HostContext {
  readonly assignmentId: string;
}

export interface HostOperation extends HostContext {
  readonly operationId: string;
}

export interface HostObservation extends HostContext {
  readonly operationId: string;
  readonly status: CapabilityStatus;
  readonly evidence?: HostCapabilityEvidence;
}

/** Host 只报告绑定到主机版本的能力事实；不持有 workflow 状态。 */
export interface HostAdapter {
  probe(hostContext: HostContext): Promise<CapabilityResult>;
  prepare(assignment: HostAssignment): Promise<CapabilityResult>;
  observe(operation: HostOperation): Promise<CapabilityResult>;
  interpret(observation: HostObservation): Promise<CapabilityResult>;
}

const CAPABILITY_STATUSES: readonly CapabilityStatus[] = ['supported', 'degraded', 'unsupported', 'unknown'];

export function isCapabilityStatus(value: unknown): value is CapabilityStatus {
  return typeof value === 'string' && CAPABILITY_STATUSES.includes(value as CapabilityStatus);
}

export function validateCapabilityStatus(value: unknown): CapabilityStatus {
  if (!isCapabilityStatus(value)) {
    throw new TypeError(`Capability status must be supported, degraded, unsupported, or unknown; received ${String(value)}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateCapabilityEvidence(value: unknown, hostId: string, hostVersion: string): boolean {
  if (!isRecord(value)
    || Object.keys(value).some((key) => !['source', 'observedAt', 'locator', 'hostId', 'hostVersion'].includes(key))) {
    return false;
  }
  if (value.hostId !== hostId || value.hostVersion !== hostVersion) return false;
  try {
    validateEvidenceRef(value as unknown as EvidenceRef);
    return nonEmpty(value.source) && nonEmpty(value.hostId) && nonEmpty(value.hostVersion);
  } catch {
    return false;
  }
}

export function validateCapabilityResult(value: unknown): CapabilityResult {
  if (!isRecord(value)) throw new TypeError('Capability result must be an object');
  const status = validateCapabilityStatus(value.status);
  if (Object.keys(value).some((key) => !['status', 'hostId', 'hostVersion', 'reasonCode', 'evidence'].includes(key))) {
    throw new TypeError('Capability result contains fields outside its allowlist');
  }
  if (!nonEmpty(value.hostId) || !nonEmpty(value.hostVersion)) {
    throw new TypeError('Capability result requires hostId and hostVersion');
  }
  if (status === 'supported') {
    if (!Object.hasOwn(value, 'evidence') || !validateCapabilityEvidence(value.evidence, value.hostId, value.hostVersion)) {
      throw new TypeError('A supported capability requires evidence bound to its host identity and version');
    }
  } else {
    if (!nonEmpty(value.reasonCode)) {
      throw new TypeError(`${status} capability requires a non-empty reasonCode`);
    }
    if (value.evidence !== undefined && !validateCapabilityEvidence(value.evidence, value.hostId, value.hostVersion)) {
      throw new TypeError('Capability evidence must be bound to its host identity and version');
    }
  }
  return value as unknown as CapabilityResult;
}

export function isCapabilityResult(value: unknown): value is CapabilityResult {
  try {
    validateCapabilityResult(value);
    return true;
  } catch {
    return false;
  }
}
