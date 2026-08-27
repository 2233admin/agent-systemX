import { isRfc3339Timestamp } from './result';

export interface StableIdentity {
  readonly workflowId: string;
  readonly planId: string;
  readonly taskId?: string;
}

export interface ArtifactRevision {
  readonly schemaVersion: number;
  readonly revision: number;
  readonly updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function validateStableIdentity(value: StableIdentity): StableIdentity {
  if (!isRecord(value) || typeof value.workflowId !== 'string' || value.workflowId.trim().length === 0) {
    throw new TypeError('StableIdentity requires a non-empty workflowId');
  }
  if (typeof value.planId !== 'string' || value.planId.trim().length === 0) {
    throw new TypeError('StableIdentity requires a non-empty planId');
  }
  if (value.taskId !== undefined && (typeof value.taskId !== 'string' || value.taskId.trim().length === 0)) {
    throw new TypeError('StableIdentity taskId must be non-empty when present');
  }
  return value;
}

export function validateArtifactRevision(value: ArtifactRevision): ArtifactRevision {
  if (
    !isRecord(value) ||
    typeof value.schemaVersion !== 'number' ||
    typeof value.revision !== 'number' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new TypeError('ArtifactRevision requires numeric schemaVersion/revision and updatedAt');
  }
  if (!isRfc3339Timestamp(value.updatedAt)) {
    throw new TypeError('ArtifactRevision updatedAt must be an RFC 3339 timestamp');
  }
  return value;
}
