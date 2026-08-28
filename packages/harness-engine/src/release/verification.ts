import type { EvidenceRef } from '../core/result.ts';
import { validateEvidenceRef } from '../core/result.ts';

export interface ReleaseVerification {
  readonly artifactDigest: string;
  readonly platform: string;
  readonly installedVersion?: string;
  readonly status: 'verified' | 'failed' | 'unknown';
  readonly evidence: readonly EvidenceRef[];
  readonly reasonCode?: string;
}

export function verifyReleaseArtifact(input: { readonly artifactDigest: string; readonly observedDigest: string; readonly platform: string; readonly installedVersion?: string; readonly evidence: readonly EvidenceRef[] }): ReleaseVerification {
  try { input.evidence.forEach((item) => validateEvidenceRef(item)); } catch { return { artifactDigest: input.artifactDigest, platform: input.platform, status: 'unknown', evidence: input.evidence, reasonCode: 'release.evidence.invalid' }; }
  if (!input.artifactDigest.trim() || !input.observedDigest.trim() || !input.platform.trim()) return { artifactDigest: input.artifactDigest, platform: input.platform, status: 'unknown', evidence: input.evidence, reasonCode: 'release.artifact.not-available' };
  if (input.artifactDigest !== input.observedDigest) return { artifactDigest: input.artifactDigest, platform: input.platform, status: 'failed', evidence: input.evidence, reasonCode: 'release.digest.drift' };
  return { artifactDigest: input.artifactDigest, platform: input.platform, installedVersion: input.installedVersion, status: 'verified', evidence: input.evidence };
}
