import type { EvidenceRef } from '../core/result.ts';
import { validateEvidenceRef } from '../core/result.ts';

export interface HostCapabilitySnapshot {
  readonly hostId: string;
  readonly version: string;
  readonly status: 'contract' | 'fixture' | 'real-smoke' | 'active' | 'unsupported' | 'unknown';
  readonly evidence: readonly EvidenceRef[];
  readonly reasonCode?: string;
}

function validEvidence(evidence: readonly EvidenceRef[]): boolean {
  try { evidence.forEach((item) => validateEvidenceRef(item)); return evidence.length > 0; } catch { return false; }
}

export function discoverHost(input: { readonly hostId: string; readonly version: string; readonly evidence: readonly EvidenceRef[] }): HostCapabilitySnapshot {
  if (!input.hostId.trim() || !input.version.trim() || !validEvidence(input.evidence)) return { hostId: input.hostId, version: input.version, status: 'unknown', evidence: input.evidence, reasonCode: 'host.discovery.incomplete' };
  if (input.hostId === 'codex' || input.hostId === 'opencode') return { ...input, status: 'unsupported', reasonCode: 'host.real-evidence.unavailable' };
  return { ...input, status: 'contract' };
}

export function doctorHost(input: { readonly hostId: string; readonly version: string; readonly evidence: readonly EvidenceRef[] }): HostCapabilitySnapshot {
  const snapshot = discoverHost(input);
  return snapshot.status === 'contract' ? { ...snapshot, status: 'unknown', reasonCode: 'host.real-smoke.not-available' } : snapshot;
}
