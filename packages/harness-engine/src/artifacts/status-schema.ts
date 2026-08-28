import { validateCanonicalArtifact } from './canonical.ts';

export interface ArtifactSchemaStatus {
  readonly schemaVersion: number;
  readonly revision: number;
  readonly compatible: boolean;
  readonly migrationRequired: boolean;
}

export function inspectArtifactSchema(value: unknown): ArtifactSchemaStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('artifact schema must be an object');
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion === 1) {
    const envelope = validateCanonicalArtifact(value);
    return { schemaVersion: 1, revision: envelope.revision, compatible: true, migrationRequired: true };
  }
  if (candidate.schemaVersion === 2) {
    if (typeof candidate.revision !== 'number' || !Number.isSafeInteger(candidate.revision) || candidate.revision < 0) throw new TypeError('artifact revision is invalid');
    if (typeof candidate.canonicalHash !== 'string' || !/^[a-f0-9]{64}$/i.test(candidate.canonicalHash)) throw new TypeError('artifact canonical hash is invalid');
    return { schemaVersion: 2, revision: candidate.revision, compatible: true, migrationRequired: false };
  }
  if (typeof candidate.schemaVersion === 'number' && candidate.schemaVersion > 2) throw new Error(`Unsupported future artifact schema version: ${candidate.schemaVersion}`);
  throw new Error(`Unsupported artifact schema version: ${String(candidate.schemaVersion)}`);
}
