import type { EvidenceRef } from '../core/result.ts';
import { validateEvidenceRef } from '../core/result.ts';

export type CapabilityStatus = 'supported' | 'degraded' | 'unsupported' | 'unknown';

export interface SupportedCapability {
  readonly status: 'supported';
  readonly evidence: EvidenceRef;
}

export interface NonSupportedCapability {
  readonly status: 'degraded' | 'unsupported' | 'unknown';
  readonly reasonCode: string;
  readonly evidence?: EvidenceRef;
}

export type CapabilityResult = SupportedCapability | NonSupportedCapability;

export interface HostRequest {
  readonly hostId: string;
  readonly capability: string;
  readonly runId?: string;
  readonly taskId?: string;
}

/** Host 只报告能力事实；准备、观察和解释都不持有 workflow 状态。 */
export interface HostAdapter {
  probe(request: HostRequest): Promise<CapabilityResult>;
  prepare(request: HostRequest): Promise<CapabilityResult>;
  observe(request: HostRequest): Promise<CapabilityResult>;
  interpret(request: HostRequest): Promise<CapabilityResult>;
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

function validateCapabilityEvidence(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || Object.keys(value).some((key) => !['source', 'observedAt', 'locator'].includes(key))) {
    return false;
  }
  try {
    validateEvidenceRef(value as unknown as EvidenceRef);
    return nonEmpty((value as unknown as EvidenceRef).source);
  } catch {
    return false;
  }
}

export function validateCapabilityResult(value: unknown): CapabilityResult {
  if (!isRecord(value)) throw new TypeError('Capability result must be an object');
  const status = validateCapabilityStatus(value.status);
  const allowed = status === 'supported'
    ? ['status', 'evidence']
    : ['status', 'reasonCode', 'evidence'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new TypeError('Capability result contains fields outside its allowlist');
  }
  if (!validateCapabilityEvidence(value.evidence)) {
    throw new TypeError('Capability result evidence must be a valid EvidenceRef');
  }
  if (status === 'supported') {
    if (!Object.hasOwn(value, 'evidence')) {
      throw new TypeError('A supported capability requires caller-provided evidence');
    }
  } else if (!nonEmpty(value.reasonCode)) {
    throw new TypeError(`${status} capability requires a non-empty reasonCode`);
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
