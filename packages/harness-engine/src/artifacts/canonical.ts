import { createHash } from 'node:crypto';
import { isRfc3339Timestamp } from '../core/result.ts';

export type CanonicalArtifactKind = 'workflow' | 'evidence' | 'gate' | 'validation-decision';

export interface CanonicalArtifactEnvelope<T = unknown> {
  readonly schemaVersion: 1;
  readonly artifactKind: CanonicalArtifactKind;
  readonly workflowId: string;
  readonly revision: number;
  readonly canonicalHash: string;
  readonly value: T;
  readonly observedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertCanonicalValue(value: unknown): void {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError('Canonical artifact values must be JSON-compatible');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Canonical artifact values must not contain non-finite numbers');
  }
  if (Array.isArray(value)) {
    for (const item of value) assertCanonicalValue(item);
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new TypeError(`Canonical artifact value has undefined field: ${key}`);
      assertCanonicalValue(item);
    }
  }
}

export function canonicalize(value: unknown): string {
  assertCanonicalValue(value);
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  throw new TypeError('Canonical artifact values must be JSON-compatible');
}

export function canonicalHashFor(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

export function createCanonicalArtifact<T>(input: {
  readonly artifactKind: CanonicalArtifactKind;
  readonly workflowId: string;
  readonly revision: number;
  readonly value: T;
  readonly observedAt: string;
}): CanonicalArtifactEnvelope<T> {
  if (input.workflowId.trim().length === 0) throw new TypeError('Canonical artifact requires a workflowId');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new TypeError('Canonical artifact revision must be a non-negative safe integer');
  }
  if (!isRfc3339Timestamp(input.observedAt)) throw new TypeError('Canonical artifact observedAt must be RFC 3339');
  assertCanonicalValue(input.value);
  const withoutHash = {
    schemaVersion: 1 as const,
    artifactKind: input.artifactKind,
    workflowId: input.workflowId,
    revision: input.revision,
    value: input.value,
    observedAt: input.observedAt,
  };
  return { ...withoutHash, canonicalHash: canonicalHashFor(withoutHash) };
}

export function validateCanonicalArtifact(value: unknown): CanonicalArtifactEnvelope {
  if (!isRecord(value)) throw new TypeError('Canonical artifact must be an object');
  const keys = ['schemaVersion', 'artifactKind', 'workflowId', 'revision', 'canonicalHash', 'value', 'observedAt'] as const;
  if (Object.keys(value).some((key) => !keys.includes(key as typeof keys[number]))
    || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError('Canonical artifact has an invalid shape');
  }
  if (value.schemaVersion !== 1) {
    if (typeof value.schemaVersion === 'number' && value.schemaVersion > 1) {
      throw new Error(`Unsupported future canonical artifact schema version: ${value.schemaVersion}`);
    }
    throw new Error(`Unsupported canonical artifact schema version: ${String(value.schemaVersion)}`);
  }
  if (value.artifactKind !== 'workflow' && value.artifactKind !== 'evidence'
    && value.artifactKind !== 'gate' && value.artifactKind !== 'validation-decision') {
    throw new TypeError('Canonical artifact kind is invalid');
  }
  const revision = typeof value.revision === 'number' ? value.revision : Number.NaN;
  const canonicalHash = value.canonicalHash;
  const observedAt = value.observedAt;
  if (typeof value.workflowId !== 'string' || value.workflowId.trim().length === 0
    || !Number.isSafeInteger(revision) || revision < 0
    || typeof canonicalHash !== 'string' || !/^[a-f0-9]{64}$/i.test(canonicalHash)
    || typeof observedAt !== 'string' || !isRfc3339Timestamp(observedAt)) {
    throw new TypeError('Canonical artifact metadata is invalid');
  }
  assertCanonicalValue(value.value);
  const { canonicalHash: _canonicalHash, ...withoutHash } = value;
  if (canonicalHashFor(withoutHash) !== canonicalHash.toLowerCase()) {
    throw new Error('Canonical artifact canonical hash does not match content');
  }
  return value as unknown as CanonicalArtifactEnvelope;
}
