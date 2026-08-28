import type { EvidenceRef } from '../core/result.ts';
import { canonicalHashFor, canonicalize, validateCanonicalArtifact, type CanonicalArtifactEnvelope } from './canonical.ts';

export interface ArtifactV2Envelope extends Omit<CanonicalArtifactEnvelope, 'schemaVersion' | 'canonicalHash'> {
  readonly schemaVersion: 2;
  readonly canonicalHash: string;
}

export interface MigrationResult {
  readonly sourceDigest: string;
  readonly targetDigest: string;
  readonly migrated: boolean;
  readonly evidence: readonly EvidenceRef[];
  readonly value: ArtifactV2Envelope;
}

export function migrateArtifact(value: unknown): MigrationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('artifact migration requires an object');
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion === 2) {
    const target = value as ArtifactV2Envelope;
    if (typeof target.canonicalHash !== 'string' || !/^[a-f0-9]{64}$/i.test(target.canonicalHash)) throw new TypeError('artifact v2 canonical hash is invalid');
    return { sourceDigest: canonicalHashFor(value), targetDigest: canonicalHashFor(value), migrated: false, evidence: [{ source: 'artifact.migration', observedAt: target.observedAt, locator: 'v2-idempotent' }], value: target };
  }
  const source = validateCanonicalArtifact(value);
  const { canonicalHash: _canonicalHash, ...withoutHash } = source;
  const targetWithoutHash = { ...withoutHash, schemaVersion: 2 as const };
  const target = { ...targetWithoutHash, canonicalHash: canonicalHashFor(targetWithoutHash) } as ArtifactV2Envelope;
  return { sourceDigest: canonicalHashFor(source), targetDigest: canonicalHashFor(target), migrated: true, evidence: [{ source: 'artifact.migration', observedAt: source.observedAt, locator: 'v1-to-v2' }], value: target };
}
