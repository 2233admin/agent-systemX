import type { EvidenceRef } from '../core/result.ts';
import { isRfc3339Timestamp } from '../core/result.ts';
import { canonicalHashFor, validateCanonicalArtifact, type CanonicalArtifactEnvelope } from './canonical.ts';

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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateArtifactV2(value: unknown): ArtifactV2Envelope {
  if (!record(value)) throw new TypeError('artifact v2 must be an object');
  const keys = ['schemaVersion', 'artifactKind', 'workflowId', 'revision', 'canonicalHash', 'value', 'observedAt'];
  if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError('artifact v2 has an invalid shape');
  }
  if (value.schemaVersion !== 2) throw new Error(`Unsupported artifact v2 schema version: ${String(value.schemaVersion)}`);
  if (!['workflow', 'evidence', 'gate', 'validation-decision'].includes(String(value.artifactKind))) throw new TypeError('artifact v2 kind is invalid');
  if (typeof value.workflowId !== 'string' || value.workflowId.trim().length === 0
    || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0
    || typeof value.canonicalHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.canonicalHash)
    || typeof value.observedAt !== 'string' || !isRfc3339Timestamp(value.observedAt)) {
    throw new TypeError('artifact v2 metadata is invalid');
  }
  const { canonicalHash: _canonicalHash, ...withoutHash } = value;
  if (canonicalHashFor(withoutHash) !== value.canonicalHash.toLowerCase()) throw new Error('artifact v2 canonical hash does not match content');
  return value as unknown as ArtifactV2Envelope;
}

export function migrateArtifact(value: unknown): MigrationResult {
  if (!record(value)) throw new TypeError('artifact migration requires an object');
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion === 2) {
    const target = validateArtifactV2(value);
    return { sourceDigest: canonicalHashFor(value), targetDigest: canonicalHashFor(target), migrated: false, evidence: [{ source: 'artifact.migration', observedAt: target.observedAt, locator: 'v2-idempotent' }], value: target };
  }
  const source = validateCanonicalArtifact(value);
  const { canonicalHash: _canonicalHash, ...withoutHash } = source;
  const targetWithoutHash = { ...withoutHash, schemaVersion: 2 as const };
  const target = validateArtifactV2({ ...targetWithoutHash, canonicalHash: canonicalHashFor(targetWithoutHash) });
  return { sourceDigest: canonicalHashFor(source), targetDigest: canonicalHashFor(target), migrated: true, evidence: [{ source: 'artifact.migration', observedAt: source.observedAt, locator: 'v1-to-v2' }], value: target };
}
